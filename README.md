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
