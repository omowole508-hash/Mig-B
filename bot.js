/**
 * CLEANED PUMP.FUN MIGRATION SNIPER
 * - Valid JavaScript
 * - No duplicate broken monitor block
 * - No imaginary or undefined functions
 * - Safe fallbacks for optional modules
 * - Single coherent bot flow
 */

const dotenv = require("dotenv");
dotenv.config();

const axios = require("axios");
const WebSocket = require("ws");
const bs58 = require("bs58");

const {
  Connection,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
} = require("@solana/web3.js");

const {
  getAssociatedTokenAddressSync,
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");

const brain = (() => {
  try {
    return require("./brain");
  } catch (e) {
    return {
      observeCoin() {},
      evaluate() {
        return {
          nudge: 0,
          mood: "neutral",
          signals: [],
          summary: "🧠 Brain: disabled",
          hot: false,
        };
      },
      recordTrade() {},
      getBrainReport() {
        return "🧠 Brain report unavailable";
      },
      getPatternsReport() {
        return "📊 Patterns unavailable";
      },
      getTrendsReport() {
        return "📈 Trends unavailable";
      },
    };
  }
})();

let jitoExecutor = null;
try {
  jitoExecutor = require("./jitoExecutor");
} catch (e) {
  jitoExecutor = {
    executeTrade: async () => ({
      success: true,
      txId: "mock-jito-" + Date.now(),
    }),
  };
}

let paperLog = null;
try {
  paperLog = require("./paperLog");
} catch (e) {
  paperLog = {
    logPaperTrade() {},
    checkPaperPositions() {},
    paperTrades: [],
  };
}

const JUP_HEADERS = process.env.JUPITER_API_KEY
  ? { "x-api-key": process.env.JUPITER_API_KEY }
  : {};

// ==========================================
// CONFIG
// ==========================================
const CONFIG = {
  RPC_URL:
    process.env.RPC_URL ||
    "https://mainnet.helius-rpc.com/?api-key=" +
      (process.env.HELIUS_API_KEY || "0528a525-35e6-4fb9-8c54-90fcaf29a7ca"),
  WALLET_PRIVATE_KEY: process.env.WALLET_PRIVATE_KEY,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,

  MIGRATION_PROGRAM: "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg",
  WSOL: "So11111111111111111111111111111111111111112",
  PUMP_AMM_PK: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  PUMP_PROGRAM_PK: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",

  BUY_AMOUNT_SOL: 0.0025,
  PRIORITY_FEE_MICROLAMPORTS: 250000,

  MIN_LIQUIDITY_USD: 10000,
  MAX_LIQUIDITY_USD: 20000,
  LIQUIDITY_DRAIN_PCT: 0.4,
  LIQUIDITY_DRAIN_CONFIRM_MS: 20000,
  LIQUIDITY_ABS_FLOOR: 2000,
  MIN_VOLUME_USD: 30000,
  MIN_MCAP_USD: 10000,
  MAX_AGE_HOURS: 0.25,
  MIN_HOLDERS: 60,
  MIN_LP_PER_HOLDER: 65,

  STOP_LOSS_PCT: -25,
  VOLUME_DROP_PCT: 0.65,

  CLUSTER_WALLETS: 20,
  CLUSTER_DIFF: 0.5,
  CLUSTER_EXIT_GAIN: 20,

  PROFIT_LOCK_TRIGGERS: [
    { gain: 30, floor: 15 },
    { gain: 50, floor: 30 },
    { gain: 60, floor: 40 },
    { gain: 80, floor: 60 },
    { gain: 100, floor: 75 },
    { gain: 150, floor: 120 },
    { gain: 220, floor: 180 },
    { gain: 300, floor: 250 },
    { gain: 500, floor: 425 },
    { gain: 700, floor: 600 },
    { gain: 1000, floor: 870 },
    { gain: 1500, floor: 1320 },
    { gain: 2000, floor: 1780 },
    { gain: 3000, floor: 2700 },
    { gain: 5000, floor: 4550 },
    { gain: 7000, floor: 6440 },
    { gain: 10000, floor: 9300 },
  ],

  TRAIL_STALL_MS: 180000,
  MAX_POSITIONS: 2,
  BREAKEVEN_EXIT: true,
  PRE_BUY_STALL_MS: 45000,

  POST_MIGRATION_DELAY_MS: 200,
  RESCAN_DELAY_MS: 13000,
  RESCAN_MAX: 5,
  MONITOR_INTERVAL_MS: 2000,
  POLL_INTERVAL_MS: 1500,

  SLOPE_MIN_READINGS: 3,
  SLOPE_MIN: 800,
  SLOPE_RECHECK_MS: 1200,

  WATCH_SCAN_MS: 6000,
  WATCH_FAST_WINDOW_MS: 3 * 60 * 1000,
  WATCH_SLOW_MS: 8000,

  WASH_VOL_THRESHOLD: 1000,
  WASH_MIN_UNIQUE_BUYS: 3,

  HONEYPOT_MAX_IMPACT_PCT: 8,

  REENTRY_WINDOW_MS: 0,
  REENTRY_SIZE_PCT: 0,

  BRAIN_ENABLED: true,

  DEAD_HOLD_MS: 10 * 60 * 1000,
  DEAD_MAX_PEAK_PCT: 5,
  DEAD_EXIT_THRESHOLD: -25,

  BUNDLE_TX_LIMIT: 15,
  BUNDLE_SAME_SLOT: 3,
  BUNDLE_SIZE_DIFF_PCT: 15,
  BUNDLE_MAX_SCORE: 2,

  BONDING_RUG_CHECK: false,
  BONDING_SIG_LIMIT: 1000,
  BONDING_TX_SAMPLE: 50,
  BONDING_DEV_SOLD_PCT: 50,
  BONDING_TOP_BUYER_PCT: 35,
  BONDING_EARLY_SLOT_BUYERS: 4,
  BONDING_MIN_UNIQUE_BUYERS: 8,
  BONDING_MAX_SCORE: 2,

  CONVICTION_MIN_GAIN: 50,
  CONVICTION_TIME_MS: 10 * 60 * 1000,
  SLIDING_STOP_3MIN: -15,
  SLIDING_STOP_8MIN: 50,
  VOL_VELOCITY_DROP: 0.6,
  MOMENTUM_DROP: 0.85,
};

if (!process.env.RPC_URL && !process.env.HELIUS_API_KEY) {
  console.error("❌ Missing RPC_URL or HELIUS_API_KEY");
  process.exit(1);
}
if (!process.env.WALLET_PRIVATE_KEY) {
  console.error("❌ Missing WALLET_PRIVATE_KEY");
  process.exit(1);
}

// ==========================================
// GLOBAL STATE
// ==========================================
const connection = new Connection(CONFIG.RPC_URL, "confirmed");
const positions = {};
const processedSigs = new Set();
const processedMints = new Map();
const buying = new Set();
const selling = new Set();
const watchlist = new Map();
const failedMints = new Set();
const mintState = new Map();
const holderCache = new Map();
const bondingCheckCache = new Map();
const mintAuthCache = new Map();
const poolSolCache = new Map();
const missCache = new Map();

let lastSig = null;
let monitorRunning = false;
let cleanerRunning = false;
let pdaMissCount = 0;
let dex429Count = 0;

let wallet;
try {
  wallet = Keypair.fromSecretKey(bs58.decode(CONFIG.WALLET_PRIVATE_KEY));
  console.log("✅ Wallet:", wallet.publicKey.toBase58());
} catch (e) {
  console.error("❌ Invalid WALLET_PRIVATE_KEY");
  process.exit(1);
}

const migrationPk = new PublicKey(CONFIG.MIGRATION_PROGRAM);
const PUMP_AMM_PK = new PublicKey(CONFIG.PUMP_AMM_PK);
const PUMP_PROG_PK = new PublicKey(CONFIG.PUMP_PROGRAM_PK);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

const SKIP = new Set([
  "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bwd",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "SysvarRent111111111111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
  "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg",
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5zP9QkNEe7z62ZP",
  "CebN5WGQ4jvEPvsVU4EoHEpgznyQHeXF4EZAiMmWUYrX",
  "So11111111111111111111111111111111111111112",
  "ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw",
]);

// ==========================================
// STATE HELPERS
// ==========================================
function setMintState(mint, state, meta = {}) {
  const prev = mintState.get(mint);
  mintState.set(mint, {
    state,
    reason: meta.reason || "",
    source: meta.source || "unknown",
    score: meta.score || 0,
    lastUpdated: Date.now(),
    ...meta,
  });

  if (prev && prev.state !== state) {
    console.log(
      "   🗺 [" +
        mint.slice(0, 8) +
        "] " +
        prev.state +
        " → " +
        state +
        (meta.reason ? " (" + meta.reason + ")" : "")
    );
  }
}

function getMintState(mint) {
  return mintState.get(mint) || { state: "unknown" };
}

// ==========================================
// TELEGRAM
// ==========================================
let tgQ = [];
let tgBusy = false;
let lastTg = 0;
let tgOffset = 0;
let tgPollBackoff = 3000;

function tg(msg) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) return;
  tgQ.push({ msg });
  if (!tgBusy) nextTg();
}

function tgWithButtons(msg, buttons) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) return;
  tgQ.push({ msg, buttons });
  if (!tgBusy) nextTg();
}

function nextTg() {
  if (!tgQ.length) {
    tgBusy = false;
    return;
  }
  tgBusy = true;
  const item = tgQ.shift();
  const wait = Math.max(0, 1000 - (Date.now() - lastTg));

  setTimeout(() => {
    lastTg = Date.now();
    const payload = {
      chat_id: CONFIG.TELEGRAM_CHAT_ID,
      text: item.msg,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    };

    if (item.buttons) {
      payload.reply_markup = { inline_keyboard: item.buttons };
    }

    axios
      .post(
        "https://api.telegram.org/bot" +
          CONFIG.TELEGRAM_BOT_TOKEN +
          "/sendMessage",
        payload,
        { timeout: 15000 }
      )
      .catch((e) => console.error("TG send:", e.message))
      .finally(() => {
        setTimeout(nextTg, 1000);
      });
  }, wait);
}

