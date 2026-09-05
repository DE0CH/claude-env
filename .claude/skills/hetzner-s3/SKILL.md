---
name: hetzner-s3
description: "Create and use Hetzner Object Storage (S3-compatible) buckets. Covers the Console-only bucket + S3-credential creation flow, the 'Click to show' secret-key gotcha, deleting credentials, and using the bucket from Python/boto3 through the pod egress proxy. Use whenever a task needs an S3 bucket on Hetzner, mentions Hetzner Object Storage / your-objectstorage.com, or needs the HETZNER_S3_* credentials."
---

# Hetzner Object Storage (S3)

S3-compatible object storage on Hetzner (Ceph-backed, WORM-ish). Separate product
from Hetzner **Storage Boxes** (those are WebDAV/SSH — see `lessons/18`). Buckets and
S3 credentials can ONLY be created in the Hetzner **Console** — there is no Cloud API
for generating S3 credentials, and the *first* credential must come from the Console
before any S3 API call works. After that, buckets/objects are managed with any S3 tool.

## Our bucket (provisioned 2026-09-05)

- **Bucket:** `de0ch-claude-6fdff6` — project **"Cloud Code"** (`/projects/2827255`),
  location **Falkenstein** (`fsn1`), **private**, object-lock disabled.
- **Endpoint:** `https://fsn1.your-objectstorage.com` · **Region:** `fsn1`
- Console S3-credential name: **`claude-store`**.
- Env vars (set in the environment config; present next session):
  `HETZNER_S3_ACCESS_KEY`, `HETZNER_S3_SECRET_KEY`,
  `HETZNER_S3_ENDPOINT` (`https://fsn1.your-objectstorage.com`),
  `HETZNER_S3_BUCKET` (`de0ch-claude-6fdff6`), `HETZNER_S3_REGION` (`fsn1`).

Locations / endpoints: Falkenstein `fsn1.your-objectstorage.com`,
Nuremberg `nbg1.your-objectstorage.com`, Helsinki `hel1.your-objectstorage.com`.
Pricing: base up to **€7.79/mo**, billed **€0.0125/h** while Object Storage runtime is
active; 1 TB-h storage + 1.5 GB traffic included per hour; extra €0.0104/TB-h,
€1.20/TB traffic; min billable object 64 kB. Creating a bucket is a **paid** action
("Create & Buy now") — only do it when the task calls for it.

## Using the bucket (boto3, from a web pod)

Route through the egress proxy's CA bundle; virtual-hosted addressing works:

```python
import boto3, os
from botocore.config import Config
s3 = boto3.client('s3',
    endpoint_url=os.environ['HETZNER_S3_ENDPOINT'], region_name=os.environ['HETZNER_S3_REGION'],
    aws_access_key_id=os.environ['HETZNER_S3_ACCESS_KEY'],
    aws_secret_access_key=os.environ['HETZNER_S3_SECRET_KEY'],
    config=Config(s3={'addressing_style':'virtual'}),
    verify='/root/.ccr/ca-bundle.crt')   # so TLS verifies through HTTPS_PROXY
s3.put_object(Bucket=os.environ['HETZNER_S3_BUCKET'], Key='k', Body=b'...')
```

`pip3 install boto3` if missing. Reachable over 443 from Claude-on-the-web pods.

## Creating a bucket / credentials in the Console (browser)

No shared logged-in Browserbase context exists — log in fresh each time
(`accounts.hetzner.com`, email-OTP; the "Heray" proof-of-work often eats the first
username/password AND the first 2FA submit — just resubmit the same values/code; see
`lessons/18`). Drive with Playwright over CDP (connect to the keep-alive session's
`connectUrl`); the Console is an Angular SPA, so use **real** clicks/typing, not JS
`.value`/`el.click()`.

**Bucket:** project → `Object Storage` (`/projects/<id>/buckets`) → `Create Bucket`.
Location is a custom dropdown (click the control showing the current city, then click
the target city — a plain text-node click does NOT change it; confirm the
`.<loc>.your-objectstorage` suffix updated). Name is globally unique, lowercase, not
changeable. Defaults Object-lock **Disabled** / Visibility **Private** are usually
right. Click **Create & Buy now**.

**S3 credentials:** project → `Security` → `S3 credentials`
(`/projects/<id>/security/s3-credentials`) → `Generate credentials` → type a
Description → `Generate credentials`. Credentials are **project-scoped** (valid for
every bucket in the project), so you rarely need more than one.

### ⚠️ The Secret Key "Click to show" gotcha (cost several rounds — 2026-09-05)

The "Credentials generated" dialog shows the **Access Key** as plain text (in a
`.click-to-copy__content` span) but the **Secret Key** is hidden inside an
`<hc-click-to-show>` component that renders the placeholder **"Some random text that
is long"** — the real secret is NOT in the DOM (not in any input, text node, HTML
attribute, or screenshot value) until you reveal it. To capture it:

1. Do a **real mouse click** on `.click-to-show` (Playwright `locator.click()`), NOT
   `el.click()` — Angular ignores synthetic clicks and the value never renders.
2. Then read `document.querySelector('hc-click-to-show').textContent`, stripping the
   `"Click to show"` / `"Some random text that is long"` remnants → that's the
   40-char secret. Write it straight to a local file; never print it.

The secret is shown **once**. If you close the dialog without revealing+saving it, the
secret is unrecoverable — you must delete that credential and generate a new one.
Access key = 20 chars, secret = 40 chars.

**Delete a credential:** hover its row so the `⋯` button appears → real-click `⋯` →
click `Delete` in the menu → the confirm dialog's button is **`OK`** (with `Cancel`),
not "Delete".

## Delivering the secret

Hetzner shows the secret once; treat it like a password. Deliver it to Deyao by
Discord DM (build the message from the saved file so it never hits the chat
transcript), and tell him the env-var names to add for the next session (env can't
change mid-session). Do NOT put the raw secret in task records — the access key,
endpoint, bucket and env-var names are enough there.
