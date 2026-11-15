# markdown-render-speed-02

Fast drop-in replacement for marked 18.1.3 — entry for the make.fun bounty
[Make Markdown rendering faster](https://make.fun/bounty/markdown-render-speed-02).

`parse.js` is a dependency-free ES module whose `parse(markdown)` returns
exactly the HTML that marked 18.1.3 returns with default options, byte for
byte, on all 720 cases (CommonMark 0.31.2 + GFM 0.29 spec examples and 40
generated READMEs). `main.ts` renders every case from `/input/cases.json` and
writes `/output/html.json`.

## License

MIT
