#!/usr/bin/env python3
"""Driving harness for Aliyun 无影云手机 (Wuying Cloud Phone / eds-aic).

Builds on scripts/ecp_call.py (hand-signed ACS3-HMAC-SHA256, stdlib only —
the official SDK wheels don't build in the container). Wraps the operations
we actually use to drive Chinese apps on a cloud phone:

  - instance group lifecycle: create / list / start / stop / reboot / delete
  - vision: screenshot() → CreateScreenshot, poll DescribeTasks, download PNG
  - input:  shell() → RunSyncCommand (≤3 s) or RunCommand+DescribeInvocations;
            tap / swipe / text / key / launch built on top
  - apps:   install_apk_from_url() → root-shell curl on the phone +
            pm install — the phone (on a China network) downloads the APK
            itself, so Tencent CDNs etc. that block our egress work fine

Gotchas learned building this:
  - `input text` only does ASCII — for Chinese text use the clipboard or an
    IME app; don't expect input text to type 中文.
  - Screenshot tasks land as OSS URLs in DescribeTasks Data[].Result (JSON
    with a DownloadUrl / Url field); the bucket is auto-created
    (cloudphone-saved-bucket-<region>-<uid>).
  - SendFile(DOWNLOAD_URL, AutoInstall) is broken for APK installs — see
    install_apk_from_url docstring. Use the root-shell path.
  - Array params are RPC-flattened: Key.1, Key.2, ...
  - Keep automation human-paced on WeChat/Alipay — cloud-phone risk control.

CLI:
  scripts/ecp.py instances                 # list instances
  scripts/ecp.py create [--spec acp.basic.small] [--image IMG] [--confirm]
  scripts/ecp.py screenshot ACP_ID [-o out.png]
  scripts/ecp.py shell ACP_ID 'getprop ro.product.model'
  scripts/ecp.py tap ACP_ID 500 800 / swipe ACP_ID x1 y1 x2 y2 [ms]
  scripts/ecp.py text ACP_ID 'hello' / key ACP_ID 3
  scripts/ecp.py launch ACP_ID com.tencent.mm
  scripts/ecp.py install ACP_ID https://.../app.apk
  scripts/ecp.py apps ACP_ID / start|stop|reboot ACP_ID... / delete AG_ID
"""
import argparse
import json
import sys
import time
import urllib.request

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from ecp_call import call as _signed_call

DEFAULT_REGION = 'cn-shanghai'
DEFAULT_SPEC = 'acp.basic.small'   # 2vCPU/4G/32G — cheapest


class EcpError(RuntimeError):
    pass


def api(action, region=DEFAULT_REGION, **params):
    """Signed eds-aic call. Lists/tuples are RPC-flattened to Key.N=...;
    dicts are JSON-encoded. Returns parsed JSON, raises EcpError on non-200."""
    flat = {}
    for k, v in params.items():
        if v is None:
            continue
        if isinstance(v, (list, tuple)):
            for i, item in enumerate(v, 1):
                flat[f'{k}.{i}'] = item
        elif isinstance(v, dict):
            flat[k] = json.dumps(v, ensure_ascii=False)
        elif isinstance(v, bool):
            flat[k] = 'true' if v else 'false'
        else:
            flat[k] = v
    status, text = _signed_call(action, '2023-09-30', region, flat)
    try:
        data = json.loads(text)
    except ValueError:
        data = {'raw': text}
    if status != 200:
        raise EcpError(f'{action} HTTP {status}: '
                       f'{data.get("Code")}: {data.get("Message", text[:300])}')
    return data


# ---------- lifecycle ----------

def create_group(spec=DEFAULT_SPEC, image_id=None, region=DEFAULT_REGION,
                 charge_type='PostPaid', period=1, period_unit='Hour',
                 auto_pay=True, number_of_instances=1, name=None):
    """Create a cloud-phone instance group. PostPaid+Hour = pay-as-you-go.
    BILLABLE — confirm with Deyao before calling."""
    if image_id is None:
        image_id = latest_system_image(region)
    return api('CreateAndroidInstanceGroup', region=region,
               BizRegionId=region, InstanceGroupSpec=spec, ImageId=image_id,
               ChargeType=charge_type, Period=period, PeriodUnit=period_unit,
               AutoPay=auto_pay, NumberOfInstances=number_of_instances,
               InstanceGroupName=name)


