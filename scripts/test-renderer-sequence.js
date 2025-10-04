#!/usr/bin/env node
// Renderer smoke test for sequence diagrams

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderMermaid } from '../out/renderer/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function expect(cond, msg) { if (!cond) throw new Error(msg); }

const file = path.resolve(__dirname, '..', 'test-fixtures/sequence/valid/basic.mmd');
const text = fs.readFileSync(file, 'utf8');
const { svg } = renderMermaid(text);

// Expect participant boxes, lifelines, a message line and label
// Actor boxes use shared .node-shape class
expect(/class=\"node-shape\"/.test(svg), 'missing node-shape');
expect(/class=\"lifeline\"/.test(svg), 'missing lifeline');
expect(/class=\"msg-line/.test(svg), 'missing msg-line');
expect(/class=\"msg-label\"/.test(svg), 'missing msg-label');

console.log('OK renderer sequence smoke test');
