#!/usr/bin/env node

// Unified preview generator for all diagram types.
// - Generates VALID_DIAGRAMS.md (Mermaid block + Maid renderer if supported)
// - Generates INVALID_DIAGRAMS.md (GitHub render attempt + mermaid-cli + maid output + auto-fix previews)
// - Verifies classification parity with mermaid-cli (valid must be VALID, invalid must be INVALID)
// - Verifies that auto-fixed invalid outputs (when changed) are VALID under mermaid-cli
// - Prints per-type timing and a total summary

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// Our experimental renderer (flowchart today). Optional import.
let renderMermaid;
try {
  ({ renderMermaid } = await import('../out/renderer/index.js'));
} catch {
  renderMermaid = undefined;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPPORTED_TYPES = ['flowchart', 'pie', 'sequence', 'class', 'state'];
// Diagram types currently supported by our experimental renderer
const RENDER_SUPPORTED = new Set(['flowchart', 'pie', 'sequence', 'class', 'state']);

function stripAnsi(input) {
  if (!input) return input;
  return input.replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, '');
}

function sanitizeMermaidMessage(input) {
  if (!input) return input;
  let out = input;
  // Normalize node_modules stacks and drop node:internal frames to keep diffs stable
  out = out.replace(/file:\/\/[^\s)]+node_modules\/(.*?):(\d+):(\d+)/g, 'node_modules/$1:$2:$3');
  out = out.replace(/\/(?:[A-Za-z]:)?[^\s)]+node_modules\/(.*?):(\d+):(\d+)/g, 'node_modules/$1:$2:$3');
  out = out.replace(/file:\/\/[A-Za-z]:\\[^\s)]+node_modules\\(.*?):(\d+):(\d+)/g, 'node_modules/$1:$2:$3');
  out = out
    .split(/\r?\n/)
    .filter((line) => !/\s+at\s+.*\(node:internal\//.test(line))
    .join('\n');
  return out;
}

// Reduce mermaid-cli error output to a single canonical message line so previews don't drift
function canonicalizeMermaidError(input) {
  if (!input) return 'INVALID (no message)';
  const s = sanitizeMermaidMessage(String(input));
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // Stable buckets to avoid env-dependent diffs
  const stable = (t) => t.replace(/\s+/g, ' ').trim();
  // Keep explicit "No such shape" messages verbatim (they are stable)
  const noShape = lines.find((l) => /No such shape:/i.test(l));
  if (noShape) return stable(noShape.startsWith('Error:') ? noShape : `Error: ${noShape}`);
  // Keep UnknownDiagramError but shrink to a single stable line
  const unknown = lines.find((l) => /UnknownDiagramError/i.test(l) || /No diagram type detected/i.test(l));
  if (unknown) return 'UnknownDiagramError: No diagram type detected';
  // Everything else → single canonical line
  return 'Syntax error in text';
}

// Choose a safe backtick fence length so inner backticks in content don't break the block.
function codeFence(content, lang = '') {
  const matches = content.match(/`+/g) || [];
  const maxTicks = matches.reduce((m, s) => Math.max(m, s.length), 0);
  const fence = '`'.repeat(Math.max(3, maxTicks + 1));
  const header = lang ? `${fence}${lang}\n` : `${fence}\n`;
  return {
    open: header,
    close: `\n${fence}\n`,
  };
}

function runMermaidCli(filepath) {
  const outSvg = `/tmp/mermaid-cli-${path.basename(filepath)}.svg`;
  try {
    const puppeteerCfg = path.resolve(__dirname, 'puppeteer-ci.json');
    const pFlag = fs.existsSync(puppeteerCfg) ? ` -p "${puppeteerCfg}"` : '';
    const timeoutMs = Number(process.env.PREVIEW_MERMAID_CLI_TIMEOUT_MS || 120000);
    const cmd = `npx @mermaid-js/mermaid-cli${pFlag} -i "${filepath}" -o "${outSvg}"`;
    try {
      execSync(cmd, { stdio: 'pipe', encoding: 'utf8', timeout: timeoutMs, cwd: path.resolve(__dirname, '..') });
    } catch (firstErr) {
      // Retry once (Chromium spin-up flakes); short backoff
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); } catch {}
      execSync(cmd, { stdio: 'pipe', encoding: 'utf8', timeout: timeoutMs, cwd: path.resolve(__dirname, '..') });
    }
  } catch (error) {
    const raw = (error.stderr || error.stdout || error.message || '').toString();
    const msg = canonicalizeMermaidError(raw);
    try { fs.unlinkSync(outSvg); } catch {}
    return { valid: false, message: msg };
  }
  // Inspect SVG even on success: mermaid-cli can render an error page with exit code 0
  try {
    const svg = fs.readFileSync(outSvg, 'utf8');
    const isError = /aria-roledescription\s*=\s*"error"/.test(svg) || /class=\"error-text\"/.test(svg);
    if (isError) {
      const texts = Array.from(svg.matchAll(/<text[^>]*class=\"error-text\"[^>]*>([^<]*)<\/text>/g)).map(m => m[1].trim()).filter(Boolean);
      const message = canonicalizeMermaidError(texts[0] || 'Syntax error in text');
      try { fs.unlinkSync(outSvg); } catch {}
      return { valid: false, message };
    }
    try { fs.unlinkSync(outSvg); } catch {}
    return { valid: true, message: 'VALID' };
  } catch {
    try { fs.unlinkSync(outSvg); } catch {}
    return { valid: false, message: 'INVALID (could not read output SVG)' };
  }
}

function runMermaidCliOnContent(content, suffix = 'tmp') {
  const tmp = `/tmp/maid-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}.mmd`;
  fs.writeFileSync(tmp, content);
  const res = runMermaidCli(tmp);
  try { fs.unlinkSync(tmp); } catch {}
  return res;
}

function runMaid(filepath) {
  try {
    const out = execSync(`node ./out/cli.js "${filepath}"`, {
      stdio: 'pipe',
      encoding: 'utf8',
      cwd: path.resolve(__dirname, '..'),
      timeout: 8000,
    });
    return { valid: true, message: stripAnsi(out.trim() || 'VALID') };
  } catch (error) {
    const raw = ((error.stdout || '') + (error.stderr || '')).toString();
    const repoRoot = path.resolve(__dirname, '..');
    const msg = stripAnsi(raw)
      .replaceAll(repoRoot + '/', '')
      .replaceAll(repoRoot + '\\', '')
      .trim();
    return { valid: false, message: msg || 'INVALID (no message)' };
  }
}

function runMaidAutofixPreview(filepath, level = 'safe') {
  try {
    const flag = level === 'all' ? '--fix=all' : '--fix';
    const out = execSync(`node ./out/cli.js ${flag} --dry-run --print-fixed "${filepath}"`, {
      stdio: 'pipe',
      encoding: 'utf8',
      cwd: path.resolve(__dirname, '..'),
      timeout: 8000,
    });
    return { ok: true, fixed: out.toString() };
  } catch (error) {
    const stdout = (error.stdout || '').toString();
    if (stdout && stdout.trim()) {
      return { ok: true, fixed: stdout };
    }
    const msg = ((error.stderr || '')).toString();
    return { ok: false, fixed: '', error: stripAnsi(msg) };
  }
}

function titleCase(name) {
  return name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ========== VALID PREVIEW (with Maid renderer when supported) ==========

function generateValidPreview(diagramType, { withRenderer = true } = {}) {
  const fixturesDir = path.resolve(__dirname, '..', 'test-fixtures', diagramType);
  const validDir = path.join(fixturesDir, 'valid');
  if (!fs.existsSync(validDir)) {
    throw new Error(`No valid fixtures found for diagram type: ${diagramType}`);
  }
  // Load compat gaps for known divergences with mermaid-cli
  const compatPath = path.join(fixturesDir, 'compat-gaps.json');
  let compat = { diagramType, items: [] };
  if (fs.existsSync(compatPath)) {
    try { compat = JSON.parse(fs.readFileSync(compatPath, 'utf8')); } catch {}
  }
  const compatSet = new Set((compat.items || []).map((it) => typeof it === 'string' ? it : it.file).filter(Boolean));
  const repoRoot = path.resolve(__dirname, '..');
  const files = fs.readdirSync(validDir).filter(f => f.endsWith('.mmd')).sort();

  // Check classification with mermaid-cli & maid
  const mismatches = [];
  const results = files.map((file, index) => {
    const abs = path.join(validDir, file);
    const rel = path.relative(repoRoot, abs);
    const mer = runMermaidCli(rel);
    const ours = runMaid(rel);
    if (!mer.valid && !compatSet.has(file)) {
      mismatches.push({ file, tool: 'mermaid-cli', message: mer.message });
    }
    if (!ours.valid) {
      // In some suites we allow differences, but for previews demand VALID
      mismatches.push({ file, tool: 'maid', message: ours.message });
    }
    return { file, index, path: rel, mer, ours };
  });

  const supportedByRenderer = RENDER_SUPPORTED.has(diagramType) && withRenderer && typeof renderMermaid === 'function';
  let md = `# Valid ${titleCase(diagramType)} Diagrams\n\n` +
           (supportedByRenderer
             ? `This file contains all valid ${diagramType} test fixtures rendered with both Mermaid and our Maid renderer.\n\n`
             : `This file contains all valid ${diagramType} test fixtures rendered with Mermaid.\n\n`) +
           `> **Note**: This file is auto-generated by \`scripts/generate-previews.js\`. Do not edit manually.\n\n` +
           (supportedByRenderer
             ? `## Renderer Comparison\n\n| Renderer | Description |\n|----------|-------------|\n| **Mermaid** | Official Mermaid.js renderer (GitHub/mermaid-cli) |\n| **Maid** | Our experimental renderer (only for supported types) |\n\n`
             : '') +
           `## Table of Contents\n\n`;
  files.forEach((f, i) => { md += `${i + 1}. [${f.replace('.mmd','').replace(/-/g,' ')}](#${i + 1}-${f.replace('.mmd','').toLowerCase()})\n`; });
  md += `\n---\n\n`;

  const renderedDir = path.join(fixturesDir, 'rendered');
  fs.mkdirSync(renderedDir, { recursive: true });

  for (const { file, index } of results) {
    const filePath = path.join(validDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const title = titleCase(file.replace('.mmd','').replace(/-/g,' '));
    md += `## ${index + 1}. ${title}\n\n`;
    md += `📄 **Source**: [\`${file}\`](./valid/${file})\n\n`;
    if (supportedByRenderer) {
      md += `### Rendered Output\n\n<table>\n<tr>\n<th width=\"50%\">Mermaid (Official)</th>\n<th width=\"50%\">Maid (Experimental)</th>\n</tr>\n<tr>\n<td>\n\n`;
      {
        const f = codeFence(content, 'mermaid');
        md += `${f.open}${content}${f.close}\n`;
      }
      md += `</td>\n<td>\n\n`;
      try {
        const res = renderMermaid(content);
        const unsupported = Array.isArray(res?.errors) && res.errors.some(e => e?.code === 'UNSUPPORTED_TYPE');
        if (!unsupported && res?.svg) {
          const svgFile = file.replace('.mmd', '.svg');
          fs.writeFileSync(path.join(renderedDir, svgFile), res.svg);
          md += `<img src=\"./rendered/${svgFile}\" alt=\"Maid Rendered Diagram\" />\n\n`;
        } else {
          md += `<sub>⚠️ Rendering not yet implemented for this diagram type</sub>\n\n`;
        }
      } catch (e) {
        md += `<sub>❌ Rendering failed: ${String(e?.message || e)}</sub>\n\n`;
      }
      md += `</td>\n</tr>\n</table>\n\n`;
    } else {
      // Mermaid-only block
      md += `### Rendered Output (Mermaid)\n\n`;
      {
        const f = codeFence(content, 'mermaid');
        md += `${f.open}${content}${f.close}`;
      }
    }
    md += `<details>\n<summary>View source code</summary>\n\n\`\`\`\n${content}\n\`\`\`\n</details>\n\n---\n\n`;
  }

  return { markdown: md, mismatches };
}

// ========== INVALID PREVIEW (with mermaid/maid outputs + auto-fix) ==========

function generateInvalidPreview(diagramType) {
  const fixturesDir = path.resolve(__dirname, '..', 'test-fixtures', diagramType);
  const invalidDir = path.join(fixturesDir, 'invalid');
  if (!fs.existsSync(invalidDir)) {
    throw new Error(`No invalid fixtures found for diagram type: ${diagramType}`);
  }
  // Optional allowlist for known CI flakes or mermaid-cli disagreements on auto-fix validation
  const invalidCompatPath = path.join(fixturesDir, 'invalid-compat.json');
  let invalidCompat = { items: [] };
  if (fs.existsSync(invalidCompatPath)) {
    try { invalidCompat = JSON.parse(fs.readFileSync(invalidCompatPath, 'utf8')); } catch {}
  }
  const invalidCompatSet = new Set((invalidCompat.items || []).map((x) => typeof x === 'string' ? x : x.file));
  const repoRoot = path.resolve(__dirname, '..');
  const files = fs.readdirSync(invalidDir).filter(f => f.endsWith('.mmd')).sort();

  const rows = files.map((file, index) => {
    const abs = path.join(invalidDir, file);
    const rel = path.relative(repoRoot, abs);
    const mermaidRes = runMermaidCli(rel);
    const maidRes = runMaid(rel);
    const fixSafe = runMaidAutofixPreview(rel, 'safe');
    const fixAll = runMaidAutofixPreview(rel, 'all');
    const orig = fs.readFileSync(abs, 'utf8');
    const normalize = (s) => (s || '').toString().replace(/\r\n/g, '\n').trim();
    const safeChanged = fixSafe.ok && normalize(fixSafe.fixed) && normalize(fixSafe.fixed) !== normalize(orig);
    const allChanged = fixAll.ok && normalize(fixAll.fixed) && normalize(fixAll.fixed) !== normalize(orig);
    const mmSafe = safeChanged ? runMermaidCliOnContent(fixSafe.fixed, 'safe') : { valid: false };
    const mmAll = allChanged ? runMermaidCliOnContent(fixAll.fixed, 'all') : { valid: false };
    return { file, index, rel, mermaidRes, maidRes, fixSafe, fixAll, safeChanged, allChanged, mmSafe, mmAll };
  });

  let md = `# Invalid ${titleCase(diagramType)} Diagrams\n\n` +
           `This file contains invalid ${diagramType} test fixtures with:\n- GitHub render attempts\n- Error from mermaid-cli\n- Error/output from our linter\n\n> Note: Auto-generated by \`scripts/generate-previews.js\`. Do not edit manually.\n\n## Table of Contents\n\n`;
  rows.forEach(({ file, index }) => {
    const name = file.replace('.mmd','').replace(/-/g,' ');
    md += `${index + 1}. [${titleCase(name)}](#${index + 1}-${file.replace('.mmd','').toLowerCase()})\n`;
  });
  md += `\n---\n\n`;

  // Summary table
  md += `## Summary\n\n`;
  md += `| # | Diagram | mermaid-cli | maid | Auto-fix? |\n|---:|---|:---:|:---:|:---:|\n`;
  rows.forEach(({ file, index, mermaidRes, maidRes, safeChanged, allChanged, mmSafe, mmAll }) => {
    const anchor = `#${index + 1}-${file.replace('.mmd','').toLowerCase()}`;
    const mm = mermaidRes.valid ? 'VALID' : 'INVALID';
    const us = maidRes.valid ? 'VALID' : 'INVALID';
    let fixCol = '—';
    if (safeChanged) fixCol = (mmSafe.valid ? '✅ safe' : '❌ safe');
    else if (allChanged) fixCol = (mmAll.valid ? '✅ all' : '❌ all');
    md += `| ${index + 1} | [${file.replace('.mmd','').replace(/-/g,' ')}](${anchor}) | ${mm} | ${us} | ${fixCol} |\n`;
  });
  md += `\n---\n\n`;

  // Details sections
  const fixFailures = [];
  rows.forEach(({ file, index, rel, mermaidRes, maidRes, fixSafe, fixAll, safeChanged, allChanged }) => {
    const abs = path.resolve(__dirname, '..', rel);
    const content = fs.readFileSync(abs, 'utf8');
    const title = titleCase(file.replace('.mmd','').replace(/-/g,' '));
    md += `## ${index + 1}. ${title}\n\n`;
    md += `📄 **Source**: [\`${file}\`](./invalid/${file})\n\n`;

    md += `### GitHub Render Attempt\n\n> **Note**: This invalid diagram may not render or may render incorrectly.\n\n`;
    md += `\`\`\`mermaid\n${content}\n\`\`\`\n\n`;

    // Side-by-side comparison table for error messages
    md += `### Error Comparison: mermaid-cli vs maid\n\n`;
    md += `<table>\n<tr>\n`;
    md += `<th width="50%">mermaid-cli</th>\n`;
    md += `<th width="50%">maid</th>\n`;
    md += `</tr>\n<tr>\n`;

    // mermaid-cli column
    md += `<td valign="top">\n\n`;
    md += `**Result**: ${mermaidRes.valid ? '✅ VALID' : '❌ INVALID'}\n\n`;
    if (!mermaidRes.valid) {
      md += `\`\`\`\n${mermaidRes.message}\n\`\`\`\n\n`;
    }
    md += `</td>\n`;

    // maid column
    md += `<td valign="top">\n\n`;
    md += `**Result**: ${maidRes.valid ? '✅ VALID' : '❌ INVALID'}\n\n`;
    if (!maidRes.valid) {
      md += `\`\`\`\n${maidRes.message}\n\`\`\`\n\n`;
    }
    md += `</td>\n`;

    md += `</tr>\n</table>\n\n`;

    // Auto-fix previews
    const orig = fs.readFileSync(abs, 'utf8');
    if (fixSafe.ok && fixSafe.fixed.trim() && fixSafe.fixed.trim() !== orig.trim()) {
      md += `### maid Auto-fix (\`--fix\`) Preview\n\n`;
      const mmFixed = runMermaidCliOnContent(fixSafe.fixed, 'safe');
      if (!mmFixed.valid) fixFailures.push({ file, level: 'safe', message: mmFixed.message });
      {
        const f = codeFence(fixSafe.fixed, 'mermaid');
        md += `${f.open}${fixSafe.fixed}${f.close}\n`;
      }
      md += `### maid Auto-fix (\`--fix=all\`) Preview\n\n`;
      md += `Shown above (safe changes applied).\n\n`;
    } else {
      md += `### maid Auto-fix (\`--fix\`) Preview\n\nNo auto-fix changes (safe level).\n\n`;
      md += `### maid Auto-fix (\`--fix=all\`) Preview\n\n`;
      if (fixAll.ok && fixAll.fixed.trim() && fixAll.fixed.trim() !== orig.trim()) {
        const mmFixedAll = runMermaidCliOnContent(fixAll.fixed, 'all');
        if (!mmFixedAll.valid) fixFailures.push({ file, level: 'all', message: mmFixedAll.message });
        const f = codeFence(fixAll.fixed, 'mermaid');
        md += `${f.open}${fixAll.fixed}${f.close}\n`;
      } else {
        md += `No auto-fix changes (all level).\n\n`;
      }
    }

    md += `<details>\n<summary>View source code</summary>\n\n\`\`\`\n${content}\n\`\`\`\n</details>\n\n---\n\n`;
  });

  return { markdown: md, rows, fixFailures };
}

// ========== CLI orchestration ==========

function printUsage() {
  console.log(`Usage:\n  node scripts/generate-previews.js [type|all] [--valid-only|--invalid-only] [--no-renderer]`);
}

async function main() {
  const args = process.argv.slice(2);
  const typesArg = args[0] && !args[0].startsWith('--') ? args[0] : 'all';
  const validOnly = args.includes('--valid-only');
  const invalidOnly = args.includes('--invalid-only');
  const noRenderer = args.includes('--no-renderer');

  const types = typesArg === 'all' ? SUPPORTED_TYPES : [typesArg];
  const unknown = types.filter(t => !SUPPORTED_TYPES.includes(t));
  if (unknown.length) {
    console.error(`Unknown type(s): ${unknown.join(', ')}`);
    printUsage();
    process.exit(1);
  }
  if (validOnly && invalidOnly) {
    console.error('Choose at most one of --valid-only or --invalid-only');
    process.exit(1);
  }

  const times = [];
  for (const type of types) {
    const t0 = Date.now();

    if (!invalidOnly) {
      const { markdown, mismatches } = generateValidPreview(type, { withRenderer: !noRenderer });
      const outPath = path.resolve(__dirname, '..', 'test-fixtures', type, 'VALID_DIAGRAMS.md');
      fs.writeFileSync(outPath, markdown);
      const blocks = (markdown.match(/```mermaid/g) || []).length;
      console.log(`✅ Generated valid preview at: ${outPath}`);
      console.log(`📊 Total valid diagrams: ${blocks}`);
      if (mismatches.length) {
        console.error(`\n❌ Found ${mismatches.length} classification mismatch(es) in '${type}/valid':`);
        mismatches.forEach((m) => {
          console.error(` - ${m.file}: expected VALID, but ${m.tool} says INVALID${m.message ? ` — ${m.message.split('\n')[0]}` : ''}`);
        });
        process.exit(1);
      }
    }

    if (!validOnly) {
      const { markdown, rows, fixFailures } = generateInvalidPreview(type);
      const outPath = path.resolve(__dirname, '..', 'test-fixtures', type, 'INVALID_DIAGRAMS.md');
      fs.writeFileSync(outPath, markdown);
      console.log(`✅ Generated invalid preview at: ${outPath}`);
      console.log(`📊 Total invalid diagrams: ${rows.length}`);

      // Enforce invalid are INVALID under mermaid-cli
      const invalidMismatch = rows.filter(r => r.mermaidRes.valid);
      if (invalidMismatch.length) {
        console.error(`\n❌ Found ${invalidMismatch.length} classification mismatch(es) in '${type}/invalid':`);
        invalidMismatch.forEach((m) => {
          console.error(` - ${m.file}: expected INVALID, but mermaid-cli says VALID`);
        });
        process.exit(1);
      }

      // Enforce aggressive '--fix=all' auto-fixes that changed content must be VALID under mermaid-cli
      // Safe-level fixes may be partial; we report them in the preview but do not fail CI.
      // Optional allowlist for flaky cases per type.
      const compatFile = path.resolve(__dirname, '..', 'test-fixtures', type, 'invalid-compat.json');
      let invalidCompatSet = new Set();
      if (fs.existsSync(compatFile)) {
        try {
          const jc = JSON.parse(fs.readFileSync(compatFile, 'utf8'));
          invalidCompatSet = new Set((jc.items || []).map((x) => typeof x === 'string' ? x : x.file));
        } catch {}
      }
      const allFailures = fixFailures.filter((f) => f.level === 'all' && !invalidCompatSet.has(f.file));
      if (allFailures.length) {
        console.error(`\n❌ Found ${allFailures.length} auto-fix validation failure(s) in '${type}/invalid':`);
        for (const f of allFailures) {
          console.error(` - ${f.file}: '--fix=all' produced output that is still INVALID per mermaid-cli — ${f.message.split('\n')[0]}`);
        }
        process.exit(1);
      }
    }

    const dt = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`⏱  Time: ${dt}s (${type})`);
    times.push({ type, seconds: Number(dt) });
  }

  const total = times.reduce((a, b) => a + b.seconds, 0).toFixed(2);
  console.log(`\n⏱  Total preview generation time: ${total}s`);
}

main().catch((e) => {
  console.error(e.stack || e.message || String(e));
  process.exit(1);
});
