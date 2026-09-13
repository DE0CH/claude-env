// Thin Hetzner Cloud API client — just what the portal needs to manage the redroid
// Android box (find it by label, delete it). Docs: docs.hetzner.cloud
const API = "https://api.hetzner.cloud/v1";

async function call(method, path, token, body) {
  if (!token) throw new Error("HETZNER_API not set in the default environment");
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j; try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
  if (!r.ok) {
    const e = new Error(`Hetzner ${method} ${path} -> ${r.status}: ${text.slice(0, 300)}`);
    e.status = r.status; throw e;
  }
  return j;
}

function mapServer(s) {
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    status: s.status, // running | off | starting | stopping | ...
    ip: (s.public_net && s.public_net.ipv4 && s.public_net.ipv4.ip) || null,
    type: (s.server_type && s.server_type.name) || "",
    cores: (s.server_type && s.server_type.cores) || null,
    memoryGb: s.server_type && s.server_type.memory ? Math.round(s.server_type.memory) : null,
    datacenter: (s.datacenter && s.datacenter.name) || "",
    created: s.created,
  };
}

// The box carries label purpose=redroid-android (set at provision time).
async function find(token) {
  const j = await call("GET", "/servers?label_selector=" + encodeURIComponent("purpose=redroid-android"), token);
  return mapServer((j.servers || [])[0]);
}

module.exports = {
  find,
  del: (id, token) => call("DELETE", `/servers/${id}`, token),
};
