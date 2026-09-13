// Auth broker: the ONE process that holds the Re-login PTY (`claude auth login --claudeai`,
// lib/auth.js). It runs as its own Deployment (k8s/auth/), pinned separately from the portal
// (CI bumps its pin only when lib/auth.js or this file change), so a portal rollout never kills
// a login in progress. The portal forwards /api/auth/* here (lib/authclient.js) and stores the
// credentials the broker hands back; the broker itself touches no git, cluster, or secrets.
const express = require("express");
const auth = require("./lib/auth");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/status", (req, res) => res.json(auth.status()));
// body: { credentials, account } — the portal's current pair, used to seed the CLI's home
app.post("/start", async (req, res) => {
  try { auth.seedHome(req.body || {}); res.json(await auth.start()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// body: { code } → { ok, output, credentials, account } — the caller persists the pair
app.post("/code", async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: "code required" });
    let pair = null;
    const r = await auth.submit(code, (credentials, account) => { pair = { credentials, account }; });
    res.json({ ...r, ...pair });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = Number(process.env.PORT || 8081);
app.listen(PORT, process.env.HOST || "0.0.0.0", () => console.log(`[auth-broker] listening on ${PORT}`));
