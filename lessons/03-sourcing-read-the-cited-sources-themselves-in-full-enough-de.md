## Sourcing: READ the cited sources themselves, in full enough depth (Deyao, 2026-08-23)

Standing rule: whenever a report cites a source, actually read that source's own text
before publishing — not just the search-result snippet, an aggregator's paraphrase, or
the first screenful an API fetch returned. Mechanics that work: fetch the page via
`exa contents` with a LARGE `maxCharacters` (default helper output truncates at ~1-2.5k
chars — that's an abstract, not the paper), then grep the fetched text for each specific
claim the report makes and read the surrounding context; a claim whose keywords aren't in
the fetched text gets reworded to what the text actually says, or dropped. War story
(mech-interp report, 2026-08-23): truncated first-pass reads let two unsupported claims
through — a "satisfying insight on only a fraction of prompts" paraphrase the paper didn't
say (it says the method "captures a fraction of the total computation" and case studies
are selected successes), and a "field publishes on blogs not peer review" point attributed
to the Open Problems paper whose text contains no such discussion. A systematic
grep-verify pass over full-text fetches caught both before Deyao did.
