# Markdown renderer

This repository contains a compact, dependency free Markdown to HTML renderer.
Its public entry point is `parse(markdown)` in `parse.js`; it returns the HTML
string for one Markdown input and keeps no state between calls.

## Running the batch driver

`main.ts` reads a JSON array from `cases.json` in the input directory. Each row
has an `id` and a `markdown` property. It writes a JSON array of rendered HTML
strings to `html.json` in the output directory.

```sh
node main.ts
```

The driver defaults to `/input` and `/output`. For local runs, set
`MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` to directories containing the
input and receiving the output. The runtime uses Node built in modules only.

## Attribution and license

This is an independently structured, modified implementation for the
Markdown Render Speed 02 exercise. It is credited as a modified fork of
marked 18.1.3; see [NOTICE](NOTICE) for upstream attribution and [LICENSE](LICENSE)
for the MIT terms.
