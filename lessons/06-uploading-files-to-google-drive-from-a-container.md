## Uploading files to Google Drive from a container (2026-08)

Working path for /Claude Records transcript+artefact uploads (`scripts/drive-browser-upload.js`):
drive.google.com in a regular-context Browserbase session, driven over CDP with Playwright.

- The regular Browserbase context's Google login is **chendeyao.uk@gmail.com**, NOT the
  chendeyao000@gmail.com account that owns the Drive the MCP connector sees. The Claude
  Records folder is shared to the .uk account (Editor, granted 2026-08-17) — that's what
  makes the browser path work. If a Drive page shows "You need access", check which
  account is signed in before debugging anything else.
- Drive web UI upload mechanics: click the New button (`[guidedhelpid="new_menu_button"]`),
  then the menu item — it's `li[role="menuitem"]:has-text("File upload")` (an `li`, and the
  inner span intercepts nothing; clicking the span times out because the `li` intercepts
  pointer events). That spawns a native file chooser → Playwright `filechooser` event →
  `setFiles(localPath)` streams the file from the container. Wait for the
  "upload complete" toast, then verify size via the connector (`search_files` on the
  subfolder's parentId).
- Playwright's `setFiles` on a CDP-connected remote browser transfers the local file
  content itself — this is the byte-faithful any-size no-base64 upload channel.
- Don't retype `connectUrl` signing keys by hand (a dropped character = 401): fetch with
  `browse cloud sessions get <id>` and extract programmatically.
