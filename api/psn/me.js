const { exchangeNpssoForAccessCode, exchangeAccessCodeForAuthTokens, getUserTrophyProfileSummary } = require("psn-api");
const { setCorsHeaders, handlePreflight } = require("../_cors");

module.exports = async function handler(req, res) {
    setCorsHeaders(req, res);
    if (handlePreflight(req, res)) return;

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

