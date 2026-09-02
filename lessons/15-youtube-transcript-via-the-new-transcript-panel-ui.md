## YouTube transcript via the NEW transcript panel UI (2026-08-28, `WtlGB-YVLOg`)

The logged-in Browserbase watch-page route still works, but two sub-paths died and the
DOM changed:

- **Timedtext `baseUrl` fetches now return 0 bytes** even from inside the logged-in page
  (POT-token wall extends to the web client's own caption URLs), and a hand-rolled
  innertube `get_transcript` POST from page context gets HTTP 400. Don't bother.
- **What works:** expand the description, Playwright-NATIVE click on
  `button[aria-label="Show transcript"]` (a JS `.click()` opens nothing), then read
  `ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]`.
  The old `ytd-transcript-segment-renderer` selector matches NOTHING in this UI — the
  panel is a new "modern transcript view". Its `innerText` is triplets of
  `m:ss` / `"N seconds"` a11y line / caption text — trivially parsed (regex the
  timestamp lines, drop the a11y line). 97 segments / 14k chars came out clean.
- Check `ytd-engagement-panel-section-list-renderer` `target-id`s + `visibility` attrs
  when a panel "doesn't open" — it may be open under a different target-id.
