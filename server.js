const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.set("trust proxy", true);

// ✅ dein bestehender Token
const VERIFICATION_TOKEN = "ebayDel9Kf7Q2xLp8Zr4Tn6Eb1Yh3DsUa8Wm5Vc";

function buildEndpointFromReq(req) {
  return `${req.protocol}://${req.get("host")}${req.path}`;
}

async function notifyTelegram(payload) {
  const token = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_CHAT_ID;

  if (!token || !chatId) {
    console.log("⚠️ TG_BOT_TOKEN oder TG_CHAT_ID fehlt – Telegram übersprungen.");
    return;
  }

  const n = payload?.notification || {};
  const d = n?.data || {};

  const text =
    "⚠️ eBay Löschanfrage eingegangen\n\n" +
    `notificationId: ${n.notificationId}\n` +
    `eventDate: ${n.eventDate}\n` +
    `userId: ${d.userId}\n` +
    `username: ${d.username}`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram error ${resp.status}: ${body}`);
  }

  console.log("✅ Telegram Nachricht gesendet");
}


async function sendMailgun(payload) {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const to = process.env.MAIL_TO;
  const from = process.env.MAIL_FROM || `eBay Deletion Bot <mailgun@${domain}>`;

  if (!apiKey || !domain || !to) {
    console.log("⚠️ MAILGUN_API_KEY/MAILGUN_DOMAIN/MAIL_TO fehlt – Mail wird übersprungen.");
    return;
  }

  const url = `https://api.mailgun.net/v3/${domain}/messages`;

  const text =
    "Eine eBay-Löschanfrage ist eingegangen.\n\nPayload (gekürzt):\n" +
    JSON.stringify(payload, null, 2).slice(0, 8000);

  const form = new URLSearchParams();
  form.set("from", from);
  form.set("to", to);
  form.set("subject", "⚠️ eBay Account Deletion Request eingegangen");
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

  const resultText = await resp.text();
  console.log("📧 Mailgun OK:", resultText);
}

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

// ✅ POST: eBay Notifications (immer sofort 200, Mail danach)
app.post(["/ebay/account-deletion", "/ebay/account-deletion/"], (req, res) => {
  res.status(200).send("OK");

  const payload = req.body;
  console.log("📩 eBay Lösch-Notification erhalten:");
  console.log(JSON.stringify(payload, null, 2));

  setImmediate(async () => {
    try {
      await sendMailgun(payload);
    } catch (err) {
      console.error("❌ Mailgun Versand fehlgeschlagen:", err?.message || err);
    }

    try {
      await notifyTelegram(payload);
    } catch (err) {
      console.error("❌ Telegram Versand fehlgeschlagen:", err?.message || err);
    }
  });
});


app.get("/", (req, res) => res.send("✅ eBay Deletion Endpoint läuft"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server läuft auf Port", PORT));
