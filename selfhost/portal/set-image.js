// Record the freshly-built Fly session image ref into the encrypted S3 config.
// Usage: PORTAL_ENC_KEY=... HETZNER_S3_*=... node set-image.js registry.fly.io/app:deployment-xxx
const store = require("./lib/store");
const ref = process.argv[2];
if (!ref) { console.error("usage: node set-image.js <image-ref>"); process.exit(1); }
store.mutate((c) => { c.sessionImage = ref; })
  .then(() => console.log("[set-image] sessionImage =", ref))
  .catch((e) => { console.error("[set-image] failed:", e.message); process.exit(1); });
