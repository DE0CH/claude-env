import { useState } from "react";
import { Button, Card, Flex, Heading, Text } from "@radix-ui/themes";
import { api, ago, REGION, sessionTitle, type Session } from "../api";
import { useStore, pendUntil, pend, refresh, settle, setTab, ask, toast } from "../store";
import { PButton, Pill, Spinner, Muted, useCoolAfterShift } from "../ui";
import { ActionSheet } from "../Sheet";

function SessionPill({ m }: { m: Session }) {
  // Real state only. Fly state first; then whether claude inside has actually come up.
  if (m.state === "destroying" || m.state === "destroyed") return <Pill kind="bad"><Spinner size="1" />{m.state}</Pill>;
  if (m.state === "created" || m.state === "starting") return <Pill kind="wait"><Spinner size="1" />creating…</Pill>;
  if (m.state === "stopped" || m.state === "suspended") return <Pill kind="dim">paused</Pill>;
  if (m.state === "started") {
    if (!m.status) return <Pill kind="wait"><Spinner size="1" />booting…</Pill>;
    if (m.status === "busy") return <Pill kind="wait">working</Pill>;
    if (m.status === "waiting") return <Pill kind="bad">needs you</Pill>;
    return m.bgTasks ? <Pill kind="wait">idle · {m.bgTasks} background</Pill> : <Pill kind="ok">idle</Pill>;
  }
  return <Pill kind="dim">{m.state}</Pill>;
}

const isPaused = (m: Session) => m.state === "stopped" || m.state === "suspended";
const find = (s: any, id: string): Session | undefined => (s.sessions || []).find((x: Session) => x.id === id);

