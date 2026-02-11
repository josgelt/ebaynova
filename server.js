const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json());

// Railway/Render etc. laufen oft hinter einem Proxy → hilft bei req.protocol
app.set("trust proxy", true);

// ✅ 32–80 Zeichen, nur [A-Za-z0-9_-]
const VERIFICATION_TOKEN = "ebayDel9Kf7Q2xLp8Zr4Tn6Eb1Yh3DsUa8Wm5Vc";

// ❗ Muss exakt der Endpoint sein, den du bei eBay einträgst (ohne ?challenge_code)
const ENDPOINT = "https://nodejs-production-048a.up.railway.app";

/**
 * 1) eBay VALIDATION (GET ...?challenge_code=XYZ)
 * Erwartet: JSON { "challengeResponse": "<sha256 hex>" }
 */
app.get("/ebay/account-deletion", (req, res) => {
  const challengeCode = req.query.challenge_code;

  if (!challengeCode) {
    return res.status(400).json({ error: "missing challenge_code" });
  }

  const hash = crypto.createHash("sha256");
  hash.update(challengeCode);
  hash.update(VERIFICATION_TOKEN);
  hash.update(ENDPOINT);

  const challengeResponse = hash.digest("hex");

  return res
    .status(200)
    .type("application/json")
    .send(JSON.stringify({ challengeResponse }));
});

/**
 * 2) eBay NOTIFICATIONS (POST)
 * Hier kommen echte Lösch-Notifications rein.
 */
app.post("/ebay/account-deletion", (req, res) => {
  console.log("📩 eBay Lösch-Notification erhalten:");
  console.log(JSON.stringify(req.body, null, 2));

  // TODO: hier echte Löschung in deinem System durchführen

  return res.status(200).send("OK");
});

app.get("/", (req, res) => res.send("✅ eBay Deletion Endpoint läuft"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server läuft auf Port", PORT));

