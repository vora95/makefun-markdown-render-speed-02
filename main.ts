import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from './parse.js';

type CaseRow = { id: string; markdown: string };

const inputRoot = resolve(process.env.MAKEFUN_INPUT_DIR || '/input');
const outputRoot = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');
const rows = JSON.parse(readFileSync(join(inputRoot, 'cases.json'), 'utf8')) as CaseRow[];
// Render sequentially with independent parser state and a stable input order.
const rendered: string[] = new Array(rows.length);
for (let index = 0; index < rows.length; index++) rendered[index] = parse(rows[index].markdown);

mkdirSync(outputRoot, { recursive: true });
writeFileSync(join(outputRoot, 'html.json'), JSON.stringify(rendered), 'utf8');
