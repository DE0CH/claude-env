## UN Inspira (PeopleSoft) application automation (2026-08-25, JO 282452)

Full mechanics distilled into the `inspira` skill — read that first. Highlights: all
content lives in iframe `TargetContent`; every "Add X" opens a stacked `modWin_<n>`
iframe that often only attaches AFTER the clicking CDP process disconnects (click in one
short process, sleep ~20s, reconnect fresh); main-page fields set via JS `.value` +
synthetic events silently DON'T persist (PeopleSoft posts only tracker-marked fields —
use Playwright native click+fill), while modWin modal fields save fine either way; the
university name is a country-filtered lookup and the Degree/Diploma select only offers
Bachelor's/Master's/… AFTER an accredited institution is picked; the wizard blocks
leaving Experience/References until 3 references exist, but happily reaches Review/Submit
with zero education/languages (which would get the application rejected per the posting).
Login is plain #userid/#pwd, no captcha/2FA. careers.un.org job pages are Angular —
click "Expand All" then read innerText.
