# Markdown renderer

This project is a modified fork of marked 18.1.3, with changes aimed at faster
Markdown rendering. See [NOTICE](NOTICE) for upstream credit and [LICENSE](LICENSE)
for the MIT terms.

Import `parse` from `parse.js` to render a Markdown string. The `main.ts` batch
entry point reads `cases.json` from `MAKEFUN_INPUT_DIR` (default `/input`) and
writes an array of HTML strings to `MAKEFUN_OUTPUT_DIR` (default `/output`).

The parser handles block and inline Markdown, lists, fenced code, tables,
references, raw HTML, and GFM autolinks. Each call parses independently.

## Probe note (16 Nov 2026)

A fresh probe session inside recording `01a1e340` rebuilt the local comparator
from the kit practice set and verified the fork at 680/720 (all 40 generated
documents failing). It extracted two-line minimal repros for doc-01 and doc-03,
and fixed the doc-01 repro: list-item bodies are now rendered in nested context,
so an indented ordered list of any start number can interrupt a paragraph inside
an item, matching marked. Grade stayed 680/720 after the fix; the doc-03 repro
(blockquote lazy-continuation leading spaces) remains open.

## Builder session (16 Nov 2026, recording 01a1e34e)

A builder session raised the comparator grade from 680/720 to 714/720
(680/680 spec cases, 34/40 generated documents). Fixes landed, each verified
against the kit comparator after every change:

- Tilde fences do not dedent content by the fence indent; backtick fences do
  (dedent counts a tab as one column).
- Blockquote content expands only leading tabs; middle tabs stay literal.
- Bare-URL trailing closers use a depth stack clamped at zero, so an unmatched
  `)` early in the URL does not hide the opener the trailing `)` belongs to.
- The marks-collection loop only opens a `<...>` span on a tag-like `<`
  (letter, `!`, `?`, `/`); `x < 1` does not open a span.
- Emphasis mod-3: the check uses the amounts actually consumed in the pair
  (closer `pairAmount`, opener full run length, inner amount from its tag).
  A strong closer spanning an attached inner pair takes its delimiters from
  the end of the run; an em closer, or a pair without an attached inner pair,
  takes them from the start. The inner-pair block does not apply when the
  closer run length is a multiple of three.
- A tilde escaped by an odd run of backslashes is literal, not a delimiter;
  a failed `~` opener emits the whole run as literal text (no retry as a
  smaller run).
- Raw HTML blocks are emitted from the original lines (tabs preserved), and
  the trailing newline is stripped only before a truly empty line, not before
  a whitespace-only line.
- A ticks>=2 code span whose content holds a backtick blocks its link label
  unless the span is immediately followed by the label's closing `]`.
- The pre-pass does not skip a link label's marks when the label holds a
  defined collapsed/full reference (the outer link is blocked, so the label
  renders as text and its emphasis must form).
- `<del>` content inherits the caller's autolink suppression, so a bare URL
  inside a `<del>` inside a link is not autolinked.
- A GFM table body stops at a block-level HTML start (e.g. `<details>`).

Known gaps (6 generated documents still fail): doc-04 (bare URL in a nested
blockquote, context-dependent), doc-08 (three-level nested link with a titled
outer destination; bare-URL autolink spans two URLs), doc-11 and doc-26
(loose/tight propagation in deeply nested lists), doc-19 (fence inside a
blockquote inside a list item), doc-40 (tab in a blockquote paragraph inside
a list item). The `*a**b**c**` / `***a *b*c***` / `*a **b**c***d*`
partial-consumption cases (probe8 N2/N10/N11) remain open; no document
first-diff points at them.

Speed (bench, median of the full 720-case set, same VM): fork ~11.6 s vs
marked ~2.7 s (about 4.3x slower). The plain-paragraph fast path already
exists in `inline`; closing the gap needs the M1–M5 work (fast paths,
regex hoisting, dispatch, tokenizer/delimiter-stack rewrites) and was not
reached in this session.

## Builder #2 session (16 Nov 2026, recording 01a1e3e1)

A second builder session raised the comparator grade from 715/720 to
**720/720 (680/680 spec cases, 40/40 generated documents)** — the
correctness gate is met. Fixes landed, each verified against the kit
comparator after every change:

- Lists (doc-26): a nested-list marker at exactly the content indent is a
  sublist continuation, not a new block (blank-line branch used `>`; now
  `>=`).
- Emphasis (doc-11): the `labelHasDefinedRef` pre-pass now also detects
  defined shortcut references `[text]`, not only full/collapsed refs.
- Blockquote + fence (doc-19): quote fence state tracks char and length
  (a ```` ```json ```` line inside a `~~~~` fence no longer toggles it off);
  a lazy line starting an HTML block (types 1–6) ends the quote.
- Autolink (doc-08): bare-URL values use marked's exact GFM backpedal
  regex until stable; autolink href uses `encodeURI` with the `%25` fix;
  a `www.`-prefixed address is a URL, not an email.
- Tags: `IN_LINK` is set only on `<a ` (literal space) and reset only on
  exact `</a>`, per marked's tag tokenizer.
- Lists, tight items (doc-04, the last failing doc): tight items render
  their tokens concatenated — top-level `<p>` wrappers are stripped
  (`stripTopPara`), and the newline before `</li>` is decided by the kind
  of the last top-level block (`lastKind`: structural blocks keep it,
  paragraphs and raw HTML do not). Verified against a 28-case battery
  (comment/div/fence/heading/quote/nested-list/hr/table endings, tight +
  loose, tasks).

Speed work (all verified 720/720 after each change; A/B on the 40 generated
documents, alternating rounds in one process, median + paired wins):

- Sticky autolink scan + batched literal escaping in `inline`.
- `identifyHtmlBlock` guarded on `<`; paragraph-interrupt regex hoisted.
- Definitions-only first pass (skipped entirely when no `[label]:` line).
- Per-line closures hoisted out of the block loop; final `<li>` replace
  guarded.
- Autolink word-scan (skip the regex for runs without `@`/`www.`/scheme)
  and ASCII fast paths for word/punct/autolink-start.
- Bulk literal runs in the render loop (`plainRunRe` chunk + indexOf-gated
  autolink guard; the scheme guard is a bounded 32-char walk-back).
- Skip the CR replace and tab-expansion map when the source has no CR/tab;
  fence close regexes cached on the item-fence object at open time; manual
  loops for the events/marks searches; a single `consumed` lookup.

Speed (bench, median of the full 720-case set, same shared-CPU VM — absolute
milliseconds vary a lot between runs because the machine is throttled, so
ratios come from same-process alternating rounds): fork ~0.7–1.4 s vs marked
~0.7–1.1 s, **about 1.2–1.3x slower** (bench2 median ratio 1.19–1.32x across
runs; the sequential comparator `--bench` reports 1.58–1.82x, which is
throttling-sensitive). The fork is under the 2.5 s absolute target but still
slower than marked; the remaining gap needs a structural inline/block
tokenizer rewrite (M3/M4), which was judged too risky for the remaining time.
Micro-optimizations attempted and reverted after A/B showed no gain: splitting
the plain-paragraph guard into indexOf/includes checks, a regex-jump pre-pass
for emphasis marks, removing a `marks.slice` allocation, hoisting the
`escapeHtml` map.

Known pre-existing gap (NOT in the 720 set, left alone): `a=b@c.com` — marked
links only `b@c.com`, the fork links `a=b@c.com` (its email local-part class
includes `=`; marked's chunking stops at `=`).
