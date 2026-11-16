# Markdown render speed 02

A dependency-free Markdown renderer and entrypoint for the make.fun Markdown rendering bounty. `parse.js` exports `parse(markdown)`; `main.ts` renders the input case array to `html.json`.

This project is a modified, performance-focused fork of marked 18.1.3. The fork retains the MIT licensing and attribution required for portions derived from marked; see [NOTICE](NOTICE) and [LICENSE](LICENSE).

[![make.fun](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/vora95/makefun-markdown-render-speed-02/rank.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/vora95/makefun-markdown-render-speed-02/reward.svg)](https://make.fun/bounty/markdown-render-speed-02)

## Usage

Run `node main.ts`. Set `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` to select input and output directories; defaults are `/input` and `/output`. The input directory must contain `cases.json` with objects containing `markdown` strings.

## License

MIT. The renderer is a credited and modified marked fork; see NOTICE for upstream attribution.
