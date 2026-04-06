const API_BASE = window.location.hostname === "localhost"
    ? "http://localhost:3000"
    : "https://my-play-db.vercel.app";

async function apiGet(path) {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
}

export { apiGet };
