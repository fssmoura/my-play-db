const { setCorsHeaders, handlePreflight } = require("./_cors");
const { requireUser } = require("./_auth");
const { serviceClient } = require("./_match");
const { updateSteam } = require("./_steam-update");
const { updateEpic } = require("./_epic-update");

// Runs the platform updaters. Each platform is independent: its own lock,
// its own 15-minute rule, and one failing never stops another.
//
// POST (signed in), optional { force: true }: every platform, in parallel,
// streamed as JSON lines:
//   {"platform": "steam", "step": "..."}           while running
//   {"done": true, "platforms": {steam: outcome, epic: outcome}}  at the end
// where an outcome is {result} | {skipped, last_finished_at, result} |
// {busy} | {error}. force ignores the 15-minute rule, never the lock.
//
// GET (Vercel cron, Authorization: Bearer CRON_SECRET), optional
// ?platform=steam|epic (all when absent): same runs, answered as one JSON
// object once finished. Sign-in renewal is not done here; that is
// cron-refresh's job.

const MIN_GAP_MS = 15 * 60 * 1000;
// A run that died without finishing stops blocking others after this long.
const STALE_LOCK_MS = 10 * 60 * 1000;
// Vercel stops a function at 300s; stop starting new games well before that.
const TIME_BUDGET_MS = 240 * 1000;

const UPDATERS = {
  async steam({ db, deadline, log }) {
    const [cred] = await db.select(
      "platform_credentials",
      "platform=eq.steam&select=credentials",
    );
    const steamId = cred?.credentials?.steamId;
    if (!steamId) throw new Error("Steam is not connected");
    return updateSteam({ db, steamId, deadline, log });
  },
  async epic({ db, deadline, log }) {
    const [cred] = await db.select(
      "platform_credentials",
      "platform=eq.epic&select=credentials,expires_at",
    );
    const { accessToken, epicAccountId } = cred?.credentials ?? {};
    if (!accessToken || !epicAccountId)
      throw new Error("Epic is not connected");
    if (cred.expires_at && new Date(cred.expires_at).getTime() < Date.now())
      throw new Error("Epic sign-in has expired");
    return updateEpic({ db, accessToken, epicAccountId, deadline, log });
  },
};

async function runPlatform({ db, platform, force, started, log }) {
  const [state] = await db.select(
    "library_sync",
    `platform=eq.${platform}&select=*`,
  );
  if (!state) throw new Error(`no library_sync row for ${platform}`);
  if (
    !force &&
    state.last_finished_at &&
    started - new Date(state.last_finished_at).getTime() < MIN_GAP_MS
  ) {
    return {
      skipped: true,
      last_finished_at: state.last_finished_at,
      result: state.last_result,
    };
  }

  // Take the lock only if nobody holds it (or the holder died long ago).
  // One UPDATE with the condition in its WHERE, so two runs can't both win.
  const staleBefore = new Date(started - STALE_LOCK_MS).toISOString();
  const acquired = await db.updateReturning(
    "library_sync",
    `platform=eq.${platform}&or=(running_since.is.null,running_since.lt."${staleBefore}")`,
    { running_since: new Date(started).toISOString() },
  );
  if (!acquired?.length) return { busy: true };

  let result;
  let error;
  try {
    result = await UPDATERS[platform]({
      db,
      deadline: started + TIME_BUDGET_MS,
      log,
    });
    result.seconds = Math.round((Date.now() - started) / 1000);
    console.log(`library-sync ${platform}:`, JSON.stringify(result));
  } catch (err) {
    error = err.message;
    console.error(`library-sync ${platform} failed:`, error);
  } finally {
    // A failure is kept in last_result so it shows, but doesn't count as a
    // finished run, so the next one isn't held back by the 15-minute rule.
    await db.update("library_sync", `platform=eq.${platform}`, {
      running_since: null,
      ...(result
        ? { last_finished_at: new Date().toISOString(), last_result: result }
        : {
            last_result: { error, at: new Date().toISOString() },
          }),
    });
  }
  return error ? { error } : { result };
}

async function runAll({ platforms, force, log }) {
  const db = serviceClient();
  const started = Date.now();
  const outcomes = await Promise.all(
    platforms.map((platform) =>
      runPlatform({
        db,
        platform,
        force,
        started,
        log: (step) => log(platform, step),
      }).catch((err) => ({ error: err.message })),
    ),
  );
  return Object.fromEntries(platforms.map((p, i) => [p, outcomes[i]]));
}

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  if (req.method === "GET") {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`)
      return res.status(401).json({ error: "unauthorized" });
    const only = req.query?.platform;
    if (only && !UPDATERS[only])
      return res.status(400).json({ error: `unknown platform: ${only}` });
    const platforms = await runAll({
      platforms: only ? [only] : Object.keys(UPDATERS),
      force: false,
      log: () => {},
    });
    const failed = Object.values(platforms).some((o) => o.error);
    return res.status(failed ? 500 : 200).json({ platforms });
  }

  if (req.method !== "POST")
    return res.status(405).json({ error: "GET (cron) or POST only" });

  const user = await requireUser(req, res);
  if (!user) return;

  const force = req.body?.force === true || req.body?.force === "true";
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const send = (obj) => res.write(`${JSON.stringify(obj)}\n`);

  const platforms = await runAll({
    platforms: Object.keys(UPDATERS),
    force,
    log: (platform, step) => send({ platform, step }),
  });
  send({ done: true, platforms });
  res.end();
};
