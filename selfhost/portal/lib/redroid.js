// Read-only diagnostics for the redroid box over SSH. The control (SSH) key and the
// Hetzner token both live in the DEFAULT environment's secrets (single source of truth),
// which the portal can read from the cluster via store.get(). We shell out to `ssh`
// (openssh-client is in the image), same style as the git/sops/flyctl shell-outs.
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const store = require("./store");

async function defaults() {
  const cfg = await store.get();
  return (cfg.environments && cfg.environments.default && cfg.environments.default.secrets) || {};
}
async function token() { return (await defaults()).HETZNER_API; }

// Write the private key to a 0600 temp file (rewrite only when it changes).
let keyPath = null;
async function ensureKey() {
  const key = (await defaults()).REDROID_SSH_KEY;
  if (!key) throw new Error("REDROID_SSH_KEY not set in the default environment");
  const norm = key.endsWith("\n") ? key : key + "\n";
  if (!keyPath) keyPath = path.join(os.tmpdir(), "redroid_id_ed25519");
  let cur = null; try { cur = fs.readFileSync(keyPath, "utf8"); } catch {}
  if (cur !== norm) { fs.writeFileSync(keyPath, norm, { mode: 0o600 }); fs.chmodSync(keyPath, 0o600); }
  return keyPath;
}

async function run(ip, remoteCmd, { binary = false, timeout = 20000 } = {}) {
  if (!ip) throw new Error("box has no IP (is it running?)");
  const kp = await ensureKey();
  const args = ["-i", kp, "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
    "-o", "ConnectTimeout=8", "-o", "LogLevel=ERROR", "-o", "BatchMode=yes", `root@${ip}`, remoteCmd];
  return new Promise((resolve, reject) => {
    execFile("ssh", args, { timeout, maxBuffer: 24 * 1024 * 1024, encoding: binary ? "buffer" : "utf8" },
      (err, stdout, stderr) => {
        if (err) { err.message = `ssh: ${err.message} ${String(stderr || "").slice(0, 200)}`; return reject(err); }
        resolve(stdout);
      });
  });
}

// One SSH round-trip that emits KEY=VALUE lines the portal parses. View-only.
// `adb connect` first: idempotent, and after a VM reboot the host adb has not attached
// to localhost:5555 yet (the device would only be visible as emulator-5554).
const ADB_CONNECT = "adb connect localhost:5555 >/dev/null 2>&1";
const HEALTH_CMD = [
  ADB_CONNECT,
  'echo boot=$(adb -s localhost:5555 shell getprop sys.boot_completed 2>/dev/null | tr -d "\\r")',
  'echo model=$(adb -s localhost:5555 shell getprop ro.product.model 2>/dev/null | tr -d "\\r")',
  'echo android=$(adb -s localhost:5555 shell getprop ro.build.version.release 2>/dev/null | tr -d "\\r")',
  'echo redroid=$(docker inspect -f "{{.State.Running}}" redroid 2>/dev/null)',
  'echo proxy=$(/usr/local/bin/redroid-proxy status 2>/dev/null | tr "\\n" " ")',
  'echo exitip=$(/usr/local/bin/redroid-ip 2>/dev/null)',
  'echo load=$(cut -d" " -f1-3 /proc/loadavg)',
  'echo mem=$(free -m | awk "NR==2{print \\$3\\"/\\"\\$2\\" MB\\"}")',
  'echo disk=$(df -h / | awk "NR==2{print \\$3\\"/\\"\\$2\\" (\\"\\$5\\")\\"}")',
  'echo up=$(uptime -p 2>/dev/null)',
].join("; ");

async function health(ip) {
  const out = await run(ip, HEALTH_CMD, { timeout: 25000 });
  const h = {};
  for (const line of String(out).split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) h[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return h;
}

// Fresh screenshot of the Android screen as PNG bytes.
async function screenshot(ip) {
  return run(ip, ADB_CONNECT + "; adb -s localhost:5555 exec-out screencap -p", { binary: true, timeout: 20000 });
}

module.exports = { token, health, screenshot };
