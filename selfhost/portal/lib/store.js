// S3-backed, encrypted config store. The controller is stateless; all portal state
// (environments + their secrets, repo list, session image ref) lives here in your
// Hetzner S3 bucket, encrypted at rest with AES-256-GCM (key = PORTAL_ENC_KEY).
const crypto = require("crypto");
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");

const KEY = "selfhost/portal-config.json.enc";
const DEFAULT = { environments: {}, repos: [], sessionImage: null, flyApp: null };

function s3() {
  let ep = process.env.HETZNER_S3_ENDPOINT || "";
  if (!ep.startsWith("http")) ep = "https://" + ep;
  return new S3Client({
    endpoint: ep,
    region: process.env.HETZNER_S3_REGION || "fsn1",
    forcePathStyle: false,
    credentials: {
      accessKeyId: process.env.HETZNER_S3_ACCESS_KEY,
      secretAccessKey: process.env.HETZNER_S3_SECRET_KEY,
    },
  });
}
const BUCKET = () => process.env.HETZNER_S3_BUCKET;

function encKey() {
  const k = process.env.PORTAL_ENC_KEY || "";
  // accept 64-hex (32 bytes) or any string (hashed to 32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(k)) return Buffer.from(k, "hex");
  return crypto.createHash("sha256").update(k || "insecure-default-change-me").digest();
}
function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
function decrypt(buf) {
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const d = crypto.createDecipheriv("aes-256-gcm", encKey(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString("utf8"));
}
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

let cache = null;
async function load() {
  try {
    const r = await s3().send(new GetObjectCommand({ Bucket: BUCKET(), Key: KEY }));
    cache = { ...DEFAULT, ...decrypt(await streamToBuffer(r.Body)) };
  } catch (e) {
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) cache = { ...DEFAULT };
    else throw e;
  }
  return cache;
}
async function get() { return cache || (await load()); }
async function save(cfg) {
  cache = cfg;
  await s3().send(new PutObjectCommand({
    Bucket: BUCKET(), Key: KEY, Body: encrypt(cfg), ContentType: "application/octet-stream",
  }));
  return cfg;
}
async function mutate(fn) { const c = await get(); await fn(c); return save(c); }

module.exports = { get, save, mutate, load };