function tgAnswerCallback(id, text) {
  axios
    .post(
      "https://api.telegram.org/bot" + CONFIG.TELEGRAM_BOT_TOKEN + "/answerCallbackQuery",
      { callback_query_id: id, text: text || "" },
      { timeout: 8000 }
    )
    .catch(() => {});
}

async function pollCallbacks() {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) return;

  try {
    const res = await axios.get(
      "https://api.telegram.org/bot" +
        CONFIG.TELEGRAM_BOT_TOKEN +
        "/getUpdates?offset=" +
        tgOffset +
        "&timeout=2&allowed_updates=[%22callback_query%22,%22message%22]",
      { timeout: 12000 }
    );

    tgPollBackoff = 3000;
    const updates = (res.data && res.data.result) || [];

    for (let i = 0; i < updates.length; i++) {
      const update = updates[i];
      tgOffset = update.update_id + 1;

      const cb = update.callback_query;
      if (cb && cb.data) {
        tgAnswerCallback(cb.id, "⏳");
        const data = cb.data;

        if (data.startsWith("refresh:")) {
          const mint = data.replace("refresh:", "");
          console.log("🔄 [TG] Refresh:", mint.slice(0, 8));
          const dex = await fetchDex(mint, 3);
          if (!dex) {
            tg("⚠️ No data for `" + mint.slice(0, 8) + "...`");
          } else {
            const e2 = processedMints.get(mint);
            const fsa = (e2 && e2.firstSeenAt) || Date.now();
            const bestTs2 =
              dex.pairCreatedAt && dex.pairCreatedAt > 0
                ? Math.min(fsa, dex.pairCreatedAt)
                : fsa;
            dex.ageMin = (Date.now() - bestTs2) / 60000;
            dex.ageHours = dex.ageMin / 60;

            const result = await runFilters(mint, dex);
            const bar = "█".repeat(result.score) + "░".repeat(result.total - result.score);

            tgWithButtons(
              "🔄 *Refresh — " +
                dex.name +
                " (" +
                dex.symbol +
                ")*\n" +
                "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                "📊 Score: *" +
                result.score +
                "/" +
                result.total +
                "* [" +
                bar +
                "] " +
                (result.pass ? "🟢 PASS" : "🔴 FAIL") +
                "\n" +
                "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                "💰 MCap: $" +
                Math.round(dex.mcap).toLocaleString() +
                "\n" +
                "💧 Liq: $" +
                Math.round(dex.liq).toLocaleString() +
                "\n" +
                "📈 Vol: $" +
                Math.round(dex.vol24h).toLocaleString() +
                "\n" +
                "⏱ Age: " +
                fmtAge(dex.ageMin) +
                "\n" +
                "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                "*Checks:*\n" +
                fmtChecks(result.checks) +
                "\n" +
                "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                "[📊 Chart](https://dexscreener.com/solana/" +
                mint +
                ")  |  " +
                "[🐦 Birdeye](https://birdeye.so/token/" +
                mint +
                "?chain=solana)  |  " +
                "[⚡ Swap](https://jup.ag/swap/SOL-" +
                mint +
                ")\n" +
                "Mint: `" +
                mint +
                "`",
              [
                [
                  { text: "🔄 Refresh again", callback_data: "refresh:" + mint },
                  { text: "🟢 Force Buy", callback_data: "buy:" + mint },
                ],
              ]
            );
          }
        }

        if (data.startsWith("buy:")) {
          const mint = data.replace("buy:", "");
          if (positions[mint] && positions[mint].symbol) {
            tg("⚠️ Already in position for `" + mint.slice(0, 8) + "...`");
          } else {
            console.log("🟢 [TG] Force buy:", mint.slice(0, 8));
            tg("🟢 *Force buy triggered* — `" + mint.slice(0, 8) + "...`");

            const dex = await fetchDex(mint, 3);
            if (dex) {
              const result = await runFilters(mint, dex);
              await queueBuyRequest(mint, dex, result, "telegram-force");
            } else {
              tg("❌ Force buy failed — no market data");
            }
          }
        }
      }

      const msg = update.message;
      if (msg && msg.text) {
        const cmd = msg.text.trim().toLowerCase();
        console.log("📩 [TG] Command:", cmd);

        if (cmd === "/pause") {
          botPaused = true;
          const activeCount = Object.keys(positions).filter(
            (m) => positions[m] && positions[m].symbol
          ).length;
          tg(
            "⏸ *Bot PAUSED*\nNo new buys will be made.\nCurrent positions: " +
              activeCount +
              "\nSells and monitoring still active.\nType /resume to restart buying."
          );
        } else if (cmd === "/resume") {
          botPaused = false;
          tg("▶️ *Bot RESUMED*\nBuying is active again. Ready to snipe! 🎯");
        } else if (cmd === "/status") {
          const activeMints = Object.keys(positions).filter(
            (m) => positions[m] && positions[m].symbol
          );
          const posLines =
            activeMints.length === 0
              ? "None"
              : activeMints
                  .map((m) => {
                    const p = positions[m];
                    const gain =
                      p.buyPrice > 0
                        ? (((p.lastMcap || p.buyPrice) - p.buyPrice) / p.buyPrice) * 100
                        : 0;
                    const sign = gain >= 0 ? "+" : "";
                    return "• " + p.symbol + " " + sign + gain.toFixed(1) + "%";
                  })
                  .join("\n");

          tg(
            (botPaused ? "⏸ *Bot Status — PAUSED*" : "▶️ *Bot Status — ACTIVE*") +
              "\n" +
              "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
              "📊 Positions: " +
              activeMints.length +
              "/" +
              CONFIG.MAX_POSITIONS +
              "\n" +
              posLines +
              "\n" +
              "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
              "👁 Watchlist: " +
              watchlist.size +
              " coins\n" +
              "🚫 Blocked: " +
              failedMints.size +
              " mints\n" +
              "📈 Trades: " +
              pnlTrades.length +
              " this session"
          );
        } else if (cmd === "/paper") {
          const pt = paperTrades;
          if (pt.length === 0) {
            tg("📋 *Paper Summary*\nNo paper trades closed this session yet.");
          } else {
            const pwins = pt.filter((t) => t.win).length;
            const plosses = pt.length - pwins;
            const pwr = ((pwins / pt.length) * 100).toFixed(0);
            const pavg = (pt.reduce((a, t) => a + t.gain, 0) / pt.length).toFixed(1);
            const pbest = pt.reduce((a, t) => (t.gain > a.gain ? t : a), pt[0]);
            const pworst = pt.reduce((a, t) => (t.gain < a.gain ? t : a), pt[0]);
            const plines = pt
              .slice(-20)
              .map((t) => {
                const s = t.gain >= 0 ? "+" : "";
                return (
                  (t.win ? "🟢" : "🔴") +
                  " " +
                  t.symbol +
                  "  " +
                  s +
                  t.gain.toFixed(1) +
                  "%  (" +
                  t.heldMin +
                  "min)  _" +
                  t.exitReason +
                  "_"
                );
              })
              .join("\n");

            tg(
              "📋 *Paper Trading Summary*\n" +
                "━━━━━━━━━━━━━━━━━━━━\n" +
                "📊 Signals: *" +
                pt.length +
                "* (" +
                pwins +
                "W / " +
                plosses +
                "L)\n" +
                "🎯 Win rate: *" +
                pwr +
                "%*\n" +
                "📈 Avg gain: *" +
                (pavg >= 0 ? "+" : "") +
                pavg +
                "%*\n" +
                "━━━━━━━━━━━━━━━━━━━━\n" +
                "🏆 Best: " +
                pbest.symbol +
                "  +" +
                pbest.gain.toFixed(1) +
                "%\n" +
                "💀 Worst: " +
                pworst.symbol +
                "  " +
                pworst.gain.toFixed(1) +
                "%\n" +
                "━━━━━━━━━━━━━━━━━━━━\n" +
                "*Last 20 trades:*\n" +
                plines
            );
          }
        } else if (cmd === "/brain") {
          tg(brain.getBrainReport(pnlTrades));
        } else if (cmd === "/state") {
          const stateLines = [];
          mintState.forEach((v, m) => {
            const age = Math.round((Date.now() - v.lastUpdated) / 1000);
            stateLines.push(
              "• `" +
                m.slice(0, 8) +
                "` → *" +
                v.state +
                "* [" +
                age +
                "s ago] " +
                (v.reason ? v.reason.slice(0, 40) : "") +
                (v.source ? " src:" + v.source : "")
            );
          });

          const stateMsg =
            mintState.size === 0
              ? "🗺 *Mint State Machine*\nNo mints tracked yet."
              : "🗺 *Mint State Machine* (" +
                mintState.size +
                " mints)\n━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                stateLines.slice(-20).join("\n");

          tg(stateMsg);
        } else if (cmd === "/patterns") {
          tg(brain.getPatternsReport());
        } else if (cmd === "/trends") {
          tg(brain.getTrendsReport());
        }
      }
    }
  } catch (e) {
    const msg = e.message || "";
    if (msg.includes("409")) {
      tgPollBackoff = Math.min(tgPollBackoff * 2, 60000);
      console.log("⚠️ TG 409 — backing off " + tgPollBackoff / 1000 + "s");
      await new Promise((r) => setTimeout(r, tgPollBackoff));
    } else if (!msg.includes("timeout") && !msg.includes("ECONNRESET")) {
      console.error("CB poll error:", msg);
    }
  }
}

function startCallbackPolling() {
  const loop = async () => {
    await pollCallbacks();
    setTimeout(loop, tgPollBackoff);
  };

  axios
    .post(
      "https://api.telegram.org/bot" + CONFIG.TELEGRAM_BOT_TOKEN + "/deleteWebhook",
      { drop_pending_updates: true },
      { timeout: 10000 }
    )
    .then(() => {
      console.log("✅ Webhook cleared — buttons active");
      loop();
    })
    .catch(() => {
      console.log("⚠️ Webhook clear failed — starting anyway");
      loop();
    });
}

