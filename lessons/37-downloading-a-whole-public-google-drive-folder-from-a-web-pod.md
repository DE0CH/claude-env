# Downloading a whole public Google Drive folder from a web pod

Context (2026-09-05, 双翼 fund-flow task): Deyao shared a Drive folder ("anyone with the
link"), 245 items incl. 8 subfolders, ~150 MB. Per-file `uc?export=download` through a
fetch proxy works for small files but fails on ~8 MB files (ScrapingBee caps non-HTML
bodies at 2 MB), and enumerating the tree by hand is slow. Deyao's instruction: "zip the
entire thing and download it and use local tools."

## What works

1. Connect Playwright to a browser over CDP (`chromium.connectOverCDP(cdpUrl)` —
   claude-in-chrome on the Mac, or a mobilerun cloud phone's Chrome), and on a CDP session
   run `Browser.setDownloadBehavior {behavior:'allow', downloadPath:<dir>, eventsEnabled:true}`.
   Listen to `Browser.downloadWillBegin` / `Browser.downloadProgress` (state `completed`).
2. Open `https://drive.google.com/drive/folders/<id>?hl=en` logged out. Rows are
   `[role="row"][data-id]`; scroll the last row into view repeatedly until the count stops
   growing (innerText of off-screen rows is empty — collect names while scrolling).
3. **A folder row's hover "Download" button zips that folder recursively into ONE zip.**
   Click the folder row (selects it, mouse now hovers it), then click the visible
   `[aria-label="Download"]` element with the smallest y (that is the row's own button —
   the logged-out UI has no toolbar Download button). One folder per page load.
4. For the loose files at the root: select the range (click first file row, shift-click
   last), then **right-click → context-menu "Download"**. Selecting files only (no folders)
   yields a single zip.
5. The zips land in the browser host's `downloadPath` — pull them from there (Mac: local
   disk; mobilerun phone: the device's download folder via the device file-transfer API).
   Extract with Python `zipfile`, decoding names via
   `name.encode('cp437').decode('utf-8')` when the UTF-8 flag (0x800) is unset — `unzip`
   mangles Chinese names into `#Uxxxx` and dies on "File name too long".

## Traps

- **Chrome blocks a page's second automatic download.** Selecting everything (folders +
  files) makes Drive emit several zips (one per folder + one for files); only the first
  arrives. Hence: one download per page (`ctx.newPage()` per folder), never one big
  multi-select.
- The hover Download button belongs to whichever row the mouse is over. After a
  shift-click on the last row you are hovering the last row, so a click on "Download"
  fetches that single file (cost me two rounds). Use the context menu for multi-select.
- Ctrl+A in the logged-out folder view does not select all rows.
- `pkill -f "[n]ode x.js"` still kills your own shell if the same bash command line also
  contains the literal `node x.js` (e.g. a restart in the same command). Kill by PID from
  `ps -eo pid,args | grep "[x]"` in a separate call.
- Only the first 8 KB of the Drive zip listing is needed to see structure; Drive folder
  zips of an audio folder can be hundreds of MB — keep the browser alive and wait for the
  `completed` event, not a fixed sleep.
