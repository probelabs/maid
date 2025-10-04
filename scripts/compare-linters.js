#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function runMermaidCli(filepath) {
  const outSvg = `/tmp/mermaid-cli-${path.basename(filepath)}.svg`;
  try {
    const puppeteerCfg = path.resolve(__dirname, 'puppeteer-ci.json');
    const pFlag = fs.existsSync(puppeteerCfg) ? ` -p "${puppeteerCfg}"` : '';
    execSync(`npx @mermaid-js/mermaid-cli${pFlag} -i "${filepath}" -o "${outSvg}"`, {
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 12000
    });
  } catch (error) {
    const raw = (error.stderr || error.stdout || error.message || '').toString();
    return {
      valid: false,
      error: sanitizeMermaidMessage(raw)
    };
  }
  try {
    const svg = fs.readFileSync(outSvg, 'utf8');
    const isError = /aria-roledescription\s*=\s*"error"/.test(svg) || /class=\"error-text\"/.test(svg);
    if (isError) {
      const texts = Array.from(svg.matchAll(/<text[^>]*class=\"error-text\"[^>]*>([^<]*)<\/text>/g)).map(m => m[1].trim()).filter(Boolean);
      const msg = texts.join('\n') || 'Syntax error (from mermaid-cli error SVG)';
      try { fs.unlinkSync(outSvg); } catch {}
      return { valid: false, error: msg };
    }
    return { valid: true, error: null };
  } finally {
    try { fs.unlinkSync(outSvg); } catch {}
  }
}

function sanitizeMermaidMessage(input) {
  if (!input) return input;
  let out = input;
  out = out.replace(/file:\/\/[^\s)]+node_modules\/(.*?):(\d+):(\d+)/g, 'node_modules/$1:$2:$3');
  out = out.replace(/\/(?:[A-Za-z]:)?[^\s)]+node_modules\/(.*?):(\d+):(\d+)/g, 'node_modules/$1:$2:$3');
  out = out.replace(/file:\/\/[A-Za-z]:\\[^\s)]+node_modules\\(.*?):(\d+):(\d+)/g, 'node_modules/$1:$2:$3');
  out = out
    .split(/\r?\n/)
    .filter((line) => !/\s+at\s+.*\(node:internal\//.test(line))
    .join('\n');
  return out;
}

function runOurLinter(filepath) {
  try {
    execSync(`node ./out/cli.js "${filepath}"`, {
      stdio: 'pipe',
      encoding: 'utf8',
      cwd: path.resolve(__dirname, '..'),
      timeout: 5000
    });
    return { valid: true, error: null };
  } catch (error) {
    const root = path.resolve(__dirname, '..');
    const output = ((error.stdout || '') + (error.stderr || ''))
      .toString()
      .replaceAll(root + '/', '')
      .replaceAll(root + '\\', '');
    return { 
      valid: false,
      error: output || error.message
    };
  }
}

function compareResults(file, mermaidResult, ourResult) {
  const filename = path.basename(file);
  const category = path.basename(path.dirname(file));
  
  console.log(`\n${colors.cyan}Testing: ${category}/${filename}${colors.reset}`);
  console.log('─'.repeat(50));
  
  const match = mermaidResult.valid === ourResult.valid;
  
  if (match) {
    console.log(`${colors.green}✓ MATCH${colors.reset} - Both linters agree: ${mermaidResult.valid ? 'VALID' : 'INVALID'}`);
  } else {
    console.log(`${colors.red}✗ MISMATCH${colors.reset}`);
    console.log(`  Mermaid CLI: ${mermaidResult.valid ? 'VALID' : 'INVALID'}`);
    console.log(`  Our Linter:  ${ourResult.valid ? 'VALID' : 'INVALID'}`);
    
    if (mermaidResult.error) {
      console.log(`${colors.yellow}  Mermaid error:${colors.reset}`);
      console.log('    ' + mermaidResult.error.split('\n').join('\n    '));
    }
    
    if (ourResult.error) {
      console.log(`${colors.yellow}  Our linter output:${colors.reset}`);
      console.log('    ' + ourResult.error.split('\n').join('\n    '));
    }
  }
  
  return match;
}

async function main() {
  const fixturesDir = path.resolve(__dirname, '..', 'test-fixtures');
  const repoRoot = path.resolve(__dirname, '..');
  const diagramType = process.argv[2] || 'flowchart';
  const typeDir = path.join(fixturesDir, diagramType);
  const compatPath = path.join(typeDir, 'compat-gaps.json');
  let compat = { diagramType, items: [] };
  if (fs.existsSync(compatPath)) {
    try { compat = JSON.parse(fs.readFileSync(compatPath, 'utf8')); } catch {}
  }
  const compatSet = new Set((compat.items || []).map((it) => typeof it === 'string' ? it : it.file).filter(Boolean));
  
  if (!fs.existsSync(typeDir)) {
    console.error(`No fixtures found for diagram type: ${diagramType}`);
    process.exit(1);
  }
  
  console.log(`${colors.blue}Comparing linters for ${diagramType} diagrams...${colors.reset}`);
  console.log('═'.repeat(50));
  
  let totalTests = 0;
  let matchingResults = 0;
  let results = {
    valid: { matches: 0, mismatches: 0, files: [] },
    invalid: { matches: 0, mismatches: 0, files: [] }
  };
  
  // Test valid diagrams
  const validDir = path.join(typeDir, 'valid');
  if (fs.existsSync(validDir)) {
    const validFiles = fs.readdirSync(validDir)
      .filter(f => f.endsWith('.mmd'))
      .map(f => path.join(validDir, f));
    
    for (const file of validFiles) {
      totalTests++;
      const rel = path.relative(repoRoot, file);
      const mermaidResult = runMermaidCli(rel);
      const ourResult = runOurLinter(rel);
      const fname = path.basename(file);
      const match = mermaidResult.valid === ourResult.valid;
      if (!match && compatSet.has(path.basename(file))) {
        console.log(`${colors.yellow}△ EXPECTED MISMATCH${colors.reset} - Listed in compat-gaps.json (${fname})`);
        matchingResults++;
        results.valid.matches++;
      } else {
        const shown = compareResults(file, mermaidResult, ourResult);
        if (shown) {
          matchingResults++;
          results.valid.matches++;
        } else {
          results.valid.mismatches++;
          results.valid.files.push(path.basename(file));
        }
      }
    }
  }
  
  // Test invalid diagrams
  const invalidDir = path.join(typeDir, 'invalid');
  if (fs.existsSync(invalidDir)) {
    const invalidFiles = fs.readdirSync(invalidDir)
      .filter(f => f.endsWith('.mmd'))
      .map(f => path.join(invalidDir, f));
    
    for (const file of invalidFiles) {
      totalTests++;
      const rel = path.relative(repoRoot, file);
      const mermaidResult = runMermaidCli(rel);
      const ourResult = runOurLinter(rel);
      const fname = path.basename(file);
      const match = mermaidResult.valid === ourResult.valid;
      if (!match && compatSet.has(fname)) {
        console.log(`${colors.yellow}△ EXPECTED MISMATCH${colors.reset} - Listed in compat-gaps.json (${fname})`);
        matchingResults++;
        results.invalid.matches++;
      } else {
        const shown = compareResults(file, mermaidResult, ourResult);
        if (shown) {
          matchingResults++;
          results.invalid.matches++;
        } else {
          results.invalid.mismatches++;
          results.invalid.files.push(path.basename(file));
        }
      }
    }
  }
  
  // Summary
  console.log('\n' + '═'.repeat(50));
  console.log(`${colors.blue}SUMMARY${colors.reset}`);
  console.log('─'.repeat(50));
  console.log(`Total tests: ${totalTests}`);
  console.log(`Matching results: ${matchingResults}/${totalTests} (${Math.round(matchingResults/totalTests*100)}%)`);
  
  if (results.valid.matches + results.valid.mismatches > 0) {
    console.log(`\nValid diagrams:`);
    console.log(`  Matches: ${results.valid.matches}`);
    if (results.valid.mismatches > 0) {
      console.log(`  Mismatches: ${results.valid.mismatches} (${results.valid.files.join(', ')})`);
    }
  }
  
  if (results.invalid.matches + results.invalid.mismatches > 0) {
    console.log(`\nInvalid diagrams:`);
    console.log(`  Matches: ${results.invalid.matches}`);
    if (results.invalid.mismatches > 0) {
      console.log(`  Mismatches: ${results.invalid.mismatches} (${results.invalid.files.join(', ')})`);
    }
  }
  
  process.exit(matchingResults === totalTests ? 0 : 1);
}

main().catch(console.error);
