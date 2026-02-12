/**
 * eBay Marketplace Account Deletion Endpoint (Node.js / Express)
 * Daily Digest (Telegram + optional Mailgun) once per day.
 *
 * Required ENV:
 * - EBAY_VERIFICATION_TOKEN
 *
 * Optional ENV:
 * - ENABLE_TELEGRAM_DIGEST=true|false   (default: true)
 * - ENABLE_EMAIL_DIGEST=true|false      (default: false)
 * - DIGEST_CRON="0 20 * * *"            (default: 0 20 * * * -> 20:00)
 * - DIGEST_TZ="Europe/Vienna"           (default: Europe/Vienna)
 * - MAX_EVENTS_BUFFER=5000              (default: 5000)
 *
 * Telegram ENV (if enabled):
 * - TG_BOT_TOKEN
 * - TG_CHAT_ID
 *
 * Mailgun ENV (if enabled):
 * - MAILGUN_API_KEY
 * - MAILGUN_DOMAIN
 * - MAIL_TO
 * - MAIL_FROM (optional)
 */

const express = require("express");
const crypto = require("crypto");
const cron = require("node-cron");

const app = express();
app.use(express.json());
app.set("trust proxy", true);

// ====== CONFIG (ENV-FIRST, no hardcoded secrets) ======
const VERIFICATION_TOKEN = process.env.EBAY_VERIFICATION_TOKEN;
if (!VERIFICATION_TOKEN) {
  console.error("❌ Missing ENV: EBAY_VERIFICATION_TOKEN");
  process.exit(1);
}

const ENABLE_TELEGRAM_DIGEST =
  (process.env.ENABLE_TELEGRAM_DIGEST || "true").toLowerCase() === "true";

const ENABLE_EMAIL_DIGEST =
  (process.env.ENABLE_EMAIL_DIGEST || "false").toLowerCase() === "true";

const DIGEST_CRON = process.env.DIGEST_CRON || "0 20 * * *"; // daily 20:00
const DIGEST_TZ = process.env.DIGEST_TZ || "Europe/Vienna";

const MAX_EVENTS_BUFFER = Number(process.env.MAX_EVENTS_BUFFER || 5000);
if (!Number.isFinite(MAX_EVENTS_BUFFER) || MAX_EVENTS_BUFFER <= 0) {
  console.error("❌ Invalid MAX_EVENTS_BUFFER. Must be a positive number.");
  process.exit(1);
}
// =======================================================

// ===== In-memory Digest Store =====
let bufferedEvents = [];
let bufferedCountTotal = 0;

function addToDigestBuffer(payload) {
  const n = payload?.notification || {};
  const d = n?.data || {};

  const item = {
    notificationId: n.notificationId || null,
    eventDate: n.eventDate || null,
    userId: d.userId || null,
    username: d.username || null,
  };

  bufferedCountTotal += 1;

  // store only up to MAX_EVENTS_BUFFER items, but keep total count
  if (bufferedEvents.length < MAX_EVENTS_BUFFER) {
    bufferedEvents.push(item);
  }
}