// ---- actions (never optimistic: the pending label stays until the server confirms) ----
export function pauseSession(id: string) {
  return pendUntil("s:" + id, "Pausing…", () => api("POST", "api/sessions/" + id + "/stop"), (s) => { const m = find(s, id); return !!m && isPaused(m); }, 60000);
}
export function wakeSession(id: string) {
  return pendUntil("s:" + id, "Starting…", () => api("POST", "api/sessions/" + id + "/start"), (s) => { const m = find(s, id); return !!m && m.state === "started"; }, 60000)
    .then(() => settle((s) => { const m = find(s, id); return !!(m && m.state === "started" && m.status); }));
}
export function toggleAutoPause(id: string, enabled: boolean) {
  return pendUntil("s:" + id, enabled ? "Enabling auto-pause…" : "Disabling auto-pause…", () => api("POST", "api/sessions/" + id + "/autopause", { enabled }),
    (s) => { const m: any = find(s, id); return !!m && (m.autoPause === "off") === !enabled; });
}
// Switch permission mode: "bypass" = --dangerously-skip-permissions, "auto" = classifier approval.
// The machine restarts on the same conversation (snapshot + resume), so this interrupts any work
// in progress; confirm first. Stays pending until Fly reports the new mode and the session is up.
export async function switchPermissionMode(id: string, mode: "auto" | "bypass") {
  const toBypass = mode === "bypass";
  const msg = toBypass
    ? "Switch this session to Bypass Permissions mode?\n\nThe machine RESTARTS (the conversation and files are snapshotted and resumed — nothing is lost). Claude then runs every tool WITHOUT asking — no permission prompts, no classifier. Any work in progress is interrupted by the restart."
    : "Switch this session back to approval mode?\n\nThe machine RESTARTS (conversation and files are resumed). Claude runs under the permission classifier again.";
  if (!confirm(msg)) return;
  return pendUntil("s:" + id, toBypass ? "Switching to skip-perms…" : "Switching to approval…",
    () => api("POST", "api/sessions/" + id + "/permission-mode", { mode }),
    (s) => { const m: any = find(s, id); return !!m && m.permissionMode === mode && m.state === "started"; }, 120000)
    .then(() => settle((s) => { const m: any = find(s, id); return !!(m && m.state === "started" && m.status); }));
}
// Session says "Login expired · Please run /login" (another session rotated the shared refresh
// token): write the portal's current pair into the session and type "continue" so it resumes.
export async function reloginSession(id: string) {
  pend("s:" + id, "Refreshing login…");
  try { const r = await api("POST", "api/sessions/" + id + "/relogin", { text: "continue" }); toast("Fresh credentials written into the session" + (r.prompted ? " and “" + r.text + "” sent" : "") + ". Valid until " + new Date(r.expiresAt).toLocaleString() + ".", "ok"); }
  catch (e: any) { toast("Refresh login failed: " + e.message, "error"); if (/Re-login/.test(e.message)) setTab("settings"); }
  pend("s:" + id, null); await refresh(false);
}
export async function destroySession(id: string) {
  pend("s:" + id, "Checking…");
  let msg = "";
  try {
    const c = await api("GET", `api/sessions/${id}/changes`);
    if (c.checked) {
      const dirty = (c.repos || []).filter((r: any) => r.uncommitted > 0 || r.unpushed > 0 || r.unpushed === -1);
      if (c.status === "busy") msg += "⚠️ Claude is still WORKING in this session.\n\n";
      if (dirty.length) {
        msg += "⚠️ Unsaved work will be LOST:\n" + dirty.map((r: any) => "• " + r.name + ": "
          + (r.uncommitted > 0 ? r.uncommitted + " uncommitted file(s)" : "")
          + (r.uncommitted > 0 && (r.unpushed > 0 || r.unpushed === -1) ? ", " : "")
          + (r.unpushed > 0 ? r.unpushed + " unpushed commit(s)" : r.unpushed === -1 ? "branch has no upstream (nothing pushed)" : "")).join("\n") + "\n";
      } else if (c.status !== "busy") msg += "✓ No uncommitted or unpushed changes found.\n";
    } else msg += "⚠️ Could not check for unsaved changes (" + (c.reason || "unknown") + ").\n";
  } catch { msg += "⚠️ Could not check for unsaved changes.\n"; }
  msg += "\nTranscripts and ~/artifacts are archived to the Storage Box first; then the container is deleted. Your repos on GitHub are not affected.";
  pend("s:" + id, null);
  if (!(await ask({ title: "Destroy this session?", detail: msg, action: "Destroy session", danger: true }))) return;
  pend("s:" + id, "Archiving…");
  try {
    let r;
    try { r = await api("DELETE", "api/sessions/" + id); }
    catch (e: any) {
      if (!/archive/i.test(e.message)) throw e;
      if (!(await ask({ title: "Archiving to the Storage Box failed", detail: e.message + "\n\nDestroy anyway? The records will be lost.", action: "Destroy anyway", danger: true }))) { pend("s:" + id, null); return; }
      pend("s:" + id, "Destroying…"); r = await api("DELETE", "api/sessions/" + id + "?force=1");
    }
    if (r && r.archived && r.archived.dir) console.log("archived", r.archived.files, "file(s) to", r.archived.dir);
  } catch (e: any) { toast(e.message, "error"); }
  pend("s:" + id, null);
  await refresh(false);                                   // card shows destroying/destroyed until Fly drops it
  settle((st) => !(st.sessions || []).some((x) => x.id === id), 60000);
}

