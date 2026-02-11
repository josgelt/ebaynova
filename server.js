const express = require("express");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json());

// Wichtig hinter Railway/Proxy, damit req.protocol korrekt "https" ist
app.set("trust proxy", true);

// ✅ 32–80 Zeichen, nur alnum + _ + -
const VERIFICATION_TOKEN = "ebayDel9Kf7Q2xLp8Zr4Tn6Eb1Yh3DsUa8Wm5Vc";

// 📧 Gmail SMTP via App Password (Railway Variables: MAIL_USER, MAIL_PASS, MAIL_TO)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

async function sendDeletionMail(payload) {
  // Wenn Variablen fehlen, nicht crashen
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS || !process.env.MAIL_TO) {
    console.log("⚠️ MAIL_USER/MAIL_PASS/MAIL_TO nicht vollständig gesetzt – sende keine Mail.");
    return;
  }

  await transporter.sendMail({
    from: `"eBay Deletion Endpoint" <${process.env.MAIL_USER}>`,
    to: process.env.MAIL_TO,
    subject: "⚠️ eBay Account Deletion Request eingegangen",
    text:
      "Eine eBay-Löschanfrage ist eingegangen.\n\n" +
      "Payload:\n" +
      JSON.stringify(payload, null, 2),
  });
}

// GET muss für die eBay Challenge funktionieren (mit und ohne trailing slash)
app.get(["/ebay/account-deletion", "/ebay/account-deletion/"], (req, res) => {
  const challengeCode = req.query.challenge_code;
  if (!challengeCode) return res.status(400).json({ error: "missing challenge_code" });

  // Endpoint exakt so zusammensetzen, wie eBay ihn aufruft (ohne Query)
  const endpoint = `${req.protocol}://${req.get("host")}${req.path}`;

  const hash = crypto.createHash("sha256");
  hash.update(String(challengeCode));
  hash.update(VERIFICATION_TOKEN);
  hash.update(endpoint);
  const challengeResponse = hash.digest("hex");

  return res.status(200).json({ challengeResponse });
});

// POST: echte Lösch-Notifications + Mail
app.post(["/ebay/account-deletion", "/ebay/account-deletion/"], async (req, res) => {
  console.log("📩 eBay Lösch-Notification erhalten:");
  console.log(JSON.stringify(req.body, null, 2));

  try {
    await sendDeletionMail(req.body);
    console.log("📧 Mail wurde gesendet an:", process.env.MAIL_TO);
  } catch (err) {
    console.error("❌ Mailversand fehlgeschlagen:", err?.message || err);
  }

  return res.status(200).send("OK");
});

app.get("/", (req, res) => res.send("✅ eBay Deletion Endpoint läuft"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server läuft auf Port", PORT));
