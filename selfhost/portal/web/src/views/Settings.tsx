import { Button, Card, Code, Flex, Heading, Text } from "@radix-ui/themes";
import { api, fromNow } from "../api";
import { useStore, pend, refresh, toast } from "../store";
import { PButton, Muted } from "../ui";

export function Settings({ onRelogin }: { onRelogin: () => void }) {
  const st = useStore((s) => s.state);
  const c = st.creds || {};
  const exp = c.expiresAt ? new Date(c.expiresAt) : null;
  async function refreshCreds() {
    pend("credrefresh", "Refreshing…");
    try { const r = await api("POST", "api/credentials/refresh"); toast(r.refreshed ? "Token refreshed. Valid until " + new Date(r.expiresAt).toLocaleString() + "." : "Token was still fresh (valid until " + new Date(r.expiresAt).toLocaleString() + ").", "ok"); }
    catch (e: any) { toast(e.message, "error"); }
    pend("credrefresh", null); await refresh(false);
  }
  return (
    <>
      <Card size="2" mb="3" className="scard"><Heading size="3" mb="1">Claude account</Heading>
        <Muted>{st.hasCreds ? <>Signed in{c.subscriptionType ? " · " + c.subscriptionType : ""}{exp ? " · access token " + (exp > new Date() ? "expires " : "expired ") + fromNow(exp) : ""}</> : "Not signed in"}</Muted>
        {c.stale && <Text as="div" size="2" color="red">Token refresh rejected: {c.error || ""}</Text>}
        <Muted mt="2">Runs the real <Code>claude auth login</Code> on the controller (in the auth-broker pod, which portal rollouts never restart): you open the link, sign in, and paste the code back here.{(st.auth || {}).unavailable && <> <Text color="red" weight="bold">Auth broker unreachable</Text> — check the auth-broker pod.</>} New sessions use the stored credentials; the portal refreshes them before each start and running sessions push their refreshed copy back.</Muted>
        <Flex gap="2" mt="3"><PButton pkey="auth" onClick={onRelogin} label="Re-login" />{st.hasCreds && <PButton pkey="credrefresh" variant="soft" color="gray" onClick={refreshCreds} label="Refresh token" />}</Flex>
      </Card>
      <Card size="2" mb="3" className="scard"><Heading size="3" mb="1">Session image</Heading>
        <Muted>{st.sessionImage || "none pinned yet"}</Muted>
        <Muted mt="2">Built by GitHub Actions (<Code>session-image</Code> workflow) on every push that touches <Code>selfhost/session-image/</Code>, pushed to the public package <Code>ghcr.io/de0ch/claude-sessions</Code> and pinned into <Code>selfhost/k8s/config/portal-config.yaml</Code>; Flux applies the ref within a minute and the next session boots from it. To rebuild without a code change, re-run the workflow on GitHub. Nothing builds inside the portal, so rollouts can't lose a build.</Muted>
        <Flex mt="3"><Button asChild variant="soft" color="gray"><a href="https://github.com/DE0CH/claude-env/actions/workflows/session-image.yml" target="_blank" rel="noopener">Workflow runs ↗</a></Button></Flex>
      </Card>
      <Card size="2" mb="3" className="scard"><Heading size="3" mb="1">Controller</Heading>
        <Muted>portal v{st.version || "?"} · Fly app {st.flyApp || ""}</Muted>
        <Muted mt="2">Everything here is reconciled by Flux from the claude-env repo (selfhost/k8s). Edits made in this dashboard are committed back to git (secrets encrypted with sops) and applied immediately.</Muted>
      </Card>
    </>
  );
}
