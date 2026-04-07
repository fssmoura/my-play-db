const { exchangeNpssoForAccessCode, exchangeAccessCodeForAuthTokens, getUserTrophyProfileSummary } = require("psn-api");

const ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "https://my-play-db.web.app"
];

module.exports = async function handler(req, res) {
    const origin = req.headers.origin;
    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    }

    if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        return res.status(204).end();
    }

    const npsso = req.body?.npsso;
    if (!npsso) {
        return res.status(400).json({ error: "npsso is required" });
    }

    try {
        const accessCode = await exchangeNpssoForAccessCode(npsso);
        const authorization = await exchangeAccessCodeForAuthTokens(accessCode);
        const profile = await getUserTrophyProfileSummary(authorization, "me");
        return res.status(200).json(profile);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

