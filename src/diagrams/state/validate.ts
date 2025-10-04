import type { ValidationError, ValidateOptions } from '../../core/types.js';
import { lintWithChevrotain } from '../../core/pipeline.js';
import { tokenize } from './lexer.js';
import { parse } from './parser.js';
import { analyzeState } from './semantics.js';
import { mapStateParserError } from '../../core/diagnostics.js';
import type { IToken } from 'chevrotain';
import * as t from './lexer.js';

export function validateState(text: string, _options: ValidateOptions = {}): ValidationError[] {
  return lintWithChevrotain(text, {
    tokenize,
    parse,
    analyze: analyzeState,
    mapParserError: mapStateParserError,
    postLex: (_text, tokens) => {
      const errs: ValidationError[] = [];
      const toks = tokens as IToken[];
      for (let i=0;i<toks.length;i++) {
        const tk = toks[i];
        if (tk.tokenType === t.InvalidArrow) {
          errs.push({
            line: tk.startLine ?? 1,
            column: tk.startColumn ?? 1,
            severity: 'error',
            code: 'ST-ARROW-INVALID',
            message: "Invalid arrow '->'. Use '-->' in state transitions.",
            hint: 'Example: A --> B : event',
            length: (tk.image?.length ?? 2)
          });
        }
      }
      // Detect 'glued' notes: '... ]Note ...' without a newline before Note
      for (let i=0;i<toks.length;i++) {
        const tk = toks[i];
        if (tk.tokenType === t.NoteKw) {
          const prev = toks[i-1];
          if (prev && prev.tokenType !== t.Newline && (prev.startLine === tk.startLine)) {
            errs.push({
              line: tk.startLine ?? 1,
              column: tk.startColumn ?? 1,
              severity: 'error',
              code: 'ST-NOTE-GLUED',
              message: "'Note' must start on a new line (not glued to the previous statement).",
              hint: "Put 'Note …' on its own line: Note right of Auth: …",
              length: (tk.image?.length ?? 4)
            });
          }
        }
      }
      return errs;
    },
    postParse: (src, _tokens, _cst, prev) => {
      const errors: ValidationError[] = [];
      const has = (code: string, line: number) => (prev || []).some(e => e.code === code && e.line === line && e.severity === 'error') || errors.some(e => e.code === code && e.line === line);
      const lines = src.split(/\r?\n/);
      const stateOpen: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i] || '';
        const ln = i + 1;
        if (/^\s*state\b.*\{\s*$/.test(raw)) stateOpen.push(ln);
        // Note missing colon fallback (case-insensitive 'Note')
        if (/^\s*Note\b/i.test(raw) && !/:/.test(raw)) {
          const idx = raw.length - (raw.trimStart().length);
          const afterHeader = raw.replace(/^\s*Note\s+(left|right)\s+of\s+[^:]+/i, '').replace(/^\s*Note\s+over\s+[^:]+/i, '');
          if (afterHeader === raw) {
            // not matched header; skip
          } else {
            const insertCol = raw.indexOf(':');
            if (insertCol === -1) {
              // place caret near end of header
              const m1 = /(Note\s+(left|right)\s+of\s+[^:]+|Note\s+over\s+[^:]+)/i.exec(raw);
              const caret = m1 ? (m1.index + (m1[0]?.length || 0) + 1) : 1;
              if (!has('ST-NOTE-MALFORMED', ln)) errors.push({ line: ln, column: caret, severity: 'error', code: 'ST-NOTE-MALFORMED', message: 'Malformed note: missing colon before note text.', hint: 'Example: Note right of A: message' });
            }
          }
        }
      }
      // Missing closing brace for any state block
      if (stateOpen.length > 0) {
        const hasClose = lines.some(l => /\}/.test(l));
        if (!hasClose && !has('ST-BLOCK-MISSING-RBRACE', Math.max(1, lines.length))) {
          errors.push({ line: Math.max(1, lines.length), column: 1, severity: 'error', code: 'ST-BLOCK-MISSING-RBRACE', message: "Missing '}' to close a state block.", hint: "Close the block: state Foo { ... }" });
        }
      }
      // Concurrency placement: '---' must be inside state { } and not the first/last content line
      // We apply a simple text-based state block scanner to evaluate placement.
      // reuse 'lines' defined above
      type Block = { start: number; content: number[]; seps: number[] };
      const stack: Block[] = [];
      const pushBlock = (ln: number) => stack.push({ start: ln, content: [], seps: [] });
      const top = () => stack[stack.length - 1];
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i] || '';
        const ln = i + 1;
        if (/^\s*state\b.*\{\s*$/.test(raw)) { pushBlock(ln); continue; }
        if (/^\s*\}\s*$/.test(raw)) {
          const blk = stack.pop();
          if (blk) {
            // Evaluate separators
            const content = blk.content.filter(l => !/^\s*---\s*$/.test(lines[l-1] || ''));
            for (const sepLn of blk.seps) {
              const before = content.find(l => l < sepLn);
              const after = content.find(l => l > sepLn);
              if (!before || !after) {
                errors.push({
                  line: sepLn,
                  column: 1,
                  severity: 'error',
                  code: 'ST-CONCURRENCY-MISPLACED',
                  message: "Concurrency separator '---' must be between regions, not at the start or end of a block.",
                  hint: "Place '---' between two sets of state lines inside the same block.",
                });
              }
            }
          }
          continue;
        }
        if (stack.length > 0) {
          if (/^\s*---\s*$/.test(raw)) { 
            top().seps.push(ln);
            // Current CLI treats concurrency as unsupported; surface a clear error code
            if (!has('ST-CONCURRENCY-UNSUPPORTED', ln)) {
              errors.push({
                line: ln,
                column: 1,
                severity: 'error',
                code: 'ST-CONCURRENCY-UNSUPPORTED',
                message: "Concurrency separator '---' is not supported by Mermaid CLI in state diagrams.",
                hint: "Remove '---' or split logic into separate composite states.",
              });
            }
          }
          else if (raw.trim() !== '') top().content.push(ln);
        }
      }
      return errors;
    }
  });
}
