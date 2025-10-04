#!/usr/bin/env node
// Renderer smoke test for state diagrams

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderMermaid } from '../out/renderer/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function expect(cond, msg) { if (!cond) throw new Error(msg); }

const file = path.resolve(__dirname, '..', 'test-fixtures/state/valid/simple.mmd');
const text = fs.readFileSync(file, 'utf8');
const { svg } = renderMermaid(text);

// Expect nodes and edges
expect(/class=\"node-shape\"/.test(svg), 'missing node-shape');
expect(/class=\"edge-path\"/.test(svg), 'missing edge-path');

console.log('OK renderer state smoke test');
