const { setCorsHeaders, handlePreflight } = require("./_cors");
const { requireUser } = require("./_auth");
const { serviceClient } = require("./_match");
const { updateSteam } = require("./_steam-update");

// Runs the Steam updater and streams its progress as JSON lines:
//   {"step": "..."}                       while running
//   {"done": true, "result": {...}}       at the end
//   {"skipped": true, "last_finished_at"} synced under 15 min ago (no force)
//   {"busy": true}                        another run is in progress
//   {"error": "..."}
// POST { force: true } ignores the 15-minute rule, never the one-at-a-time lock.

const MIN_GAP_MS = 15 * 60 * 1000;
// A run that died without finishing stops blocking others after this long.
const STALE_LOCK_MS = 10 * 60 * 1000;
// Vercel stops a function at 300s; stop starting new games well before that.
const TIME_BUDGET_MS = 240 * 1000;

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST")
    return res.status(405).json({ error: "POST only" });

  const user = await requireUser(req, res);
  if (!user) return;

  const force = req.body?.force === true || req.body?.force === "true";
  const db = serviceClient();
  const started = Date.now();

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const send = (obj) => res.write(`${JSON.stringify(obj)}\n`);

  try {
    const [state] = await db.select(
      "library_sync",
      "platform=eq.steam&select=*",
    );
    if (
      !force &&
      state?.last_finished_at &&
      started - new Date(state.last_finished_at).getTime() < MIN_GAP_MS
    ) {
      send({
        skipped: true,
        last_finished_at: state.last_finished_at,
        result: state.last_result,
      });
      return res.end();
    }

    // Take the lock only if nobody holds it (or the holder died long ago).
    // One UPDATE with the condition in its WHERE, so two runs can't both win.
    const staleBefore = new Date(started - STALE_LOCK_MS).toISOString();
    const acquired = await db.updateReturning(
      "library_sync",
      `platform=eq.steam&or=(running_since.is.null,running_since.lt."${staleBefore}")`,
      { running_since: new Date(started).toISOString() },
    );
    if (!acquired?.length) {
      send({ busy: true });
      return res.end();
    }

    let result;
    try {
      const [cred] = await db.select(
        "platform_credentials",
        "platform=eq.steam&select=credentials",
      );
      const steamId = cred?.credentials?.steamId;
      if (!steamId) throw new Error("Steam is not connected");

      result = await updateSteam({
        db,
        steamId,
        deadline: started + TIME_BUDGET_MS,
        log: (step) => send({ step }),
      });
      result.seconds = Math.round((Date.now() - started) / 1000);
      console.log("library-sync steam:", JSON.stringify(result));
    } finally {
      await db.update("library_sync", "platform=eq.steam", {
        running_since: null,
        ...(result
          ? { last_finished_at: new Date().toISOString(), last_result: result }
          : {}),
      });
    }

    send({ done: true, result });
  } catch (err) {
    console.error("library-sync steam failed:", err.message);
    send({ error: err.message });
  }
  res.end();
};
