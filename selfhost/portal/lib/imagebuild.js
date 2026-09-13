// Rebuild the Fly session image from the repo checkout (flyctl remote builder) and record
// the new ref. Runs in the background; poll status(). Replaces the old deploy-session-image.sh.
const { spawn } = require("child_process");
const path = require("path");
const git = require("./gitsync");

let job = null; // { startedAt, done, ok, log, image }

function status() { return job ? { running: !job.done, ok: job.ok, image: job.image, startedAt: job.startedAt, log: job.log.slice(-4000) } : { running: false }; }

async function start(store) {
  if (job && !job.done) throw new Error("a build is already running");
  if (!process.env.FLY_API_TOKEN) throw new Error("FLY_API_TOKEN missing");
  await git.ensure();
  const app = process.env.FLY_APP || "de0ch-claude-sessions";
  const dir = path.join(git.DIR, "selfhost/session-image");
  job = { startedAt: Date.now(), done: false, ok: false, log: "", image: "" };
  const j = job;
  const p = spawn("flyctl", ["deploy", dir, "--config", path.join(dir, "fly.toml"), "--app", app, "--build-only", "--push", "--verbose"],
    { env: { ...process.env, FLY_ACCESS_TOKEN: process.env.FLY_API_TOKEN, NO_COLOR: "1" } });
  const onData = (d) => { j.log += d.toString(); if (j.log.length > 200000) j.log = j.log.slice(-100000); };
  p.stdout.on("data", onData); p.stderr.on("data", onData);
  p.on("close", async (code) => {
    const m = j.log.match(/registry\.fly\.io\/[^\s"']+/g);
    j.image = m ? m[m.length - 1] : "";
    if (code === 0 && j.image) {
      try { await store.setSessionImage(j.image); j.ok = true; }
      catch (e) { j.log += "\n[record image] " + e.message; }
    } else j.log += `\n[flyctl exited ${code}${j.image ? "" : ", no image ref found"}]`;
    j.done = true;
  });
  return status();
}

module.exports = { start, status };
