# Markdown renderer

A modified fork of marked 18.1.3 focused on fast Markdown rendering. Upstream
credit and license details are in [NOTICE](NOTICE); this project is distributed
under the MIT License in [LICENSE](LICENSE).

Import `parse` from `parse.js` to render a Markdown string. The batch entry
point `main.ts` reads `cases.json` from `MAKEFUN_INPUT_DIR` (default `/input`)
and writes rendered HTML to `MAKEFUN_OUTPUT_DIR` (default `/output`).

The parser supports CommonMark blocks and inline constructs, reference links,
fenced code, lists, tables, raw HTML, and GFM autolinks. Parsing state is local
to each call.
