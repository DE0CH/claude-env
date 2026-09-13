import { createRoot } from "react-dom/client";
import { App } from "./App";
import "bootstrap/dist/css/bootstrap.min.css";
import "./styles.css";
import "./store";

// Bootstrap's colour modes are opt-in per element: follow the OS setting
const mq = matchMedia("(prefers-color-scheme: dark)");
const theme = () => { document.documentElement.setAttribute("data-bs-theme", mq.matches ? "dark" : "light"); };
theme(); mq.addEventListener("change", theme);

// iOS Safari ignores user-scalable=no in a normal tab (honoured only when added to the Home
// Screen), so block pinch-zoom by hand: cancel multi-finger touchmove and the gesture events.
const opts = { passive: false } as AddEventListenerOptions;
document.addEventListener("touchmove", (e: any) => { if ((e.scale !== undefined && e.scale !== 1) || e.touches.length > 1) e.preventDefault(); }, opts);
for (const n of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(n, (e) => e.preventDefault(), opts);

createRoot(document.getElementById("root")!).render(<App />);
