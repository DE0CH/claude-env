#!/usr/bin/env node
// Raw 2Captcha API v2 client (createTask / getTaskResult / getBalance).
// Tool-agnostic: no browser dependency. Used directly for "I already have the
// sitekey" solves, and imported by bb-solve.js for the Browserbase flow.
//
// Auth: env var TWOCAPTCHA_API (the 2Captcha API key). Endpoints are the JSON
// v2 API at api.2captcha.com — NOT the legacy in.php/res.php.
//
// Usage (CLI):
//   node twocaptcha.js balance
//   node twocaptcha.js turnstile  <websiteURL> <sitekey> [action data pagedata]
//   node twocaptcha.js recaptcha  <websiteURL> <sitekey> [--invisible]
//   node twocaptcha.js hcaptcha   <websiteURL> <sitekey> [--invisible]
//   node twocaptcha.js task '<json task object>'          # any task type
// Prints the solution JSON to stdout; progress to stderr.
//
// Usage (module):
//   const { solve, getBalance } = require('./twocaptcha');
//   const sol = await solve({ type: 'TurnstileTaskProxyless',
//                             websiteURL: url, websiteKey: sitekey });
//   sol.token   // <- the Turnstile / hCaptcha token
//   sol.gRecaptchaResponse   // <- for reCAPTCHA

const API = 'https://api.2captcha.com';
const KEY = process.env.TWOCAPTCHA_API;

// Errors that mean "the account can't pay" — per CLAUDE.md these are NOT to be
// worked around; the caller should stop and ping Deyao on Discord.
const BILLING_ERRORS = new Set([
  'ERROR_ZERO_BALANCE',
  'ERROR_NO_SLOT_AVAILABLE', // sometimes surfaced when the balance is exhausted
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`2captcha ${path}: non-JSON response ${res.status}: ${text.slice(0, 300)}`); }
  return json;
}

function assertKey() {
  if (!KEY) {
    throw new Error(
      'TWOCAPTCHA_API is not set. This is a misconfiguration — per CLAUDE.md, ' +
      'stop and discord Deyao to fix the env var; do NOT fall back to another solver.'
    );
  }
}

// Raise a distinctive error for billing problems so callers can catch and ping.
function checkError(resp, where) {
  if (resp.errorId && resp.errorId !== 0) {
    const code = resp.errorCode || 'UNKNOWN';
    const msg = resp.errorDescription || code;
    const err = new Error(`2captcha ${where}: ${code} — ${msg}`);
    err.errorCode = code;
    err.isBilling = BILLING_ERRORS.has(code);
    throw err;
  }
}

async function getBalance() {
  assertKey();
  const resp = await post('/getBalance', { clientKey: KEY });
  checkError(resp, 'getBalance');
  return resp.balance; // float, USD
}

async function createTask(task) {
  assertKey();
  const resp = await post('/createTask', { clientKey: KEY, task });
  checkError(resp, 'createTask');
  if (!resp.taskId) throw new Error('2captcha createTask: no taskId in response: ' + JSON.stringify(resp));
  return resp.taskId;
}

async function getTaskResult(taskId) {
  assertKey();
  const resp = await post('/getTaskResult', { clientKey: KEY, taskId });
  checkError(resp, 'getTaskResult'); // throws on ERROR_CAPTCHA_UNSOLVABLE etc.
  return resp; // { status: 'processing' } | { status: 'ready', solution, cost, ... }
}

// Create a task and poll until solved. Returns the `solution` object.
// opts: { pollMs=5000, timeoutMs=180000, onProgress }
async function solve(task, opts = {}) {
  const { pollMs = 5000, timeoutMs = 180000, onProgress = () => {} } = opts;
  const taskId = await createTask(task);
  onProgress(`task ${taskId} created (${task.type}), polling...`);
  const start = Date.now();
  // First result usually isn't ready for ~10-20s; give it a beat before polling.
  await sleep(Math.min(pollMs, 8000));
  for (;;) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`2captcha: task ${taskId} not solved within ${timeoutMs / 1000}s`);
    }
    const r = await getTaskResult(taskId);
    if (r.status === 'ready') {
      onProgress(`task ${taskId} solved (cost $${r.cost}, ${r.solveCount} worker(s))`);
      return r.solution;
    }
    onProgress(`task ${taskId} still processing...`);
    await sleep(pollMs);
  }
}