def latest_system_image(region=DEFAULT_REGION):
    data = api('DescribeImageList', region=region, ImageType='System',
               MaxResults=50)
    imgs = [i for i in data.get('Data', [])
            if i.get('Status') == 'AVAILABLE' and region in
            (i.get('ImageRegionList') or [])]
    if not imgs:
        raise EcpError(f'no AVAILABLE system image in {region}')
    imgs.sort(key=lambda i: i.get('GmtCreate', ''), reverse=True)
    return imgs[0]['ImageId']


def list_instances(region=DEFAULT_REGION, **params):
    return api('DescribeAndroidInstances', region=region, MaxResults=50,
               **params).get('InstanceModel', [])


def list_groups(region=DEFAULT_REGION):
    return api('DescribeAndroidInstanceGroups', region=region,
               MaxResults=50).get('InstanceGroupModel', [])


def wait_instances_running(instance_ids, region=DEFAULT_REGION, timeout=600):
    """Poll until every instance is RUNNING. Returns the instance models."""
    deadline = time.time() + timeout
    while True:
        insts = [i for i in list_instances(region)
                 if i.get('AndroidInstanceId') in instance_ids]
        states = {i['AndroidInstanceId']: i.get('AndroidInstanceStatus')
                  for i in insts}
        if insts and all(s == 'RUNNING' for s in states.values()):
            return insts
        if time.time() > deadline:
            raise EcpError(f'timeout waiting for RUNNING, states={states}')
        time.sleep(10)


def start_instances(ids, region=DEFAULT_REGION):
    return api('StartAndroidInstance', region=region, AndroidInstanceIds=ids)


def stop_instances(ids, region=DEFAULT_REGION, force=False):
    return api('StopAndroidInstance', region=region, AndroidInstanceIds=ids,
               ForceStop=force)


def reboot_instances(ids, region=DEFAULT_REGION):
    return api('RebootAndroidInstancesInGroup', region=region,
               AndroidInstanceIds=ids)


def delete_group(group_ids, region=DEFAULT_REGION):
    """Delete instance group(s). PostPaid groups stop billing on delete."""
    if isinstance(group_ids, str):
        group_ids = [group_ids]
    return api('DeleteAndroidInstanceGroup', region=region,
               InstanceGroupIds=group_ids)


# ---------- async task plumbing ----------

def wait_tasks(task_ids, region=DEFAULT_REGION, timeout=300, interval=3):
    """Poll DescribeTasks until all task_ids finish. Returns task dicts.
    Raises EcpError if any task fails."""
    if isinstance(task_ids, str):
        task_ids = [task_ids]
    deadline = time.time() + timeout
    while True:
        data = api('DescribeTasks', region=region, TaskIds=task_ids,
                   MaxResults=100)
        tasks = {t['TaskId']: t for t in data.get('Data', [])}
        done = [t for t in tasks.values()
                if t.get('TaskStatus') not in ('Processing', 'Waiting',
                                               'Running', 'Init')]
        if len(done) >= len(task_ids):
            failed = [t for t in done if t.get('TaskStatus') != 'Finished']
            if failed:
                raise EcpError('task(s) failed: ' + json.dumps(
                    [{k: t.get(k) for k in
                      ('TaskId', 'TaskStatus', 'ErrorCode', 'ErrorMsg')}
                     for t in failed], ensure_ascii=False))
            return list(tasks.values())
        if time.time() > deadline:
            raise EcpError(f'timeout; states=' + json.dumps(
                {tid: t.get('TaskStatus') for tid, t in tasks.items()}))
        time.sleep(interval)


# ---------- vision ----------

def screenshot(instance_ids, region=DEFAULT_REGION, out=None, timeout=120):
    """Take screenshot(s). Returns [(instance_id, url, local_path|None)].
    Downloads to `out` (single instance) or out prefix per instance."""
    if isinstance(instance_ids, str):
        instance_ids = [instance_ids]
    resp = api('CreateScreenshot', region=region,
               AndroidInstanceIdList=instance_ids)
    tasks = resp.get('Tasks', [])
    task_map = {t['TaskId']: t['AndroidInstanceId'] for t in tasks}
    finished = wait_tasks(list(task_map), region=region, timeout=timeout)
    results = []
    for t in finished:
        inst = task_map.get(t['TaskId'], t.get('ResourceId'))
        url = _extract_url(t.get('Result', ''))
        path = None
        if url and out:
            path = out if len(task_map) == 1 else f'{out}.{inst}.png'
            with urllib.request.urlopen(url, timeout=60) as r, \
                    open(path, 'wb') as f:
                f.write(r.read())
        results.append((inst, url, path))
    return results


