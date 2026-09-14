import { useEffect, useState } from "react";
import { Button, Callout, Flex, Heading, IconButton, Tabs } from "@radix-ui/themes";
import { api } from "./api";
import { useStore, setTab, refresh, pend, toast, type Tab } from "./store";
import { THEME, Theme, PortalCtx } from "./theme";
import { Sessions } from "./views/Sessions";
import { Android } from "./views/Android";
import { Envs } from "./views/Envs";
import { Repos } from "./views/Repos";
import { Settings } from "./views/Settings";
import { NewSession } from "./sheets/NewSession";
import { EnvEditor } from "./sheets/EnvEditor";
import { Relogin } from "./sheets/Relogin";
import { TerminalPage } from "./Terminal";
import { Toasts, ConfirmSheet } from "./ui";
import { syncStatusBar } from "./statusBar";

type SheetSpec = { kind: "new" } | { kind: "env"; name: string } | { kind: "relogin"; url: string } | { kind: "term"; id: string; title: string };
const TABS: [Tab, string][] = [["sessions", "Sessions"], ["android", "Android"], ["envs", "Envs"], ["repos", "Repos"], ["settings", "Settings"]];

function Banners() {
  const st = useStore((s) => s.state);
  const B = ({ color, children }: { color: "red" | "amber"; children: React.ReactNode }) => <Callout.Root color={color} size="1" mb="3"><Callout.Text>{children}</Callout.Text></Callout.Root>;
  return (
    <div id="banners">
      {st.hasCreds === false ? <B color="red">No Claude credentials — sessions can't authenticate. Re-login from Settings.</B>
        : (st.creds || {}).stale ? <B color="red">Claude login expired and the token refresh was rejected — new sessions can't sign in. Re-login from Settings.</B> : null}
      {!st.sessionImage && <B color="amber">No session image pinned yet — run the session-image workflow on GitHub (see Settings).</B>}
      {st.flyError && <B color="red">Fly: {st.flyError}</B>}
    </div>
  );
}

export function App() {
  const tab = useStore((s) => s.tab);
  const refreshing = useStore((s) => s.refreshing);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useEffect(() => { if (root) syncStatusBar(); }, [root]);
  // one sheet at a time; `open` flips false first so the sheet plays its exit animation, then
  // onClosed unmounts it
  const [sheet, setSheet] = useState<SheetSpec | null>(null);
  const [open, setOpen] = useState(false);
  const show = (s: SheetSpec) => { setSheet(s); setOpen(true); };
  const close = () => setOpen(false);
  const closed = () => setSheet(null);
  async function relogin() {
    pend("auth", "Starting…");
    try { const { url } = await api("POST", "api/auth/start"); pend("auth", null); show({ kind: "relogin", url }); }
    catch (e: any) { pend("auth", null); toast("Could not start login: " + e.message, "error"); }
  }
  return (
    <Theme {...THEME} ref={setRoot}>
      <PortalCtx.Provider value={root}>
        <div className="topbar">
          <Flex className="wrap" align="center" justify="between" py="4" gap="3">
            <Heading size="4" truncate style={{ minWidth: 0 }}>Claude sessions</Heading>
            <Flex gap="2">
              <IconButton variant="soft" color="gray" id="refreshBtn" onClick={() => refresh(true)} aria-label="Refresh" loading={refreshing}>↻</IconButton>
              {tab === "sessions" && <Button id="newBtn" onClick={() => show({ kind: "new" })}>+ New session</Button>}
            </Flex>
          </Flex>
        </div>
        <div className="wrap main" style={{ paddingTop: 16 }}>
          <Banners />
          <Tabs.Root value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <Tabs.List size="2" mb="3" className="tablist">{TABS.map(([k, l]) => <Tabs.Trigger key={k} value={k} data-tab={k}>{l}</Tabs.Trigger>)}</Tabs.List>
          </Tabs.Root>
          <div id={"view-" + tab}>
            {tab === "sessions" && <Sessions onTerminal={(id, title) => show({ kind: "term", id, title })} />}
            {tab === "android" && <Android />}
            {tab === "envs" && <Envs onEdit={(name) => show({ kind: "env", name })} />}
            {tab === "repos" && <Repos />}
            {tab === "settings" && <Settings onRelogin={relogin} />}
          </div>
        </div>
        {sheet?.kind === "new" && <NewSession open={open} onClose={close} onClosed={closed} />}
        {sheet?.kind === "env" && <EnvEditor name={sheet.name} open={open} onClose={close} onClosed={closed} />}
        {sheet?.kind === "relogin" && <Relogin url={sheet.url} open={open} onClose={close} onClosed={closed} />}
        {sheet?.kind === "term" && <TerminalPage session={sheet} onClose={closed} />}
        <ConfirmSheet />
        <Toasts />
      </PortalCtx.Provider>
    </Theme>
  );
}
