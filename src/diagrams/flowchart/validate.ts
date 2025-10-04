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
      // Mermaid accepts backslash-escaped quotes inside quoted labels.
      // Emit as a warning (not an error) so --fix can normalize to &quot; if desired.
      const escWarn = detectEscapedQuotes(tokens as IToken[], {
        code: 'FL-LABEL-ESCAPED-QUOTE',
        message: 'Escaped quotes (\\") in node labels are accepted by Mermaid, but using &quot; is preferred for portability.',
        hint: 'Prefer &quot; inside quoted labels, e.g., A["He said &quot;Hi&quot;"]'
      }).map(e => ({ ...e, severity: 'warning' } as ValidationError));
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
