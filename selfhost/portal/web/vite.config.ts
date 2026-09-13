import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dashboard is served under a path prefix through the cf-tunnel (/t/portal/), so every
// asset and API URL is relative. Output goes to ../public, which server.js serves as static.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "../public", emptyOutDir: true, sourcemap: true },
  server: { proxy: { "/api": "http://127.0.0.1:8080" } },
});
