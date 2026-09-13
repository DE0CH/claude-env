// Plain-file config store on the controller's disk (Deyao's choice, 2026-09-13):
// environments + their secrets, repo list, session image ref — one JSON file, mode 600.
// No encryption, no S3. controller/create.sh bundles this file into a rebuild.
const fs = require("fs");
const os = require("os");
const path = require("path");

const FILE = process.env.PORTAL_STORE_FILE || path.join(os.homedir(), ".selfhost", "config.json");
const DEFAULT = { environments: {}, repos: [], sessionImage: null, flyApp: null };

let cache = null, cacheMtime = 0;

function load() {
  try {
    const st = fs.statSync(FILE);
    if (cache && st.mtimeMs === cacheMtime) return cache;
    cache = { ...DEFAULT, ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
    cacheMtime = st.mtimeMs;
  } catch (e) {
    if (e.code === "ENOENT") { cache = { ...DEFAULT }; cacheMtime = 0; }
    else throw e;
  }
  return cache;
}
async function get() { return load(); }
async function save(cfg) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  fs.chmodSync(FILE, 0o600);
  cache = cfg; cacheMtime = fs.statSync(FILE).mtimeMs;
  return cfg;
}
async function mutate(fn) { const c = await get(); await fn(c); return save(c); }

module.exports = { get, save, mutate, load: async () => load(), FILE };
