# Markdown renderer

A compact, dependency free Markdown renderer for the Markdown Render Speed 02
exercise. Import `parse` from `parse.js` to render one string at a time; each
call creates its own parsing state.

The batch entry point is `main.ts`. It reads `cases.json` from the configured
input directory and writes `html.json` to the configured output directory.
Both paths default to `/input` and `/output` and can be changed for local use
with `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR`.

This implementation is an independently structured and modified fork of
marked 18.1.3. Its per-call parser uses run-length-aware code spans and
independent block and inline scanners. The upstream project and its contributors are credited in
[NOTICE](NOTICE); the MIT terms are in [LICENSE](LICENSE).

Inline delimiter handling, block recognition, and batch input/output plumbing
have been independently adapted for this entry. Parsing state is local to each
call, so rendering one document does not affect the next.
