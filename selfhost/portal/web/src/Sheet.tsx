// Bottom sheets on vaul (the drawer behind shadcn/ui): the library owns the gestures — drag the
// handle/sheet down to dismiss, drag up to the next snap point (full screen), keyboard-aware
// input repositioning on iOS. We only add chrome: a handle, a header with the actions
// (Cancel · title · primary), and a scrolling body — styled with Bootstrap.
import { useState, type ReactNode } from "react";
import { Drawer } from "vaul";

export function Sheet({ open, onClose, title, left, right, snap, children, onClosed, className }: {
  open: boolean; onClose: () => void; title?: string; left?: ReactNode; right?: ReactNode; snap?: boolean; children: ReactNode; onClosed?: () => void; className?: string;
}) {
  const [snapPt, setSnapPt] = useState<number | string | null>(0.62);
  const common = { open, onOpenChange: (o: boolean) => { if (!o) onClose(); }, onAnimationEnd: (o: boolean) => { if (!o) onClosed?.(); } };
  const content = (
    <Drawer.Portal>
      <Drawer.Overlay className="sheet-overlay" />
      <Drawer.Content className={`sheet${snap ? " snap" : ""}${className ? " " + className : ""}`} aria-describedby={undefined}>
        <Drawer.Handle className="handle" />
        {title !== undefined ? (
          <div className="head">
            <div className="side">{left}</div>
            <Drawer.Title className="ttl">{title}</Drawer.Title>
            <div className="side r">{right}</div>
          </div>
        ) : <Drawer.Title className="visually-hidden">Menu</Drawer.Title>}
        <div className="body">{children}</div>
      </Drawer.Content>
    </Drawer.Portal>
  );
  // snapPoints + fadeFromIndex are a typed pair in vaul, hence the two branches
  return snap
    ? <Drawer.Root {...common} snapPoints={[0.62, 1]} fadeFromIndex={0} activeSnapPoint={snapPt} setActiveSnapPoint={setSnapPt}>{content}</Drawer.Root>
    : <Drawer.Root {...common}>{content}</Drawer.Root>;
}

// Action sheet: a list group of actions + Cancel.
export type MenuItem = { label: string; sub?: string; danger?: boolean; disabled?: boolean; onClick: () => void };
export function ActionSheet({ open, onClose, onClosed, title, items }: { open: boolean; onClose: () => void; onClosed?: () => void; title?: string; items: MenuItem[] }) {
  return (
    <Sheet open={open} onClose={onClose} onClosed={onClosed} className="menu-sheet">
      <div className="menu">
        {title && <div className="text-body-secondary small text-center mb-2 text-truncate">{title}</div>}
        <div className="list-group mb-3">
          {items.map((it, i) => (
            <button key={i} type="button" className={`list-group-item list-group-item-action mi${it.danger ? " text-danger" : ""}`} disabled={it.disabled} onClick={() => { onClose(); it.onClick(); }}>
              <div className="fw-semibold">{it.label}</div>{it.sub && <small className="text-body-secondary">{it.sub}</small>}
            </button>
          ))}
        </div>
        <button className="btn btn-outline-secondary w-100 cancel" onClick={onClose}>Cancel</button>
      </div>
    </Sheet>
  );
}
