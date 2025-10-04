#!/usr/bin/env node
// Batch-compare Mermaid (official) vs Maid (experimental) renderer outputs
// for all valid fixtures across supported types. Produces both SVG and PNG
// for each renderer and writes a structural diff summary per diagram.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { renderMermaid } from '../out/renderer/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPPORTED = ['flowchart', 'pie', 'sequence', 'class', 'state'];

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function runMermaidCliSVG(inputPath, outSvg) {
  try {
    const puppeteerCfg = path.resolve(__dirname, 'puppeteer-ci.json');
    const pFlag = fs.existsSync(puppeteerCfg) ? ` -p "${puppeteerCfg}"` : '';
    execSync(`npx @mermaid-js/mermaid-cli${pFlag} -i "${inputPath}" -o "${outSvg}"`, {
      stdio: 'pipe',
      encoding: 'utf8',
      cwd: path.resolve(__dirname, '..'),
      timeout: 12000,
    });
    return fs.readFileSync(outSvg, 'utf8');
  } catch (e) {
    return '';
  }
}

function writePngFromSvg(svg, outPng) {
  // Prefer resvg if available (bundled as dev dep); fallback to system tools
  try {
    const { Resvg } = require('@resvg/resvg-js');
    const r = new Resvg(svg, { background: 'white' });
    const png = r.render().asPng();
    fs.writeFileSync(outPng, png);
    return true;
  } catch {
    // fallback via temp svg
    const tmpSvg = outPng.replace(/\.png$/i, '.tmp.svg');
    fs.writeFileSync(tmpSvg, svg, 'utf8');
    try {
      execSync(`rsvg-convert -o "${outPng}" "${tmpSvg}" 2>/dev/null`, { stdio: 'pipe' });
      fs.unlinkSync(tmpSvg);
      return true;
    } catch {}
    try {
      execSync(`convert "${tmpSvg}" "${outPng}" 2>/dev/null`, { stdio: 'pipe' });
      fs.unlinkSync(tmpSvg);
      return true;
    } catch {
      return false;
    }
  }
}

function summarize(svg) {
  const count = (re) => (svg.match(re) || []).length;
  const fills = Array.from(svg.matchAll(/\sfill=\"([^\"]+)\"/g)).map(m => m[1]);
  const strokes = Array.from(svg.matchAll(/\sstroke=\"([^\"]+)\"/g)).map(m => m[1]);
  const uniq = (arr) => Array.from(new Set(arr));
  const viewBox = (svg.match(/viewBox=\"([^\"]+)\"/) || [])[1] || '';
  return {
    tags: {
      path: count(/<path\b/g),
      rect: count(/<rect\b/g),
      circle: count(/<circle\b/g),
      line: count(/<line\b/g),
      polyline: count(/<polyline\b/g),
      text: count(/<text\b/g),
      g: count(/<g\b/g),
      marker: count(/<marker\b/g),
    },
    colors: {
      fills: uniq(fills).slice(0, 64),
      strokes: uniq(strokes).slice(0, 64),
    },
    viewBox,
  };
}

function diffSummary(a, b) {
  const tagDiff = {};
  for (const k of Object.keys(a.tags)) tagDiff[k] = (b.tags[k] || 0) - (a.tags[k] || 0);
  const onlyA = (arrA, arrB) => arrA.filter(x => !arrB.includes(x));
  return {
    tagDelta: tagDiff,
    fills: {
      onlyMermaid: onlyA(a.colors.fills, b.colors.fills),
      onlyMaid: onlyA(b.colors.fills, a.colors.fills),
    },
    strokes: {
      onlyMermaid: onlyA(a.colors.strokes, b.colors.strokes),
      onlyMaid: onlyA(b.colors.strokes, a.colors.strokes),
    },
    viewBoxA: a.viewBox,
    viewBoxB: b.viewBox,
  };
}

async function compareOne(type, file, outRoot) {
  const fixturesDir = path.resolve(__dirname, '..', 'test-fixtures', type, 'valid');
  const abs = path.join(fixturesDir, file);
  const base = path.basename(file, '.mmd');
  const outDir = path.join(outRoot, type, base);
  ensureDir(outDir);

  // Mermaid SVG + PNG
  const merSvgPath = path.join(outDir, `${base}.mermaid.svg`);
  const merPngPath = path.join(outDir, `${base}.mermaid.png`);
  const merSvg = runMermaidCliSVG(abs, merSvgPath);
  if (merSvg) writePngFromSvg(merSvg, merPngPath);

  // Maid SVG + PNG
  const text = fs.readFileSync(abs, 'utf8');
  const { svg: maidSvg } = renderMermaid(text);
  const maidSvgPath = path.join(outDir, `${base}.maid.svg`);
  const maidPngPath = path.join(outDir, `${base}.maid.png`);
  fs.writeFileSync(maidSvgPath, maidSvg, 'utf8');
  writePngFromSvg(maidSvg, maidPngPath);

  // Structural summaries
  const sMer = summarize(merSvg);
  const sMaid = summarize(maidSvg);
  const diff = diffSummary(sMer, sMaid);
  fs.writeFileSync(path.join(outDir, 'summary.mermaid.json'), JSON.stringify(sMer, null, 2));
  fs.writeFileSync(path.join(outDir, 'summary.maid.json'), JSON.stringify(sMaid, null, 2));
  fs.writeFileSync(path.join(outDir, 'diff.json'), JSON.stringify(diff, null, 2));

  return { type, file, outDir, diff };
}

async function main() {
  const args = process.argv.slice(2);
  const typeArg = args[0] && !args[0].startsWith('--') ? args[0] : 'all';
  const types = typeArg === 'all' ? SUPPORTED : [typeArg];
  for (const t of types) {
    if (!SUPPORTED.includes(t)) {
      console.error(`Unsupported type: ${t}`);
      process.exit(1);
    }
  }
  const repoRoot = path.resolve(__dirname, '..');
  const outRoot = path.join(repoRoot, '.tmp-compare-all');
  ensureDir(outRoot);

  const report = [];
  for (const type of types) {
    const validDir = path.join(repoRoot, 'test-fixtures', type, 'valid');
    const files = fs.readdirSync(validDir).filter(f => f.endsWith('.mmd')).sort();
    console.log(`Comparing ${files.length} ${type} diagram(s)…`);
    for (const file of files) {
      const r = await compareOne(type, file, outRoot);
      report.push(r);
      console.log(` - ${type}/${file}: wrote ${path.relative(repoRoot, r.outDir)}`);
    }
  }

  // Write a top-level report
  const index = {
    generatedAt: new Date().toISOString(),
    items: report.map(r => ({ type: r.type, file: r.file, outDir: path.relative(repoRoot, r.outDir), diff: r.diff }))
  };
  fs.writeFileSync(path.join(outRoot, 'REPORT.json'), JSON.stringify(index, null, 2));
  console.log(`\nDone. See ${path.join(outRoot, 'REPORT.json')} and per-diagram folders.`);
}

main().catch(e => { console.error(e.stack || e.message || String(e)); process.exit(1); });
