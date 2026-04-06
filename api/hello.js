// Test endpoint — replace with real feature endpoints (e.g. api/psn/trophies.js).
// Each file in api/ becomes a serverless function at /api/<filename>.
// Copy the CORS block into every new endpoint.
const ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "https://my-play-db.web.app"
];

export default function handler(req, res) {
    const origin = req.headers.origin;
    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    }

    // Mock data simulating what a PSN API response will look like
    res.status(200).json({
        user: "fssmoura",
        trophies: [
            { title: "God of War", platinum: true, trophyCount: 51 },
            { title: "Spider-Man", platinum: false, trophyCount: 23 }
        ]
    });
}
