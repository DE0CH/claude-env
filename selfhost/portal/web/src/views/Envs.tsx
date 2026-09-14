import { Button, Card, Flex, Heading, Text } from "@radix-ui/themes";
import { api } from "../api";
import { useStore, pend, refresh, ask, toast } from "../store";
import { PButton, Muted, useCoolAfterShift } from "../ui";

export function Envs({ onEdit }: { onEdit: (name: string) => void }) {
  const envs = useStore((s) => s.state.environments) || {};
  const pending = useStore((s) => s.pending);
  const names = Object.keys(envs).sort();
  const cool = useCoolAfterShift(names.join("|"));
  async function del(n: string) {
    if (!(await ask({ title: `Delete environment "${n}"?`, detail: "Its saved secret values are removed from the cluster and from git — nothing outside is affected.", action: "Delete environment", danger: true }))) return;
    pend("env:" + n, "Deleting…");
    try { await api("DELETE", "api/environments/" + encodeURIComponent(n)); } catch (e: any) { toast(e.message, "error"); }
    pend("env:" + n, null); await refresh(false);
  }
  return (
    <>
      {names.map((n) => { const d = envs[n]; return (
        <Card size="2" mb="3" className="scard" key={n} style={{ opacity: pending.has("env:" + n) ? .75 : 1 }}>
          <Flex justify="between" align="start" gap="2" mb="1"><Heading size="3">{n}</Heading><Text size="1" color="gray">{(d.keys || []).length} keys</Text></Flex>
          <Muted>{(d.keys || []).join(", ") || "—"}</Muted>
          <Flex gap="2" mt="3"><Button variant="soft" color="gray" onClick={() => onEdit(n)}>Edit secrets</Button><PButton pkey={"env:" + n} color="red" variant="soft" onClick={() => del(n)} label="Delete" cool={cool} /></Flex>
        </Card>); })}
      <Button onClick={() => onEdit("")}>+ Add environment</Button>
    </>
  );
}