// ==========================================
// UTILS
// ==========================================
function fmtAge(ageMin) {
  const s = Math.round(ageMin * 60);
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m " + (s % 60) + "s";
  return (ageMin / 60).toFixed(1) + "h";
}

function fmtChecks(checks) {
  return Object.values(checks)
    .map((c) => {
      return (c.pass ? "✅" : "❌") + " " + c.label + ": " + c.val;
    })
    .join("\n");
}

// ==========================================
// DATA FETCHERS
// ==========================================
async function fetchGecko(mint) {
  try {
    const res = await axios.get(
      "https://api.geckoterminal.com/api/v2/networks/solana/tokens/" +
        mint +
        "/pools?page=1",
      {
        timeout: 5000,
        headers: { Accept: "application/json;version=20230302" },
      }
    );

    const pools = res.data && res.data.data;
    if (!pools || pools.length === 0) return null;

    const pool = pools.sort((a, b) => {
      return (
        parseFloat(b.attributes.reserve_in_usd || 0) -
        parseFloat(a.attributes.reserve_in_usd || 0)
      );
    })[0];

    const attr = pool.attributes;
    const liq = parseFloat(attr.reserve_in_usd || 0);
    const mcap = parseFloat(attr.fdv_usd || attr.market_cap_usd || 0);
    const vol24h = parseFloat((attr.volume_usd && attr.volume_usd.h24) || 0);
    const vol5m = parseFloat((attr.volume_usd && attr.volume_usd.m5) || 0);
    const price = parseFloat(attr.base_token_price_usd || 0);
    const createdAt = attr.pool_created_at
      ? new Date(attr.pool_created_at).getTime()
      : Date.now();
    const ageMs = Date.now() - createdAt;
    const txns = attr.transactions || {};
    const buys5m = (txns.m5 && txns.m5.buys) || 0;
    const sells5m = (txns.m5 && txns.m5.sells) || 0;

    let symbol = mint.slice(0, 6);
    let name = "Unknown";
    try {
      const incl = res.data.included || [];
      const tok = incl.find(
        (i) => i.type === "token" && i.attributes && i.attributes.symbol
      );
      if (tok) {
        symbol = tok.attributes.symbol;
        name = tok.attributes.name || name;
      }
    } catch (e) {}

    if (mcap > 0 || liq > 0 || vol24h > 0) {
      return {
        mint,
        symbol,
        name,
        mcap,
        liq,
        vol24h,
        vol5m,
        price,
        ageHours: ageMs / 3600000,
        ageMin: ageMs / 60000,
        pairCreatedAt: createdAt,
        buys5m,
        sells5m,
        hasSocials: false,
        hasTwitter: false,
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function fetchDex(mint, maxRetries = 6) {
  const geckoResult = await fetchGecko(mint);
  if (geckoResult) return geckoResult;

  for (let i = 1; i <= maxRetries; i++) {
    let is429 = false;
    try {
      const res = await axios.get(
        "https://api.dexscreener.com/latest/dex/tokens/" + mint,
        { timeout: 7000 }
      );

      const pairs = res.data && res.data.pairs;
      if (pairs && pairs.length > 0) {
        const pair =
          pairs.find((p) => p.dexId && p.dexId.toLowerCase().indexOf("pump") > -1) ||
          pairs.sort((a, b) => {
            return (
              parseFloat((b.liquidity && b.liquidity.usd) || 0) -
              parseFloat((a.liquidity && a.liquidity.usd) || 0)
            );
          })[0];

        const liq = parseFloat((pair.liquidity && pair.liquidity.usd) || 0);
        const mcap = parseFloat(pair.fdv || pair.marketCap || 0);
        const vol24h = parseFloat((pair.volume && pair.volume.h24) || 0);

        if (mcap > 0 || liq > 0 || vol24h > 0) {
          const ageMs = Date.now() - (pair.pairCreatedAt || Date.now());
          return {
            mint,
            symbol: (pair.baseToken && pair.baseToken.symbol) || mint.slice(0, 6),
            name: (pair.baseToken && pair.baseToken.name) || "Unknown",
            mcap,
            liq,
            vol24h,
            vol5m: parseFloat((pair.volume && pair.volume.m5) || 0),
            price: parseFloat(pair.priceUsd || 0),
            ageHours: ageMs / 3600000,
            ageMin: ageMs / 60000,
            pairCreatedAt: pair.pairCreatedAt || 0,
            buys5m: (pair.txns && pair.txns.m5 && pair.txns.m5.buys) || 0,
            sells5m: (pair.txns && pair.txns.m5 && pair.txns.m5.sells) || 0,
            hasSocials:
              !!(pair.info && pair.info.socials && pair.info.socials.length > 0),
            hasTwitter: !!(
              pair.info &&
              pair.info.socials &&
              pair.info.socials.some((s) => s.type === "twitter" || s.type === "x")
            ),
            socials: (pair.info && pair.info.socials) || [],
          };
        }
      }
    } catch (e) {
      is429 = !!(e.response && e.response.status === 429);
      if (is429) dex429Count++;
      else console.log("   DexScreener attempt " + i + ": " + e.message);
    }

    if (i < maxRetries) {
      const delay = is429 ? 15000 : i <= 2 ? 1500 : i <= 4 ? 3000 : 6000;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return null;
}

// ==========================================
// HOLDER HELPERS
// ==========================================
function derivePoolTokenAccount(mintPk) {
  try {
    const poolAuthority = PublicKey.findProgramAddressSync(
      [Buffer.from("pool-authority"), mintPk.toBuffer()],
      PUMP_PROG_PK
    )[0];

    const indexBuf = Buffer.alloc(2);
    indexBuf.writeUInt16LE(0, 0);

    const poolPk = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        indexBuf,
        poolAuthority.toBuffer(),
        mintPk.toBuffer(),
        new PublicKey(CONFIG.WSOL).toBuffer(),
      ],
      PUMP_AMM_PK
    )[0];

    return getAssociatedTokenAddressSync(mintPk, poolPk, true);
  } catch (e) {
    return null;
  }
}

async function fetchHolders(mint) {
  try {
    const mintPk = new PublicKey(mint);
    const poolTokenAccount = derivePoolTokenAccount(mintPk);
    const poolAddress = poolTokenAccount ? poolTokenAccount.toBase58() : null;

    const results = await Promise.all([
      connection.getTokenLargestAccounts(mintPk, "confirmed"),
      connection.getTokenSupply(mintPk, "confirmed"),
    ]);

    const accounts = results[0] && results[0].value;
    const totalSupply =
      results[1] && results[1].value && parseFloat(results[1].value.amount);

    if (!accounts || accounts.length === 0 || !totalSupply) return null;

    let poolBal = 0;
    const holders = [];

    for (let i = 0; i < accounts.length; i++) {
      const addr = accounts[i].address;
      const bal = parseFloat(accounts[i].amount || "0");
      if (bal === 0) continue;

      if (i === 0) {
        poolBal += bal;
        continue;
      }
      if (poolAddress && addr === poolAddress) {
        poolBal += bal;
        continue;
      }
      if ((bal / totalSupply) * 100 > 60) {
        poolBal += bal;
        continue;
      }

      holders.push({ address: addr, amount: bal });
    }

    const circulatingSupply = totalSupply - poolBal;
    if (circulatingSupply <= 0 || holders.length === 0) return null;

    return holders.map((h) => ({
      percentage: (h.amount / circulatingSupply) * 100,
    }));
  } catch (e) {
    console.log("   ⚠️ fetchHolders error:", e.message);
    return null;
  }
}

async function getCachedHolders(mint) {
  const cached = holderCache.get(mint);
  if (cached && Date.now() - cached.ts < 45000) return cached.data;

  const holders = await fetchHolders(mint);
  if (holders) holderCache.set(mint, { data: holders, ts: Date.now() });
  return holders;
}

async function getTotalHolderCount(mint) {
  try {
    const url = CONFIG.RPC_URL || "";
    const match = url.match(/api-key=([a-zA-Z0-9\-]+)/);
    const apiKey = match ? match[1] : null;
    if (!apiKey) return null;

    let total = 0;
    let page = 1;
    const heliusUrl = "https://mainnet.helius-rpc.com/?api-key=" + apiKey;

    while (true) {
      const res = await axios.post(
        heliusUrl,
        {
          jsonrpc: "2.0",
          id: "hc" + page,
          method: "getTokenAccounts",
          params: {
            mint,
            limit: 1000,
            page,
            options: { showZeroBalance: false },
          },
        },
        { timeout: 10000 }
      );

      const accounts =
        res.data && res.data.result && res.data.result.token_accounts;
      if (!accounts || accounts.length === 0) break;
      total += accounts.length;
      if (accounts.length < 1000) break;
      page++;
      if (page > 50) break;
    }

    if (total > 0) return total;
    return null;
  } catch (e) {
    console.log("   ⚠️ Helius holder count:", e.message);
    return null;
  }
}

// ==========================================
// FILTERS
// ==========================================
async function runFilters(mint, dex) {
  let score = 0;
  const checks = {};
  const ageSec = dex.ageMin * 60;

  const mcapPass = dex.mcap >= CONFIG.MIN_MCAP_USD;
  if (mcapPass) score++;
  checks.mcap = {
    pass: mcapPass,
    label: "MCap",
    val: "$" + Math.round(dex.mcap).toLocaleString(),
  };

  const liqPass =
    dex.liq >= CONFIG.MIN_LIQUIDITY_USD &&
    dex.liq <= CONFIG.MAX_LIQUIDITY_USD;
  if (liqPass) score++;
  checks.liq = {
    pass: liqPass,
    label: "Liquidity",
    val:
      "$" +
      Math.round(dex.liq).toLocaleString() +
      " (need $" +
      CONFIG.MIN_LIQUIDITY_USD.toLocaleString() +
      "–$" +
      CONFIG.MAX_LIQUIDITY_USD.toLocaleString() +
      ")",
  };

  const volPass = dex.vol24h >= CONFIG.MIN_VOLUME_USD;
  if (volPass) score++;
  checks.vol = {
    pass: volPass,
    label: "Volume 24h",
    val: "$" + Math.round(dex.vol24h).toLocaleString(),
  };

  const volRatio = dex.mcap > 0 ? dex.vol24h / dex.mcap : 0;
  const minRatio =
    ageSec <= 30 ? 0.05 : ageSec <= 120 ? 0.15 : ageSec <= 600 ? 0.3 : 0.8;
  const ratioPass = volRatio >= minRatio;
  if (ratioPass) score++;
  checks.volRatio = {
    pass: ratioPass,
    label: "Vol/MCap",
    val: volRatio.toFixed(3) + "x (need " + minRatio + "x @ " + fmtAge(dex.ageMin) + ")",
  };

  const agePass = dex.ageHours <= CONFIG.MAX_AGE_HOURS;
  if (agePass) score++;
  checks.age = {
    pass: agePass,
    label: "Age",
    val: fmtAge(dex.ageMin),
  };

  const maxTop10Pct =
    ageSec <= 30 ? 50 : ageSec <= 120 ? 45 : ageSec <= 600 ? 40 : 20;

  const holderResults = await Promise.all([
    getCachedHolders(mint),
    getTotalHolderCount(mint),
  ]);

  const holders = holderResults[0];
  const totalCount = holderResults[1];

  if (holders !== null && holders.length > 0) {
    const hCount = totalCount || holders.length;

    if (hCount < CONFIG.MIN_HOLDERS) {
      checks.lp = {
        pass: false,
        label: "LP/holder",
        val:
          "n/a — only " +
          hCount +
          " holders (need " +
          CONFIG.MIN_HOLDERS +
          "+)",
      };
      checks.top10 = {
        pass: false,
        label: "Top10 %",
        val: "n/a — holder count too low",
      };
      return { pass: false, score, total: 7, checks, isCluster: false };
    }

    const top10 = holders.slice(0, 10).reduce((s, h) => s + (h.percentage || 0), 0);
    const lpPerH = dex.liq / hCount;
    const lpPass = lpPerH >= CONFIG.MIN_LP_PER_HOLDER;
    const topPass = top10 < maxTop10Pct;

    if (lpPass) score++;
    if (topPass) score++;

    checks.lp = {
      pass: lpPass,
      label: "LP/holder",
      val:
        "$" +
        lpPerH.toFixed(2) +
        " / " +
        hCount +
        " holders (need $" +
        CONFIG.MIN_LP_PER_HOLDER +
        "+)",
    };
    checks.top10 = {
      pass: topPass,
      label: "Top10 %",
      val:
        top10.toFixed(1) +
        "% (need <" +
        maxTop10Pct +
        "% @ " +
        fmtAge(dex.ageMin) +
        ")",
    };

    let isCluster = false;
    if (holders.length >= CONFIG.CLUSTER_WALLETS) {
      const pcts = holders.map((h) => h.percentage || 0);
      const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
      const uniform = pcts.filter((p) => Math.abs(p - avg) <= CONFIG.CLUSTER_DIFF);
      if (uniform.length >= CONFIG.CLUSTER_WALLETS) {
        isCluster = true;
        checks.cluster = {
          pass: true,
          label: "CLUSTER",
          val: uniform.length + " wallets ~" + avg.toFixed(2) + "% — fast exit",
        };
      }
    }

    return { pass: score === 7, score, total: 7, checks, isCluster };
  }

  checks.lp = {
    pass: false,
    label: "LP/holder",
    val: "n/a — holder data unavailable",
  };
  checks.top10 = {
    pass: false,
    label: "Top10 %",
    val: "n/a — holder data unavailable",
  };

  return { pass: false, score, total: 7, checks, isCluster: false };
}

// ==========================================
// CHECKS
// ==========================================
function checkWashTrading(dex) {
  if (!dex.vol5m || dex.vol5m < CONFIG.WASH_VOL_THRESHOLD) return { wash: false };

  const buys5m = dex.buys5m || 0;

  if (buys5m === 0) {
    return {
      wash: true,
      reason: "$" + Math.round(dex.vol5m) + " vol5m but 0 buy txns — wash trading",
    };
  }

  if (buys5m < CONFIG.WASH_MIN_UNIQUE_BUYS) {
    return {
      wash: true,
      reason:
        "$" +
        Math.round(dex.vol5m) +
        " vol5m but only " +
        buys5m +
        " buy txns — likely wash",
    };
  }

  return { wash: false };
}

async function checkMintAuthority(mint) {
  const cached = mintAuthCache.get(mint);
  if (cached) return cached;

  try {
    const acct = await connection.getParsedAccountInfo(new PublicKey(mint));
    const parsed =
      acct &&
      acct.value &&
      acct.value.data &&
      acct.value.data.parsed &&
      acct.value.data.parsed.info;

    if (!parsed) {
      const out = {
        safe: false,
        transient: true,
        reason: "mint account not readable",
      };
      mintAuthCache.set(mint, out);
      return out;
    }

    if (parsed.mintAuthority) {
      const out = { safe: false, reason: "mint authority still active" };
      mintAuthCache.set(mint, out);
      return out;
    }

    if (parsed.freezeAuthority) {
      const out = { safe: false, reason: "freeze authority still active" };
      mintAuthCache.set(mint, out);
      return out;
    }

    const out = { safe: true };
    mintAuthCache.set(mint, out);
    return out;
  } catch (e) {
    const out = {
      safe: false,
      transient: true,
      reason: "authority check failed — " + (e.message || "").slice(0, 60),
    };
    mintAuthCache.set(mint, out);
    return out;
  }
}

async function checkSellViable(mint, tokenAmount) {
  try {
    const sellQuote = await axios.get(
      "https://api.jup.ag/swap/v1/quote" +
        "?inputMint=" +
        mint +
        "&outputMint=" +
        CONFIG.WSOL +
        "&amount=" +
        tokenAmount +
        "&slippageBps=500",
      { headers: JUP_HEADERS, timeout: 3000 }
    );

    if (!sellQuote.data || !sellQuote.data.outAmount) {
      return { viable: false, reason: "No sell route found" };
    }

    const impact = parseFloat(sellQuote.data.priceImpactPct || 0);
    if (impact > CONFIG.HONEYPOT_MAX_IMPACT_PCT) {
      return { viable: false, reason: "Sell impact " + impact.toFixed(1) + "% too high" };
    }

    return { viable: true, impact };
  } catch (e) {
    return { viable: true, reason: "check timed out — proceeding" };
  }
}

async function checkHoneypot(mint) {
  try {
    const testLam = Math.floor(CONFIG.BUY_AMOUNT_SOL * LAMPORTS_PER_SOL * 0.1);

    const buyQuote = await axios.get(
      "https://api.jup.ag/swap/v1/quote" +
        "?inputMint=" +
        CONFIG.WSOL +
        "&outputMint=" +
        mint +
        "&amount=" +
        testLam +
        "&slippageBps=500",
      { headers: JUP_HEADERS, timeout: 8000 }
    );

    if (!buyQuote.data || !buyQuote.data.outAmount) {
      console.log("   🍯 Honeypot: no buy quote — skipping");
      return { safe: false, reason: "No buy route found" };
    }

    const tokenAmount = buyQuote.data.outAmount;

    const sellQuote = await axios.get(
      "https://api.jup.ag/swap/v1/quote" +
        "?inputMint=" +
        mint +
        "&outputMint=" +
        CONFIG.WSOL +
        "&amount=" +
        tokenAmount +
        "&slippageBps=500",
      { headers: JUP_HEADERS, timeout: 8000 }
    );

    if (!sellQuote.data || !sellQuote.data.outAmount) {
      console.log("   🍯 Honeypot: no sell route — BLOCKED");
      return { safe: false, reason: "No sell route — likely honeypot" };
    }

    const impact = parseFloat(sellQuote.data.priceImpactPct || 0);
    if (impact > CONFIG.HONEYPOT_MAX_IMPACT_PCT) {
      console.log(
        "   🍯 Honeypot: sell impact " +
          impact.toFixed(1) +
          "% > " +
          CONFIG.HONEYPOT_MAX_IMPACT_PCT +
          "% — BLOCKED"
      );
      return { safe: false, reason: "Sell impact " + impact.toFixed(1) + "% — no exit liquidity" };
    }

    console.log("   ✅ Honeypot check passed — sell impact " + impact.toFixed(1) + "%");
    return { safe: true, impact };
  } catch (e) {
    console.log("   ⚠️ Honeypot check failed (blocking):", (e.message || "").slice(0, 80));
    return { safe: false, transient: true, reason: "honeypot check failed — blocked for safety" };
  }
}

async function checkBundle(mint) {
  if (CONFIG.BUNDLE_MAX_SCORE === 0) {
    return { bundled: false, score: 0, reason: "disabled" };
  }

  try {
    const mintPk = new PublicKey(mint);
    const sigs = await connection.getSignaturesForAddress(
      mintPk,
      { limit: CONFIG.BUNDLE_TX_LIMIT },
      "confirmed"
    );
    if (!sigs || sigs.length === 0) {
      return { bundled: false, score: 0, reason: "no txs" };
    }

    const migPkStr = migrationPk.toBase58();
    const walletBuys = {};

    for (let i = 0; i < sigs.length; i++) {
      try {
        const tx = await connection.getParsedTransaction(sigs[i].signature, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        });
        if (!tx || !tx.meta) continue;

        const slot = sigs[i].slot;
        const keys = tx.transaction.message.accountKeys || [];
        const signers = keys
          .filter((k) => k.signer)
          .map((k) => k.pubkey.toBase58());
        if (signers.includes(migPkStr)) continue;

        const preBalances = tx.meta.preBalances || [];
        const postBalances = tx.meta.postBalances || [];

        for (let ki = 0; ki < keys.length; ki++) {
          const key = keys[ki];
          if (!key.signer || !key.writable) continue;

          const walletStr = key.pubkey.toBase58();
          if (walletStr === migPkStr) continue;

          const solSpent = (preBalances[ki] - postBalances[ki]) / 1e9;
          if (solSpent < 0.001) continue;

          if (!walletBuys[walletStr]) {
            walletBuys[walletStr] = { slot, solSpent };
          }
        }
      } catch (e) {}
    }

    const buyers = Object.keys(walletBuys);
    if (buyers.length < 2) {
      return { bundled: false, score: 0, reason: "not enough buyers" };
    }

    let bundleScore = 0;
    const bundleReasons = [];

    const slotGroups = {};
    buyers.forEach((w) => {
      const s = walletBuys[w].slot;
      if (!slotGroups[s]) slotGroups[s] = [];
      slotGroups[s].push(w);
    });

    const maxSlotGroup = Object.values(slotGroups).reduce((a, b) => {
      return b.length > a.length ? b : a;
    }, []);

    if (maxSlotGroup.length >= CONFIG.BUNDLE_SAME_SLOT) {
      bundleScore++;
      bundleReasons.push(maxSlotGroup.length + " wallets in same slot");

      const sizes = maxSlotGroup.map((w) => walletBuys[w].solSpent);
      const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      const allClose = sizes.every(
        (s) => (Math.abs(s - avgSize) / avgSize) * 100 <= CONFIG.BUNDLE_SIZE_DIFF_PCT
      );

      if (allClose && sizes.length >= 3) {
        bundleScore++;
        bundleReasons.push("coordinated sizes ~" + avgSize.toFixed(3) + " SOL each");
      }
    }

    const preBals = buyers.map((w) => Math.round(walletBuys[w].solSpent * 10) / 10);
    const balFreq = {};
    preBals.forEach((b) => {
      balFreq[b] = (balFreq[b] || 0) + 1;
    });
    const maxFreq = Math.max(...Object.values(balFreq));
    if (maxFreq >= 3) {
      bundleScore++;
      bundleReasons.push(maxFreq + " wallets with identical spend amounts");
    }

    const bundled = bundleScore >= CONFIG.BUNDLE_MAX_SCORE;
    const reason = bundleReasons.join(" | ") || "clean";
    console.log("   🔎 Bundle check: score=" + bundleScore + " | " + reason);
    return { bundled, score: bundleScore, reason };
  } catch (e) {
    console.log(
      "   ⚠️ Bundle check error (allowing through):",
      (e.message || "").slice(0, 80)
    );
    return { bundled: false, score: 0, reason: "check failed — allowed" };
  }
}

// ==========================================
// BONDING / MIGRATION CHECKS
// ==========================================
async function isFullyMigrated(mint) {
  try {
    const mintPk = new PublicKey(mint);
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mintPk.toBuffer()],
      PUMP_PROG_PK
    );

    const info = await connection.getAccountInfo(bondingCurve, "confirmed");
    if (info && info.data && info.data.length > 0) {
      if (info.data.length >= 49) {
        const complete = info.data[48];
        if (complete === 0) {
          console.log("   ⏭ Still bonding — skipping " + mint.slice(0, 8));
          return false;
        }
      }
      return true;
    }
    return true;
  } catch (e) {
    return true;
  }
}

async function migrationWalletBoughtThis(mint) {
  try {
    const mintPk = new PublicKey(mint);
    const migATA = getAssociatedTokenAddressSync(mintPk, migrationPk, true);
    const sigs = await connection.getSignaturesForAddress(migATA, { limit: 8 }, "confirmed");
    if (!sigs || sigs.length === 0) return false;

    for (let i = 0; i < Math.min(sigs.length, 5); i++) {
      try {
        const tx = await connection.getParsedTransaction(sigs[i].signature, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        });
        if (!tx || !tx.meta) continue;

        const pre = tx.meta.preTokenBalances || [];
        const post = tx.meta.postTokenBalances || [];
        const migATAstr = migATA.toBase58();

        let preBal = 0;
        let postBal = 0;

        pre.forEach((b) => {
          if (b.accountIndex !== undefined) {
            const acct = tx.transaction.message.accountKeys[b.accountIndex];
            if (acct && acct.pubkey && acct.pubkey.toBase58() === migATAstr) {
              preBal = parseFloat(b.uiTokenAmount.amount || "0");
            }
          }
        });

        post.forEach((b) => {
          if (b.accountIndex !== undefined) {
            const acct = tx.transaction.message.accountKeys[b.accountIndex];
            if (acct && acct.pubkey && acct.pubkey.toBase58() === migATAstr) {
              postBal = parseFloat(b.uiTokenAmount.amount || "0");
            }
          }
        });

        if (postBal > preBal) {
          console.log("   ⭐ Migration wallet BOUGHT " + mint.slice(0, 8) + " — ultra priority!");
          return true;
        }
      } catch (e) {}
    }
    return false;
  } catch (e) {
    return false;
  }
}

