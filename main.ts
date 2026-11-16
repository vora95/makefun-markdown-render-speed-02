// Batch entry point for the make.fun markdown-render-speed-02 bounty.
//
// Reads every case from `cases.json` in MAKEFUN_INPUT_DIR (default `/input`),
// renders each Markdown string with `parse` from `./parse.js`, and writes the
// resulting HTML strings as a JSON array to `html.json` in MAKEFUN_OUTPUT_DIR
// (default `/output`). Each case is parsed independently; no state is shared
// between cases.
//
// Builder #2 session (16 Nov 2026, recording 01a1e3e1): `parse` is the tuned
// fork at 720/720 on the kit comparator; this entry point is unchanged.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from './parse.js';

type CaseRow = { id: string; markdown: string };

const inputDir = resolve(process.env.MAKEFUN_INPUT_DIR ?? '/input');
const outputDir = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const rows = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8')) as CaseRow[];
const rendered = rows.map(({ markdown }) => parse(markdown));

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'html.json'), JSON.stringify(rendered), 'utf8');
