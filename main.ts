import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from './parse.js';

type CaseRow = { id: string; markdown: string };

const inputRoot = resolve(process.env.MAKEFUN_INPUT_DIR || '/input');
const outputRoot = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');
const rows = JSON.parse(readFileSync(join(inputRoot, 'cases.json'), 'utf8')) as CaseRow[];
// Keep each case independent: parse owns its complete state for this call.
const rendered = rows.map(row => parse(row.markdown));

mkdirSync(outputRoot, { recursive: true });
writeFileSync(join(outputRoot, 'html.json'), JSON.stringify(rendered), 'utf8');