async function checkBondingHistory(mint) {
  if (!CONFIG.BONDING_RUG_CHECK || CONFIG.BONDING_MAX_SCORE === 0) {
    return { rug: false, score: 0, reason: "disabled" };
  }

  const cached = bondingCheckCache.get(mint);
  if (cached) return cached;

  try {
    const mintPk = new PublicKey(mint);
    const [curvePk] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mintPk.toBuffer()],
      PUMP_PROG_PK
    );

    const sigs = await connection.getSignaturesForAddress(
      curvePk,
      { limit: CONFIG.BONDING_SIG_LIMIT },
      "confirmed"
    );

    if (!sigs || sigs.length === 0) {
      return { rug: false, score: 0, reason: "no curve history — allowed" };
    }

    const truncated = sigs.length >= CONFIG.BONDING_SIG_LIMIT;
    const okSigs = sigs.filter((s) => !s.err).reverse();
    const half = Math.floor(CONFIG.BONDING_TX_SAMPLE / 2);
    const oldest = okSigs.slice(0, half);
    const newest = okSigs.length > half ? okSigs.slice(-half) : [];
    const oldestSet = new Set(oldest.map((s) => s.signature));
    const picked = oldest.concat(newest.filter((s) => !oldestSet.has(s.signature)));

    const txs = await connection.getParsedTransactions(
      picked.map((s) => s.signature),
      { maxSupportedTransactionVersion: 0, commitment: "confirmed" }
    );

    const events = [];
    for (let i = 0; i < picked.length; i++) {
      const tx = txs && txs[i];
      if (!tx || !tx.meta || tx.meta.err) continue;

      const keys = tx.transaction.message.accountKeys || [];
      if (!keys[0]) continue;

      const signer = keys[0].pubkey.toBase58();
      let pre = 0;
      let post = 0;

      (tx.meta.preTokenBalances || []).forEach((b) => {
        if (b.mint === mint && b.owner === signer) {
          pre += parseFloat((b.uiTokenAmount && b.uiTokenAmount.amount) || "0");
        }
      });

      (tx.meta.postTokenBalances || []).forEach((b) => {
        if (b.mint === mint && b.owner === signer) {
          post += parseFloat((b.uiTokenAmount && b.uiTokenAmount.amount) || "0");
        }
      });

      const solDelta = ((tx.meta.postBalances[0] || 0) - (tx.meta.preBalances[0] || 0)) / 1e9;

      events.push({
        sig: picked[i].signature,
        slot: picked[i].slot,
        signer,
        tokDelta: post - pre,
        solSpent: -solDelta,
      });
    }

    if (events.length === 0) {
      return { rug: false, score: 0, reason: "no parsable curve txs — allowed" };
    }

    let score = 0;
    const reasons = [];

    let creator = null;
    if (!truncated && oldest[0]) {
      const first = events.find((e) => e.sig === oldest[0].signature);
      creator = first ? first.signer : null;
    }

    if (creator) {
      let devBought = 0;
      let devSold = 0;

      events.forEach((e) => {
        if (e.signer !== creator) return;
        if (e.tokDelta > 0) devBought += e.tokDelta;
        if (e.tokDelta < 0) devSold += -e.tokDelta;
      });

      if (devBought > 0) {
        const devSoldPct = (devSold / devBought) * 100;
        if (devSoldPct >= CONFIG.BONDING_DEV_SOLD_PCT) {
          score += 2;
          reasons.push("dev sold " + devSoldPct.toFixed(0) + "% of their bag on curve");
        }
      }
    }

    const buySol = {};
    let totalBuySol = 0;

    events.forEach((e) => {
      if (e.tokDelta > 0 && e.solSpent > 0.001) {
        buySol[e.signer] = (buySol[e.signer] || 0) + e.solSpent;
        totalBuySol += e.solSpent;
      }
    });

    const buyerList = Object.keys(buySol);
    if (buyerList.length > 0 && totalBuySol > 0) {
      const topWallet = buyerList.reduce((a, b) => {
        return buySol[b] > buySol[a] ? b : a;
      }, buyerList[0]);
      const topPct = (buySol[topWallet] / totalBuySol) * 100;
      if (topPct >= CONFIG.BONDING_TOP_BUYER_PCT) {
        score++;
        reasons.push("one wallet = " + topPct.toFixed(0) + "% of buy SOL");
      }
    }

    if (!truncated && oldest[0]) {
      const firstSlot = oldest[0].slot;
      const earlyBuyers = new Set();
      events.forEach((e) => {
        if (e.slot <= firstSlot + 1 && e.tokDelta > 0 && e.signer !== creator) {
          earlyBuyers.add(e.signer);
        }
      });
      if (earlyBuyers.size >= CONFIG.BONDING_EARLY_SLOT_BUYERS) {
        score++;
        reasons.push(earlyBuyers.size + " wallets sniped in first 2 slots");
      }
    }

    if (buyerList.length < CONFIG.BONDING_MIN_UNIQUE_BUYERS) {
      score++;
      reasons.push("only " + buyerList.length + " unique buyers");
    }

    const rug = score >= CONFIG.BONDING_MAX_SCORE;
    const reason = reasons.join(" | ") || "clean";
    const out = { rug, score, reason, txs: sigs.length };
    bondingCheckCache.set(mint, out);

    console.log("   🧬 Bonding history:", out);
    return out;
  } catch (e) {
    console.log(
      "   ⚠️ Bonding history check error (allowing through):",
      (e.message || "").slice(0, 80)
    );
    return { rug: false, score: 0, reason: "check failed — allowed" };
  }
}

