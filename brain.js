/**
 * ================================================================
 *  brain.js — Migration Sniper Advisor (Self-Learning Edition)
 *
 *  No static keyword lists. No hardcoded thresholds.
 *  Everything derives from actual trade history.
 *
 *  Three layers:
 *    1. Mood       — auto-calibrated from your real win rate
 *    2. Trend      — words brain observed winning, self-built
 *    3. Patterns   — win/loss traits from closed trades
 *
 *  Bot.js wiring:
 *    brain.observeCoin(symbol, name, filterScore, filterTotal)  — every evaluated coin
 *    brain.evaluate(dex, pnlTrades)                             — after runFilters()
 *    brain.recordTrade(symbol, pnl, win, reason, tiers, name)   — after trade closes
 *    brain.getBrainReport(pnlTrades)                            — /brain command
 *    brain.getPatternsReport()                                  — /patterns command
 *    brain.getTrendsReport()                                    — /trends command
 * ================================================================
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const BRAIN_MEMORY_FILE = path.join(__dirname, "brain_memory.json");
const TREND_MEMORY_FILE = path.join(__dirname, "trend_memory.json");

// ─────────────────────────────────────────────
//  CLOUD BACKUP — JSONBin (optional)
// ─────────────────────────────────────────────
var JSONBIN_BIN_ID  = process.env.JSONBIN_BIN_ID  || null;
var JSONBIN_API_KEY = process.env.JSONBIN_API_KEY  || null;
var JSONBIN_URL     = JSONBIN_BIN_ID ? "https://api.jsonbin.io/v3/b/" + JSONBIN_BIN_ID : null;

async function loadFromCloud() {
  if (!JSONBIN_URL || !JSONBIN_API_KEY) return null;
  try {
    var axios = require("axios");
    var r = await axios.get(JSONBIN_URL + "/latest", {
      headers: { "X-Master-Key": JSONBIN_API_KEY },
      timeout: 8000
    });
    return r.data && r.data.record || null;
  } catch (e) {
    console.log("🧠 Cloud load failed:", e.message);
    return null;
  }
}

async function saveToCloud(data) {
  if (!JSONBIN_URL || !JSONBIN_API_KEY) return;
  try {
    var axios = require("axios");
    await axios.put(JSONBIN_URL, data, {
      headers: { "X-Master-Key": JSONBIN_API_KEY, "Content-Type": "application/json" },
      timeout: 8000
    });
  } catch (e) {
    console.log("🧠 Cloud save failed:", e.message);
  }
}

// ─────────────────────────────────────────────
//  SIGNAL HISTORY — ring buffer, last 50
// ─────────────────────────────────────────────
var signalHistory = [];
var MAX_HISTORY   = 50;

// ─────────────────────────────────────────────
//  PERSISTENT TRADE MEMORY
// ─────────────────────────────────────────────
var MAX_BRAIN_MEMORY = 200;
var brainTradeMemory = [];

(async function loadBrainMemory() {
  try {
    var cloudData = await loadFromCloud();
    if (cloudData && Array.isArray(cloudData.brainTrades) && cloudData.brainTrades.length > 0) {
      brainTradeMemory = cloudData.brainTrades.slice(-MAX_BRAIN_MEMORY);
      if (cloudData.trendMemory) trendMemory = cloudData.trendMemory;
      console.log("🧠 Brain loaded " + brainTradeMemory.length + " trades from cloud");
      try { fs.writeFileSync(BRAIN_MEMORY_FILE, JSON.stringify(brainTradeMemory), "utf8"); } catch(e) {}
      return;
    }
  } catch (e) {}
  try {
    if (fs.existsSync(BRAIN_MEMORY_FILE)) {
      var raw    = fs.readFileSync(BRAIN_MEMORY_FILE, "utf8");
      var loaded = JSON.parse(raw);
      if (Array.isArray(loaded)) {
        brainTradeMemory = loaded.slice(-MAX_BRAIN_MEMORY);
        console.log("🧠 Brain loaded " + brainTradeMemory.length + " trades from disk");
      }
    }
  } catch (e) {
    console.error("🧠 Brain memory load failed (starting fresh):", e.message);
    brainTradeMemory = [];
  }
})();

function saveBrainMemory() {
  try { fs.writeFileSync(BRAIN_MEMORY_FILE, JSON.stringify(brainTradeMemory), "utf8"); } catch (e) {}
  if (brainTradeMemory.length % 5 === 0) {
    saveToCloud({ brainTrades: brainTradeMemory, trendMemory: trendMemory }).catch(function(){});
  }
}

// ─────────────────────────────────────────────
//  TREND MEMORY — self-built from winning trades
//  No hardcoded keywords. Brain extracts words
//  from every coin it sees and scores them purely
//  from outcomes.
// ─────────────────────────────────────────────
var trendMemory = {};

try {
  if (fs.existsSync(TREND_MEMORY_FILE)) {
    var rawTrend = fs.readFileSync(TREND_MEMORY_FILE, "utf8");
    trendMemory  = JSON.parse(rawTrend) || {};
    console.log("📈 Trend memory loaded: " + Object.keys(trendMemory).length + " patterns");
  }
} catch (e) { trendMemory = {}; }

function saveTrendMemory() {
  try { fs.writeFileSync(TREND_MEMORY_FILE, JSON.stringify(trendMemory), "utf8"); } catch (e) {}
}

// ─────────────────────────────────────────────
//  OBSERVE MEMORY — every coin seen, not just traded
//  Decays after 2hrs. Writes every 20 coins.
// ─────────────────────────────────────────────
var OBSERVE_FILE  = path.join(__dirname, "observe_memory.json");
var observeMemory = {};
var observeWrites = 0;

try {
  if (fs.existsSync(OBSERVE_FILE)) {
    observeMemory = JSON.parse(fs.readFileSync(OBSERVE_FILE, "utf8")) || {};
    console.log("👁 Observe memory loaded: " + Object.keys(observeMemory).length + " patterns");
  }
} catch (e) { observeMemory = {}; }

function saveObserveMemory() {
  try { fs.writeFileSync(OBSERVE_FILE, JSON.stringify(observeMemory), "utf8"); } catch (e) {}
}

// Extract meaningful words from symbol/name — skip filler
function extractPatterns(symbol, name) {
  var patterns = [];
  var combined = ((symbol || "") + " " + (name || "")).toLowerCase();
  var skip = new Set(["the", "a", "an", "of", "in", "on", "is", "to", "coin", "token", "it", "at", "by"]);
  combined.split(/[^a-z0-9]+/).forEach(function(w) {
    if (w.length >= 2 && !skip.has(w)) patterns.push(w);
  });
  return patterns;
}

// Called for EVERY coin evaluated — builds feed picture passively
function observeCoin(symbol, name, filterScore, filterTotal) {
  try {
    var patterns = extractPatterns(symbol, name);
    if (patterns.length === 0) return;
    var now      = Date.now();
    var weight   = filterTotal > 0 ? filterScore / filterTotal : 0;
    var TWO_HRS  = 2 * 60 * 60 * 1000;
    patterns.forEach(function(p) {
      if (!observeMemory[p]) observeMemory[p] = { count: 0, totalWeight: 0, lastSeen: now };
      observeMemory[p].count++;
      observeMemory[p].totalWeight += weight;
      observeMemory[p].lastSeen = now;
    });
    // Decay patterns older than 2hrs
    Object.keys(observeMemory).forEach(function(p) {
      if (now - observeMemory[p].lastSeen > TWO_HRS) delete observeMemory[p];
    });
    observeWrites++;
    if (observeWrites % 20 === 0) saveObserveMemory();
  } catch (e) {}
}

// Called when a trade closes — updates trend memory from outcome
function updateTrendMemory(symbol, name, win, pnlPct) {
  try {
    var patterns = extractPatterns(symbol, name);
    var now      = Date.now();
    patterns.forEach(function(p) {
      if (!trendMemory[p]) trendMemory[p] = { score: 0, wins: 0, total: 0, lastSeen: now };
      trendMemory[p].total++;
      trendMemory[p].lastSeen = now;
      if (win) {
        trendMemory[p].wins++;
        var boost = pnlPct >= 200 ? 3 : pnlPct >= 50 ? 2 : 1;
        trendMemory[p].score += boost;
      } else {
        trendMemory[p].score = Math.max(0, trendMemory[p].score - 1);
      }
    });
    // Decay patterns not seen in 6hrs
    var SIX_HRS = 6 * 60 * 60 * 1000;
    Object.keys(trendMemory).forEach(function(p) {
      if (now - trendMemory[p].lastSeen > SIX_HRS) {
        trendMemory[p].score = Math.floor(trendMemory[p].score * 0.5);
        if (trendMemory[p].score === 0) delete trendMemory[p];
      }
    });
    saveTrendMemory();
  } catch (e) {}
}

// Check if current coin matches brain's learned trends
function getTrendNudge(symbol, name) {
  try {
    var patterns  = extractPatterns(symbol, name);
    var maxScore  = 0;
    var topSignal = null;
    patterns.forEach(function(p) {
      var t = trendMemory[p];
      if (t && t.score > 0 && t.total >= 2) {
        var wr = t.wins / t.total;
        if (t.score > maxScore) {
          maxScore  = t.score;
          topSignal = "📈 Trend [" + p + "] score:" + t.score + " WR:" + (wr * 100).toFixed(0) + "%";
        }
      }
    });
    if (maxScore >= 4) return { nudge: +2, signal: topSignal, hot: true };
    if (maxScore >= 2) return { nudge: +1, signal: topSignal, hot: false };
    return { nudge: 0, signal: null, hot: false };
  } catch (e) {
    return { nudge: 0, signal: null, hot: false };
  }
}

// ================================================================
//  RECORD TRADE — feed brain after every close
// ================================================================
function recordTrade(symbol, pnl, win, reason, tiers, name, latency) {
  try {
    var pnlPct = 0;
    if (brainTradeMemory.length > 0) {
      var last = brainTradeMemory[brainTradeMemory.length - 1];
      if (last && last.solSpent > 0) pnlPct = (pnl / last.solSpent) * 100;
    }
    brainTradeMemory.push({
      symbol: symbol,
      name:   name   || symbol,
      pnl:    pnl    || 0,
      win:    !!win,
      reason: reason || "",
      tiers:  tiers  || [],
      time:   Date.now(),
      signalToExecMs: latency && latency.signalToExecMs != null ? latency.signalToExecMs : null,
      txConfirmMs:    latency && latency.txConfirmMs    != null ? latency.txConfirmMs    : null,
      totalLatencyMs: latency && latency.totalLatencyMs != null ? latency.totalLatencyMs : null,
    });
    if (brainTradeMemory.length > MAX_BRAIN_MEMORY) brainTradeMemory.shift();
    saveBrainMemory();
    updateTrendMemory(symbol, name || symbol, !!win, pnlPct);
  } catch (e) {}
}

function logSignal(entry) {
  signalHistory.push(entry);
  if (signalHistory.length > MAX_HISTORY) signalHistory.shift();
}

// ================================================================
//  1. MOOD — auto-calibrated from actual trade history
//  Thresholds derived from the distribution of your real results,
//  not hardcoded numbers.
// ================================================================
function getMood(pnlTrades) {
  var trades = brainTradeMemory;
  if (!trades || trades.length === 0) {
    return { mood: "neutral", nudge: 0, summary: "😐 No trades yet", winRate: null, netSol: 0 };
  }

  var lookback = Math.min(10, trades.length);
  var recent   = trades.slice(-lookback);
  var wins     = recent.filter(function(t) { return t.win; }).length;
  var winRate  = wins / recent.length;
  var netSol   = recent.reduce(function(acc, t) { return acc + (t.pnl || 0); }, 0);

  // ── Auto-calibrate thresholds from all-time history ──────────
  // Confident = above your own historical average
  // Cautious  = below your own historical average
  // Cooling   = net loss in recent window
  var allWins    = trades.filter(function(t) { return t.win; }).length;
  var allWinRate = trades.length > 0 ? allWins / trades.length : 0.5;
  var confidentThreshold = Math.min(allWinRate + 0.15, 0.85); // 15% above your avg, capped at 85%
  var cautiousThreshold  = Math.max(allWinRate - 0.15, 0.15); // 15% below your avg, floor 15%
  // Cooling loss threshold: avg loss per trade in your worst 20%
  var sortedPnl   = trades.map(function(t) { return t.pnl || 0; }).sort(function(a,b){return a-b;});
  var worstSlice  = sortedPnl.slice(0, Math.max(1, Math.floor(sortedPnl.length * 0.2)));
  var avgWorstPnl = worstSlice.reduce(function(a,b){return a+b;},0) / worstSlice.length;
  var coolingThreshold = Math.max(avgWorstPnl * 0.5, -0.10); // half of avg bad loss, max -0.10

  // 3 consecutive losses → cooling immediately
  var last3     = trades.slice(-3);
  var last3Loss = last3.length === 3 && last3.every(function(t) { return !t.win; });
  var last3Time = last3Loss && last3[2] && last3[2].time ? last3[2].time : 0;
  var coolingMins = last3Time ? Math.round((Date.now() - last3Time) / 60000) : 0;

  var mood, nudge, summary;

  if (last3Loss && (Date.now() - last3Time) < 3600000) {
    mood    = "cooling";
    nudge   = -2;
    summary = "🥶 Cooling — 3 consecutive losses. Blocking weak entries.";
  } else if (last3Loss) {
    mood    = "neutral";
    nudge   = 0;
    summary = "😐 Cooling expired (" + coolingMins + "m) — resuming neutral.";
  } else if (netSol <= coolingThreshold && recent.length >= 3) {
    mood    = "cooling";
    nudge   = -1;
    summary = "🥶 Cooling — net " + netSol.toFixed(4) + " SOL last " + recent.length + " trades.";
  } else if (winRate >= confidentThreshold && recent.length >= 5) {
    mood    = "confident";
    nudge   = +1;
    summary = "🔥 Confident — " + (winRate * 100).toFixed(0) + "% WR (your avg: " + (allWinRate * 100).toFixed(0) + "%)";
  } else if (winRate <= cautiousThreshold && recent.length >= 5) {
    mood    = "cautious";
    nudge   = -1;
    summary = "⚠️ Cautious — " + (winRate * 100).toFixed(0) + "% WR (your avg: " + (allWinRate * 100).toFixed(0) + "%)";
  } else {
    mood    = "neutral";
    nudge   = 0;
    summary = "😐 Neutral — " + (winRate * 100).toFixed(0) + "% WR last " + recent.length + " trades";
  }

  return { mood, nudge, summary, winRate, netSol, allWinRate, confidentThreshold, cautiousThreshold };
}

// ================================================================
//  2. PATTERN MEMORY — auto-calibrated win rate thresholds
//  Strong edge = top 25% of your trait win rates
//  Weak drag   = bottom 25% of your trait win rates
// ================================================================
var MIN_TRADES = 100;
var MIN_SAMPLE = 8;

function getPatternNudge(dex) {
  var trades = brainTradeMemory;
  if (!trades || trades.length < MIN_TRADES) {
    return { nudge: 0, signals: ["📊 Pattern memory: " + trades.length + "/" + MIN_TRADES + " trades"], ready: false };
  }

  // Build trait index
  var traitMap = {};
  trades.forEach(function(trade) {
    extractTraits(trade).forEach(function(trait) {
      if (!traitMap[trait]) traitMap[trait] = { wins: 0, total: 0 };
      traitMap[trait].total++;
      if (trade.win) traitMap[trait].wins++;
    });
  });

  // Auto-calibrate thresholds from distribution of trait win rates
  var winRates = Object.keys(traitMap)
    .filter(function(t) { return traitMap[t].total >= MIN_SAMPLE; })
    .map(function(t) { return traitMap[t].wins / traitMap[t].total; })
    .sort(function(a, b) { return a - b; });

  var strongThreshold = winRates.length > 0 ? winRates[Math.floor(winRates.length * 0.75)] : 0.65;
  var weakThreshold   = winRates.length > 0 ? winRates[Math.floor(winRates.length * 0.25)] : 0.40;

  var currentTraits = extractDexTraits(dex);
  var nudge   = 0;
  var signals = [];

  currentTraits.forEach(function(trait) {
    var stat = traitMap[trait];
    if (!stat || stat.total < MIN_SAMPLE) return;
    var wr = stat.wins / stat.total;
    if (wr >= strongThreshold) {
      nudge += 1;
      signals.push("📈 Edge: " + trait + " (" + (wr * 100).toFixed(0) + "% WR, n=" + stat.total + ")");
    } else if (wr <= weakThreshold) {
      nudge -= 1;
      signals.push("📉 Drag: " + trait + " (" + (wr * 100).toFixed(0) + "% WR, n=" + stat.total + ")");
    }
  });

  nudge = Math.max(-2, Math.min(+2, nudge));
  return { nudge, signals, ready: true };
}

// Trait extraction from closed trade
function extractTraits(trade) {
  var traits = [];
  if (trade.tiers && trade.tiers.length > 0) traits.push("tiers:hit");
  else traits.push("tiers:none");
  if (trade.time) {
    var hour    = new Date(trade.time).getUTCHours();
    var session = hour >= 13 && hour < 21 ? "session:us"
                : hour >= 7  && hour < 13 ? "session:eu"
                : "session:asia";
    traits.push(session);
  }
  if (trade.reason) {
    var r = trade.reason.toLowerCase();
    if (r.indexOf("stop")    > -1) traits.push("exit:stoploss");
    if (r.indexOf("stall")   > -1) traits.push("exit:stall");
    if (r.indexOf("cluster") > -1) traits.push("exit:cluster");
    if (r.indexOf("t1")      > -1) traits.push("exit:tier");
    if (r.indexOf("volume")  > -1) traits.push("exit:volcrash");
    if (r.indexOf("break")   > -1) traits.push("exit:breakeven");
    if (r.indexOf("floor")   > -1) traits.push("exit:floor");
    if (r.indexOf("clean")   > -1) traits.push("exit:cleaner");
  }
  return traits;
}

// Trait extraction from live dex object
function extractDexTraits(dex) {
  var traits = [];
  if (dex.mcap < 30000)       traits.push("mcap:micro");
  else if (dex.mcap < 100000) traits.push("mcap:small");
  else                        traits.push("mcap:mid");
  var ageSec = (dex.ageMin || 0) * 60;
  if (ageSec <= 30)       traits.push("age:instant");
  else if (ageSec <= 120) traits.push("age:early");
  else if (ageSec <= 600) traits.push("age:mid");
  else                    traits.push("age:late");
  var hour    = new Date().getUTCHours();
  var session = hour >= 13 && hour < 21 ? "session:us"
              : hour >= 7  && hour < 13 ? "session:eu"
              : "session:asia";
  traits.push(session);
  var ratio = dex.mcap > 0 && dex.vol24h ? dex.vol24h / dex.mcap : 0;
  if (ratio >= 0.5)      traits.push("ratio:high");
  else if (ratio >= 0.1) traits.push("ratio:mid");
  else                   traits.push("ratio:low");
  return traits;
}

// ================================================================
//  MAIN EXPORT — evaluate()
// ================================================================
function evaluate(dex, pnlTrades) {
  try {
    var moodResult    = getMood(pnlTrades);
    var patternResult = getPatternNudge(dex);
    var trendResult   = getTrendNudge(dex.symbol, dex.name);

    var totalNudge = moodResult.nudge + patternResult.nudge + trendResult.nudge;
    totalNudge     = Math.max(-5, Math.min(+5, totalNudge));

    var signals = []
      .concat(patternResult.ready ? patternResult.signals : [])
      .concat(trendResult.signal ? [trendResult.signal] : [])
      .concat([moodResult.summary]);

    var moodEmoji = moodResult.mood === "confident" ? "🔥"
                  : moodResult.mood === "cautious"  ? "⚠️"
                  : moodResult.mood === "cooling"   ? "🥶"
                  : "😐";

    var nudgeStr = totalNudge > 0 ? "+" + totalNudge : String(totalNudge);
    var summary  = moodEmoji + " Brain: " + nudgeStr + " | " + moodResult.summary;

    logSignal({
      ts:      Date.now(),
      symbol:  dex.symbol,
      name:    dex.name,
      nudge:   totalNudge,
      mood:    moodResult.mood,
      signals: signals,
    });

    return {
      nudge:    totalNudge,
      mood:     moodResult.mood,
      signals:  signals,
      summary:  summary,
      moodData: moodResult,
      hot:      trendResult.hot || false,
    };
  } catch (err) {
    console.error("🧠 Brain error:", err.message);
    return { nudge: 0, mood: "neutral", signals: [], summary: "🧠 Brain: offline", moodData: {} };
  }
}

// ================================================================
//  TELEGRAM REPORTS
// ================================================================
function getBrainReport(pnlTrades) {
  try {
    var mood  = getMood(brainTradeMemory);
    var total = brainTradeMemory.length;
    var wins  = brainTradeMemory.filter(function(t) { return t.win; }).length;
    var losses = total - wins;
    var netSol = mood.netSol || 0;
    var sign   = netSol >= 0 ? "+" : "";

    var recent    = signalHistory.slice(-8).reverse();
    var histLines = recent.length === 0
      ? "No coins evaluated yet."
      : recent.map(function(h) {
          var age   = Math.round((Date.now() - h.ts) / 60000);
          var nudge = h.nudge >= 0 ? "+" + h.nudge : String(h.nudge);
          return (h.nudge > 0 ? "🟢" : h.nudge < 0 ? "🔴" : "⚫") +
            " *" + h.symbol + "* nudge:" + nudge + " [" + age + "m ago]";
        }).join("\n");

    var patternLine = total >= MIN_TRADES
      ? "✅ Pattern memory active (" + total + " trades)"
      : "⏳ Pattern memory: " + total + "/" + MIN_TRADES + " trades needed";

    var avgWR = mood.allWinRate != null ? (mood.allWinRate * 100).toFixed(0) + "%" : "n/a";

    return (
      "🧠 *Brain Report*\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "*Session mood:* " + mood.mood.toUpperCase() + "\n" +
      "*Win rate (last 10):* " + (mood.winRate !== null ? (mood.winRate * 100).toFixed(0) + "%" : "n/a") + "\n" +
      "*Your all-time avg:* " + avgWR + "\n" +
      "*Net SOL (last 10):* " + sign + netSol.toFixed(4) + " SOL\n" +
      "*All-time trades:* " + total + " (" + wins + "W / " + losses + "L)\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      patternLine + "\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "*Recent signals:*\n" + histLines
    );
  } catch (err) {
    return "🧠 Brain report error: " + err.message;
  }
}

function getPatternsReport() {
  try {
    var trades = brainTradeMemory;
    var total  = trades.length;
    if (total < 5) {
      return "📊 *Patterns Report*\n⏳ Need at least 5 trades — currently " + total;
    }
    var wins    = trades.filter(function(t) { return t.win; }).length;
    var winRate = (wins / total * 100).toFixed(0);

    var reasonMap = {};
    trades.forEach(function(t) {
      var r = t.reason || "unknown";
      if (!reasonMap[r]) reasonMap[r] = { wins: 0, total: 0, pnl: 0 };
      reasonMap[r].total++;
      if (t.win) reasonMap[r].wins++;
      reasonMap[r].pnl += t.pnl || 0;
    });
    var reasonLines = Object.keys(reasonMap)
      .sort(function(a, b) { return reasonMap[b].pnl - reasonMap[a].pnl; })
      .slice(0, 5)
      .map(function(r) {
        var d = reasonMap[r];
        var wr = (d.wins / d.total * 100).toFixed(0);
        var sign = d.pnl >= 0 ? "+" : "";
        return "• " + r.slice(0, 25) + " — " + wr + "% WR | " + sign + d.pnl.toFixed(4) + " SOL";
      }).join("\n");

    var symMap = {};
    trades.forEach(function(t) {
      var s = t.symbol || "?";
      if (!symMap[s]) symMap[s] = { wins: 0, total: 0, pnl: 0 };
      symMap[s].total++;
      if (t.win) symMap[s].wins++;
      symMap[s].pnl += t.pnl || 0;
    });
    var symLines = Object.keys(symMap)
      .sort(function(a, b) { return symMap[b].pnl - symMap[a].pnl; })
      .slice(0, 5)
      .map(function(s) {
        var d = symMap[s];
        var sign = d.pnl >= 0 ? "+" : "";
        return "• " + s + " (" + d.total + " trades) — " + sign + d.pnl.toFixed(4) + " SOL";
      }).join("\n");

    var netSol  = trades.reduce(function(a, t) { return a + (t.pnl || 0); }, 0);
    var netSign = netSol >= 0 ? "+" : "";

    return (
      "📊 *Patterns Report*\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "Total trades: *" + total + "* | Win rate: *" + winRate + "%*\n" +
      "Net all-time: *" + netSign + netSol.toFixed(4) + " SOL*\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "*Top exit reasons:*\n" + reasonLines + "\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "*Top symbols:*\n" + symLines
    );
  } catch (err) {
    return "📊 Patterns error: " + err.message;
  }
}

function getTrendsReport() {
  try {
    var now = Date.now();

    var obsKeys = Object.keys(observeMemory)
      .filter(function(p) { return observeMemory[p].count >= 3; })
      .sort(function(a, b) { return observeMemory[b].count - observeMemory[a].count; })
      .slice(0, 8);

    var feedLines = obsKeys.length === 0
      ? "⏳ Scanning... check back in a few minutes"
      : obsKeys.map(function(p) {
          var o   = observeMemory[p];
          var avg = (o.totalWeight / o.count * 7).toFixed(1);
          var age = Math.round((now - o.lastSeen) / 60000);
          var icon = o.count >= 10 ? "🔥" : o.count >= 6 ? "📈" : "👀";
          return icon + " *" + p + "*  " + o.count + "x · avg " + avg + "/7 · " + age + "m ago";
        }).join("\n");

    var tradeKeys = Object.keys(trendMemory)
      .filter(function(p) { return trendMemory[p].total >= 2; })
      .sort(function(a, b) { return trendMemory[b].score - trendMemory[a].score; })
      .slice(0, 8);

    var tradeLines = tradeKeys.length === 0
      ? "⏳ No data yet — builds up as trades close"
      : tradeKeys.map(function(p) {
          var t   = trendMemory[p];
          var wr  = (t.wins / t.total * 100).toFixed(0);
          var age = Math.round((now - t.lastSeen) / 60000);
          var icon = t.score >= 4 ? "🔥" : t.score >= 2 ? "📈" : "⚫";
          return icon + " *" + p + "*  " + wr + "% WR · " + t.total + " trades · score " + t.score + " · " + age + "m ago";
        }).join("\n");

    return (
      "📈 *Trend Report*\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "👁 *Feed Trends* _(all coins seen)_\n" +
      feedLines + "\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "💰 *Trade Trends* _(your winning patterns)_\n" +
      tradeLines
    );
  } catch (err) {
    return "📈 Trends error: " + err.message;
  }
}

// ================================================================
//  EXPORTS
// ================================================================
module.exports = {
  evaluate,
  getMood,
  getBrainReport,
  getPatternsReport,
  getTrendsReport,
  recordTrade,
  getTrendNudge,
  updateTrendMemory,
  observeCoin,
  trendMemory,
};
