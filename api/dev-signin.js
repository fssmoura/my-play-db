// DEV ONLY: signs the local preview in automatically so the owner doesn't
// retype the password. Credentials come from a git-ignored local file; they
// never go to Vercel. Anything that isn't a local `vercel dev` POST gets a
// plain 404, as if the route didn't exist. Deliberately NOT behind _auth.js
// (it is the thing that creates the session) and NOT using _cors.js (same
// origin only).
const fs = require("fs");
const os = require("os");
const path = require("path");

const SUPABASE_URL = "https://bcqodvutikcetnxtzigr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_98P3cCMcgw9YlldTH2rGkg_TFWR77zs";
// One place on this PC, outside every checkout, so every worktree's preview
// uses it and it can never be committed.
const FILE_PATH = path.join(os.homedir(), ".my-play-db", "dev-signin.env");

function notFound(res) {
  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain");
  res.end("Not found");
}

function isLocalHost(host) {
  return /^(localhost|127\.0\.0\.1):\d+$/.test(String(host ?? ""));
}

function readCredentials() {
  let text;
  try {
    text = fs.readFileSync(FILE_PATH, "utf8");
  } catch {
    return null;
  }
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(DEV_SIGNIN_EMAIL|DEV_SIGNIN_PASSWORD)\s*=(.*)$/);
    if (match) values[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  if (!values.DEV_SIGNIN_EMAIL || !values.DEV_SIGNIN_PASSWORD) return null;
  return { email: values.DEV_SIGNIN_EMAIL, password: values.DEV_SIGNIN_PASSWORD };
}

module.exports = async function handler(req, res) {
  const env = process.env.VERCEL_ENV;
  if (env && env !== "development") return notFound(res);
  if (req.method !== "POST") return notFound(res);
  if (!isLocalHost(req.headers?.host)) return notFound(res);
  // Browsers send Origin on POST; a foreign page must not be able to trigger this.
  const origin = req.headers?.origin;
  if (origin && origin !== `http://${req.headers.host}`) return notFound(res);
  const creds = readCredentials();
  if (!creds) return notFound(res);

  try {
    const response = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: creds.email, password: creds.password }),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token || !data.refresh_token) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "sign-in failed" }));
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      JSON.stringify({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      }),
    );
  } catch {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "sign-in failed" }));
  }
};
