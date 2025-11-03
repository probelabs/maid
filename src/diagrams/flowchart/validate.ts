import type { ValidationError, ValidateOptions } from '../../core/types.js';
import { tokenize, InvalidArrow } from './lexer.js';
import { parse } from './parser.js';
import { analyzeFlowchart } from './semantics.js';
import type { IToken } from 'chevrotain';
import { lintWithChevrotain } from '../../core/pipeline.js';
import { coercePos, mapFlowchartParserError } from '../../core/diagnostics.js';
import { detectDoubleInDouble, detectUnclosedQuotesInText } from '../../core/quoteHygiene.js';
import { detectEscapedQuotes } from '../../core/quoteHygiene.js';

export function validateFlowchart(text: string, options: ValidateOptions = {}): ValidationError[] {
  return lintWithChevrotain(text, {
    tokenize,
    parse,
    analyze: (cst, tokens) => analyzeFlowchart(cst as any, tokens as IToken[], { strict: !!options.strict }),
    mapParserError: (e, t) => mapFlowchartParserError(e, t),
    postLex: (_text, tokens) => {
      const errs: ValidationError[] = [];
      for (const token of tokens as IToken[]) {
        if (token.tokenType === InvalidArrow) {
          errs.push({
            line: token.startLine ?? 1,
            column: token.startColumn ?? 1,
            message: 'Invalid arrow syntax: -> (use --> instead)',
            severity: 'error',
            code: 'FL-ARROW-INVALID',
            hint: 'Replace -> with -->, or use -- text --> for inline labels.',
            length: (token.image?.length ?? 2)
          });
        }
      }
      return errs;
    },
    postParse: (text, tokens, _cst, prevErrors) => {
      
      // Flowchart: unsupported meta headers (title)
      {
        const tks = tokens as IToken[];
        const firstByLine = new Map<number, IToken>();
        for (const tk of tks) {
          const ln = tk.startLine ?? 1;
          const col = tk.startColumn ?? 1;
          const prev = firstByLine.get(ln);
          if (!prev || (prev.startColumn ?? Infinity) > col) firstByLine.set(ln, tk);
        }
        for (const tk of tks) {
          if (tk.image === 'title' && firstByLine.get(tk.startLine ?? 1) === tk) {
            prevErrors.push({
              line: tk.startLine ?? 1,
              column: tk.startColumn ?? 1,
              severity: 'error',
              code: 'FL-META-UNSUPPORTED',
              message: "'title' is not supported in flowcharts by the current Mermaid CLI.",
              hint: 'Use a Markdown heading above the code block, or draw a labeled node at the top (e.g., T["Dependency Relationship"]).',
              length: (tk.image?.length ?? 5)
            } as ValidationError);
          }
        }
      }
      // Backslash-escaped quotes inside quoted labels will cause Mermaid CLI parse errors if not normalized.
      // Treat as errors so autofix is required to produce a renderable diagram.
      const escWarn = detectEscapedQuotes(tokens as IToken[], {
        code: 'FL-LABEL-ESCAPED-QUOTE',
        message: 'Escaped quotes (\\") in node labels are accepted by Mermaid, but using &quot; is preferred for portability.',
        hint: 'Prefer &quot; inside quoted labels, e.g., A["He said &quot;Hi&quot;"]'
      }).map(e => ({ ...e, severity: 'error' } as ValidationError));
      // Detect double-in-double for lines not already reported by the parser mapping
      const seenDoubleLines = new Set(
        prevErrors.filter(e => e.code === 'FL-LABEL-DOUBLE-IN-DOUBLE').map(e => e.line)
      );
      // Avoid reporting when a properly escaped quote appears on the same line
      const escapedLinesAll = new Set(detectEscapedQuotes(tokens as IToken[], { code: 'x' }).map(e => e.line));
      const dbl = detectDoubleInDouble(tokens as IToken[], {
        code: 'FL-LABEL-DOUBLE-IN-DOUBLE',
        message: 'Double quotes inside a double-quoted label are not supported. Use &quot; for inner quotes.',
        hint: 'Example: A["He said &quot;Hi&quot;"]',
        scopeEndTokenNames: [
          'SquareClose','RoundClose','DiamondClose','DoubleSquareClose','DoubleRoundClose','StadiumClose','CylinderClose','HexagonClose'
        ],
        scopeStartTokenNames: [
          'SquareOpen','RoundOpen','DiamondOpen','DoubleSquareOpen','DoubleRoundOpen','StadiumOpen','CylinderOpen','HexagonOpen'
        ]
      }).filter(e => !seenDoubleLines.has(e.line) && !escapedLinesAll.has(e.line));
      const errs = escWarn.concat(dbl);
      // Heuristic: map generic parser error for two identifiers on one line (missing arrow)
      const generic = (prevErrors || []).filter(e => e.severity === 'error' && !('code' in e) && typeof e.message === 'string');
      for (const ge of generic) {
        const msg = String((ge as any).message || '');
        if (msg.includes('Newline') && msg.includes('EOF')) {
          errs.push({
            line: (ge as any).line ?? 1,
            column: (ge as any).column ?? 1,
            severity: 'error',
            code: 'FL-LINK-MISSING',
            message: "Two nodes on one line must be connected with an arrow.",
            hint: 'Insert --> between nodes, e.g., A --> B.'
          });
        }
      }
      // Heuristic: explicit missing arrow when two node-like refs are on one line with only whitespace between
      {
        const lines = text.split(/\r?\n/);
        const nodeRef = String.raw`[A-Za-z0-9_]+(?:\[[^\]]*\]|\([^\)]*\)|\{[^}]*\}|\[\[[^\]]*\]\]|\(\([^\)]*\)\))?`;
        const re = new RegExp(String.raw`^\s*(${nodeRef})\s+(${nodeRef})\s*;?\s*$`);
        const skipStart = /^(?:\s*)(style|classDef|class|click|linkStyle|subgraph|end|graph|flowchart|direction)\b/;
        for (let i = 0; i < lines.length; i++) {
          const raw = lines[i] || '';
          const ln = i + 1;
          if (!raw.trim()) continue;
          if (skipStart.test(raw)) continue;
          const m = re.exec(raw);
          if (m) {
            const idxSecond = raw.indexOf(m[2]);
            const col = idxSecond >= 0 ? (idxSecond + 1) : 1;
            errs.push({
              line: ln,
              column: col,
              severity: 'error',
              code: 'FL-LINK-MISSING',
              message: 'Two nodes on one line must be connected with an arrow.',
              hint: 'Insert --> between nodes, e.g., A --> B.'
            });
          }
        }
      }
      
      // Heuristic sweep: detect parens in unquoted square-bracket node labels, robustly scanning
      // across all labels per line while ignoring brackets inside quoted strings.
      {
        // Collect already-reported positions (line:column) from parser-mapped errors and our own augmentations
        const byLine = new Map<number, {start:number,end:number}[]>();
        const collect = (arr: any[]) => {
          for (const e of (arr || [])) {
            if (e && ((e as any).code === 'FL-LABEL-PARENS-UNQUOTED' || (e as any).code === 'FL-LABEL-AT-IN-UNQUOTED')) {
              const ln = (e as any).line ?? 0;
              const col = (e as any).column ?? 1;
              const list = byLine.get(ln) || [];
              list.push({ start: col, end: col });
              byLine.set(ln, list);
            }
          }
        };
        collect(prevErrors as any[]);
        collect(errs as any[]);

        const lines2 = text.split(/\r?\n/);
        for (let ii = 0; ii < lines2.length; ii++) {
          const raw = lines2[ii] || '';
          if (!raw.includes('[') || !raw.includes(']')) continue;

          let i = 0; const n = raw.length; let inQuote = false; let esc = false;
          while (i < n) {
            const ch = raw[i];
            if (inQuote) {
              if (esc) { esc = false; }
              else if (ch === '\\') { esc = true; }
              else if (ch === '"') { inQuote = false; }
              i++; continue;
            }
            if (ch === '"') { inQuote = true; i++; continue; }
            if (ch === '[') {
              // find matching ']' while respecting quotes
              let j = i + 1; let inQ = false; let esc2 = false; let depth = 1;
              while (j < n && depth > 0) {
                const cj = raw[j];
                if (inQ) {
                  if (esc2) { esc2 = false; }
                  else if (cj === '\\') { esc2 = true; }
                  else if (cj === '"') { inQ = false; }
                  j++; continue;
                }
                if (cj === '"') { inQ = true; j++; continue; }
                if (cj === '[') depth++;
                else if (cj === ']') depth--;
                j++;
              }
              if (depth === 0) {
                const startCol = i + 2; const endCol = j; // 1-based inclusive at end
                const seg = raw.slice(i + 1, j - 1);
                const trimmed = seg.trim();
                const ln = ii + 1;
                // Skip parallelogram/trapezoid markers [/.../], [\...\]
                const lsp = trimmed.slice(0,1), rsp = trimmed.slice(-1);
                const isSlashPair = ((lsp === '/' || lsp === '\\') && (rsp === '/' || rsp === '\\'));
                const isParenWrapped = (lsp === '(' && rsp === ')'); // cylinder/stadium in square
                const isQuoted = /^"[\s\S]*"$/.test(trimmed);
                const existing = byLine.get(ln) || [];
                const covered = existing.some(r => !(endCol < r.start || startCol > r.end));
                // Report hazards in unquoted labels.
                // - Parentheses: for both normal and typed [/…/] labels (we can encode for typed shapes)
                // - At-sign: only for normal labels; parallelogram/trapezoid do not support quotes
                const hasParens = seg.includes('(') || seg.includes(')');
                const hasAt = seg.includes('@');
                if (!covered && !isQuoted && !isParenWrapped && hasParens) {
                  errs.push({ line: ln, column: startCol, severity: 'error', code: 'FL-LABEL-PARENS-UNQUOTED', message: 'Parentheses inside an unquoted label are not supported by Mermaid.', hint: 'Wrap the label in quotes, e.g., A["Mark (X)"] — or replace ( and ) with HTML entities: &#40; and &#41;.' } as any);
                  existing.push({ start: startCol, end: endCol });
                  byLine.set(ln, existing);
                }
                if (!covered && !isQuoted && !isSlashPair && hasAt) {
                  errs.push({ line: ln, column: startCol, severity: 'error', code: 'FL-LABEL-AT-IN-UNQUOTED', message: "'@' inside an unquoted label can be misparsed by Mermaid.", hint: 'Wrap the label in quotes, e.g., B["@probelabs/probe v0.6.0-rc149"]' } as any);
                  existing.push({ start: startCol, end: endCol });
                  byLine.set(ln, existing);
                }
                i = j; // continue after this segment
                continue;
              } else {
                break;
              }
            }
            i++;
          }
        }
      }


      // File-level unclosed quote detection: only if overall quote count is odd (Mermaid treats
        // per-line mismatches as OK as long as the file balances quotes overall).
      const dblEsc = (text.match(/\\\"/g) || []).length;
      const dq = (text.match(/\"/g) || []).length - dblEsc;
      const sq = (text.match(/'/g) || []).length;
      if ((dq % 2 === 1) || (sq % 2 === 1)) {
        errs.push(...detectUnclosedQuotesInText(text, {
          code: 'FL-QUOTE-UNCLOSED',
          message: 'Unclosed quote in node label.',
          hint: 'Close the quote: A["Label"]',
          limitPerFile: 1
        }));
      }
      return errs;
    }
  });
}
