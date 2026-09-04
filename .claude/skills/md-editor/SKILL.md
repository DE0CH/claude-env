---
name: md-editor
description: Give Deyao a WYSIWYG editor for a single markdown file on disk (e.g. OKR.md), served through the cf-tunnel, that autosaves every change straight to the file. Use whenever Deyao asks to "write/edit a markdown doc in a WYSIWYG editor", wants a live editor for one file, or asks for a shared note he can type into from his phone while the session works with the same file.
---

# md-editor — WYSIWYG markdown editor for one file over cf-tunnel

Built 2026-09-04 (OKR.md task). Stack: **Toast UI Editor 3.2.2** (WYSIWYG + Markdown
toggle, vendored) + `scripts/md-editor-server.py` (stdlib) + the cf-tunnel agent.

## Bring-up (2 commands)

```bash
cd ~/claude-env
setsid nohup python3 scripts/md-editor-server.py --file /path/to/DOC.md --port 8899 > "$SCRATCHPAD/md-editor.log" 2>&1 < /dev/null &
setsid nohup node cf-tunnel/agent.js > "$SCRATCHPAD/agent.log" 2>&1 < /dev/null &
```

Then discord him the per-session URL the agent logs
(`https://tunnel.deyaochen.com/t/<CLAUDE_CODE_SESSION_ID>/`). The page at `/` IS the
editor; there is no `/drop`. First open per device needs the Cloudflare Access PIN.

- `ws` must be installed globally for the agent (`npm i -g ws`) — fresh pods lack it.
- The server creates the file if missing. Seed it with a heading first so the editor
  isn't blank.

## How it behaves

- **Autosave**: debounced 800 ms after the last change, plus flush on tab hide /
  pagehide; status pill top-right (`unsaved` → `saving…` → `saved HH:MM:SS`).
- **Conflict-safe**: `GET /doc` returns the text + `X-Doc-Version` (mtime ns);
  `POST /doc` must echo that version or gets **409** with the current text, and the
  page reloads from disk instead of clobbering. So the agent may edit the file from the
  container while he types — the page polls every 5 s and reloads when it changes on
  disk (only while it has no unsaved local edits).
- Writes are atomic (`mkstemp` + `os.replace`).
- Serves `scripts/md-editor/` (index.html + `vendor/`), binds 127.0.0.1 only.

## Pitfalls (don't re-derive)

- **Use the `-all` bundle.** `@toast-ui/editor/dist/toastui-editor.js` on npm/jsdelivr
  is UMD with prosemirror-* as *externals* → `Cannot read properties of undefined
  (reading 'PluginKey')` at init. The self-contained build lives only on
  `https://uicdn.toast.com/editor/3.2.2/toastui-editor-all.min.js` (vendored at
  `scripts/md-editor/vendor/`). CSS: `toastui-editor.css` + `theme/toastui-editor-dark.css`.
- Headless Chromium in the pod can't reach public URLs through the agent proxy
  (ERR_CONNECTION_RESET); test against `http://127.0.0.1:8899/` or `file://` instead.
  Playwright: `npm i playwright` locally in the scratchpad (ESM ignores NODE_PATH) and
  launch with `executablePath: '/opt/pw-browsers/chromium'`.
- The tunnel worker strips `/t/<id>/`, so keep every URL in index.html **relative**
  (`vendor/…`, `doc`).

## Community prior art checked

Toast UI Editor (WYSIWYG/markdown dual mode, `getMarkdown()`/`setMarkdown()`), Milkdown
(needs bundling), HedgeDoc (full server, overkill for one file). Toast UI won on
"single script tag, no build step".
