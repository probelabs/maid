import type { IToken } from 'chevrotain';
import type { ValidationError } from './types.js';
import { coercePos } from './diagnostics.js';

export function detectEscapedQuotes(tokens: IToken[], opts: { code: string; message?: string; hint?: string }): ValidationError[] {
  const out: ValidationError[] = [];
  const code = opts.code;
  const message = opts.message || 'Escaped quotes (\\") are not supported by Mermaid. Use &quot; instead.';
  const hint = opts.hint || 'Use &quot; for inner quotes, e.g., "He said &quot;Hi&quot;".';
  const seenLines = new Set<number>();
  for (const tok of tokens) {
    if (typeof tok.image === 'string') {
      const idx = tok.image.indexOf('\\"');
      if (idx !== -1) {
        const lineNo = tok.startLine ?? 1;
        if (seenLines.has(lineNo)) continue; // report only once per line
        seenLines.add(lineNo);
        const col = (tok.startColumn ?? 1) + idx;
        const { line, column } = coercePos(lineNo, col, 1, 1);
        out.push({ line, column, severity: 'error', code, message, hint, length: 2 });
      }
    }
  }
  return out;
}

export function detectDoubleInDouble(
  tokens: IToken[],
  opts: { code: string; message: string; hint: string; scopeEndTokenNames?: string[]; scopeStartTokenNames?: string[] }
): ValidationError[] {
  const out: ValidationError[] = [];
  const byLine = new Map<number, IToken[]>();
  for (const tk of tokens) {
    const ln = tk.startLine ?? 1;
    if (!byLine.has(ln)) byLine.set(ln, []);
    byLine.get(ln)!.push(tk);
  }
  const ends = new Set(opts.scopeEndTokenNames || []);
  const starts = new Set(opts.scopeStartTokenNames || []);
  for (const [ln, arr] of byLine) {
    // Walk tokens on this line; for each QuotedString, look ahead until a scope end token.
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      if (t.tokenType?.name !== 'QuotedString') continue;
      // If start tokens are specified, ensure one appears earlier on this line before first quote
      if (starts.size > 0) {
        // Find the nearest scope-start token before this quote
        let startIdx = -1;
        for (let k = i - 1; k >= 0; k--) {
          const s = arr[k];
          if (starts.has(s.tokenType?.name || '')) { startIdx = k; break; }
        }
        if (startIdx === -1) continue;
        // Exclude typed-shape attribute objects: '@' followed by '{' (DiamondOpen)
        const sTok = arr[startIdx];
        const prevTok = arr[startIdx - 1];
        if ((sTok.tokenType?.name === 'DiamondOpen') && (prevTok?.tokenType?.name === 'AtSign')) {
          continue;
        }
      }
      // Scan forward until scope end
      for (let j = i + 1; j < arr.length; j++) {
        const u = arr[j];
        if (ends.size > 0 && ends.has(u.tokenType?.name || '')) break;
        // Another quoted string before end → likely inner quote case
        if (u.tokenType?.name === 'QuotedString') {
          const { line, column } = coercePos(u.startLine ?? null, u.startColumn ?? null, ln, 1);
          out.push({ line, column, severity: 'error', code: opts.code, message: opts.message, hint: opts.hint, length: 1 });
          j = arr.length; // stop scanning this line
          break;
        }
        // Some lexers may surface a bare '"' in a free-text token; handle that too
        if (u.tokenType?.name === 'Text' && typeof u.image === 'string' && u.image.includes('"')) {
          const idx = (u.image as string).indexOf('"');
          const col = (u.startColumn ?? 1) + (idx >= 0 ? idx : 0);
          const { line, column } = coercePos(u.startLine ?? null, col, ln, 1);
          out.push({ line, column, severity: 'error', code: opts.code, message: opts.message, hint: opts.hint, length: 1 });
          j = arr.length;
          break;
        }
      }
      // Only one error per line to reduce noise
      if (out.length > 0 && out[out.length - 1].line === ln) break;
    }
  }
  return out;
}

export function detectUnclosedQuotesInText(text: string, opts: {
  code: string;
  message?: string;
  hint?: string;
  limitPerFile?: number;
}): ValidationError[] {
  const out: ValidationError[] = [];
  const lines = text.split(/\r?\n/);
  const msg = opts.message || 'Unclosed quote in label or name.';
  const hint = opts.hint || 'Close the quote, e.g., "Text"';
  const limit = opts.limitPerFile ?? 1;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    if (!raw) continue;
    // Ignore HTML entities &quot; and remove escaped quotes (we report those separately)
    let s = raw.split('&quot;').join('').split('\\"').join('');
    const dqIdxs: number[] = [];
    const sqIdxs: number[] = [];
    for (let j = 0; j < s.length; j++) {
      const ch = s[j];
      if (ch === '"') dqIdxs.push(j);
      else if (ch === "'") sqIdxs.push(j);
    }
    const oddDq = dqIdxs.length % 2 === 1;
    const oddSq = sqIdxs.length % 2 === 1;
    if (oddDq || oddSq) {
      const firstIdx = oddDq ? (dqIdxs[0] ?? 0) : (sqIdxs[0] ?? 0);
      out.push({
        line: i + 1,
        column: firstIdx + 1,
        severity: 'error',
        code: opts.code,
        message: msg,
        hint,
        length: 1
      });
      if (out.length >= limit) break;
    }
  }
  return out;
}
