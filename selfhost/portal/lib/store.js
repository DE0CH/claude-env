// Portal state, cluster-backed with git write-through:
//   environments -> Secrets `env-<name>` (label selfhost.claude/environment=<name>)
//   repos + session image -> ConfigMap `portal-config`
//   Claude OAuth creds -> Secret `claude-credentials` (credentials.json, claude.json)
// Reads hit the k8s API; writes go to git first (sops-encrypted) and are then applied to the
// cluster immediately so the change is usable without waiting for Flux.
const k8s = require("./k8s");
const git = require("./gitsync");

const ENV_LABEL = "selfhost.claude/environment";
const envName = (n) => {
  const s = String(n || "").toLowerCase().trim();
  if (!/^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$/.test(s)) throw new Error("environment id must be lowercase letters/digits/dashes");
  return s;
};
const meta = (name, extra = {}) => ({ name, namespace: k8s.namespace(), ...extra });

async function get() {
  const [list, cm] = await Promise.all([
    k8s.list("secrets", { labelSelector: ENV_LABEL }),
    k8s.get("configmaps", "portal-config", { allow404: true }),
  ]);
  const environments = {};
  for (const s of list.items || []) {
    environments[s.metadata.labels[ENV_LABEL]] = { secrets: k8s.decodeData(s.data) };
  }
  let repos = [];
  try { repos = JSON.parse((cm && cm.data && cm.data["repos.json"]) || "[]"); } catch {}
  return { environments, repos, sessionImage: (cm && cm.data && cm.data.sessionImage) || null };
}

function envManifest(name, secrets) {
  return {
    apiVersion: "v1", kind: "Secret", type: "Opaque",
    metadata: meta(`env-${name}`, { labels: { [ENV_LABEL]: name } }),
    stringData: secrets,
  };
}
async function setEnvironment(rawName, merge) {
  const name = envName(rawName);
  const cur = (await get()).environments[name];
  const secrets = { ...((cur && cur.secrets) || {}) };
  for (const [k, v] of Object.entries(merge || {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`bad key '${k}'`);
    if (v === "") delete secrets[k]; else secrets[k] = String(v);
  }
  const m = envManifest(name, secrets);
  await git.transaction(`portal: environment ${name}`, () =>
    git.writeEncryptedSecret(`${git.SECRETS_DIR}/env-${name}.sops.yaml`, m));
  await k8s.apply(m);
}
async function deleteEnvironment(rawName) {
  const name = envName(rawName);
  await git.transaction(`portal: delete environment ${name}`, () =>
    git.removeFile(`${git.SECRETS_DIR}/env-${name}.sops.yaml`));
  await k8s.delete("secrets", `env-${name}`);
}

async function configManifest(patch) {
  const cur = await get();
  const data = {
    "repos.json": JSON.stringify(patch.repos !== undefined ? patch.repos : cur.repos),
    sessionImage: patch.sessionImage !== undefined ? patch.sessionImage : (cur.sessionImage || ""),
  };
  return { apiVersion: "v1", kind: "ConfigMap", metadata: meta("portal-config"), data };
}
async function setRepos(repos) {
  const m = await configManifest({ repos });
  await git.transaction("portal: repos", () => git.writeYamlish(`${git.K8S_DIR}/config/portal-config.yaml`, m));
  await k8s.apply(m);
}
async function setSessionImage(ref) {
  const m = await configManifest({ sessionImage: ref });
  await git.transaction(`portal: session image ${ref}`, () => git.writeYamlish(`${git.K8S_DIR}/config/portal-config.yaml`, m));
  await k8s.apply(m);
}

async function getClaudeCredentials() {
  const s = await k8s.get("secrets", "claude-credentials", { allow404: true });
  const d = s ? k8s.decodeData(s.data) : {};
  return { credentials: d["credentials.json"] || "", account: d["claude.json"] || "{}" };
}
async function setClaudeCredentials(credentialsJson, accountJson) {
  const m = { apiVersion: "v1", kind: "Secret", type: "Opaque", metadata: meta("claude-credentials"),
    stringData: { "credentials.json": credentialsJson, "claude.json": accountJson || "{}" } };
  await git.transaction("portal: claude credentials", () =>
    git.writeEncryptedSecret(`${git.SECRETS_DIR}/claude-credentials.sops.yaml`, m));
  await k8s.apply(m);
}

module.exports = { get, setEnvironment, deleteEnvironment, setRepos, setSessionImage, getClaudeCredentials, setClaudeCredentials, ENV_LABEL };
