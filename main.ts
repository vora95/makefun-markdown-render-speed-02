import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from './parse.js';

type CaseRow = { id: string; markdown: string };

const inputRoot = resolve(process.env.MAKEFUN_INPUT_DIR || '/input');
const outputRoot = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');
const rows = JSON.parse(readFileSync(join(inputRoot, 'cases.json'), 'utf8')) as CaseRow[];
// Render in input order and keep parser state isolated to each invocation.
const rendered: string[] = [];
for (const row of rows) rendered.push(parse(row.markdown));

mkdirSync(outputRoot, { recursive: true });
writeFileSync(join(outputRoot, 'html.json'), JSON.stringify(rendered), 'utf8');