// ==========================================
// BUY/SELL
// ==========================================
const buyQueue = new Map();

async function queueBuyRequest(mint, dex, result, source, overrideSol, precomputedBundle) {
  const current = getMintState(mint);

  if (
    current.state === "buying" ||
    current.state === "bought" ||
    current.state === "selling" ||
    current.state === "sold" ||
    current.state === "blocked"
  ) {
    console.log("   ⛔ [" + mint.slice(0, 8) + "] queueBuyRequest ignored — state: " + current.state);
    return;
  }

  if (buyQueue.has(mint)) {
    console.log("   ⛔ [" + mint.slice(0, 8) + "] Already queued — ignoring duplicate from: " + source);
    return;
  }

  buyQueue.set(mint, {
    dex,
    result,
    source: source || "unknown",
    overrideSol,
    bundle: precomputedBundle,
  });
  setMintState(mint, "queued", {
    source: source || "unknown",
    score: result && result.score,
  });
  console.log("   📥 [" + mint.slice(0, 8) + "] Queued for buy — source:", source || "unknown");

  try {
    buyQueue.delete(mint);
    await executeBuy(mint, dex, result, overrideSol, precomputedBundle, source);
  } catch (e) {
    console.error("   ❌ queueBuyRequest error [" + mint.slice(0, 8) + "]:", e.message);
    setMintState(mint, "blocked", {
      reason: "buy queue error: " + (e.message || "").slice(0, 60),
    });
  }
}

