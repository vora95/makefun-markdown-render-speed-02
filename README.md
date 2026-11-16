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
