import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const sourceDir = process.env.MAKEFUN_INPUT_DIR || '/input';
const resultDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
const documents = JSON.parse(readFileSync(join(sourceDir, 'cases.json'), 'utf8')) as Array<{ id: string; markdown: string }>;
const rendered = documents.map(({ markdown }) => parse(markdown));
writeFileSync(join(resultDir, 'html.json'), JSON.stringify(rendered));