def _extract_url(result):
    """Task Result is JSON (or a bare URL) containing the OSS download URL."""
    if not result:
        return None
    if result.startswith('http'):
        return result.strip()
    try:
        d = json.loads(result)
    except ValueError:
        return None
    if isinstance(d, str):
        return d if d.startswith('http') else None
    for key in ('DownloadUrl', 'downloadUrl', 'Url', 'url', 'OssUrl',
                'ossUrl', 'FileUrl', 'fileUrl'):
        if isinstance(d, dict) and d.get(key):
            return d[key]
    # last resort: any http(s) string value anywhere in the object
    def walk(o):
        if isinstance(o, str) and o.startswith('http'):
            return o
        if isinstance(o, dict):
            for v in o.values():
                u = walk(v)
                if u:
                    return u
        if isinstance(o, list):
            for v in o:
                u = walk(v)
                if u:
                    return u
    return walk(d)


# ---------- input / shell ----------

def shell(instance_ids, cmd, region=DEFAULT_REGION, sync=True, wait_ms=3000,
          timeout=60):
    """Run a shell command on instance(s). Returns {instance_id: output}.
    sync=True uses RunSyncCommand (fast, ≤3 s wall time); sync=False uses
    RunCommand and polls DescribeInvocations until finished."""
    if isinstance(instance_ids, str):
        instance_ids = [instance_ids]
    if sync:
        data = api('RunSyncCommand', region=region, InstanceIds=instance_ids,
                   CommandContent=cmd, WaitTime=wait_ms)
        return {d['InstanceId']: d.get('Output', '')
                for d in data.get('Data', [])}
    resp = api('RunCommand', region=region, InstanceIds=instance_ids,
               CommandContent=cmd, Timeout=timeout)
    invoke_id = resp.get('InvokeId') or resp.get('RequestId')
    deadline = time.time() + timeout + 30
    while True:
        data = api('DescribeInvocations', region=region,
                   InstanceIds=instance_ids, InvocationId=invoke_id)
        rows = data.get('Data', [])
        if rows and all(r.get('InvocationStatus') in
                        ('FINISHED', 'Finished', 'Success', 'SUCCESS',
                         'FAILED', 'Failed', 'TIMEOUT', 'Timeout')
                        for r in rows):
            return {r['InstanceId']: r.get('Output', '') for r in rows}
        if time.time() > deadline:
            raise EcpError('RunCommand poll timeout: ' + json.dumps(rows))
        time.sleep(3)


def tap(ids, x, y, **kw):
    return shell(ids, f'input tap {int(x)} {int(y)}', **kw)


def swipe(ids, x1, y1, x2, y2, dur_ms=300, **kw):
    return shell(ids, f'input swipe {int(x1)} {int(y1)} {int(x2)} {int(y2)} '
                      f'{int(dur_ms)}', **kw)


def text(ids, s, **kw):
    """ASCII only — `input text` can't type Chinese."""
    esc = s.replace(' ', '%s')
    return shell(ids, f'input text {esc}', **kw)


def key(ids, keycode, **kw):
    """keycode: int or name, e.g. 3=HOME, 4=BACK, 66=ENTER."""
    return shell(ids, f'input keyevent {keycode}', **kw)


def launch(ids, package, activity=None, **kw):
    if activity:
        return shell(ids, f'am start -n {package}/{activity}', **kw)
    return shell(ids, f'monkey -p {package} -c android.intent.category.'
                      f'LAUNCHER 1', **kw)


# ---------- apps ----------

def install_apk_from_url(instance_ids, url, region=DEFAULT_REGION,
                         timeout=900):
    """Install an APK from a public download URL by downloading it ON the
    phone (root shell curl → /data/local/tmp) and pm-installing it there.

    Verified working (WeChat 8.0.56, 248 MB, seconds to download on the
    phone's China network). Don't switch back to
    SendFile(DOWNLOAD_URL, AutoInstall=true): tested 2026-08-18, it left a
    0-byte file in /sdcard/Download AND AutoInstall's pm install can't read
    /sdcard anyway (SELinux: system_server denied read on fuse).
    Returns {instance_id: shell output}; output ends with 'Success' on a
    good install."""
    q = url.replace("'", "%27")
    cmd = (f"cd /data/local/tmp && curl -sSL -o app.apk '{q}' && "
           f"pm install -r /data/local/tmp/app.apk && rm /data/local/tmp/app.apk")
    return shell(instance_ids, cmd, region=region, sync=False,
                 timeout=timeout)


