import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

type CaseRow = { id: string; markdown: string };
const input = process.env.MAKEFUN_INPUT_DIR || '/input';
const output = process.env.MAKEFUN_OUTPUT_DIR || '/output';
const rows = JSON.parse(readFileSync(join(input, 'cases.json'), 'utf8')) as CaseRow[];
const rendered = rows.map(({ markdown }) => parse(markdown));
mkdirSync(output, { recursive: true });
writeFileSync(join(output, 'html.json'), JSON.stringify(rendered));
