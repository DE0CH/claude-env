// Thin Fly.io Machines API client. One Fly app holds the session image; each session
// is a Machine in that app. Docs: https://fly.io/docs/machines/api/
const API = "https://api.machines.dev/v1";

function headers() {
  return {
    Authorization: `Bearer ${process.env.FLY_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}
async function call(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!r.ok) {
    const err = new Error(`Fly ${method} ${path} -> ${r.status}: ${text.slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }
  return json;
}

const app = () => process.env.FLY_APP || "de0ch-claude-sessions";

module.exports = {
  listMachines: () => call("GET", `/apps/${app()}/machines`),
  getMachine: (id) => call("GET", `/apps/${app()}/machines/${id}`),
  createMachine: ({ name, region, image, env, guest, metadata }) =>
    call("POST", `/apps/${app()}/machines`, {
      name,
      region: region || process.env.FLY_REGION || "arn",
      config: {
        image,
        env: env || {},
        metadata: metadata || {},
        auto_destroy: false,
        restart: { policy: "on-failure", max_retries: 3 },
        guest: guest || { cpu_kind: "shared", cpus: 1, memory_mb: 1024 },
      },
    }),
  // Run a command inside a started machine; returns {stdout, stderr, exit_code}.
  exec: (id, command, timeout = 15) =>
    call("POST", `/apps/${app()}/machines/${id}/exec`, { command, timeout }),
  stopMachine: (id) => call("POST", `/apps/${app()}/machines/${id}/stop`),
  startMachine: (id) => call("POST", `/apps/${app()}/machines/${id}/start`),
  destroyMachine: (id) => call("DELETE", `/apps/${app()}/machines/${id}?force=true`),
};