function buildDigestText() {
  const countStored = bufferedEvents.length;
  const countTotal = bufferedCountTotal;

  const header = "⚠️ eBay Daily Digest – Löschanfragen";
  if (countTotal === 0) {
    return `${header}\n\n✅ Keine Löschanfragen in den letzten 24h.`;
  }

  const userIds = new Set();
  const usernames = new Map(); // username -> count
  let first = null;
  let last = null;

  for (const e of bufferedEvents) {
    if (e.userId) userIds.add(e.userId);
    if (e.username) usernames.set(e.username, (usernames.get(e.username) || 0) + 1);

    if (e.eventDate) {
      if (!first || e.eventDate < first) first = e.eventDate;
      if (!last || e.eventDate > last) last = e.eventDate;
    }
  }

  const topUsernames = [...usernames.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const lines = [];
  lines.push(header);
  lines.push("");
  lines.push(`Total Events (24h): ${countTotal}`);
  lines.push(`Unique userIds (aus Buffer): ${userIds.size}`);
  if (first || last) lines.push(`Zeitraum (aus Buffer): ${first || "?"} → ${last || "?"}`);
  lines.push(`Buffer gespeichert: ${countStored}/${MAX_EVENTS_BUFFER}`);

  if (topUsernames.length) {
    lines.push("");
    lines.push("Top usernames (aus Buffer):");
    for (const [name, c] of topUsernames) lines.push(`- ${name}: ${c}`);
  }

  return lines.join("\n");
}

function resetDigestBuffer() {
  bufferedEvents = [];
  bufferedCountTotal = 0;
}
// ===== End Digest Store =====

function buildEndpointFromReq(req) {
  return `${req.protocol}://${req.get("host")}${req.path}`;
}

// ---- Telegram digest ----
async function sendTelegram(text) {
  const token = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_CHAT_ID;

  if (!token || !chatId) {
    console.log("⚠️ TG_BOT_TOKEN oder TG_CHAT_ID fehlt – Telegram Digest übersprungen.");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram error ${resp.status}: ${body}`);
  }

  console.log("✅ Telegram Digest gesendet");
}

// ---- Mailgun digest ----
async function sendMailgun(text) {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const to = process.env.MAIL_TO;
  const from =
    process.env.MAIL_FROM || (domain ? `eBay Deletion Bot <mailgun@${domain}>` : "eBay Deletion Bot");

  if (!apiKey || !domain || !to) {
    console.log("⚠️ MAILGUN_API_KEY/MAILGUN_DOMAIN/MAIL_TO fehlt – Mail Digest übersprungen.");
    return;
  }

  const url = `https://api.mailgun.net/v3/${domain}/messages`;

  const form = new URLSearchParams();
  form.set("from", from);
  form.set("to", to);
  form.set("subject", "eBay Daily Digest – Account Deletion Requests");
  form.set("text", text);

  const auth = Buffer.from(`api:${apiKey}`).toString("base64");

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Mailgun error ${resp.status}: ${body}`);
  }

  console.log("📧 Mailgun Digest OK");
}

// ===== Daily Digest Scheduler =====
cron.schedule(
  DIGEST_CRON,
  async () => {
    try {
      const text = buildDigestText();

      if (ENABLE_TELEGRAM_DIGEST) {
        try {
          await sendTelegram(text);
        } catch (err) {
          console.error("❌ Telegram Digest fehlgeschlagen:", err?.message || err);
        }
      } else {
        console.log("📲 Telegram Digest deaktiviert");
      }

      if (ENABLE_EMAIL_DIGEST) {
        try {
          await sendMailgun(text);
        } catch (err) {
          console.error("❌ Mailgun Digest fehlgeschlagen:", err?.message || err);
        }
      } else {
        console.log("📧 Email Digest deaktiviert");
      }

      resetDigestBuffer();
      console.log("🧹 Digest Buffer zurückgesetzt");
    } catch (err) {
      console.error("❌ Digest Job Crash:", err?.message || err);
    }
  },
  { timezone: DIGEST_TZ }
);

console.log(`🕒 Daily Digest geplant: "${DIGEST_CRON}" TZ=${DIGEST_TZ}`);
// ===== End Scheduler =====

// ✅ GET: eBay Endpoint Validation (Challenge)
app.get(["/ebay/account-deletion", "/ebay/account-deletion/"], (req, res) => {
  const challengeCode = req.query.challenge_code;
  if (!challengeCode) return res.status(400).json({ error: "missing challenge_code" });

  const endpoint = buildEndpointFromReq(req);

  const hash = crypto.createHash("sha256");
  hash.update(String(challengeCode));
  hash.update(VERIFICATION_TOKEN);
  hash.update(endpoint);

  return res.status(200).json({ challengeResponse: hash.digest("hex") });
});

// ✅ POST: eBay Notifications (immer sofort 200, nur sammeln)
app.post(["/ebay/account-deletion", "/ebay/account-deletion/"], (req, res) => {
  res.status(200).send("OK");

  const payload = req.body;

  const topic = payload?.metadata?.topic;
  if (topic !== "MARKETPLACE_ACCOUNT_DELETION") {
    console.log("ℹ️ Ignoriere Topic:", topic);
    return;
  }

  addToDigestBuffer(payload);
  console.log(
    "📥 Deletion Event gesammelt. total24h=",
    bufferedCountTotal,
    "stored=",
    bufferedEvents.length
  );
});

// Health
app.get("/", (_req, res) =>
  res.send("✅ eBay Deletion Endpoint läuft (Daily Digest aktiv)")
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server läuft auf Port", PORT));
