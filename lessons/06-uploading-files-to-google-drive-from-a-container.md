## Uploading files to Google Drive from a container (2026-08)

Working path for /Claude Records transcript+artefact uploads (`scripts/drive-browser-upload.js`):
drive.google.com in a browser driven over CDP with Playwright (claude-in-chrome on the Mac,
or a mobilerun cloud phone's Chrome), signed in to a Google account with access to the folder.

- Check WHICH Google account the browser is signed in as before debugging anything else.
  The Drive the MCP connector sees belongs to chendeyao000@gmail.com; the Claude Records
  folder is additionally shared to **chendeyao.uk@gmail.com** (Editor, granted 2026-08-17),
  so a browser signed in as either account works. If a Drive page shows "You need access",
  it's the wrong account.
- Drive web UI upload mechanics: click the New button (`[guidedhelpid="new_menu_button"]`),
  then the menu item — it's `li[role="menuitem"]:has-text("File upload")` (an `li`, and the
  inner span intercepts nothing; clicking the span times out because the `li` intercepts
  pointer events). That spawns a native file chooser → Playwright `filechooser` event →
  `setFiles(localPath)` streams the file from the container. Wait for the
  "upload complete" toast, then verify size via the connector (`search_files` on the
  subfolder's parentId).
- Playwright's `setFiles` on a CDP-connected remote browser transfers the local file
  content itself — this is the byte-faithful any-size no-base64 upload channel.
- Don't retype CDP `connectUrl`s / signing tokens by hand (a dropped character = 401):
  extract them programmatically from the API response.
