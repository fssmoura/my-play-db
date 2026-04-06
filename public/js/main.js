import { db } from './firebase.js';

const API_BASE = window.location.hostname === "localhost"
    ? "http://localhost:3000"
    : "https://my-play-db.vercel.app";

async function loadTrophies() {
    const res = await fetch(`${API_BASE}/api/hello`);
    const data = await res.json();

    document.getElementById("user").textContent = data.user;

    const list = document.getElementById("trophies");
    for (const game of data.trophies) {
        const li = document.createElement("li");
        li.textContent = `${game.title} — ${game.trophyCount} trophies${game.platinum ? " 🏆" : ""}`;
        list.appendChild(li);
    }
}

loadTrophies();
