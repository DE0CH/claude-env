## Hetzner Storage Box provisioning via API (2026-08, box `claude-records`)

- **Storage Boxes are on the new Hetzner API**: `api.hetzner.com/v1/storage_box(_type)s`,
  Bearer token from Hetzner Console → project → Security → API tokens. The token
  reveal dialog is an Angular `hc-click-to-show` component — click `.click-to-show`,
  then read the revealed text (initially it renders literal placeholder text
  "Some random text that is long").
- Box passwords require upper+lower+digit+special. `POST /v1/storage_boxes` with
  `{name, storage_box_type:"bx11", location:"fsn1", password, access_settings:{...}}`
  → box was `active` with ssh/webdav/external enabled in <1 min. Username (u######)
  appears in the GET response once active; host is `<username>.your-storagebox.de`.
- **From Claude-on-the-web pods only WebDAV (443) is reachable** — SSH/SFTP/rsync
  ports 22/23 are blocked by the egress gateway. WebDAV worked: MKCOL per path
  segment (not recursive; 405 = exists), PUT/GET byte-faithful. The gateway drops
  a fraction of CONNECTs to the box (transient `000`/502) — always retry;
  `scripts/storagebox-upload.sh` has this built in. A brand-new box's DNS takes
  ~1–2 min to resolve (502 "policy denial or upstream failure" until then).
- **accounts.hetzner.com login flow**: `#_username`/`#_password` form → email OTP at
  `/2fa` (`#_auth_code`), fronted by a "Heray" proof-of-work check that can eat the
  first 2FA submit (bounces back to /2fa with no error) — resubmitting the same
  code worked. Console SSO (console.hetzner.com) follows from the accounts login.
  (There is no longer a shared logged-in Browserbase context — expect to log in
  fresh via the accounts.hetzner.com email-OTP flow above each time.)
