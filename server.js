const express = require("express");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json());
app.set("trust proxy", true);

// ✅ 32–80 Zeichen, nur alnum + _ + -
const VERIFICATION_TOKEN = "ebayDel9Kf7Q2xLp8Zr4Tn6Eb1Yh3DsUa8Wm5Vc";

function buildEndpointFromReq(req) {
  return `${req.protocol}://${req.get("host")}${req.path}`;
}

async function sendDeletionMail(payload) {
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_PASS;
  const to = process.env.MAIL_TO;

  if (!user || !pass || !to) {
    console.log("⚠️ MAIL_USER/MAIL_PASS/MAIL_TO fehlt – Mail wird übersprungen.");
    return;
  }

  // Transporter erst "just-in-time" erstellen (verhindert Start-/Crash-Probleme)
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: `"eBay Deletion Endpoint" <${user}>`,
    to,
    subject: "⚠️ eBay Account Deletion Request eingegangen",
    text:
      "Eine eBay-Löschanfrage ist eingegangen.\n\nPayload:\n" +
      JSON.stringify(payload, null, 2),
  });
}

// ✅ GET: eBay Endpoint-Validation (Challenge)
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

// ✅ POST: eBay Notifications (WICHTIG: sofort 200 zurückgeben)
app.post(["/ebay/account-deletion", "/ebay/account-deletion/"], (req, res) => {
  // 1) sofort antworten -> eBay happy, keine Timeouts/502
  res.status(200).send("OK");

  // 2) danach erst Logging + Mail (asynchron)
  const payload = req.body;
  console.log("📩 eBay Lösch-Notification erhalten:");
  console.log(JSON.stringify(payload, null, 2));

  setImmediate(async () => {
    try {
      await sendDeletionMail(payload);
      console.log("📧 Mail gesendet (falls MAIL_* gesetzt).");
    } catch (err) {
      console.error("❌ Mailversand fehlgeschlagen:", err?.message || err);
    }
  });
});

app.get("/", (req, res) => res.send("✅ eBay Deletion Endpoint läuft"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server läuft auf Port", PORT));
