#!/usr/bin/env node
import assert from 'node:assert/strict';
import { validate, detectDiagramType } from '../out/core/router.js';
import { extractMermaidBlocks } from '../out/core/markdown.js';

const withFrontmatter = [
  '---',
  'title: Frontmatter Title',
  '---',
  'flowchart TD',
  '  A[Start] --> B[Done]',
  ''
].join('\n');

const t = detectDiagramType(withFrontmatter);
assert.equal(t, 'flowchart', 'detectDiagramType should ignore frontmatter and detect flowchart');

const direct = validate(withFrontmatter);
assert.equal(direct.type, 'flowchart');
assert.equal(direct.errors.length, 0, 'frontmatter + flowchart should validate');

const markdown = [
  '# Doc',
  '',
  '```mermaid',
  '---',
  'title: Frontmatter in fenced block',
  '---',
  'flowchart TD',
  '  A[One] --> B[Two]',
  '```',
  ''
].join('\n');

const blocks = extractMermaidBlocks(markdown);
assert.equal(blocks.length, 1, 'expected one mermaid block');
const fenced = validate(blocks[0].content);
assert.equal(fenced.errors.length, 0, 'fenced mermaid block with frontmatter should validate');

const invalidWithFrontmatter = [
  '---',
  'title: Bad Label',
  '---',
  'flowchart TD',
  '  A[Bad (label)]',
  ''
].join('\n');

const invalid = validate(invalidWithFrontmatter);
const parenErr = invalid.errors.find((e) => e.code === 'FL-LABEL-PARENS-UNQUOTED');
assert.ok(parenErr, 'expected FL-LABEL-PARENS-UNQUOTED');
assert.equal(parenErr?.line, 5, 'error line should be offset by frontmatter lines');

const unsupportedWithFrontmatter = [
  '---',
  'title: Journey Diagram',
  '---',
  'journey',
  '  title My day',
  '  section Work',
  '    Build: 5: Me',
  ''
].join('\n');

const unsupported = validate(unsupportedWithFrontmatter);
assert.equal(unsupported.errors.length, 0, 'unsupported mermaid types should still pass through with frontmatter');

console.log('Frontmatter validation support: OK');
