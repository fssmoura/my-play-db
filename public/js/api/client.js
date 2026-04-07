const API_BASE = window.location.hostname === "localhost"
    ? "http://localhost:3000"
    : "https://my-play-db.vercel.app";

async function apiGet(path) {
    const res = await fetch(`${API_BASE}${path}`);
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data.error ?? `API error ${res.status}`), { status: res.status });
    return data;
}

async function apiPost(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data.error ?? `API error ${res.status}`), { status: res.status });
    return data;
}

export { apiGet, apiPost };

