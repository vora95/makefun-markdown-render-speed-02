# Markdown renderer

This project is a modified fork of marked 18.1.3, with changes aimed at faster
Markdown rendering. See [NOTICE](NOTICE) for upstream credit and [LICENSE](LICENSE)
for the MIT terms.

Import `parse` from `parse.js` to render a Markdown string. The `main.ts` batch
entry point reads `cases.json` from `MAKEFUN_INPUT_DIR` (default `/input`) and
writes an array of HTML strings to `MAKEFUN_OUTPUT_DIR` (default `/output`).

The parser handles block and inline Markdown, lists, fenced code, tables,
references, raw HTML, and GFM autolinks. Each call parses independently.
