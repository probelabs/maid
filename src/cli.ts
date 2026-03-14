#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { globby } from 'globby';
import { validate, detectDiagramType } from './core/router.js';
import type { ValidationError } from './core/types.js';
import { toJsonResult, textReport } from './core/format.js';
import { extractMermaidBlocks, offsetErrors } from './core/markdown.js';
import { computeFixes } from './core/fixes.js';
import { applyEdits } from './core/edits.js';
import type { FixLevel } from './core/types.js';

function autoFixMultipass(text: string, strict: boolean, level: FixLevel): { fixed: string; errors: ValidationError[] } {
    let current = text;
    for (let i = 0; i < 5; i++) {
        const res = validate(current, { strict });
        const edits = computeFixes(current, res.errors, level);
        if (edits.length === 0) return { fixed: current, errors: res.errors };
        const next = applyEdits(current, edits);
        if (next === current) return { fixed: current, errors: res.errors };
        current = next;
    }
    const finalRes = validate(current, { strict });
    return { fixed: current, errors: finalRes.errors };
}

// Main CLI execution
function printUsage() {
    console.log('Usage: maid <file>');
    console.log('       cat file | maid -');
    console.log('       maid <directory>');
    console.log('       maid render <input> [output]');
    console.log('  - Validates standalone .mmd files or Markdown with ```mermaid fences');
    console.log('  - When a directory is given, scans recursively for .md/.markdown/.mdx/.mmd/.mermaid');
    console.log('  - "maid render" renders diagrams to SVG/PNG using experimental renderer');
    console.log('Options:');
    console.log('  --include, -I   Glob(s) to include (repeatable or comma-separated)');
    console.log('  --exclude, -E   Glob(s) to exclude (repeatable or comma-separated)');
    console.log('  --no-gitignore  Do not respect .gitignore when scanning directories');
    console.log('  --strict, -s    Enable strict mode (require quoted labels inside shapes)');
    console.log('  --format, -f    Output format: text|json (default: text)');
    console.log('  --fix[=all]     Apply auto-fixes (safe by default; all for heuristics)');
    console.log('  --dry-run, -n   Do not write files (useful with --fix)');
    console.log('  --print-fixed   With --fix, print fixed content for a single file/stdin');
}

function readInput(arg: string): { content: string; filename: string } {
    if (arg === '-') {
        return { content: fs.readFileSync(0, 'utf8'), filename: '<stdin>' };
    }
    if (!fs.existsSync(arg)) {
        console.error(`File not found: ${arg}`);
        process.exit(1);
    }
    return { content: fs.readFileSync(arg, 'utf8'), filename: arg };
}

function isDirectory(p: string) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

const DEFAULT_INCLUDE_GLOBS = [
  '**/*.md',
  '**/*.markdown',
  '**/*.mdx',
  '**/*.mmd',
  '**/*.mermaid',
];

const DEFAULT_IGNORE_DIRS = [
  '**/.git/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.next/**',
  '**/.vercel/**',
  '**/.cache/**',
  '**/coverage/**'
];

async function listCandidateFiles(root: string, includes: string[], excludes: string[], useGitignore: boolean): Promise<string[]> {
    const patterns = includes.length > 0 ? includes : DEFAULT_INCLUDE_GLOBS;
    const ignore = [
      ...excludes,
      ...(useGitignore ? [] : DEFAULT_IGNORE_DIRS),
    ];
    const cwdAbs = path.resolve(root);
    const files = await globby(patterns, {
      cwd: cwdAbs,
      absolute: true,
      dot: true,
      gitignore: useGitignore,
      ignore,
      followSymbolicLinks: false,
    });
    return files.sort();
}

