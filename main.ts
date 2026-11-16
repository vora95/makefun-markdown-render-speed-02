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