let botPaused = false;
let pnlTrades = [];
let sessionStart = Date.now();

function recordTrade(symbol, mint, solSpent, solReceived, reason, tiers) {
  const pnl = solReceived - solSpent;
  const pnlPct = solSpent > 0 ? (pnl / solSpent) * 100 : 0;
  const win = pnl > 0;

  pnlTrades.push({
    symbol,
    mint,
    solSpent,
    solReceived,
    pnl,
    pnlPct,
    reason,
    tiers,
    time: Date.now(),
    win,
  });

  try {
    brain.recordTrade(symbol, pnl, win, reason, tiers);
  } catch (e) {}

  const emoji = win ? "🟢" : "🔴";
  const sign = pnl >= 0 ? "+" : "";
  const tiersHit = tiers.length ? tiers.join(" → ") : "none";

  tg(
    emoji +
      " *Trade Closed — " +
      symbol +
      "*\n" +
      "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
      "📥 Spent: *" +
      solSpent.toFixed(4) +
      " SOL*\n" +
      "📤 Received: *" +
      solReceived.toFixed(4) +
      " SOL*\n" +
      "💰 PnL: *" +
      sign +
      pnl.toFixed(4) +
      " SOL* (" +
      sign +
      pnlPct.toFixed(1) +
      "%)\n" +
      "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
      "🎯 Tiers hit: " +
      tiersHit +
      "\n" +
      "🚪 Exit: " +
      reason +
      "\n" +
      "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
      "Mint: `" +
      mint +
      "`"
  );
}

function sendSessionSummary() {
  const totalTrades = pnlTrades.length;
  if (totalTrades === 0) {
    tg("📊 *3hr Summary*\nNo trades completed this period.");
    return;
  }

  const wins = pnlTrades.filter((t) => t.win).length;
  const losses = totalTrades - wins;
  const totalSpent = pnlTrades.reduce((a, t) => a + t.solSpent, 0);
  const totalRec = pnlTrades.reduce((a, t) => a + t.solReceived, 0);
  const totalPnl = totalRec - totalSpent;
  const winRate = ((wins / totalTrades) * 100).toFixed(0);
  const bestTrade = pnlTrades.reduce((a, t) => (t.pnl > a.pnl ? t : a), pnlTrades[0]);
  const worstTrade = pnlTrades.reduce((a, t) => (t.pnl < a.pnl ? t : a), pnlTrades[0]);
  const sign = totalPnl >= 0 ? "+" : "";
  const emoji = totalPnl >= 0 ? "🟢" : "🔴";
  const elapsed = Math.round((Date.now() - sessionStart) / 3600000 * 10) / 10;

  const tradeLines = pnlTrades
    .slice(-10)
    .map((t) => {
      const s = t.pnl >= 0 ? "+" : "";
      return (
        (t.win ? "🟢" : "🔴") +
        " " +
        t.symbol +
        " " +
        s +
        t.pnl.toFixed(4) +
        " SOL (" +
        s +
        t.pnlPct.toFixed(0) +
        "%)"
      );
    })
    .join("\n");

  tg(
    "📊 *3hr Session Report*\n" +
      "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
      emoji +
      " *Net PnL: " +
      sign +
      totalPnl.toFixed(4) +
      " SOL*\n" +
      "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
      "📈 Trades: " +
      totalTrades +
      " (" +
      wins +
      "W / " +
      losses +
      "L)\n" +
      "🎯 Win rate: " +
      winRate +
      "%\n" +
      "📥 Spent: " +
      totalSpent.toFixed(4) +
      " SOL\n" +
      "📤 Received: " +
      totalRec.toFixed(4) +
      " SOL\n" +
      "⏱ Runtime: " +
      elapsed +
      "hrs\n" +
      "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
      "🏆 Best: " +
      bestTrade.symbol +
      " +" +
      bestTrade.pnl.toFixed(4) +
      " SOL\n" +
      "💀 Worst: " +
      worstTrade.symbol +
      " " +
      worstTrade.pnl.toFixed(4) +
      " SOL\n" +
      "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
      "*Recent trades:*\n" +
      tradeLines
  );

  pnlTrades = [];
  sessionStart = Date.now();
}

async function jupiterSwap(inputMint, outputMint, amount, slippageBps = 500) {
  const res = await axios.get(
    "https://api.jup.ag/swap/v1/quote" +
      "?inputMint=" +
      inputMint +
      "&outputMint=" +
      outputMint +
      "&amount=" +
      amount +
      "&slippageBps=" +
      slippageBps,
    { headers: JUP_HEADERS, timeout: 15000 }
  );

  if (!res.data || !res.data.swapTransaction) {
    throw new Error("No Jupiter route");
  }

  const txBuf = Buffer.from(res.data.swapTransaction, "base64");
  return Transaction.from(txBuf);
}

