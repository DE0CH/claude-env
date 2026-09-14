import { useState } from "react";
import { Button, CheckboxCards, RadioCards, Text, TextArea, TextField } from "@radix-ui/themes";
import { api } from "../api";
import { useStore, refresh, settle, setTab } from "../store";
import { Sheet } from "../Sheet";
import { Lbl, Muted, Spinner, useBusy } from "../ui";

export function NewSession({ open, onClose, onClosed }: { open: boolean; onClose: () => void; onClosed: () => void }) {
  const st = useStore((s) => s.state), SIZES = useStore((s) => s.sizes), MODELS = useStore((s) => s.models);
  const envs = Object.keys(st.environments || {}), repos = st.repos || [];
  const [env, setEnv] = useState(envs[0] || "");
  const [picked, setPicked] = useState<string[]>(() => repos.filter((r) => r.name === "claude-env" || repos.length === 1).map((r) => r.name));
  const [perm, setPerm] = useState("auto"), [model, setModel] = useState(MODELS.default), [size, setSize] = useState(SIZES.default), [autoPause, setAutoPause] = useState<string[]>(["on"]);
  const [label, setLabel] = useState(""), [prompt, setPrompt] = useState("");
  const [busy, run] = useBusy();
  async function start() {
    await run("Starting…", async () => {
      try {
        const r = await api("POST", "api/sessions", { environment: env, repos: picked, label: label.trim(), permissionMode: perm, size, model, prompt: prompt.trim(), autoPause: autoPause.includes("on") });
        onClose();
        await refresh(false);                                 // card appears in its REAL state (creating…)
        settle((s) => { const m = (s.sessions || []).find((x) => x.id === r.id); return !!(m && m.state === "started" && m.status); }); // fast-poll until claude is actually up
      } catch (e: any) { alert("Start failed: " + e.message); if (/Re-login/.test(e.message)) { onClose(); setTab("settings"); } }
    });
  }
  const Item = ({ t, sub }: { t: React.ReactNode; sub?: React.ReactNode }) => <div style={{ minWidth: 0, width: "100%", textAlign: "left" }}><Text as="div" size="2" weight="medium" style={{ wordBreak: "break-word" }}>{t}</Text>{sub && <Text as="div" size="1" color="gray" style={{ wordBreak: "break-all" }}>{sub}</Text>}</div>;
  return (
    <Sheet open={open} onClose={onClose} onClosed={onClosed} title="New session" snap
      left={<Button variant="ghost" onClick={onClose}>Cancel</Button>}
      right={<Button id="ns-start" disabled={!!busy} onClick={start}>{busy ? <><Spinner size="1" />{busy}</> : "Start"}</Button>}>
      <Lbl>Environment</Lbl>
      {envs.length ? <RadioCards.Root id="ns-env" columns="1" gap="2" size="1" value={env} onValueChange={setEnv}>{envs.map((n) => <RadioCards.Item key={n} value={n}><Item t={n} sub={`${(st.environments[n].keys || []).length} keys`} /></RadioCards.Item>)}</RadioCards.Root> : <Muted>No environments yet — add one in the Environments tab.</Muted>}
      <Lbl>Repos</Lbl>
      {repos.length ? <CheckboxCards.Root id="ns-repo" columns="1" gap="2" size="1" value={picked} onValueChange={setPicked}>{repos.map((r) => <CheckboxCards.Item key={r.name} value={r.name}><Item t={r.name} sub={r.url} /></CheckboxCards.Item>)}</CheckboxCards.Root> : <Muted>No repos yet — add some in the Repos tab.</Muted>}
      <Lbl>Permission mode</Lbl>
      <RadioCards.Root id="ns-perm" columns="1" gap="2" size="1" value={perm} onValueChange={setPerm}>
        <RadioCards.Item value="auto"><Item t="Auto" sub="Auto-approve safe actions; the permission classifier gates the rest." /></RadioCards.Item>
        <RadioCards.Item value="bypass"><Item t="Dangerously skip permissions" sub="No prompts at all (--dangerously-skip-permissions)." /></RadioCards.Item>
      </RadioCards.Root>
      <Lbl>Model</Lbl>
      <RadioCards.Root id="ns-model" columns="1" gap="2" size="1" value={model} onValueChange={setModel}>{Object.entries(MODELS.models || {}).map(([k, v]) => <RadioCards.Item key={k} value={k}><Item t={v.label || k} sub={k} /></RadioCards.Item>)}</RadioCards.Root>
      <Lbl>Machine size</Lbl>
      <RadioCards.Root id="ns-size" columns="1" gap="2" size="1" value={size} onValueChange={setSize}>{Object.entries(SIZES.sizes || {}).map(([k, v]) => <RadioCards.Item key={k} value={k}><Item t={k[0].toUpperCase() + k.slice(1)} sub={v.label} /></RadioCards.Item>)}</RadioCards.Root>
      <Lbl>Idle</Lbl>
      <CheckboxCards.Root id="ns-autopause" columns="1" gap="2" size="1" value={autoPause} onValueChange={setAutoPause}><CheckboxCards.Item value="on"><Item t="Auto-pause when idle" sub="Stops the machine after ~1h with nothing running to save compute. Wake it with Start — the conversation is kept (commit your files first; the workspace is not)." /></CheckboxCards.Item></CheckboxCards.Root>
      <Lbl>Session title (optional)</Lbl>
      <TextField.Root id="ns-title" type="text" name="session-topic" autoComplete="off" autoCorrect="off" autoCapitalize="sentences" spellCheck={false} placeholder="e.g. refactor billing module" value={label} onChange={(e) => setLabel(e.target.value)} />
      <Muted mt="1">Shows as the session title in the Claude app too. Leave blank and the Claude session names itself.</Muted>
      <Lbl>First prompt (optional)</Lbl>
      <TextArea id="ns-prompt" rows={4} name="session-first-prompt" autoComplete="off" autoCapitalize="sentences" spellCheck placeholder="Typed into the session as its first message once Claude is up — leave blank to start it yourself from the app." value={prompt} onChange={(e) => setPrompt(e.target.value)} />
    </Sheet>
  );
}