async function handleRenderCommand(args: string[]) {
    const { execSync } = await import('child_process');

    // Parse render-specific arguments
    let format: 'svg' | 'png' | null = null;
    let outputPath: string | null = null;
    const positionals: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--format' || arg === '-f') {
            const v = (args[i + 1] || '').toLowerCase();
            if (v === 'svg' || v === 'png') {
                format = v as 'svg' | 'png';
                i++;
                continue;
            }
        }

        if (arg === '--output' || arg === '-o') {
            outputPath = args[i + 1];
            i++;
            continue;
        }

        if (arg === '-' || !arg.startsWith('-')) {
            positionals.push(arg);
        }
    }

    const inputFile = positionals[0];
    if (!inputFile) {
        console.error('Error: No input file specified');
        process.exit(1);
    }

    // Determine output path and format
    if (!outputPath && positionals[1]) {
        outputPath = positionals[1];
    }

    // Auto-detect format from output extension if not specified
    if (!format && outputPath) {
        const ext = path.extname(outputPath).toLowerCase();
        if (ext === '.png') format = 'png';
        else if (ext === '.svg') format = 'svg';
    }

    // Default to SVG if no format specified
    if (!format) format = 'svg';

    // Default output path
    if (!outputPath) {
        if (inputFile === '-') {
            outputPath = `output.${format}`;
        } else {
            const baseName = path.basename(inputFile, path.extname(inputFile));
            outputPath = `${baseName}.${format}`;
        }
    }

    // Read input content
    const { content } = readInput(inputFile);

    // Dynamically import renderer to avoid loading it for non-render commands
    const { renderMermaid } = await import('./renderer/index.js');

    try {
        // Render to SVG
        const result = renderMermaid(content);

        if (!result || !result.svg) {
            console.error('Error: Failed to render diagram');
            if (result?.errors && result.errors.length > 0) {
                for (const err of result.errors) {
                    console.error(`  ${err.severity}: ${err.message} at line ${err.line}`);
                }
            }
            process.exit(1);
        }

        if (format === 'svg') {
            // Write SVG directly
            fs.writeFileSync(outputPath, result.svg, 'utf8');
            console.log(`✅ Rendered to SVG: ${outputPath}`);
        } else {
            // Convert to PNG
            const tempSvg = outputPath.replace('.png', '.tmp.svg');
            fs.writeFileSync(tempSvg, result.svg, 'utf8');

            try {
                // Try rsvg-convert first
                execSync(`rsvg-convert -o "${outputPath}" "${tempSvg}" 2>/dev/null`, { stdio: 'pipe' });
                console.log(`✅ Rendered to PNG: ${outputPath}`);
            } catch {
                try {
                    // Fallback to ImageMagick
                    execSync(`convert "${tempSvg}" "${outputPath}" 2>/dev/null`, { stdio: 'pipe' });
                    console.log(`✅ Rendered to PNG: ${outputPath}`);
                } catch {
                    console.error('Error: PNG conversion requires rsvg-convert or ImageMagick');
                    console.error('  On macOS: brew install librsvg');
                    console.error('  Or: brew install imagemagick');
                    console.error(`  SVG saved as: ${tempSvg}`);
                    process.exit(1);
                }
            }

            // Clean up temp file
            fs.unlinkSync(tempSvg);
        }
    } catch (error: any) {
        console.error(`Error rendering diagram: ${error.message}`);
        process.exit(1);
    }
}

