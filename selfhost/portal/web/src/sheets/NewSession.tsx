import { useState } from "react";
import { api } from "../api";
import { useStore, refresh, settle, setTab } from "../store";
import { Sheet } from "../Sheet";
import { Lbl, Spinner, useBusy } from "../ui";

export function NewSession({ open, onClose, onClosed }: { open: boolean; onClose: () => void; onClosed: () => void }) {
  const st = useStore((s) => s.state), SIZES = useStore((s) => s.sizes), MODELS = useStore((s) => s.models);
  const envs = Object.keys(st.environments || {}), repos = st.repos || [];
  const [env, setEnv] = useState(envs[0] || "");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(repos.filter((r) => r.name === "claude-env" || repos.length === 1).map((r) => r.name)));
  const [perm, setPerm] = useState("auto"), [model, setModel] = useState(MODELS.default), [size, setSize] = useState(SIZES.default), [autoPause, setAutoPause] = useState(true);
  const [label, setLabel] = useState(""), [prompt, setPrompt] = useState("");
  const [busy, run] = useBusy();
  async function start() {
    await run("Starting…", async () => {
      try {
        const r = await api("POST", "api/sessions", { environment: env, repos: [...picked], label: label.trim(), permissionMode: perm, size, model, prompt: prompt.trim(), autoPause });
        onClose();
        await refresh(false);                                 // card appears in its REAL state (creating…)
        settle((s) => { const m = (s.sessions || []).find((x) => x.id === r.id); return !!(m && m.state === "started" && m.status); }); // fast-poll until claude is actually up
      } catch (e: any) { alert("Start failed: " + e.message); if (/Re-login/.test(e.message)) { onClose(); setTab("settings"); } }
    });
  }
  // Bootstrap list group of radio / checkbox rows
  const Row = ({ type, name, value, checked, onChange, t, sub }: { type: "radio" | "checkbox"; name: string; value: string; checked: boolean; onChange: (c: boolean) => void; t: React.ReactNode; sub?: React.ReactNode }) => (
    <label className="list-group-item d-flex gap-3 align-items-center">
      <input className="form-check-input flex-shrink-0 m-0" type={type} name={name} value={value} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex-grow-1 text-break">{t}{sub && <small className="d-block text-body-secondary">{sub}</small>}</span>
    </label>);
  return (
    <Sheet open={open} onClose={onClose} onClosed={onClosed} title="New session" snap
      left={<button className="btn btn-link text-decoration-none px-1" onClick={onClose}>Cancel</button>}
      right={<button className="btn btn-primary btn-sm" id="ns-start" disabled={!!busy} onClick={start}>{busy ? <><Spinner />{busy}</> : "Start"}</button>}>
      <Lbl>Environment</Lbl>
      <div className="list-group">{envs.length ? envs.map((n) => <Row key={n} type="radio" name="ns-env" value={n} checked={env === n} onChange={() => setEnv(n)} t={n} sub={`${(st.environments[n].keys || []).length} keys`} />) : <div className="text-body-secondary small">No environments yet — add one in the Environments tab.</div>}</div>
      <Lbl>Repos</Lbl>
      <div className="list-group">{repos.length ? repos.map((r) => <Row key={r.name} type="checkbox" name="ns-repo" value={r.name} checked={picked.has(r.name)} onChange={(c) => setPicked((p) => { const n = new Set(p); c ? n.add(r.name) : n.delete(r.name); return n; })} t={r.name} sub={r.url} />) : <div className="text-body-secondary small">No repos yet — add some in the Repos tab.</div>}</div>
      <Lbl>Permission mode</Lbl>
      <div className="list-group">
        <Row type="radio" name="ns-perm" value="auto" checked={perm === "auto"} onChange={() => setPerm("auto")} t="Auto" sub="Auto-approve safe actions; the permission classifier gates the rest." />
        <Row type="radio" name="ns-perm" value="bypass" checked={perm === "bypass"} onChange={() => setPerm("bypass")} t="Dangerously skip permissions" sub="No prompts at all (--dangerously-skip-permissions)." />
      </div>
      <Lbl>Model</Lbl>
      <div className="list-group">{Object.entries(MODELS.models || {}).map(([k, v]) => <Row key={k} type="radio" name="ns-model" value={k} checked={model === k} onChange={() => setModel(k)} t={v.label || k} sub={k} />)}</div>
      <Lbl>Machine size</Lbl>
      <div className="list-group">{Object.entries(SIZES.sizes || {}).map(([k, v]) => <Row key={k} type="radio" name="ns-size" value={k} checked={size === k} onChange={() => setSize(k)} t={k[0].toUpperCase() + k.slice(1)} sub={v.label} />)}</div>
      <Lbl>Idle</Lbl>
      <div className="list-group"><Row type="checkbox" name="ns-autopause" value="on" checked={autoPause} onChange={setAutoPause} t="Auto-pause when idle" sub="Stops the machine after ~1h with nothing running to save compute. Wake it with Start — files and the conversation are kept." /></div>
      <Lbl>Session title (optional)</Lbl>
      <input id="ns-title" className="form-control" type="text" name="session-topic" autoComplete="off" autoCorrect="off" autoCapitalize="sentences" spellCheck={false} placeholder="e.g. refactor billing module" value={label} onChange={(e) => setLabel(e.target.value)} />
      <div className="form-text">Shows as the session title in the Claude app too. Leave blank and the Claude session names itself.</div>
      <Lbl>First prompt (optional)</Lbl>
      <textarea id="ns-prompt" className="form-control" rows={4} name="session-first-prompt" autoComplete="off" autoCapitalize="sentences" spellCheck placeholder="Typed into the session as its first message once Claude is up — leave blank to start it yourself from the app." value={prompt} onChange={(e) => setPrompt(e.target.value)} />
    </Sheet>
  );
}
