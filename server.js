const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json());

// Wichtig hinter Railway/Proxy, damit req.protocol korrekt "https" ist
app.set("trust proxy", true);

// ✅ 32–80 Zeichen, nur alnum + _ + -
const VERIFICATION_TOKEN = "ebayDel9Kf7Q2xLp8Zr4Tn6Eb1Yh3DsUa8Wm5Vc";

// GET muss für die eBay Challenge funktionieren (mit und ohne trailing slash)
app.get(["/ebay/account-deletion", "/ebay/account-deletion/"], (req, res) => {
  const challengeCode = req.query.challenge_code;
  if (!challengeCode) return res.status(400).json({ error: "missing challenge_code" });

  // Endpoint exakt so zusammensetzen, wie eBay ihn aufruft (ohne Query)
  // eBay: GET https://<callback_URL>?challenge_code=...
  const endpoint = `${req.protocol}://${req.get("host")}${req.path}`;

  const hash = crypto.createHash("sha256");
  hash.update(String(challengeCode));
  hash.update(VERIFICATION_TOKEN);
  hash.update(endpoint);
  const challengeResponse = hash.digest("hex");

  // Content-Type muss application/json sein
  return res.status(200).json({ challengeResponse });
});

// POST: echte Lösch-Notifications
app.post(["/ebay/account-deletion", "/ebay/account-deletion/"], (req, res) => {
  console.log("📩 eBay Lösch-Notification erhalten:");
  console.log(JSON.stringify(req.body, null, 2));
  return res.status(200).send("OK");
});

app.get("/", (req, res) => res.send("✅ eBay Deletion Endpoint läuft"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server läuft auf Port", PORT));