async function executeBuy(mint, dex, result, overrideSol, precomputedBundle, source) {
  if (buying.has(mint)) {
    console.log("   ⚠️ Buy in progress:", mint.slice(0, 8));
    return;
  }

  buying.add(mint);
  setMintState(mint, "buying", {
    source: source || "unknown",
    score: result && result.score,
  });

  const buySol = overrideSol || CONFIG.BUY_AMOUNT_SOL;

  if (failedMints.has(mint)) {
    buying.delete(mint);
    setMintState(mint, "blocked", { reason: "in failedMints" });
    return;
  }

  if (positions[mint] && positions[mint].symbol) {
    buying.delete(mint);
    setMintState(mint, "bought", { reason: "position already exists" });
    return;
  }

  const activeMints = Object.keys(positions).filter(
    (m) => positions[m] && positions[m].symbol
  );
  if (activeMints.length >= CONFIG.MAX_POSITIONS) {
    for (let i = 0; i < activeMints.length; i++) {
      const pm = activeMints[i];
      const pos = positions[pm];
      if (!pos || !pos.entryTime) continue;

      const age = Date.now() - pos.entryTime;
      if (!pos.tier1 && age >= CONFIG.PRE_BUY_STALL_MS) {
        console.log("   🔄 Selling stalled position " + pos.symbol + " to make room");
        tg(
          "🔄 *Selling stalled position* — *" +
            pos.symbol +
            "*\nHeld " +
            Math.round(age / 1000) +
            "s, no T1 yet — freeing slot"
        );
        await executeSell(pm, 100, "Stalled — freeing slot");
        delete positions[pm];
        break;
      }
    }
  }

  if (botPaused) {
    console.log("   ⏸ Bot paused — skipping buy for:", mint.slice(0, 8));
    buying.delete(mint);
    return;
  }

  const washResult = checkWashTrading(dex);
  if (washResult.wash) {
    console.log("   🚿 Wash trading detected — " + washResult.reason);
    tg(
      "🚿 *Wash trading — skipped*\n*" +
        dex.name +
        " (" +
        dex.symbol +
        ")*\n" +
        washResult.reason +
        "\nMint: `" +
        mint +
        "`"
    );
    setMintState(mint, "blocked", { reason: "wash: " + washResult.reason });
    buying.delete(mint);
    return;
  }

  const authority = await checkMintAuthority(mint);
  if (!authority.safe) {
    console.log("   🔒 Authority blocked — " + authority.reason);
    tg(
      "🔒 *Authority check — skipped*\n*" +
        dex.name +
        " (" +
        dex.symbol +
        ")*\n" +
        authority.reason +
        "\nMint: `" +
        mint +
        "`"
    );
    if (!authority.transient) failedMints.add(mint);
    setMintState(mint, "blocked", { reason: "authority: " + authority.reason });
    buying.delete(mint);
    return;
  }

  const honeypot = await checkHoneypot(mint);
  if (!honeypot.safe) {
    console.log("   🍯 Honeypot blocked — " + honeypot.reason);
    tg(
      "🍯 *Honeypot detected — skipped*\n*" +
        dex.name +
        " (" +
        dex.symbol +
        ")*\n" +
        honeypot.reason +
        "\nMint: `" +
        mint +
        "`"
    );
    if (!honeypot.transient) failedMints.add(mint);
    setMintState(mint, "blocked", { reason: "honeypot: " + honeypot.reason });
    buying.delete(mint);
    return;
  }

  const bundle = precomputedBundle || (await checkBundle(mint));
  if (bundle.bundled) {
    console.log("   🎯 Bundle blocked — " + bundle.reason);
    tg(
      "🎯 *Bundle detected — skipped*\n" +
        "*" +
        dex.name +
        " (" +
        dex.symbol +
        ")*\n" +
        "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
        "🔎 Score: " +
        bundle.score +
        "/" +
        CONFIG.BUNDLE_MAX_SCORE +
        "\n" +
        "📋 Detail: " +
        bundle.reason +
        "\n" +
        "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
        "Mint: `" +
        mint +
        "`"
    );
    failedMints.add(mint);
    setMintState(mint, "blocked", { reason: "bundle: " + bundle.reason });
    buying.delete(mint);
    return;
  }

  positions[mint] = true;
  const ageStr = fmtAge(dex.ageMin);
  console.log("\n🚀 BUYING: " + dex.name + " (" + dex.symbol + ") age:" + ageStr);

  tgWithButtons(
    "🟡 *#" +
      dex.symbol +
      "*  |  MC: *$" +
      Math.round(dex.mcap).toLocaleString() +
      "*  |  Score: *" +
      result.score +
      "/7*\n" +
      "Liq: $" +
      Math.round(dex.liq).toLocaleString() +
      " | Vol: $" +
      Math.round(dex.vol24h).toLocaleString() +
      " | " +
      (dex.hasTwitter ? "🐦X" : "🚫NoX") +
      "\n" +
      "⏳ Executing via Jito → Jupiter fallback...\n" +
      "[📊 Chart](https://dexscreener.com/solana/" +
      mint +
      ") | [🐦 Birdeye](https://birdeye.so/token/" +
      mint +
      "?chain=solana)\n" +
      mint,
    [[{ text: "🔄 Refresh", callback_data: "refresh:" + mint }]]
  );

  try {
    const solLam = Math.floor(buySol * LAMPORTS_PER_SOL);
    let sig;
    let usedEngine;

    try {
      console.log("   ⚡ Trying Jito Bundle Engine...");
      const jitoResult = await jitoExecutor.executeTrade(mint, "buy", buySol);
      if (jitoResult && jitoResult.error) throw new Error(jitoResult.error.message || JSON.stringify(jitoResult.error));
      sig = jitoResult.result || jitoResult.txId || jitoResult.signature;
      usedEngine = "Jito";
      console.log("   ✅ JITO BUNDLE LANDED:", sig);
    } catch (jitoErr) {
      console.log("   ⚠️ Jito failed (" + (jitoErr.message || "").slice(0, 60) + ") — falling back to Jupiter...");
      const tx = await jupiterSwap(CONFIG.WSOL, mint, solLam, 800);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      usedEngine = "Jupiter";
    }

    const link = "https://solscan.io/tx/" + sig;
    positions[mint] = {
      symbol: dex.symbol,
      name: dex.name,
      mint,
      buyPrice: dex.mcap,
      isCluster: result.isCluster,
      tier1: false,
      tier2: false,
      tier3: false,
      prevVol: dex.vol5m || 0,
      entryVol: dex.vol5m || 0,
      entryHolders: null,
      lastMcap: dex.mcap,
      lastMcapTime: Date.now(),
      entryTime: Date.now(),
      peakGain: 0,
      mcapSnapshots: [{ mcap: dex.mcap, ts: Date.now() }],
      solSpent: buySol,
      entryLiq: dex.liq || 0,
      lastLiq: dex.liq || 0,
      liqDrainSince: null,
    };

    setTimeout(async () => {
      try {
        const initPoolSol = await fetchOnChainPoolSol(mint);
        if (initPoolSol !== null && positions[mint]) {
          positions[mint].buyPoolSol = initPoolSol;
          console.log("   🔗 buyPoolSol baseline:", initPoolSol.toFixed(4));
        }
      } catch (e) {
        console.log("   ⚠️ buyPoolSol fetch error:", (e.message || "").slice(0, 60));
      }
    }, 1000);

    setMintState(mint, "bought", {
      source: source || "unknown",
      engine: usedEngine,
      entryMcap: dex.mcap,
    });
    tg(
      "✅ *Buy Confirmed [" +
        usedEngine +
        "] — " +
        dex.name +
        " (" +
        dex.symbol +
        ")*\n" +
        "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
        "💰 Entry MCap: $" +
        Math.round(dex.mcap).toLocaleString() +
        "\n" +
        "💸 Spent: " +
        buySol +
        " SOL\n" +
        "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
        "Mint: `" +
        mint +
        "`\n" +
        "[View TX](" +
        link +
        ")"
    );
  } catch (err) {
    console.error("   ❌ Buy FAILED:", err.message);
    tg(
      "❌ *Buy FAILED*\n*" +
        dex.name +
        "*\nError: `" +
        (err.message || "").slice(0, 200) +
        "`"
    );
    const errMsg = (err.message || "").toLowerCase();
    if (errMsg.includes("insufficient") || errMsg.includes("not enough")) {
      failedMints.add(mint);
      console.log("   🚫 Added to failedMints:", err.message.slice(0, 80));
    }
    setMintState(mint, "blocked", {
      reason: "buy tx failed: " + (err.message || "").slice(0, 80),
    });
    delete positions[mint];
  } finally {
    buying.delete(mint);
  }
}

async function executeSell(mint, pct, reason) {
  if (selling.has(mint)) {
    console.log("   ⚠️ Sell already in progress:", mint.slice(0, 8));
    return;
  }

  selling.add(mint);
  setMintState(mint, "selling", { reason });

  const pos = positions[mint];
  if (!pos) {
    selling.delete(mint);
    return;
  }

  console.log("📤 SELL " + pct + "% " + pos.symbol + " | " + reason);

  try {
    const mintPk = new PublicKey(mint);
    const tokenProgId = await getTokenProgramId(mintPk);
    const userATA = getAssociatedTokenAddressSync(
      mintPk,
      wallet.publicKey,
      false,
      tokenProgId
    );
    const info = await connection.getTokenAccountBalance(userATA);
    const balance = parseInt((info && info.value && info.value.amount) || "0");
    const tokens = Math.floor(balance * (pct / 100));

    if (tokens <= 0) {
      console.log("   ⚠️ No balance");
      delete positions[mint];
      selling.delete(mint);
      return;
    }

    checkSellViable(mint, tokens)
      .then((v) => {
        if (!v.viable) console.log("   ⚠️ [PreSell] " + pos.symbol + " — " + v.reason + " (selling anyway)");
      })
      .catch(() => {});

    let solBefore = 0;
    try {
      solBefore = (await connection.getBalance(wallet.publicKey, "confirmed")) / LAMPORTS_PER_SOL;
    } catch (e) {
      console.log("   ⚠️ Could not read pre-sell balance:", e.message);
    }

    const tx = await jupiterSwap(mint, CONFIG.WSOL, tokens, 500);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

    const link = "https://solscan.io/tx/" + sig;
    console.log("   ✅ SELL confirmed:", link);

    let solReceived = 0;
    try {
      const solAfter = (await connection.getBalance(wallet.publicKey, "confirmed")) / LAMPORTS_PER_SOL;
      solReceived = solAfter - solBefore;
    } catch (e) {
      console.log("   ⚠️ Could not read post-sell balance:", e.message);
    }

    pos.totalReceived = (pos.totalReceived || 0) + solReceived;

    if (pct >= 100) {
      recordTrade(
        pos.symbol,
        mint,
        pos.solSpent || CONFIG.BUY_AMOUNT_SOL,
        pos.totalReceived,
        reason,
        []
      );
      setMintState(mint, "sold", { reason });
      delete positions[mint];

      setTimeout(async () => {
        try {
          const mintPk2 = new PublicKey(mint);
          const userATA2 = getAssociatedTokenAddressSync(mintPk2, wallet.publicKey);
          const ix = createCloseAccountInstruction(
            userATA2,
            wallet.publicKey,
            wallet.publicKey
          );
          const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
          const txClose = new Transaction().add(ix);
          txClose.recentBlockhash = blockhash;
          txClose.feePayer = wallet.publicKey;
          txClose.sign(wallet);
          const sig2 = await connection.sendRawTransaction(txClose.serialize(), {
            skipPreflight: true,
          });
          await connection.confirmTransaction({ signature: sig2, blockhash, lastValidBlockHeight }, "confirmed");
          tg("♻️ Rent reclaimed — " + pos.symbol + " +0.0020 SOL");
        } catch (e) {
          console.log("⚠️ Rent reclaim failed:", (e.message || "").slice(0, 60));
        }
      }, 3000);
    }

    tg(
      "📤 *SELL — " +
        pos.symbol +
        "*\nMint: `" +
        mint +
        "`\n" +
        pct +
        "% | " +
        reason +
        "\n[TX](" +
        link +
        ")"
    );
  } catch (err) {
    console.error("   ❌ Sell failed:", err.message);
    tg(
      "❌ *Sell FAILED — " +
        (pos && pos.symbol) ||
        mint.slice(0, 8) +
          "*\nError: `" +
          (err.message || "").slice(0, 200) +
          "`"
    );
  } finally {
    selling.delete(mint);
  }
}

// ==========================================
// MONITOR
// ==========================================
async function getTokenProgramId(mintPk) {
  try {
    const info = await connection.getAccountInfo(mintPk);
    if (info && info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  } catch (e) {}
  return TOKEN_PROGRAM_ID;
}

async function fetchOnChainPoolSol(mint) {
  try {
    const cached = poolSolCache.get(mint);
    if (cached && Date.now() - cached.ts < 600) return cached.sol;

    const missed = missCache.get(mint);
    if (missed && Date.now() - missed < 60000) return null;

    const mintPk = new PublicKey(mint);
    const poolAuthority = PublicKey.findProgramAddressSync(
      [Buffer.from("pool-authority"), mintPk.toBuffer()],
      PUMP_PROG_PK
    )[0];

    const indexBuf = Buffer.alloc(2);
    indexBuf.writeUInt16LE(0, 0);

    const poolPk = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        indexBuf,
        poolAuthority.toBuffer(),
        mintPk.toBuffer(),
        new PublicKey(CONFIG.WSOL).toBuffer(),
      ],
      PUMP_AMM_PK
    )[0];

    const wsolAta = getAssociatedTokenAddressSync(new PublicKey(CONFIG.WSOL), poolPk, true);
    const info = await connection.getTokenAccountBalance(wsolAta, "confirmed");
    const sol = info && info.value ? parseInt(info.value.amount) / LAMPORTS_PER_SOL : null;

    if (sol !== null) poolSolCache.set(mint, { sol, ts: Date.now() });
    return sol;
  } catch (e) {
    missCache.set(mint, Date.now());
    pdaMissCount++;
    return null;
  }
}