def list_packages(ids, grep=None, **kw):
    cmd = 'pm list packages' + (f' | grep {grep}' if grep else '')
    return shell(ids, cmd, **kw)


# ---------- CLI ----------

def _print(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=2, default=str))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--region', default=DEFAULT_REGION)
    sub = ap.add_subparsers(dest='cmd', required=True)

    sub.add_parser('instances')
    sub.add_parser('groups')
    p = sub.add_parser('create')
    p.add_argument('--spec', default=DEFAULT_SPEC)
    p.add_argument('--image')
    p.add_argument('--charge', default='PostPaid')
    p.add_argument('--period', type=int, default=1)
    p.add_argument('--unit', default='Hour')
    p.add_argument('--name')
    p.add_argument('--confirm', action='store_true',
                   help='required — this creates billable resources')
    for name in ('start', 'stop', 'reboot'):
        p = sub.add_parser(name)
        p.add_argument('ids', nargs='+')
    p = sub.add_parser('delete')
    p.add_argument('group_ids', nargs='+')
    p = sub.add_parser('screenshot')
    p.add_argument('ids', nargs='+')
    p.add_argument('-o', '--out', default='screenshot.png')
    p = sub.add_parser('shell')
    p.add_argument('id')
    p.add_argument('command')
    p.add_argument('--async', dest='use_async', action='store_true')
    p = sub.add_parser('tap')
    p.add_argument('id'); p.add_argument('x', type=int); p.add_argument('y', type=int)
    p = sub.add_parser('swipe')
    p.add_argument('id')
    for a in ('x1', 'y1', 'x2', 'y2'):
        p.add_argument(a, type=int)
    p.add_argument('dur', type=int, nargs='?', default=300)
    p = sub.add_parser('text')
    p.add_argument('id'); p.add_argument('s')
    p = sub.add_parser('key')
    p.add_argument('id'); p.add_argument('keycode')
    p = sub.add_parser('launch')
    p.add_argument('id'); p.add_argument('package')
    p.add_argument('activity', nargs='?')
    p = sub.add_parser('install')
    p.add_argument('id'); p.add_argument('url')
    p = sub.add_parser('apps')
    p.add_argument('id'); p.add_argument('--grep')

    a = ap.parse_args()
    r = a.region
    if a.cmd == 'instances':
        _print(list_instances(r))
    elif a.cmd == 'groups':
        _print(list_groups(r))
    elif a.cmd == 'create':
        if not a.confirm:
            sys.exit('refusing: creating an instance group is BILLABLE. '
                     'Re-run with --confirm after Deyao approves.')
        _print(create_group(spec=a.spec, image_id=a.image, region=r,
                            charge_type=a.charge, period=a.period,
                            period_unit=a.unit, name=a.name))
    elif a.cmd == 'start':
        _print(start_instances(a.ids, r))
    elif a.cmd == 'stop':
        _print(stop_instances(a.ids, r))
    elif a.cmd == 'reboot':
        _print(reboot_instances(a.ids, r))
    elif a.cmd == 'delete':
        _print(delete_group(a.group_ids, r))
    elif a.cmd == 'screenshot':
        for inst, url, path in screenshot(a.ids, region=r, out=a.out):
            print(f'{inst}: {path or url}')
    elif a.cmd == 'shell':
        _print(shell(a.id, a.command, region=r, sync=not a.use_async))
    elif a.cmd == 'tap':
        _print(tap(a.id, a.x, a.y, region=r))
    elif a.cmd == 'swipe':
        _print(swipe(a.id, a.x1, a.y1, a.x2, a.y2, a.dur, region=r))
    elif a.cmd == 'text':
        _print(text(a.id, a.s, region=r))
    elif a.cmd == 'key':
        _print(key(a.id, a.keycode, region=r))
    elif a.cmd == 'launch':
        _print(launch(a.id, a.package, a.activity, region=r))
    elif a.cmd == 'install':
        _print(install_apk_from_url(a.id, a.url, region=r))
    elif a.cmd == 'apps':
        _print(list_packages(a.id, grep=a.grep, region=r))


if __name__ == '__main__':
    main()
