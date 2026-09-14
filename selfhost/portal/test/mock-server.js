#!/usr/bin/env node
// Fake portal API for driving the dashboard locally (no cluster / Fly / GitHub needed):
//   node selfhost/portal/test/mock-server.js [port]   → serves ../public + canned /api/*
// Used by dashboard.test.js in mock mode and for eyeballing UI changes before a push.
const express = require("express");
const path = require("path");
const app = express();
app.use(express.json());
const now = Date.now();
const sessions = [
  // m1 is a one-shot (its prompt is the whole job: no auto-pause, destroyed by the portal when done)
  { id: "m1", name: "s-weekly-report-ab12c", state: "started", status: "busy", region: "arn", created: new Date(now - 5 * 60000).toISOString(), environment: "default", repos: "https://github.com/DE0CH/claude-env.git", permissionMode: "auto", model: "claude-fable-5-1", autoPause: "off", oneShot: true, guest: "4×shared · 4 GB", label: "Weekly report", aiTitle: "Weekly Report Digest" },
  { id: "m2", name: "paused-one", state: "stopped", region: "fra", created: new Date(now - 3 * 3600000).toISOString(), environment: "default", repos: "https://github.com/DE0CH/claude-env.git https://github.com/DE0CH/wda-build.git", permissionMode: "bypass", model: "claude-opus-4-8", autoPause: "off", guest: "2×shared · 2 GB", label: "Long-running paused session with a rather long title" },
];
app.get("/api/state", (req, res) => res.json({ version: "mock", flyApp: "de0ch-claude-sessions", hasCreds: true, creds: { expiresAt: new Date(now + 3600000).toISOString(), subscriptionType: "max" }, auth: {}, sessionImage: "ghcr.io/de0ch/claude-sessions:sha-mock", flyError: null,
  environments: { default: { keys: ["FLY_API_TOKEN", "GITHUB_TOKEN", "LOBSTER_TOKEN", "SERPAPI_KEY"] }, scratch: { keys: ["FOO"] } },
  repos: [{ name: "claude-env", url: "https://github.com/DE0CH/claude-env.git" }, { name: "wda-build", url: "https://github.com/DE0CH/wda-build.git" }], sessions }));
app.get("/api/sizes", (req, res) => res.json({ sizes: { small: { label: "2 shared vCPU / 2 GB" }, medium: { label: "4 shared vCPU / 4 GB" }, large: { label: "8 shared vCPU / 8 GB" } }, default: "medium" }));
app.get("/api/models", (req, res) => res.json({ models: { "claude-opus-4-8": { label: "Opus 4.8 — fast" }, "claude-fable-5-1": { label: "Fable 5.1 — most capable" } }, default: "claude-opus-4-8" }));
app.get("/api/github/repos", (req, res) => res.json({ repos: [
  { fullName: "DE0CH/claude-env", url: "https://github.com/DE0CH/claude-env.git", htmlUrl: "https://github.com/DE0CH/claude-env", description: "Claude environment", language: "JavaScript", private: true, pushedAt: new Date(now - 600000).toISOString() },
  { fullName: "DE0CH/other", url: "https://github.com/DE0CH/other.git", htmlUrl: "https://github.com/DE0CH/other", description: "Something else", language: "Python", pushedAt: new Date(now - 86400000).toISOString() },
] }));
app.get("/api/redroid/state", (req, res) => res.json({ configured: false, server: null, error: "HETZNER_API not set (mock)" }));
let size = { cols: 120, rows: 40 };
app.post("/api/sessions/:id/tty/resize", (req, res) => { size = { cols: +req.body.cols, rows: +req.body.rows }; console.log("resize", size); res.json(size); });
app.post("/api/sessions/:id/tty/input", (req, res) => { console.log("input", JSON.stringify(req.body)); res.json({ ok: true }); });
app.get("/api/sessions/:id/tty/frame", (req, res) => {
  const lines = []; for (let r = 0; r < size.rows; r++) lines.push(r === 0 ? `╭${"─".repeat(size.cols - 2)}╮` : r === size.rows - 1 ? `╰${"─".repeat(size.cols - 2)}╯` : `│ line ${String(r).padStart(3)} ${"·".repeat(Math.max(0, size.cols - 12))} │`);
  res.json({ screen: lines.join("\n"), x: 3, y: 2, cols: size.cols, rows: size.rows, cursor: false });
});
app.post("/api/sessions/:id/autopause", (req, res) => { const s = sessions.find((x) => x.id === req.params.id); setTimeout(() => { s.autoPause = req.body.enabled ? "on" : "off"; }, 3000); res.json({ ok: true }); });
app.post("/api/sessions/:id/stop", (req, res) => { const s = sessions.find((x) => x.id === req.params.id); setTimeout(() => { s.state = "stopped"; s.status = undefined; }, 3000); res.json({ ok: true }); });
app.post("/api/sessions/:id/start", (req, res) => { const s = sessions.find((x) => x.id === req.params.id); setTimeout(() => { s.state = "started"; }, 3000); setTimeout(() => { s.status = "idle"; }, 6000); res.json({ ok: true }); });
app.post("/api/sessions/:id/permission-mode", (req, res) => { const s = sessions.find((x) => x.id === req.params.id); const mode = req.body.mode === "bypass" ? "bypass" : "auto"; setTimeout(() => { s.state = "stopped"; s.status = undefined; }, 1500); setTimeout(() => { s.state = "started"; s.permissionMode = mode; }, 4000); setTimeout(() => { s.status = "idle"; }, 6000); res.json({ ok: true, permissionMode: mode }); });
app.get("/api/sessions/:id/changes", (req, res) => res.json({ checked: true, repos: [{ name: "claude-env", uncommitted: 2, unpushed: 0 }], status: "idle" }));
app.post("/api/sessions", (req, res) => { if (req.body.oneShot && !req.body.prompt) return res.status(400).json({ error: "a one-shot session needs a prompt" }); const id = "m" + (sessions.length + 1); sessions.push({ id, name: req.body.label || "new", state: "created", region: "arn", created: new Date().toISOString(), ...req.body, repos: (req.body.repos || []).join(" "), autoPause: req.body.autoPause === false || req.body.oneShot ? "off" : "on", oneShot: !!req.body.oneShot }); setTimeout(() => { const s = sessions.find((x) => x.id === id); s.state = "started"; s.status = "idle"; }, 4000); res.json({ ok: true, id }); });
app.post("/api/auth/start", (req, res) => res.json({ url: "https://claude.ai/oauth/authorize?mock=1" }));
app.post("/api/environments", (req, res) => { console.log("env save", Object.keys(req.body.secrets || {})); res.json({ ok: true }); });
app.post("/api/repos", (req, res) => res.json({ ok: true }));
app.use((req, res, next) => { if (req.path.startsWith("/api/")) return res.status(404).json({ error: "mock: no route " + req.method + " " + req.path }); next(); });
app.use(express.static(path.join(__dirname, "..", "public")));
const port = +process.argv[2] || 18080;
app.listen(port, "127.0.0.1", () => console.log(`mock portal on http://127.0.0.1:${port}/`));