export function Sessions({ onTerminal }: { onTerminal: (id: string, title: string) => void }) {
  const sessions = useStore((s) => s.state.sessions) || [];
  const models = useStore((s) => s.models);
  const pending = useStore((s) => s.pending);
  const [menu, setMenu] = useState<{ id: string; open: boolean } | null>(null);
  // stable order (newest first) so cards never swap between polls
  const list = [...sessions].sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")) || String(a.id).localeCompare(String(b.id)));
  const cool = useCoolAfterShift(list.map((m) => m.id).join("|"));
  if (!list.length) return <Text as="div" align="center" color="gray" my="8">No sessions running.<br />Tap “New session”.</Text>;
  const menuFor = menu ? list.find((m) => m.id === menu.id) : undefined;
  return (
    <>
      {list.map((m: any) => {
        const title = sessionTitle(m);
        const busy = pending.get("s:" + m.id);
        const repos = m.repos ? m.repos.split(" ").map((u: string) => u.split("/").pop()!.replace(/\.git$/, "")).join(", ") : "";
        const modelName = m.model ? ((models.models[m.model] || {}).label || m.model) : "";
        const paused = isPaused(m);
        // auto-pause status line: off / counting down / generic; paused sessions explain Start
        const apInfo = paused ? "Paused — Start resumes the same conversation."
          : m.state === "started" ? (m.autoPause === "off" ? "Auto-pause off — stays running while idle."
            : (m.pauseInMs != null ? `Pauses in ~${Math.max(1, Math.round(m.pauseInMs / 60000))} min if still idle.` : "Auto-pauses after ~1h idle.")) : "";
        return (
          <Card size="2" mb="3" className="scard" key={m.id} style={{ opacity: busy ? .75 : 1 }}>
            <Flex justify="between" align="start" gap="2" mb="1"><Heading size="3" style={{ wordBreak: "break-word" }}>{title}</Heading><SessionPill m={m} /></Flex>
            <Muted>{m.environment ? "env: " + m.environment : ""}{repos ? " · " + repos : ""}{m.permissionMode === "bypass" ? <> · <Pill kind="bad">skip perms</Pill></> : (m.permissionMode ? " · auto" : "")}</Muted>
            <Muted>{REGION[m.region] || m.region || ""}{m.guest ? " · " + m.guest : ""}{modelName ? " · " + modelName : ""}{m.created ? " · created " + ago(m.created) : ""}</Muted>
            {apInfo && <Muted mt="1">{apInfo}</Muted>}
            <Flex gap="2" mt="3" className="actions">
              {m.state === "started" && <Button onClick={() => onTerminal(m.id, title)}>Terminal</Button>}
              {paused && <PButton pkey={"s:" + m.id} color="green" onClick={() => wakeSession(m.id)} label="Start" />}
              {busy ? (m.state === "started" ? <Button variant="soft" color="gray" disabled><Spinner size="1" />{busy}</Button> : null)
                : <Button variant="soft" color="gray" className={cool ? "cool" : undefined} disabled={cool} aria-label="More actions" onClick={() => setMenu({ id: m.id, open: true })}>More ▾</Button>}
            </Flex>
          </Card>
        );
      })}
      <ActionSheet open={!!menu?.open} onClose={() => setMenu((m) => (m ? { ...m, open: false } : m))} onClosed={() => setMenu(null)}
        title={menuFor ? sessionTitle(menuFor) : ""}
        items={menuFor ? menuItems(menuFor) : []} />
    </>
  );
}
function menuItems(m: any) {
  const items = [] as { label: string; sub?: string; danger?: boolean; onClick: () => void }[];
  if (m.state === "started") {
    items.push({ label: "Refresh login", sub: "Write fresh Claude credentials into the session and send “continue”", onClick: () => reloginSession(m.id) });
    items.push(m.autoPause === "off"
      ? { label: "Turn auto-pause on", sub: "Pause automatically after ~1h idle", onClick: () => toggleAutoPause(m.id, true) }
      : { label: "Turn auto-pause off", sub: "Keep the machine running while idle", onClick: () => toggleAutoPause(m.id, false) });
    items.push({ label: "Pause", sub: "Stop the machine now; the conversation and files are kept", onClick: () => pauseSession(m.id) });
  }
  if (m.state === "started" || isPaused(m)) {
    items.push(m.permissionMode === "bypass"
      ? { label: "Switch to approval mode", sub: "Restart on the same conversation under the permission classifier", onClick: () => switchPermissionMode(m.id, "auto") }
      : { label: "Switch to skip-permissions", sub: "Restart on the same conversation with --dangerously-skip-permissions", danger: true, onClick: () => switchPermissionMode(m.id, "bypass") });
  }
  if (isPaused(m)) items.push({ label: "Start", sub: "Resume the same conversation", onClick: () => wakeSession(m.id) });
  items.push({ label: "Destroy", sub: "Archive transcripts + ~/artifacts, then delete the machine", danger: true, onClick: () => destroySession(m.id) });
  return items;
}
