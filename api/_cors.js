const ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "https://my-play-db.vercel.app"
];

function setCorsHeaders(req, res) {
    const origin = req.headers.origin;
    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    }
}

function handlePreflight(req, res) {
    if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        res.status(204).end();
        return true;
    }
    return false;
}

module.exports = { setCorsHeaders, handlePreflight };
