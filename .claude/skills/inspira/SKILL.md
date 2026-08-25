---
name: inspira
description: "Drive the UN Inspira recruitment portal (inspira.un.org, PeopleSoft) with Playwright over a Browserbase session — log in, open/resume a job application draft, walk the 7-step application wizard, fill fields/modals (work experience, references, education with institution lookup, languages), and read every page's fields. Use whenever a task involves inspira.un.org, UN job/internship applications, or careers.un.org postings."
compatibility: "Needs Browserbase (browse CLI + playwright via NODE_PATH=$(npm root -g)). Login requires the user's Inspira User ID + password (collect via cf-tunnel drop)."
---

# UN Inspira (PeopleSoft) automation

Proven end-to-end 2026-08-25 on job opening 282452 (internship application draft filled
without submitting). Reference driver scripts from that session: `inspira.js`, `modal.js`,
`walk2.js` (session scratchpad; reconstructible from the archived transcript).

## URLs & login

- Job detail/apply deep link:
  `https://inspira.un.org/psp/PUNA1J/EMPLOYEE/HRMS/c/UN_CUSTOMIZATIONS.UN_JOB_DETAIL.GBL?Action=A&UNAction=Apply&JobOpeningId=<ID>&languageCd=ENG`
  Unauthenticated it renders the login page; after login it redirects to My Applications /
  the apply flow, and **auto-creates a Draft application row** for that job.
- Public posting (no login): `https://careers.un.org/jobSearchDescription/<ID>?lang=en-US`
  (Angular; click "Expand All" then read `document.body.innerText`).
- Login form (top page, not in an iframe): `#userid`, `#pwd`, submit `input[name="Submit"]`.
  No captcha, no 2FA observed. Wrong-password marker: "user id and/or password are invalid".

## Frame layout — the #1 gotcha

- All content renders in iframe `ptifrmtgtframe` (frame name `TargetContent`, URL `/psc/`).
- Every "Add X" sub-form opens as ANOTHER iframe named `modWin_<n>` (ICType=Panel), stacked
  above TargetContent. Always operate on the topmost `modWin_*` frame if one exists, else
  `TargetContent`:
  `page.frames().filter(f => /^modWin_/.test(f.name())).pop() || frames.find(f => f.name()==='TargetContent')`
- **Modal frames often attach only AFTER the clicking Node process disconnects** (CDP
  quirk): click in one short-lived process, sleep 15–25 s in bash, then reconnect with a
  fresh process to interact. Single-process click→wait loops can wait forever.

## PeopleSoft mechanics

- Buttons/links run `submitAction_win0(document.win0, id)`; `element.click()` via
  `frame.evaluate` works. Every click is a server roundtrip (2–10 s) that re-renders the
  DOM — re-query elements after each one, and add retry loops (10×2.5 s) for "element
  missing" right after a roundtrip.
- **Main-page text fields set via JS `.value` + synthetic change events DO NOT PERSIST** —
  PeopleSoft only posts fields its own tracker marked changed. Use Playwright's native
  `frame.click(sel)` + `frame.fill(sel)` (real events) for textareas/inputs on wizard pages,
  then the toolbar Save. Fields inside modWin modals saved via the modal's Save button post
  fine either way.
- Ids contain `$` (e.g. `HRS_APP_OPANS_I_UN_HRS_JFQ_ANS$0`) — escape as `\\$` in CSS
  selectors, or use `getElementById`.
- Save shows a modal "Your in-progress application has been saved but not submitted" —
  dismiss its OK before doing anything else; a lingering `pt_modalMask` intercepts all
  Playwright clicks (JS `.click()` bypasses it, but state may be stuck).
- If you hit "This page is no longer available", click "return to your most recent active
  page"; if the UI stops responding to submitActions entirely (stale ICStateNum), hard-reload
  the apply URL — the draft resumes where it was. Saved data survives; unsaved main-page
  edits don't.
- Date format: dd/mm/yyyy. `input text` uppercases some fields (city).

## Application wizard (internship JO, 7 steps)

Tabs are links `EOTL_WZ_MAINSTEPS#<target>`: `@@RESUME` (Welcome), `UN_HRAM_CE_GRPB_2`
(Job Requirements), `UN_LANGUAGE_TITLE` (Education/Languages), `HRAM_CEPROF_PT13`
(Experience/References), `UN_COVER_LETTER` (Motivation Statement), `UN_FINAL_QUESTIONS`
(Other information), `@@REVIEW_SUBMIT`. Tab navigation validates the CURRENT step first
(e.g. can't leave Experience/References until ≥3 references exist — a modal says so).
Detect current step via `innerText.match(/Step (\d) of 7/)`.

Key element ids (suffix `$0` = row 0):
- Step 4: `HRS_CE_LNK_WRK_ADD_WORK_EXP`, `HRS_CE_LNK_WRK_ADD_REFERENCES`,
  UN-history radios `HRS_CE_WRK_UN_EMPLOYMENT_STAT[...]`; reference modal fields
  `HRS_REFF_SS_VW_*` (name/position/org/email/phone/"how do you know" — all required);
  work-exp modal `HRS_APP_WRK_EXP_*` + `HRS_ADDR_WORK_*`.
- Step 3: `HRS_CE_LNK_WRK_ADD_PRIMARY_EDU`, `HRS_CE_LNK_WRK_HRS_ADD_CONTENT$0` (languages).
  Education modal `UN_HRS_EDU_VW_*`: for University/Tertiary the institution name is a
  **prompt lookup** (`UN_INST_NM_VW_UN_ORG_DESCR$prompt$0` → search page filtered by the
  selected country → click `SEARCH_RESULT1`/`RESULT0$n`), and the "Degree/Diploma" select
  only gets the real degree levels (Bachelor's/Master's/…) AFTER an accredited institution
  is picked — before that it offers only "Certificate/Diploma". Language modal
  `HRS_APPITM02_VW_*`: language + 4 proficiency selects (Basic/Confident/Fluent) + How
  Acquired + mother-tongue checkbox.
- Step 2 answers: textareas `HRS_APP_OPANS_I_UN_HRS_JFQ_ANS$n` (1000 chars) + opt-out
  checkboxes `HRS_APP_OPANS_I_UN_FLAG$n`.
- Step 5: `UN_HRS_OI_RESUME_TEXT$0` (2000 chars).
- Step 6: attachment select `UN_HRS_OI_ATTCH_UN_ATTACHMENT_TYPE$0` + `Add Attachment`;
  vetting radio groups `UN_HRS_OI_YESNO_DROPDOWN*` (criminal), `UN_HRS_APP_SEA_YESNO_*`
  (sexual exploitation/abuse), `UN_UNS_WRKPLC_*`/`UN_NUNS_WRKPLC_*` (disciplinary),
  `UN_APP_MISC_Q_YESNO_DROPDOWN3*` (NCRE/G-to-P/YPP); nationality selects pre-filled from
  profile.
- Step 7 Review/Submit: buttons `value="Submit Application"` (top+bottom). The review page
  does NOT render the step-2/step-5 free-text answers — verify those on their own pages,
  not by grepping the review.

## Wizard traps

- The wizard resumes at the furthest-saved step, not Welcome.
- "I do not meet this criterion"/"No" checkboxes on eliminatory Job Requirements questions
  reject the application if left checked — real applications need the textareas filled.
- Education/Languages has NO hard gate — the wizard reaches Review/Submit with zero
  education/language rows, but the posting text warns the application is rejected without
  the required language fluency. Don't rely on validation to catch omissions.