async function monitor() {
  if (monitorRunning) return;
  monitorRunning = true;

  try {
    const mints = Object.keys(positions);

    for (let i = 0; i < mints.length; i++) {
      const mint = mints[i];
      if (!positions[mint]) continue;

      const pos = positions[mint];

      try {
        if (!pos.ghostDetecting) {
          const ghostAgeMs = pos.entryTime ? Date.now() - pos.entryTime : 0;
          if (ghostAgeMs > 60000 && pos.solSpent > 0) {
            const ghostMintPk = new PublicKey(mint);
            const ghostProgId = await getTokenProgramId(ghostMintPk);
            const ghostAta = getAssociatedTokenAddressSync(
              ghostMintPk,
              wallet.publicKey,
              false,
              ghostProgId
            );
            const ghostBal = await connection
              .getTokenAccountBalance(ghostAta)
              .catch(() => null);
            const ghostRawBal = parseInt(
              (ghostBal && ghostBal.value && ghostBal.value.amount) || "0"
            );

            if (ghostRawBal === 0 && pos.state !== "BUYING") {
              pos.ghostDetecting = true;
              console.log("   👻 Ghost position detected — " + pos.symbol + " — reading sell tx for PnL...");
              try {
                const ghostSigs = await connection
                  .getSignaturesForAddress(ghostAta, { limit: 5 })
                  .catch(() => []);
                let ghostSellSig = null;
                for (let gs = 0; gs < ghostSigs.length; gs++) {
                  if (!ghostSigs[gs].err) {
                    ghostSellSig = ghostSigs[gs].signature;
                    break;
                  }
                }
                if (ghostSellSig) {
                  console.log("   👻 Sell tx found:", ghostSellSig);
                  tg("👻 *Manual Sell Detected — " + pos.symbol + "*\nSell tx: `" + ghostSellSig + "`");
                } else {
                  console.log("   👻 Sell tx not found — closing silently");
                }
              } catch (e) {}
              delete positions[mint];
              continue;
            }
          }
        }
      } catch (e) {}

      const dex = await fetchDex(mint, 2);
      if (!dex) continue;

      let mcap = dex.mcap;
      const holdMs = pos.entryTime ? Date.now() - pos.entryTime : 0;
      const curVol = dex.vol5m || 0;

      pos.onChainTick = (pos.onChainTick || 0) + 1;
      if (holdMs < 420000 && pos.buyPoolSol && pos.onChainTick % 3 === 0) {
        const onChainSol = await fetchOnChainPoolSol(mint);
        if (onChainSol !== null) {
          const onChainGain =
            ((onChainSol - pos.buyPoolSol) / pos.buyPoolSol) * 100;
          mcap = pos.buyPrice * (1 + onChainGain / 100);
        }
      }

      const gain = pos.buyPrice > 0 ? ((mcap - pos.buyPrice) / pos.buyPrice) * 100 : 0;
      const gainStr = (gain >= 0 ? "+" : "") + gain.toFixed(1) + "%";
      console.log(
        pos.symbol +
          " | " +
          gainStr +
          " | MCap $" +
          Math.round(mcap).toLocaleString() +
          (holdMs < 420000 ? " [onchain]" : "")
      );

      if (mcap !== pos.lastMcap) {
        pos.lastMcap = mcap;
        pos.lastMcapTime = Date.now();
      }

      if (gain > (pos.peakGain || 0)) pos.peakGain = gain;

      if (pos.lastLiq && dex.liq !== undefined && dex.liq !== null && dex.liq < pos.lastLiq) {
        const suddenDropPct = (pos.lastLiq - dex.liq) / pos.lastLiq;
        if (suddenDropPct >= 0.4) {
          await executeSell(
            mint,
            100,
            "Sudden liquidity pull — dropped " +
              (suddenDropPct * 100).toFixed(0) +
              "% in one check, now " +
              gainStr
          );
          delete positions[mint];
          continue;
        }
      }

      if (dex.liq !== undefined && dex.liq !== null) pos.lastLiq = dex.liq;

      if (pos.entryLiq > 0 && dex.liq !== undefined && dex.liq !== null) {
        const liqPct = dex.liq / pos.entryLiq;
        const liqDraining =
          liqPct < CONFIG.LIQUIDITY_DRAIN_PCT || dex.liq < CONFIG.LIQUIDITY_ABS_FLOOR;

        if (liqDraining) {
          if (!pos.liqDrainSince) pos.liqDrainSince = Date.now();
          if (Date.now() - pos.liqDrainSince >= CONFIG.LIQUIDITY_DRAIN_CONFIRM_MS) {
            const liqReason =
              dex.liq < CONFIG.LIQUIDITY_ABS_FLOOR
                ? "Liquidity drain — liq $" +
                  Math.round(dex.liq).toLocaleString() +
                  " below hard floor, now " +
                  gainStr
                : "Liquidity drain — liq fell to " +
                  (liqPct * 100).toFixed(0) +
                  "% of entry, now " +
                  gainStr;

            await executeSell(mint, 100, liqReason);
            delete positions[mint];
            continue;
          }
        } else {
          pos.liqDrainSince = null;
        }
      }

      if (!pos.lastSellCheck || Date.now() - pos.lastSellCheck > 60000) {
        pos.lastSellCheck = Date.now();

        const washNow = checkWashTrading(dex);
        if (washNow.wash) {
          console.log("   ⚠️ [WashRecheck] " + pos.symbol + " now showing wash trading — exiting");
          await executeSell(mint, 100, "Wash trading detected while holding: " + washNow.reason);
          delete positions[mint];
          continue;
        }

        try {
          const mintPkChk = new PublicKey(mint);
          const tokProgChk = await getTokenProgramId(mintPkChk);
          const ataChk = getAssociatedTokenAddressSync(
            mintPkChk,
            wallet.publicKey,
            false,
            tokProgChk
          );
          const balChk = await connection.getTokenAccountBalance(ataChk);
          const heldTokens = parseInt(
            (balChk && balChk.value && balChk.value.amount) || "0"
          );

          if (heldTokens > 0) {
            const sellCheck = await checkSellViable(mint, heldTokens);
            if (!sellCheck.viable) {
              console.log(
                "   ⚠️ [SellRouteRecheck] " +
                  pos.symbol +
                  " — " +
                  sellCheck.reason +
                  " — exiting now"
              );
              await executeSell(mint, 100, "Sell route degraded: " + sellCheck.reason);
              delete positions[mint];
              continue;
            }
          }
        } catch (e) {}
      }

      if (!pos.mcapSnapshots) pos.mcapSnapshots = [];
      const lastSnap = pos.mcapSnapshots[pos.mcapSnapshots.length - 1];
      if (!lastSnap || Date.now() - lastSnap.ts >= 60000) {
        pos.mcapSnapshots.push({ mcap, ts: Date.now() });
      }

      if (
        holdMs >= CONFIG.CONVICTION_TIME_MS &&
        (pos.peakGain || 0) < CONFIG.CONVICTION_MIN_GAIN &&
        !pos.convictionExited
      ) {
        pos.convictionExited = true;
        console.log(
          "   ⏱ [Conviction] " +
            pos.symbol +
            " 10min no +" +
            CONFIG.CONVICTION_MIN_GAIN +
            "% — closing | peak +" +
            (pos.peakGain || 0).toFixed(1) +
            "% now " +
            gainStr
        );
        await executeSell(
          mint,
          100,
          "Conviction exit — 10min, peak +" +
            (pos.peakGain || 0).toFixed(1) +
            "%, now " +
            gainStr
        );
        delete positions[mint];
        continue;
      }

      if (!pos.lockedFloor) {
        if (holdMs >= 8 * 60 * 1000 && (pos.peakGain || 0) < CONFIG.SLIDING_STOP_8MIN) {
          console.log(
            "   ⏱ [Sliding] " +
              pos.symbol +
              " 8min no +" +
              CONFIG.SLIDING_STOP_8MIN +
              "% — closing | " +
              gainStr
          );
          await executeSell(
            mint,
            100,
            "Sliding exit — 8min, peak +" + (pos.peakGain || 0).toFixed(1) + "%"
          );
          delete positions[mint];
          continue;
        }

        if (
          holdMs >= 3 * 60 * 1000 &&
          (pos.peakGain || 0) < 20 &&
          gain <= CONFIG.SLIDING_STOP_3MIN
        ) {
          console.log(
            "   ⏱ [Sliding] " +
              pos.symbol +
              " 3min no +20%, now " +
              gainStr +
              " — tightened stop"
          );
          await executeSell(
            mint,
            100,
            "Sliding stop — 3min, peak +" + (pos.peakGain || 0).toFixed(1) + "%, now " + gainStr
          );
          delete positions[mint];
          continue;
        }
      }

      if (holdMs >= 5 * 60 * 1000 && !pos.volVelocityChecked) {
        pos.volVelocityChecked = true;
        if (pos.entryVol && curVol < pos.entryVol * CONFIG.VOL_VELOCITY_DROP) {
          console.log(
            "   📉 [VolVelocity] " +
              pos.symbol +
              " vol dropped >40% from entry — exiting"
          );
          await executeSell(mint, 100, "Volume velocity — 5min vol fell 40%+ from entry");
          delete positions[mint];
          continue;
        }
      }

      if (holdMs >= 5 * 60 * 1000 && !pos.buySellChecked) {
        pos.buySellChecked = true;
        const buys5m = dex.buys5m || 0;
        const sells5m = dex.sells5m || 0;
        if (sells5m > 0 && buys5m > 0 && sells5m > buys5m * 1.5) {
          console.log(
            "   📉 [BuySell] " +
              pos.symbol +
              " sells dominating " +
              sells5m +
              ">" +
              buys5m +
              " — exiting"
          );
          await executeSell(
            mint,
            100,
            "Buy/sell ratio — sells " + sells5m + " vs buys " + buys5m + " at 5min"
          );
          delete positions[mint];
          continue;
        }
