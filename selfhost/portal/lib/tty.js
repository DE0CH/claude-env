// Live terminal for a session: the claude TUI runs in tmux inside the Fly machine, so we
// stream `tmux capture-pane` snapshots (1 Hz, only when changed) over SSE and forward
// keystrokes with `tmux send-keys` — all via the Machines exec API we already use.
// No WireGuard, no PTY, works through the cf-tunnel. Enough to watch and nudge a session.
const crypto = require("crypto");
const fly = require("./fly");

const AS_CLAUDE = ["/usr/bin/sudo", "-u", "claude", "-H"];
// cursor_flag: 0 when the app hid the cursor (Ink/claude draws its own) — the mirror must hide
// xterm's too, or a blinking block shows wherever the app last parked the real cursor.
const SNAP = "tmux capture-pane -p -e -t claude; printf '\\n__CUR__%s\\n' \"$(tmux display-message -p -t claude '#{cursor_x},#{cursor_y},#{pane_width},#{pane_height},#{cursor_flag}')\"";

async function snapshot(machineId) {
  const r = await fly.exec(machineId, [...AS_CLAUDE, "/bin/bash", "-lc", SNAP], 10);
  const out = String(r.stdout || "");
  const i = out.lastIndexOf("\n__CUR__");
  if (i < 0) throw new Error("no tmux session (is claude running?)" + (r.stderr ? ": " + String(r.stderr).slice(0, 120) : ""));
  const [x, y, cols, rows, flag] = out.slice(i + 8).trim().split(",").map((n) => parseInt(n, 10));
  return { screen: out.slice(0, i), x, y, cols, rows, cursor: flag !== 0 };
}

function stream(machineId, res, { interval = 1000 } = {}) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write(": ok\n\n");
  let last = "", alive = true, timer = null;
  const tick = async () => {
    if (!alive) return;
    try {
      const s = await snapshot(machineId);
      const h = crypto.createHash("sha1").update(`${s.screen}|${s.x},${s.y},${s.cols},${s.rows},${s.cursor}`).digest("hex");
      if (h !== last) { last = h; res.write(`event: frame\ndata: ${JSON.stringify(s)}\n\n`); }
      else res.write(": tick\n\n");
    } catch (e) { res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`); }
    if (alive) timer = setTimeout(tick, interval);
  };
  tick();
  const stop = () => { alive = false; clearTimeout(timer); };
  res.on("close", stop);
  return stop;
}

const KEYS = new Set(["Enter", "Escape", "Tab", "BSpace", "Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown", "DC",
  "C-c", "C-d", "C-z", "C-l", "C-a", "C-e", "C-k", "C-u", "C-r", "C-w", "S-Tab", "Space"]);
async function input(machineId, { text, keys }) {
  if (text) await fly.exec(machineId, [...AS_CLAUDE, "/usr/bin/tmux", "send-keys", "-t", "claude", "-l", "--", String(text).slice(0, 4000)], 10);
  for (const k of keys || []) {
    if (!KEYS.has(k)) throw new Error("unknown key " + k);
    await fly.exec(machineId, [...AS_CLAUDE, "/usr/bin/tmux", "send-keys", "-t", "claude", k], 10);
  }
}
async function resize(machineId, cols, rows) {
  cols = Math.max(40, Math.min(300, parseInt(cols, 10) || 120));
  rows = Math.max(10, Math.min(120, parseInt(rows, 10) || 40));
  await fly.exec(machineId, [...AS_CLAUDE, "/usr/bin/tmux", "resize-window", "-t", "claude", "-x", String(cols), "-y", String(rows)], 10);
  return { cols, rows };
}

module.exports = { snapshot, stream, input, resize };
