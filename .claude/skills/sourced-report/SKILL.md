---
name: sourced-report
description: Conventions for building a "report with sources" HTML page for Deyao — numbered Sources section, clickable citation superscripts, and a floating "back to exact reading position" button. Use whenever Deyao asks for a report/research writeup "with sources" (deployed to Vercel per the vercel skill).
---

# Sourced report conventions (Deyao, 2026-08-19)

When Deyao asks for a **report with sources**, deliver a self-contained HTML page deployed
to Vercel (see the `vercel` skill — never Claude Artifacts) with the following citation UX.
First built for the IPRoyal sourcing report (`de0ch-claude-2c340d13.vercel.app`); Deyao
approved this format explicitly — reuse it.

**Start from `template.html` in this skill directory** — it is the full approved skeleton
(header, TL;DR box, numbered sections in cards, optional stats grid / flow diagram /
blockquote / table components, Sources section, and the required back-button code).
Copy it as `index.html` into the Vercel project dir, fill in the `{{PLACEHOLDER}}`s,
delete unused optional components, and keep the back-button markup/CSS/JS verbatim.
The sections below document the conventions and preserve the key code in case the
template file is unavailable.

## Structure

- Inline citations are superscript links: `<sup><a href="#s8">[8]</a></sup>`, pointing at a
  numbered **Sources** section at the bottom (`<ol class="srcs">` with `<li id="s8">` entries:
  bold source name, short parenthetical of what it supports, link).
- Report vendor/marketing claims as claims (attributed), use independent sources for
  economics/criticism; add a short method note at the end of Sources.

## Back-to-position button (Deyao explicitly asked for this)

Clicking a citation jumps to the source; a floating **"↩ Back to text"** button must then
appear and, on click, restore the **exact scroll position** captured at the moment the
citation was clicked (`window.scrollX/Y` + `window.scrollTo`). Deyao rejected the
scroll-the-citation-into-view variant — it must be the exact position, not re-centering.
Also: flash-highlight the source entry on jump and the origin paragraph on return, and
clean the `#sN` hash afterwards so refresh/back doesn't re-jump.

Proven implementation (drop in verbatim):

```html
<button id="backbtn" type="button" aria-label="Back to where you were reading">↩ Back to text</button>
```

```css
#backbtn {
  position: fixed; bottom: 1.4rem; right: 1.4rem; z-index: 50;
  display: none; align-items: center; gap: .45rem;
  background: var(--accent); color: #fff; border: none; border-radius: 999px;
  padding: .65rem 1.1rem; font: 600 .9rem/1 inherit; font-family: inherit;
  cursor: pointer; box-shadow: 0 4px 16px rgba(70, 36, 122, .35);
}
#backbtn.show { display: inline-flex; }
.flash { animation: flashbg 1.6s ease-out; }
@keyframes flashbg {
  0%, 40% { background: #efe2ff; box-shadow: 0 0 0 4px #efe2ff; border-radius: 6px; }
  100% { background: transparent; box-shadow: none; }
}
```

```js
(function () {
  var backBtn = document.getElementById('backbtn');
  var origin = null;

  function flash(el) {
    el.classList.remove('flash');
    void el.offsetWidth; // restart animation
    el.classList.add('flash');
  }

  document.querySelectorAll('sup a[href^="#s"]').forEach(function (a) {
    a.addEventListener('click', function () {
      origin = { x: window.scrollX, y: window.scrollY, el: a };
      backBtn.classList.add('show');
      var target = document.getElementById(a.getAttribute('href').slice(1));
      if (target) flash(target);
    });
  });

  backBtn.addEventListener('click', function () {
    if (!origin) return;
    backBtn.classList.remove('show');
    window.scrollTo({ left: origin.x, top: origin.y, behavior: 'smooth' });
    var para = origin.el.closest('li, p, blockquote, td, .cap') || origin.el;
    flash(para);
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
    origin = null;
  });
})();
```

## Delivery checklist

1. Research with the `exa` skill; keep every claim traceable to a source entry.
2. Build the page with the citation UX above; deploy per the `vercel` skill
   (`de0ch-claude-<sid>` project, `--prod`, verify 200 on the alias).
3. Discord Deyao the alias URL with a TL;DR (lobster bot).
4. End-of-task records to the Hetzner Storage Box as usual.
