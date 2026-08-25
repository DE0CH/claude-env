---
name: china-number-parking
description: Keep a Chinese mobile number (+86) alive and usable from abroad over the internet — receive its SMS/calls and place genuine +86-origin calls into China — via carrier "number parking" apps (China Mobile 无忧行/JegoTrip; Unicom/Telecom equivalents). Use for any task about staying reachable on a Chinese number overseas, receiving Chinese SMS OTPs abroad (Alipay/WeChat/bank/12306/政务), calling Chinese numbers so the recipient sees a real +86, or "cheap international calls to China / Skype replacement" questions involving China.
---

# Keeping a Chinese number alive from abroad (号码托管 / number parking)

## The core question this answers
"How do I receive my Chinese SMS codes / calls abroad, and call Chinese numbers so they
see a genuine +86 — over the internet, cheaply?" The answer is carrier **number parking**,
NOT any third-party VoIP.

## What does NOT work (rule these out fast)
- **Showing a +86 caller ID to a +86 recipient via any foreign VoIP** (Google Voice, Yolla,
  Viber Out, WeChat Out, DID providers like AVOXI/FlyNumber/CloudTalk): this is "China-to-China
  local mimicry"/CLI spoofing, **explicitly prohibited and blocked** by Chinese carriers under
  the Anti-Telecom Fraud Law (2022) + amended Cybersecurity Law (2026). Only a genuine +86
  origin passes.
- **WeChat Out**: only for accounts OUTSIDE mainland China; HK accounts can't call mainland at
  all; shows WeChat's gateway number, not your +86. Just another foreign terminator.
- **Mainland-carrier native VoWiFi while roaming abroad**: generally unsupported (CMHK: no
  IDD/roaming); China also blocks inbound VoWiFi sessions. Don't rely on it.
- **GOIP / SIM-box / "cloud-SIM call termination" grey services**: real but criminalized in
  China (selling/operating GOIP + 两卡 support); strangers' recycled real-name SIMs; fraud-
  investigation exposure. Avoid.

## What DOES work: carrier number parking
**China Mobile 无忧行 (intl name JegoTrip)** — made by China Mobile International (CMI, the HK
subsidiary), NOT the domestic 中国移动/10086 app. It's an obscure second-tier app (~28M users
2019, not top-30 travel apps 2024) because it's purely an outbound/overseas tool — domestic
life never surfaces it. Unicom = 沃行讯通; Telecom has its own. Mobile's is the most polished.

### Mechanism (号码托管)
1. Have a **real, real-name-registered, ACTIVE, paid** China Mobile number (cheap ¥8/month
   保号-style plan works).
2. Insert SIM once, log into 无忧行 (移动 users: 本机号码一键登录), enable 号码托管.
3. **Then remove the physical SIM — permanently.** After setup the app is authenticated by an
   app login (password/device session, SMS OTP), NOT by the SIM's cryptographic secure element.
   Two DIFFERENT senses of "identity", do not conflate them:
   - **SIM technical identity (IMSI + Ki cryptographic auth): gone.** You genuinely don't need a
     SIM anymore; the strong hardware-rooted identity is replaced by a "flimsy" app account. This
     is a real SECURITY DOWNGRADE — the +86 (master key to Alipay/bank/WeChat) is now only as
     strong as that app password.
   - **Carrier real-name registration (legal record) + active PAID subscription: still required.**
     The number must stay active; 停机/停机保号 breaks forwarding. This is a database record, not
     the SIM. It is not anonymous in the legal sense, but it is SIM-crypto-free in the technical
     sense. (Earlier sessions wrongly said "more identity-bound than a SIM" by conflating these.)

### Costs / what's free
- **Receiving calls + SMS abroad: FREE** — traffic rides the internet to the app, so it's billed
  "视同在大陆境内" (as domestic), and domestic incoming is free. This is the killer feature
  (bank/Alipay/WeChat/12306/政务 OTPs land free anywhere).
- **Outbound calls to China: NOT free** — 100 free minutes on signup (any operator qualifies),
  then paid 语音包 (voice packages) at domestic-ish rates. Recipient sees your genuine +86.
- **You still pay**: the monthly line fee, and for **your own data/Wi-Fi** at your end (the app
  needs connectivity — in practice carry a local SIM/eSIM for data + park the +86 in 无忧行).
  Note: the outbound cost is a DOMESTIC charge, NOT an international fee.
- **NOT the same billing outcome as Western Wi-Fi Calling** (don't repeat this earlier error).
  Western VoWiFi virtualizes you onto your HOME network: calling a home-country number is domestic,
  but calling any FOREIGN number (incl. China) is still billed international even over Wi-Fi.
  无忧行 instead virtualizes your +86 as if the handset were physically IN China, so a call to a
  Chinese number is a plain domestic-China call and incoming is free — there is NO international
  leg at all. It's not "cheap international calling", it's "your number teleported home." The
  shared idea with VoWiFi is only the delivery mechanism (voice over IP, no radio-roaming leg),
  not the billing.

### Why it's the legitimate +86-origin path
The call genuinely originates from your own real SIM/subscription via the carrier's own
VoWiFi/callback plumbing — carrier-whitelisted, so it isn't caught by anti-fraud filters the way
a DIY GOIP rig (SIM never moves towers / all-internet backhaul → 停机 + in-person re-verify) is.

## Also for personal contacts
Plain **WeChat/QQ app-to-app voice call** is free, both directions, no caller ID needed — best
for people who have WeChat. Number parking is for OTPs and calling actual phone numbers.

## General cheap-call-to-any-phone (non-China-CLI) Skype replacements
Skype shut down 5 May 2025. Google Voice (cheapest, free US/CA, US-number signup), Viber Out,
Yolla, MobileVOIP/Betamax, BOSS Revolution, Zoom Phone. China ~2.5-7c/min but China-terminated
VoIP is increasingly blocked regardless of price.

## Sources
China Mobile 10086.cn (无忧行 listed as official roaming channel; 国际漫游99语音包);
baike.baidu.com/item/无忧行 (号码托管 core tech, scale); hsu.cy/2025/10/cm-number-parking;
uscardforum.com/t/topic/251216; AVOXI China outbound restrictions; FlyNumber China limits;
cs.help.wechat.com (WeChat Out limits); cmi.chinamobile.com (CMI/CMLink).