// ---- Convenience task builders -------------------------------------------

// Cloudflare Turnstile. For a standalone widget pass only url+sitekey. For a
// Cloudflare *Challenge* page, also pass action/data/pagedata/userAgent grabbed
// by intercepting turnstile.render (see bb-solve.js). Add a `proxy` object
// { type, address, port, login, password } to use TurnstileTask (proxied).
function turnstileTask({ url, sitekey, action, data, pagedata, userAgent, proxy }) {
  const task = { type: 'TurnstileTaskProxyless', websiteURL: url, websiteKey: sitekey };
  if (action) task.action = action;
  if (data) task.data = data;
  if (pagedata) task.pagedata = pagedata;
  if (userAgent) task.userAgent = userAgent;
  if (proxy) Object.assign(task, {
    type: 'TurnstileTask',
    proxyType: proxy.type, proxyAddress: proxy.address, proxyPort: proxy.port,
    proxyLogin: proxy.login, proxyPassword: proxy.password,
  });
  return task;
}

function recaptchaV2Task({ url, sitekey, invisible, proxy }) {
  const task = {
    type: proxy ? 'RecaptchaV2Task' : 'RecaptchaV2TaskProxyless',
    websiteURL: url, websiteKey: sitekey,
  };
  if (invisible) task.isInvisible = true;
  if (proxy) Object.assign(task, {
    proxyType: proxy.type, proxyAddress: proxy.address, proxyPort: proxy.port,
    proxyLogin: proxy.login, proxyPassword: proxy.password,
  });
  return task;
}

function hcaptchaTask({ url, sitekey, invisible, proxy }) {
  const task = {
    type: proxy ? 'HCaptchaTask' : 'HCaptchaTaskProxyless',
    websiteURL: url, websiteKey: sitekey,
  };
  if (invisible) task.isInvisible = true;
  if (proxy) Object.assign(task, {
    proxyType: proxy.type, proxyAddress: proxy.address, proxyPort: proxy.port,
    proxyLogin: proxy.login, proxyPassword: proxy.password,
  });
  return task;
}

module.exports = {
  solve, createTask, getTaskResult, getBalance,
  turnstileTask, recaptchaV2Task, hcaptchaTask,
};

// ---- CLI ------------------------------------------------------------------
if (require.main === module) {
  (async () => {
    const [cmd, ...rest] = process.argv.slice(2);
    const onProgress = (m) => console.error('[2captcha] ' + m);
    const die = (m) => { console.error('ERROR: ' + m); process.exit(1); };
    try {
      if (cmd === 'balance') {
        console.log(JSON.stringify({ balance: await getBalance() }));
      } else if (cmd === 'turnstile') {
        const [url, sitekey, action, data, pagedata] = rest;
        if (!url || !sitekey) die('usage: turnstile <websiteURL> <sitekey> [action data pagedata]');
        const sol = await solve(turnstileTask({ url, sitekey, action, data, pagedata }), { onProgress });
        console.log(JSON.stringify(sol));
      } else if (cmd === 'recaptcha' || cmd === 'hcaptcha') {
        const args = rest.filter((a) => a !== '--invisible');
        const invisible = rest.includes('--invisible');
        const [url, sitekey] = args;
        if (!url || !sitekey) die(`usage: ${cmd} <websiteURL> <sitekey> [--invisible]`);
        const build = cmd === 'recaptcha' ? recaptchaV2Task : hcaptchaTask;
        const sol = await solve(build({ url, sitekey, invisible }), { onProgress });
        console.log(JSON.stringify(sol));
      } else if (cmd === 'task') {
        const task = JSON.parse(rest[0] || '{}');
        const sol = await solve(task, { onProgress });
        console.log(JSON.stringify(sol));
      } else {
        die('commands: balance | turnstile | recaptcha | hcaptcha | task');
      }
    } catch (e) {
      if (e.isBilling) {
        console.error('ERROR (BILLING): ' + e.message);
        console.error('>> Do NOT work around. Discord Deyao to recharge 2Captcha (per CLAUDE.md).');
        process.exit(2);
      }
      die(e.message);
    }
  })();
}
