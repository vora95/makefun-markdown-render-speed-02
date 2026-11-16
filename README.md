# Markdown renderer

A dependency free Markdown renderer for the Markdown Render Speed 02 exercise.
Import `parse` from `parse.js` to render one string at a time. Each call builds
fresh block, link, and inline delimiter state; no rendered result is cached.

The batch entry point is `main.ts`. It reads `cases.json` from the configured
input directory and writes `html.json` to the configured output directory. Both
paths default to `/input` and `/output` and can be changed for local use with
`MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR`.

The parser has independent scanners for block structure, lists, quotes, fences,
and inline tokens. HTML block endings preserve whitespace-only following lines
after self-terminating constructs, while tag blocks trim those separators. Bare
and angle autolinks percent-encode backslashes in their destinations. Its inline pass pairs emphasis delimiter runs, parses links
and images, and handles entities, raw tags, and GFM autolinks. The practice
comparison reports compatibility by CommonMark/GFM section and generated
document. The implementation is informed by marked 18.1.3; upstream credit is
in [NOTICE](NOTICE), and the MIT terms are in [LICENSE](LICENSE).
