import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@radix-ui/themes/styles.css";
import "./styles.css";
import "./store";
import { syncStatusBar } from "./statusBar";

// Radix Themes reads a `light`/`dark` class from an ancestor when appearance="inherit" — follow the OS
const mq = matchMedia("(prefers-color-scheme: dark)");
const theme = () => { document.documentElement.classList.toggle("dark", mq.matches); document.documentElement.classList.toggle("light", !mq.matches); syncStatusBar(); };
theme(); mq.addEventListener("change", theme);

// iOS Safari ignores user-scalable=no in a normal tab (honoured only when added to the Home
// Screen), so block pinch-zoom by hand: cancel multi-finger touchmove and the gesture events.
const opts = { passive: false } as AddEventListenerOptions;
document.addEventListener("touchmove", (e: any) => { if ((e.scale !== undefined && e.scale !== 1) || e.touches.length > 1) e.preventDefault(); }, opts);
for (const n of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(n, (e) => e.preventDefault(), opts);

createRoot(document.getElementById("root")!).render(<App />);
