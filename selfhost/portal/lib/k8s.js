// Minimal Kubernetes API client (plain fetch, no SDK). In-cluster it uses the mounted
// ServiceAccount (trust the API CA via NODE_EXTRA_CA_CERTS); out-of-cluster (dev / a session
// pod) set KUBE_SERVER + KUBE_TOKEN (+ NODE_EXTRA_CA_CERTS=<ca.pem>).
const fs = require("fs");
const SA = "/var/run/secrets/kubernetes.io/serviceaccount";

let conf = null;
function config() {
  if (conf) return conf;
  if (process.env.KUBE_SERVER) {
    conf = { server: process.env.KUBE_SERVER.replace(/\/$/, ""), token: process.env.KUBE_TOKEN || "",
             ns: process.env.PORTAL_NAMESPACE || "claude" };
  } else {
    conf = {
      server: `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT || 443}`,
      token: fs.readFileSync(SA + "/token", "utf8").trim(),
      ns: process.env.PORTAL_NAMESPACE || fs.readFileSync(SA + "/namespace", "utf8").trim(),
    };
  }
  return conf;
}
const namespace = () => config().ns;

async function call(method, path, body, { contentType, allow404 } = {}) {
  const c = config();
  const r = await fetch(c.server + path, {
    method,
    headers: {
      Authorization: `Bearer ${c.token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": contentType || "application/json" } : {}),
    },
    body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (r.status === 404 && allow404) return null;
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!r.ok) {
    const err = new Error(`k8s ${method} ${path} -> ${r.status}: ${(json.message || text).slice(0, 300)}`);
    err.status = r.status; throw err;
  }
  return json;
}
const nsPath = (resource, name) => `/api/v1/namespaces/${namespace()}/${resource}${name ? "/" + name : ""}`;

module.exports = {
  namespace,
  get: (resource, name, opts) => call("GET", nsPath(resource, name), null, opts),
  list: (resource, { labelSelector } = {}) =>
    call("GET", nsPath(resource) + (labelSelector ? `?labelSelector=${encodeURIComponent(labelSelector)}` : "")),
  // server-side apply == create-or-update in one call
  apply: (manifest) => {
    const resource = manifest.kind === "Secret" ? "secrets" : manifest.kind === "ConfigMap" ? "configmaps" : null;
    if (!resource) throw new Error("apply: unsupported kind " + manifest.kind);
    return call("PATCH", nsPath(resource, manifest.metadata.name) + "?fieldManager=portal&force=true",
      manifest, { contentType: "application/apply-patch+yaml" });
  },
  delete: (resource, name) => call("DELETE", nsPath(resource, name), null, { allow404: true }),
  // convenience: Secret .data (base64 on the wire) -> plain strings
  decodeData: (data) => Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, Buffer.from(v, "base64").toString("utf8")])),
  // raw call for one-off reads elsewhere in the cluster
  call,
};
