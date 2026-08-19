---
name: sourced-report
description: Deyao's approved format for a "report with sources" HTML page — warm-paper/burnt-orange research-note layout, numbered Sources panel with badges, clickable citation superscripts, and a floating button that returns to the exact reading position. Use whenever Deyao asks for a report/research writeup "with sources" (deployed to Vercel per the vercel skill).
---

# Sourced report format (Deyao, approved 2026-08-19)

When Deyao asks for a **report with sources**, deliver a self-contained HTML page deployed
to Vercel (see the `vercel` skill — never Claude Artifacts).

**Start from `template.html` in this skill directory — do not design from scratch.**
Deyao explicitly approved this exact layout and palette (originally the China-IPs report,
`de0ch-claude-3d5b71d3.vercel.app`): warm paper background (`#f7f7f5`), burnt-orange accent
(`#b3541e`), kicker + hero header with a hairline border (no gradient banner), numbered
section headings with accent numbers, panel cards, labeled callouts, consent-style
good/warn/bad tags, a Sources panel with per-source badges, and full dark-mode support
(`prefers-color-scheme` + `data-theme` override). Copy the template as `index.html` into
the Vercel project dir, fill in the `{{PLACEHOLDER}}`s, and delete optional components
(flow strip, card stack, tags, callouts) the report doesn't need. Don't invent new styling —
extend the existing tokens if something extra is needed.

## Conventions

- **Primary sources first (Deyao, 2026-08-19):** every load-bearing claim should cite a
  primary source — the legislation/rules themselves, the regulator's own report or data
  page, official media releases, the parliamentary bill record, the original study.
  News articles are for political context and corroboration only; when a news story
  states a fact, hunt down the primary document behind it and cite that instead (the
  news piece can stay as a secondary cite). Gov/First-party badges should dominate the
  Sources panel, not News. Deliberately hunt the deep record classes too (Deyao,
  2026-08-19): cabinet/committee meeting records (e.g. National Cabinet's agreed
  statements are the published "record of meeting outcomes"), court registries for any
  litigation mentioned (e.g. hcourt.gov.au case pages give parties, filing dates,
  grounds, orders), Hansard/committee reports and Bills Digests for legislation, and
  the regulator's own study/report pages rather than coverage of them.

- **Citations:** superscript links `<sup><a href="#s1">1</a></sup>` (no brackets), pointing
  at `<li id="sN">` entries in the Sources panel, numbered in first-appearance order.
- **Source badges:** every source gets one — `Vendor`, `Gov` (`badge gov`), `Peer-reviewed`
  (`badge sec`), `News`, `Industry`, `First-party`. Vendor/marketing claims are reported as
  claims and attributed; independent sources carry the load-bearing facts. Include a short
  method note at the top of the Sources panel and an attribution disclaimer in the footer.
- **Honest scoping:** use the `.disc` box to separate what a source directly states from
  sector context or inference.
- **Mobile — NO tables (Deyao, 2026-08-19):** do not use `<table>` (or any element that
  needs horizontal scrolling or produces cramped multi-column text on a phone). For
  comparisons/matrices use the template's **card stack** (`.cards`/`.card`): one card per
  row-entity, labeled rows inside, verdict tag in the card header — it stacks naturally on
  narrow screens. `.scroll` remains only as a last resort for intrinsically wide content
  like code blocks, never as a way to keep a table; the flow strip wraps via flexbox.

## Back-to-position button (Deyao explicitly required this)

Clicking a citation jumps to the source; a floating **"↩ Back to text"** button must then
appear and, on click, restore the **exact scroll position** captured at the moment the
citation was clicked (`window.scrollX/Y` + `window.scrollTo`). Deyao rejected the
scroll-the-citation-into-view variant — it must be the exact position, not re-centering.
Also: flash-highlight the source entry on jump and the origin paragraph on return, and
clean the `#sN` hash afterwards so refresh/back doesn't re-jump. The full markup, CSS,
and script are in `template.html` (bottom of the file) — keep them verbatim; the script
auto-binds to all `sup a[href^="#s"]` links.

## Load the design skills before writing (like the original author did)

The session that produced the approved report loaded the design guidance skills before
writing the HTML (its theme-token / dark-mode structure matches the `artifact-design`
patterns exactly). Do the same: **before writing or meaningfully extending the report
page, load `artifact-design`**, and additionally load **`dataviz` if the report includes
any chart/graph/plot** (the template has no chart component — dataviz governs any you
add) and **`artifact-diagramming` if you add a diagram beyond the template's flow strip**.
The template already encodes the layout, but these skills govern the judgment calls the
template can't: content selection, density, new components, and chart/diagram design.
They're written for Artifacts — apply the design guidance, but the delivery target
remains Vercel, never a Claude Artifact.

## Delivery checklist

1. Research per the web-search skills (currently `serpapi` primary, `exa` for extracted
   content); keep every claim traceable to a source entry.
2. Load `artifact-design` (+ `dataviz` / `artifact-diagramming` if charts/diagrams),
   then fill in `template.html`; deploy per the `vercel` skill
   (`de0ch-claude-<sid>` project, `--prod`, verify 200 on the alias).
3. Discord Deyao the alias URL with a TL;DR (lobster bot).
4. End-of-task records to the Hetzner Storage Box as usual.