async function main() {
    const args = process.argv.slice(2);

    // Handle MCP mode
    if (args[0] === 'mcp') {
        console.error('The MCP server has been moved to a separate package.');
        console.error('Install: npm install -g @probelabs/maid-mcp');
        console.error('Then run: maid-mcp');
        console.error('');
        console.error('See: https://github.com/probelabs/maid#mcp-server');
        process.exit(1);
    }

    // Handle render mode
    if (args[0] === 'render') {
        const renderArgs = args.slice(1);
        if (renderArgs.length === 0 || renderArgs[0] === '--help' || renderArgs[0] === '-h') {
            console.log('Usage: maid render <input.mmd> [output.svg|output.png]');
            console.log('       cat file.mmd | maid render - [output.svg|output.png]');
            console.log('');
            console.log('Renders Mermaid diagrams to SVG/PNG using the experimental Maid renderer.');
            console.log('');
            console.log('Options:');
            console.log('  --format, -f    Output format: svg|png (default: auto-detect from extension or svg)');
            console.log('  --output, -o    Output file path (alternative to positional argument)');
            console.log('');
            console.log('Examples:');
            console.log('  maid render diagram.mmd                    # Outputs diagram.svg');
            console.log('  maid render diagram.mmd output.png         # Outputs PNG');
            console.log('  maid render diagram.mmd -f png             # Force PNG output');
            console.log('  cat diagram.mmd | maid render - out.svg    # Read from stdin');
            console.log('');
            console.log('Note: PNG output requires rsvg-convert or ImageMagick installed.');
            console.log('      The renderer is experimental and currently supports: flowchart, pie, sequence.');
            process.exit(renderArgs.length === 0 ? 1 : 0);
        }
        await handleRenderCommand(renderArgs);
        return;
    }

    if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
        printUsage();
        process.exit(args.length === 0 ? 1 : 0);
    }

    // simple arg parsing: --format json|text (consume flag + value), --strict,
    // --fix[=all], --dry-run/-n (do not write), --print-fixed (stdout fixed content for single file),
    // directory options: --include/-I, --exclude/-E, --no-gitignore
    let format: 'text' | 'json' = 'text';
    let strict = false;
    let fixLevel: FixLevel | null = null; // null means no fixing
    let dryRun = false;
    let printFixed = false;
    let includeGlobs: string[] = [];
    let excludeGlobs: string[] = [];
    let useGitignore = true;
    const positionals: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--format' || a === '-f') {
            const v = (args[i + 1] || '').toLowerCase();
            if (v === 'json' || v === 'text') { format = v as any; i++; continue; }
        }
        if (a === '--strict' || a === '-s') { strict = true; continue; }
        if (a === '--fix' || a.startsWith('--fix=')) {
            if (a === '--fix') fixLevel = 'safe';
            else {
                const v = a.split('=')[1]?.toLowerCase();
                fixLevel = v === 'all' ? 'all' : 'safe';
            }
            continue;
        }
        if (a === '--dry-run' || a === '-n') { dryRun = true; continue; }
        if (a === '--print-fixed') { printFixed = true; continue; }
        if (a === '--include' || a === '-I') {
            const v = args[i + 1];
            if (v) {
                includeGlobs.push(...v.split(',').map(s => s.trim()).filter(Boolean));
                i++; continue;
            }
        }
        if (a === '--exclude' || a === '-E') {
            const v = args[i + 1];
            if (v) {
                excludeGlobs.push(...v.split(',').map(s => s.trim()).filter(Boolean));
                i++; continue;
            }
        }
        if (a === '--no-gitignore') { useGitignore = false; continue; }
        if (a === '--gitignore') { useGitignore = true; continue; }
        if (a === '-' || !a.startsWith('-')) positionals.push(a);
    }
    const target = positionals[0] || args[0];
    // Directory mode
    if (isDirectory(target)) {
        const files = await listCandidateFiles(target, includeGlobs, excludeGlobs, useGitignore);
        type FileResult = { file: string; content: string; errors: ValidationError[] };
        const results: FileResult[] = [];
        let diagramCount = 0;
        let modifiedCount = 0;
        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            const ext = path.extname(file).toLowerCase();
            const isMermaidFile = ext === '.mmd' || ext === '.mermaid';
            const blocks = extractMermaidBlocks(content);
            let errs: ValidationError[] = [];
            let newContent: string | null = null;
            if (blocks.length > 0) {
                diagramCount += blocks.length;
                // Optionally fix each block and reassemble file
                if (fixLevel) {
                    const lines = content.split(/\r?\n/);
                    // Rebuild by replacing each block with its multipass-fixed content
                    let accLines = [...lines];
                    for (const b of blocks) {
                        const { fixed: fixedBlock } = autoFixMultipass(b.content, strict, fixLevel);
                        if (fixedBlock !== b.content) {
                            const realStart = b.startLine - 1;
                            const realEnd = b.endLine - 2;
                            const before = accLines.slice(0, realStart);
                            const after = accLines.slice(realEnd + 1);
                            const fixedLines = fixedBlock.split('\n');
                            accLines = before.concat(fixedLines, after);
                        }
                    }
                    newContent = accLines.join('\n');
                    if (newContent !== null && !dryRun) {
                        fs.writeFileSync(file, newContent, 'utf8');
                        modifiedCount++;
                    }
                    // Validate result content (new or original)
                    const checkText = newContent ?? content;
                    const freshBlocks = extractMermaidBlocks(checkText);
                    for (const b of freshBlocks) {
                        const { errors: blockErrors2 } = validate(b.content, { strict });
                        if (blockErrors2.length) errs = errs.concat(offsetErrors(blockErrors2, b.startLine - 1));
                    }
                } else {
                    for (const b of blocks) {
                        const { errors: blockErrors } = validate(b.content, { strict });
                        if (blockErrors.length) errs = errs.concat(offsetErrors(blockErrors, b.startLine - 1));
                    }
                }
            } else {
                const kind = detectDiagramType(content);
                if (kind !== 'unknown') {
                    diagramCount++;
                    if (fixLevel) {
                        const { fixed, errors: afterErrs } = autoFixMultipass(content, strict, fixLevel);
                        if (fixed !== content && !dryRun) { fs.writeFileSync(file, fixed, 'utf8'); modifiedCount++; }
                        errs = afterErrs;
                    } else {
                        const res = validate(content, { strict });
                        errs = res.errors;
                    }
                } else if (isMermaidFile) {
                    // Mermaid file without header → invalid
                    diagramCount++;
                    const res = validate(content, { strict });
                    errs = res.errors; // expect GEN-HEADER-INVALID
                }
            }
            if (errs.length > 0) {
                results.push({ file, content, errors: errs });
            }
        }
        // Output and exit code
        if (format === 'json') {
            const jsonFiles = files.map((file) => {
                const found = results.find(r => r.file === file);
                const errs = found ? found.errors : [];
                const json = toJsonResult(file, errs);
                return json;
            });
            const totalErrors = jsonFiles.reduce((n, jf) => n + (jf.errorCount || 0), 0);
            const totalWarnings = jsonFiles.reduce((n, jf) => n + (jf.warningCount || 0), 0);
            const overallValid = totalErrors === 0;
            const payload = { valid: overallValid, files: jsonFiles, errorCount: totalErrors, warningCount: totalWarnings, diagramCount };
            console.log(JSON.stringify(payload, null, 2));
            process.exit(overallValid ? 0 : 1);
        } else {
            if (results.length === 0) {
                if (diagramCount === 0) console.log('No Mermaid diagrams found.');
                else console.log(modifiedCount > 0 ? `All diagrams valid after fixes. Modified ${modifiedCount} file(s).` : 'All diagrams valid.');
                process.exit(0);
            }
            for (const r of results) {
                const report = textReport(r.file, r.content, r.errors);
                // Ensure clear separation between files
                console.error(report.trimEnd());
            }
            process.exit(1);
        }
        return; // directory handled
    }

    // Single-file or stdin mode
    const { content, filename } = readInput(target);
    const fileExt = filename === '<stdin>' ? '' : path.extname(filename).toLowerCase();
    const isMermaidFile = fileExt === '.mmd' || fileExt === '.mermaid';
    // If the file contains one or more ```mermaid fences, validate each block
    const blocks = extractMermaidBlocks(content);
    let errors: ValidationError[] = [];
    let diagramsFound = false;
    if (blocks.length > 0) {
        diagramsFound = true;
        if (fixLevel) {
            // Fix each block (multipass) and reconstruct
            const lines = content.split(/\r?\n/);
            let accLines = [...lines];
            for (const b of blocks) {
                const { fixed: fixedBlock } = autoFixMultipass(b.content, strict, fixLevel);
                if (fixedBlock !== b.content) {
                    const realStart = b.startLine - 1;
                    const realEnd = b.endLine - 2;
                    const before = accLines.slice(0, realStart);
                    const after = accLines.slice(realEnd + 1);
                    const fixedLines = fixedBlock.split('\n');
                    accLines = before.concat(fixedLines, after);
                }
            }
            const fixed = accLines.join('\n');
            const err2: ValidationError[] = [];
            const newBlocks = extractMermaidBlocks(fixed);
            for (const b of newBlocks) {
                const { errors: blockErrors2 } = validate(b.content, { strict });
                err2.push(...offsetErrors(blockErrors2, b.startLine - 1));
            }
            if (!dryRun && filename !== '<stdin>') {
                fs.writeFileSync(filename, fixed, 'utf8');
            }
            if (printFixed || filename === '<stdin>') {
                // Print only the fixed content when requested or on stdin
                process.stdout.write(fixed);
            }
            errors = err2;
        } else {
            for (const b of blocks) {
                const { errors: blockErrors } = validate(b.content, { strict });
                errors = errors.concat(offsetErrors(blockErrors, b.startLine - 1));
            }
        }
    } else {
        // If no mermaid fences found, only validate whole file when it looks like a diagram.
        const kind = detectDiagramType(content);
        if (kind !== 'unknown') {
            diagramsFound = true;
            if (fixLevel) {
                const { fixed, errors: afterErrs } = autoFixMultipass(content, strict, fixLevel);
                if (!dryRun && filename !== '<stdin>') fs.writeFileSync(filename, fixed, 'utf8');
                if (printFixed || filename === '<stdin>') process.stdout.write(fixed);
                errors = afterErrs;
            } else {
                const res = validate(content, { strict });
                errors = res.errors;
            }
        } else {
            if (isMermaidFile) {
                // Treat standalone Mermaid files without a proper header as invalid
                diagramsFound = true;
                const res = validate(content, { strict });
                errors = res.errors; // will include GEN-HEADER-INVALID
            } else {
                errors = []; // No diagrams detected (Markdown or other) → success
            }
        }
    }

    const errorCount = errors.filter(e => e.severity === 'error').length;
    const warningCount = errors.filter(e => e.severity === 'warning').length;

    if (format === 'json') {
        const json = toJsonResult(filename, errors);
        // include a hint field for clients, without breaking structure
        (json as any).diagramCount = diagramsFound ? 1 : 0;
        console.log(JSON.stringify(json, null, 2));
        process.exit(json.valid ? 0 : 1);
    } else {
        // Text output: caret-underlined snippets without border lines
        if (!fixLevel) {
          if (errorCount === 0 && !diagramsFound) {
              console.log('No Mermaid diagrams found.');
          } else {
              const report = textReport(filename, content, errors);
              const outTo = errorCount > 0 ? 'stderr' : 'stdout';
              if (outTo === 'stderr') console.error(report); else console.log(report);
          }
        }
        process.exit(errorCount > 0 ? 1 : 0);
    }
}

main().catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
});
