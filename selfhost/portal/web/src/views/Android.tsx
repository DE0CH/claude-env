// Android (redroid box): a Hetzner VM managed via HETZNER_API. The only action is Release
// (delete): Hetzner bills a powered-off server exactly like a running one, so a Stop button
// would save nothing. Debug is READ-ONLY: a live screenshot + health pulled over SSH on demand.
import { useState } from "react";
import { Card, Code, Flex, Heading, Text } from "@radix-ui/themes";
import { api, ago } from "../api";
import { useStore, pend, settle, loadAndroid, setAndroid, ask, toast } from "../store";
import { PButton, Pill, Spinner, Muted } from "../ui";

function RdPill({ st }: { st: string }) {
  if (st === "running") return <Pill kind="ok">running</Pill>;
  if (st === "off") return <Pill kind="dim">off</Pill>;
  if (st === "starting" || st === "stopping" || st === "initializing") return <Pill kind="wait"><Spinner size="1" />{st}</Pill>;
  return <Pill kind="dim">{st || "unknown"}</Pill>;
}
export function Android() {
  const a = useStore((s) => s.android);
  const [health, setHealth] = useState<any>(null);
  const [note, setNote] = useState<string>("Tap “Load” for a live screenshot and health.");
  const s = a.server;
  if (!s) return <Text as="div" align="center" color="gray" my="8">{a.loading ? <><Spinner size="1" /> Loading…</> : a.err ? `Cloud Android: ${a.err}` : <>No redroid box found.<br />Provision one with <Code>redroid/provision.sh</Code>.</>}</Text>;
  async function release() {
    if (!(await ask({ title: "Release the cloud-Android box?", detail: "This permanently deletes the VM and everything on it — apps, logins, data. It stops the monthly cost. Rebuild later with redroid/provision.sh. This cannot be undone.", action: "Delete the box", danger: true }))) return;
    pend("rd:release", "Releasing…");
    try { await api("DELETE", "api/redroid"); setAndroid({ server: null, screenTs: 0 }); } catch (e: any) { toast(e.message, "error"); }
    pend("rd:release", null); settle(() => !a.server, 30000); await loadAndroid();
  }
  async function debug() {
    pend("rd:debug", "Loading…");
    try { const d = await api("GET", "api/redroid/debug"); setHealth(d.health); setNote(d.health ? "" : (d.note || "no data")); setAndroid({ screenTs: Date.now() }); }
    catch (e: any) { setNote(e.message); }
    pend("rd:debug", null);
  }
  const h = health || {};
  const rows: [string, any][] = [["Boot completed", h.boot === "1" ? "yes" : h.boot], ["Model", h.model], ["Android", h.android], ["redroid", h.redroid === "true" ? "up" : h.redroid], ["Exit IP", h.exitip], ["Proxy", h.proxy], ["Load", h.load], ["Memory", h.mem], ["Disk", h.disk], ["Uptime", h.up]];
  return (
    <>
      <Card size="2" mb="3" className="scard">
        <Flex justify="between" align="start" gap="2" mb="1"><Heading size="3">Cloud Android</Heading><RdPill st={s.status} /></Flex>
        <Muted>{s.type || ""}{s.cores ? ` · ${s.cores} vCPU` : ""}{s.memoryGb ? ` · ${s.memoryGb} GB` : ""}{s.datacenter ? ` · ${s.datacenter}` : ""}<br />{s.ip || "(no IP)"}{s.created ? ` · created ${ago(s.created)}` : ""}</Muted>
        <Flex mt="3"><PButton pkey="rd:release" color="red" variant="soft" onClick={release} label="Release" /></Flex>
      </Card>
      {s.status === "running" && (
        <Card size="2" mb="3" className="scard">
          <Flex justify="between" align="start" gap="2" mb="1"><Heading size="3">Debug — view only</Heading><PButton pkey="rd:debug" variant="soft" color="gray" onClick={debug} label={a.screenTs ? "Refresh" : "Load"} /></Flex>
          <Muted>{health ? rows.filter((r) => r[1]).map((r) => <div key={r[0]}><b>{r[0]}:</b> {r[1]}</div>) : note}</Muted>
          {a.screenTs > 0 && <img alt="" src={"api/redroid/screen.png?t=" + a.screenTs} style={{ display: "block", width: "100%", maxWidth: 360, marginTop: 12, border: "1px solid var(--gray-a6)", borderRadius: "var(--radius-4)" }} />}
        </Card>
      )}
    </>
  );
}
