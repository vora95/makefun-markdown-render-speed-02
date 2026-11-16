import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from './parse.js';

interface MarkdownCase { id: string; markdown: string }

function directory(variable: string, fallback: string): string {
  const configured = process.env[variable];
  return resolve(configured && configured.length ? configured : fallback);
}

function renderBatch(): void {
  const inputFile = resolve(directory('MAKEFUN_INPUT_DIR', '/input'), 'cases.json');
  const outputFile = resolve(directory('MAKEFUN_OUTPUT_DIR', '/output'), 'html.json');
  const cases = JSON.parse(readFileSync(inputFile, 'utf8')) as MarkdownCase[];
  const html: string[] = new Array(cases.length);

  for (let index = 0; index < cases.length; index++) {
    html[index] = parse(cases[index].markdown);
  }

  mkdirSync(directory('MAKEFUN_OUTPUT_DIR', '/output'), { recursive: true });
  writeFileSync(outputFile, JSON.stringify(html), 'utf8');
}

renderBatch();
