#!/usr/bin/env python3
"""Call the Aliyun Wuying Cloud Phone (无影云手机 / eds-aic) OpenAPI with an
ACS3-HMAC-SHA256 signed request. Stdlib only — the official alibabacloud SDK
wheels fail to build in this container, so we sign by hand.

Credentials: read from env vars ALIBABA_CLOUD_ACCESS_KEY_ID /
ALIBABA_CLOUD_ACCESS_KEY_SECRET, falling back to /root/drop/ak_id.txt and
/root/drop/ak_secret.txt (this session only). RAM user must hold
AliyunECDFullAccess.

Usage:
  scripts/ecp_call.py DescribeRegions
  scripts/ecp_call.py DescribeAndroidInstances --region cn-shanghai -p MaxResults=50
  scripts/ecp_call.py CreateScreenshot --region cn-shanghai -p AndroidInstanceId=xxx
  scripts/ecp_call.py RunCommand --region cn-shanghai \
      -p 'AndroidInstanceIdList.1=xxx' -p 'CommandContent=input tap 500 500'

Notes:
- API version is fixed at 2023-09-30 (override with --version).
- Endpoint is eds-aic.<region>.aliyuncs.com (default region cn-shanghai).
- All params go in the query string (GET-style params via POST body-less request),
  which is what every eds-aic action this project uses expects.
- Full action list: https://help.aliyun.com/zh/ecp/api-eds-aic-2023-09-30-overview
"""
import argparse
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


def _load_creds():
    ak = os.environ.get('ALIBABA_CLOUD_ACCESS_KEY_ID')
    sk = os.environ.get('ALIBABA_CLOUD_ACCESS_KEY_SECRET')
    if ak and sk:
        return ak.strip(), sk.strip()
    try:
        ak = open('/root/drop/ak_id.txt').read().strip()
        sk = open('/root/drop/ak_secret.txt').read().strip()
        return ak, sk
    except OSError:
        sys.exit('No credentials: set ALIBABA_CLOUD_ACCESS_KEY_ID / '
                 'ALIBABA_CLOUD_ACCESS_KEY_SECRET or drop ak_id.txt/ak_secret.txt in /root/drop')


def call(action, version, region, params):
    ak, sk = _load_creds()
    host = f'eds-aic.{region}.aliyuncs.com'
    method = 'POST'
    canonical_query = '&'.join(
        f"{urllib.parse.quote(k, safe='~')}={urllib.parse.quote(str(v), safe='~')}"
        for k, v in sorted(params.items()))
    body = b''
    payload_hash = hashlib.sha256(body).hexdigest()
    headers = {
        'host': host,
        'x-acs-action': action,
        'x-acs-content-sha256': payload_hash,
        'x-acs-date': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'x-acs-signature-nonce': str(uuid.uuid4()),
        'x-acs-version': version,
    }
    signed_headers = ';'.join(sorted(headers))
    canonical_headers = ''.join(f"{k}:{headers[k]}\n" for k in sorted(headers))
    canonical_request = '\n'.join(
        [method, '/', canonical_query, canonical_headers, signed_headers, payload_hash])
    string_to_sign = 'ACS3-HMAC-SHA256\n' + hashlib.sha256(canonical_request.encode()).hexdigest()
    signature = hmac.new(sk.encode(), string_to_sign.encode(), hashlib.sha256).hexdigest()
    headers['Authorization'] = (
        f"ACS3-HMAC-SHA256 Credential={ak},SignedHeaders={signed_headers},Signature={signature}")
    url = f"https://{host}/?{canonical_query}" if canonical_query else f"https://{host}/"
    req = urllib.request.Request(url, data=body, method=method)
    for k, v in headers.items():
        if k != 'host':
            req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def main():
    ap = argparse.ArgumentParser(description='Signed Aliyun eds-aic (Cloud Phone) API call')
    ap.add_argument('action', help='API action, e.g. DescribeRegions')
    ap.add_argument('--region', default='cn-shanghai')
    ap.add_argument('--version', default='2023-09-30')
    ap.add_argument('-p', '--param', action='append', default=[],
                    metavar='KEY=VALUE', help='query parameter (repeatable)')
    args = ap.parse_args()
    params = {}
    for kv in args.param:
        if '=' not in kv:
            sys.exit(f'bad --param {kv!r}, expected KEY=VALUE')
        k, v = kv.split('=', 1)
        params[k] = v
    status, text = call(args.action, args.version, args.region, params)
    try:
        text = json.dumps(json.loads(text), ensure_ascii=False, indent=2)
    except ValueError:
        pass
    print(f'HTTP {status}')
    print(text)
    sys.exit(0 if status == 200 else 1)


if __name__ == '__main__':
    main()
