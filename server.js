const express = require("express");
const app = express();

app.use(express.json());

// 🔐 eBay Verification Token
const VERIFICATION_TOKEN = "ebayDel_9Kf7Q2xLp8Zr4Tn6Eb1Yh3DsUa8Wm5Vc";

app.post("/ebay/account-deletion", (req, res) => {
  const token = req.headers["verification-token"] || req.headers["x-ebay-signature"];

  if (token !== VERIFICATION_TOKEN) {
    console.log("❌ Ungültiger Verification Token");
    return res.status(403).send("Forbidden");
  }

  console.log("📩 eBay Löschanfrage erhalten:");
  console.log(JSON.stringify(req.body, null, 2));

  // 👉 TODO: hier deine Daten löschen

  return res.status(200).send("OK");
});

app.get("/", (req, res) => res.send("✅ eBay Deletion Endpoint läuft"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server läuft auf Port", PORT));
