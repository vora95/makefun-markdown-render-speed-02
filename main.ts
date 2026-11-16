import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from './parse.js';

type InputCase = { id: string; markdown: string };
const sourceDir = resolve(process.env.MAKEFUN_INPUT_DIR || '/input');
const resultDir = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');
const cases = JSON.parse(readFileSync(join(sourceDir, 'cases.json'), 'utf8')) as InputCase[];
const html = cases.map(({ markdown }) => parse(markdown));
mkdirSync(resultDir, { recursive: true });
writeFileSync(join(resultDir, 'html.json'), JSON.stringify(html), 'utf8');
