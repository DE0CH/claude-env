// Bottom sheets on react-modal-sheet (Framer Motion): iOS-style detents with the scroll/drag
// hand-off done by the library — opens half, flick up on the handle OR the content expands to
// full, at full the content scrolls, a drag down from scrollTop 0 brings it back to half, then
// dismisses. Keyboard avoidance (avoidKeyboard) is built in. Chrome is Radix Themes.
import type { ReactNode } from "react";
import { Sheet as RMS } from "react-modal-sheet";
import { Button, Heading, Text, Flex, Box, Separator } from "@radix-ui/themes";
import { usePortalContainer } from "./theme";

// snap points: 0 = closed, 0.62 = half (initial), 1 = full  → indices 0 / 1 / 2
const SNAPS = [0, 0.62, 1], HALF = 1, FULL = 2;
const box = { backgroundColor: "var(--color-panel-solid)", color: "var(--gray-12)", boxShadow: "none", borderTopLeftRadius: "var(--radius-6)", borderTopRightRadius: "var(--radius-6)", border: "1px solid var(--gray-a6)", borderBottom: "none", maxWidth: 600, margin: "0 auto", left: 0, right: 0 } as const;

export function Sheet({ open, onClose, title, left, right, snap, children, onClosed, className }: {
  open: boolean; onClose: () => void; title?: string; left?: ReactNode; right?: ReactNode; snap?: boolean; children: ReactNode; onClosed?: () => void; className?: string;
}) {
  const mount = usePortalContainer();
  return (
    <RMS isOpen={open} onClose={onClose} onCloseEnd={onClosed} mountPoint={mount}
      {...(snap ? { snapPoints: SNAPS, initialSnap: HALF } : { detent: "content" as const })}>
      <RMS.Container className={`sheet${snap ? " snap" : ""}${className ? " " + className : ""}`} style={box}>
        <RMS.Header>
          <div className="handle-wrap"><RMS.DragIndicator className="handle" /></div>
          {title !== undefined && (
            <div className="head">
              <div className="side">{left}</div>
              <Heading as="h2" size="3" className="ttl">{title}</Heading>
              <div className="side r">{right}</div>
            </div>
          )}
        </RMS.Header>
        <RMS.Content className="body"
          disableScroll={snap ? (s) => s.currentSnap !== FULL : false}
          disableDrag={snap ? (s) => s.currentSnap === FULL && s.scrollPosition !== "top" : (s) => s.scrollPosition !== "top" && s.scrollPosition !== undefined}>
          <div className="body-in">{children}</div>
        </RMS.Content>
      </RMS.Container>
      <RMS.Backdrop onTap={onClose} style={{ backgroundColor: "var(--color-overlay)" }} />
    </RMS>
  );
}

// Action sheet: a list of actions + Cancel.
export type MenuItem = { label: string; sub?: string; danger?: boolean; disabled?: boolean; onClick: () => void };
export function ActionSheet({ open, onClose, onClosed, title, items }: { open: boolean; onClose: () => void; onClosed?: () => void; title?: string; items: MenuItem[] }) {
  return (
    <Sheet open={open} onClose={onClose} onClosed={onClosed} className="menu-sheet">
      <Box className="menu" pb="2">
        {title && <Text as="div" size="1" color="gray" align="center" mb="2" truncate>{title}</Text>}
        <Flex direction="column" mb="3" className="mlist">
          {items.map((it, i) => (
            <Box key={i}>
              {i > 0 && <Separator size="4" />}
              <button type="button" className="mi" disabled={it.disabled} onClick={() => { onClose(); it.onClick(); }}>
                <Text as="div" size="3" weight="medium" color={it.danger ? "red" : undefined}>{it.label}</Text>
                {it.sub && <Text as="div" size="1" color="gray">{it.sub}</Text>}
              </button>
            </Box>
          ))}
        </Flex>
        <Button size="3" variant="soft" color="gray" className="cancel" style={{ width: "100%" }} onClick={onClose}>Cancel</Button>
      </Box>
    </Sheet>
  );
}
