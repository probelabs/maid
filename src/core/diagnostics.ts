import type { ILexingError, IRecognitionException, IToken } from 'chevrotain';
import type { ValidationError } from './types.js';
import { detectUnclosedQuotesInText } from './quoteHygiene.js';

export function coercePos(line?: number | null, column?: number | null, fallbackLine = 1, fallbackColumn = 1) {
  const ln = Number.isFinite(line as number) && (line as number)! > 0 ? (line as number) : fallbackLine;
  const col = Number.isFinite(column as number) && (column as number)! > 0 ? (column as number) : fallbackColumn;
  return { line: ln, column: col };
}

export function endOfTextPos(text: string) {
  const lines = text.split(/\r?\n/);
  const line = lines.length;
  const last = lines[lines.length - 1] ?? '';
  const column = Math.max(1, last.length + 1);
  return { line, column };
}

export function codeFrame(
  text: string,
  line: number,
  column: number,
  length = 1,
  contextLines = 1
): string {
  const lines = text.split(/\r?\n/);
  const idx = Math.max(0, Math.min(lines.length - 1, line - 1));
  const start = Math.max(0, idx - contextLines);
  const end = Math.min(lines.length - 1, idx + contextLines);
  const numWidth = String(end + 1).length;

  const parts: string[] = [];
  for (let i = start; i <= end; i++) {
    const lno = String(i + 1).padStart(numWidth, ' ');
    parts.push(`${lno} | ${lines[i] ?? ''}`);
    if (i === idx) {
      const caretPad = ' '.repeat(Math.max(0, column - 1));
      const marker = '^'.repeat(Math.max(1, Math.min(length, (lines[i] ?? '').length - column + 1)));
      parts.push(`${' '.repeat(numWidth)} | ${caretPad}${marker}`);
    }
  }
  return parts.join('\n');
}

export function fromLexerError(e: ILexingError): ValidationError {
  const { line, column } = coercePos(e.line, e.column);
  return {
    line,
    column,
    severity: 'error',
    message: e.message,
  };
}

// Helpers
function tokenImage(t?: IToken | null) {
  const img = t?.image ?? '';
  return img === '\n' ? '\\n' : img;
}

function isInRule(err: IRecognitionException, name: string) {
  const stack: string[] | undefined = (err as any)?.context?.ruleStack;
  return Array.isArray(stack) && stack.includes(name);
}

function expecting(err: IRecognitionException, tokenName: string) {
  // Chevrotain does not always expose expected tokens structurally; fall back to message text.
  return (err.message || '').includes(`--> ${tokenName} <--`);
}

function atHeader(err: IRecognitionException) {
  const stack: string[] | undefined = (err as any)?.context?.ruleStack;
  return Array.isArray(stack) && stack.length === 1 && stack[0] === 'diagram';
}

export function mapFlowchartParserError(err: IRecognitionException, text: string): ValidationError {
  const tok = err.token;
  const posFallback = endOfTextPos(text);
  const { line, column } = coercePos(tok?.startLine ?? null, tok?.startColumn ?? null, posFallback.line, posFallback.column);
  const found = tokenImage(tok);
  const tokType = tok?.tokenType?.name;
  const len = typeof (tok as any)?.image === 'string' && (tok as any).image.length > 0 ? (tok as any).image.length : 1;
  const allLines = text.split(/\r?\n/);
  const lineStr = allLines[Math.max(0, line - 1)] ?? '';
  const findInnerQuoteIssue = (openCh: '{'|'['|'(') => {
    const caret0 = Math.max(0, column - 1);
    const before = lineStr.slice(0, caret0);
    const openIdx = before.lastIndexOf(openCh);
    if (openIdx === -1) return null;
    const seg = lineStr.slice(openIdx + 1);
    // If we see a backslash-escaped double-quote anywhere between brackets on this line
    const escIdx = seg.indexOf('\\"');
    if (escIdx !== -1) {
      const col = openIdx + 1 + escIdx + 1; // 1-based later
      return {
        kind: 'escaped' as const,
        column: col
      };
    }
    // Heuristic: inner unescaped double-quote inside a double-quoted label → at least 3 quotes in segment
    const quoteIdxs: number[] = [];
    for (let i = 0; i < seg.length; i++) if (seg[i] === '"') quoteIdxs.push(i);
    if (quoteIdxs.length >= 3) {
      const inner = quoteIdxs[2];
      const col = openIdx + 1 + inner + 1;
      return {
        kind: 'double-in-double' as const,
        column: col
      };
    }
    return null;
  };

  // 1) Direction after header
  if (atHeader(err) && expecting(err, 'Direction')) {
    if (tokType === 'EOF' || tokType === 'Newline') {
      return {
        line, column, severity: 'error', code: 'FL-DIR-MISSING',
        message: 'Missing direction after diagram header. Use TD, TB, BT, RL, or LR.',
        hint: "Example: 'flowchart TD' for top-down layout.",
        length: 1
      };
    }
    return {
      line, column, severity: 'error', code: 'FL-DIR-INVALID',
      message: `Invalid direction '${found}'. Use one of: TD, TB, BT, RL, LR.`,
      hint: "Try 'TD' (top-down) or 'LR' (left-to-right).",
      length: len
    };
  }

  // 2) Missing arrow between nodes on the same line
  if ((err.name === 'NoViableAltException' || err.name === 'MismatchedTokenException')) {
    // Common pattern: two nodes on same line without an arrow
    const msg = err.message || '';
    if (tokType === 'Identifier' && msg.includes('Newline') && msg.includes('EOF')) {
      return {
        line, column, severity: 'error', code: 'FL-LINK-MISSING',
        message: `Two nodes on one line must be connected with an arrow before '${found}'.`,
        hint: 'Insert --> between nodes, e.g., A --> B.',
        length: len
      };
    }
  }

  // 3) Mixed brackets: opened '(' closed with ']'
  if (isInRule(err, 'nodeShape') && err.name === 'MismatchedTokenException' && tokType === 'SquareClose' && expecting(err, 'RoundClose')) {
    return {
      line, column, severity: 'error', code: 'FL-NODE-MIXED-BRACKETS',
      message: "Mismatched brackets: opened '(' but closed with ']'.",
      hint: "Close with ')' or change the opening bracket to '['.",
      length: len
    };
  }

  // 4) Unclosed/mismatched brackets inside a node
  if (isInRule(err, 'nodeShape') && err.name === 'MismatchedTokenException') {
    if (expecting(err, 'SquareClose')) {
      const q = findInnerQuoteIssue('[');
      if (q?.kind === 'escaped') {
        return { line, column: q.column, severity: 'error', code: 'FL-LABEL-ESCAPED-QUOTE', message: 'Escaped quotes (\\") in node labels are not supported by Mermaid. Use &quot; instead.', hint: 'Prefer "He said &quot;Hi&quot;".', length: 2 };
      }
      if (q?.kind === 'double-in-double') {
        return { line, column: q.column, severity: 'error', code: 'FL-LABEL-DOUBLE-IN-DOUBLE', message: 'Double quotes inside a double-quoted label are not supported. Use &quot; for inner quotes.', hint: 'Example: A["He said &quot;Hi&quot;"]', length: 1 };
      }
      return { line, column, severity: 'error', code: 'FL-NODE-UNCLOSED-BRACKET', message: "Unclosed '['. Add a matching ']' before the arrow or newline.", hint: "Example: A[Label] --> B", length: 1 };
    }
    if (expecting(err, 'RoundClose')) {
      const q = findInnerQuoteIssue('(');
      if (q?.kind === 'escaped') {
        return { line, column: q.column, severity: 'error', code: 'FL-LABEL-ESCAPED-QUOTE', message: 'Escaped quotes (\\") in node labels are not supported by Mermaid. Use &quot; instead.', hint: 'Prefer "He said &quot;Hi&quot;".', length: 2 };
      }
      if (q?.kind === 'double-in-double') {
        return { line, column: q.column, severity: 'error', code: 'FL-LABEL-DOUBLE-IN-DOUBLE', message: 'Double quotes inside a double-quoted label are not supported. Use &quot; for inner quotes.', hint: 'Example: A["He said &quot;Hi&quot;"]', length: 1 };
      }
      return { line, column, severity: 'error', code: 'FL-NODE-UNCLOSED-BRACKET', message: "Unclosed '('. Add a matching ')'.", hint: "Example: B(Label)", length: 1 };
    }
    if (expecting(err, 'DiamondClose')) {
      // Try to recognize common quote issues inside decision labels and map them to clearer errors
      const q = findInnerQuoteIssue('{');
      if (q?.kind === 'escaped') {
        return {
          line,
          column: q.column,
          severity: 'error',
          code: 'FL-LABEL-ESCAPED-QUOTE',
          message: 'Escaped quotes (\\") in node labels are not supported by Mermaid. Use &quot; instead.',
          hint: 'Example: D{"Is &quot;Driver&quot; AND &quot;AuthCheck.Path&quot; configured?"}',
          length: 2
        };
      }
      if (q?.kind === 'double-in-double') {
        return {
          line,
          column: q.column,
          severity: 'error',
          code: 'FL-LABEL-DOUBLE-IN-DOUBLE',
          message: 'Double quotes inside a double-quoted label are not supported by Mermaid. Use &quot; for inner quotes.',
          hint: 'Example: D{"Is &quot;Driver&quot; and &quot;AuthCheck.Path&quot; configured?"}',
          length: 1
        };
      }
      return { line, column, severity: 'error', code: 'FL-NODE-UNCLOSED-BRACKET', message: "Unclosed '{'. Add a matching '}'.", hint: "Example: C{Decision}", length: 1 };
    }
    if (expecting(err, 'DoubleRoundClose')) {
      const q = findInnerQuoteIssue('(');
      if (q?.kind === 'escaped') {
        return { line, column: q.column, severity: 'error', code: 'FL-LABEL-ESCAPED-QUOTE', message: 'Escaped quotes (\\") in node labels are not supported by Mermaid. Use &quot; instead.', hint: 'Prefer "He said &quot;Hi&quot;".', length: 2 };
      }
      if (q?.kind === 'double-in-double') {
        return { line, column: q.column, severity: 'error', code: 'FL-LABEL-DOUBLE-IN-DOUBLE', message: 'Double quotes inside a double-quoted label are not supported. Use &quot; for inner quotes.', hint: 'Example: A["He said &quot;Hi&quot;"]', length: 1 };
      }
      return { line, column, severity: 'error', code: 'FL-NODE-UNCLOSED-BRACKET', message: "Unclosed '(( '. Add a matching '))'.", hint: "Example: A((Circle))", length: 2 };
    }
    if (expecting(err, 'DoubleSquareClose')) {
      const q = findInnerQuoteIssue('[');
      if (q?.kind === 'escaped') {
        return { line, column: q.column, severity: 'error', code: 'FL-LABEL-ESCAPED-QUOTE', message: 'Escaped quotes (\\") in node labels are not supported by Mermaid. Use &quot; instead.', hint: 'Prefer "He said &quot;Hi&quot;".', length: 2 };
      }
      if (q?.kind === 'double-in-double') {
        return { line, column: q.column, severity: 'error', code: 'FL-LABEL-DOUBLE-IN-DOUBLE', message: 'Double quotes inside a double-quoted label are not supported. Use &quot; for inner quotes.', hint: 'Example: A["He said &quot;Hi&quot;"]', length: 1 };
      }
      return { line, column, severity: 'error', code: 'FL-NODE-UNCLOSED-BRACKET', message: "Unclosed '[[ '. Add a matching ']]'.", hint: "Example: [[Subroutine]]", length: 2 };
    }
    // Stadium and Cylinder are compound shapes: try '(' first, then '['
    if (expecting(err, 'StadiumClose')) {
      let q = findInnerQuoteIssue('(') || findInnerQuoteIssue('[');
      if (q?.kind === 'escaped') {
        return { line, column: q.column, severity: 'error', code: 'FL-LABEL-ESCAPED-QUOTE', message: 'Escaped quotes (\\") in node labels are not supported by Mermaid. Use &quot; instead.', hint: 'Prefer "He said &quot;Hi&quot;".', length: 2 };
      }
      if (q?.kind === 'double-in-double') {
        return { line, column: q.column, severity: 'error', code: 'FL-LABEL-DOUBLE-IN-DOUBLE', message: 'Double quotes inside a double-quoted label are not supported. Use &quot; for inner quotes.', hint: 'Example: A["He said &quot;Hi&quot;"]', length: 1 };
      }
      return { line, column, severity: 'error', code: 'FL-NODE-UNCLOSED-BRACKET', message: "Unclosed '([ '. Add a matching '])'.", hint: "Example: A([Stadium])", length: len };
    }
    if (expecting(err, 'CylinderClose')) {
      let q = findInnerQuoteIssue('(') || findInnerQuoteIssue('[');
      if (q?.kind === 'escaped') {
        return { line, column: q.column, severity: 'error', code: 'FL-LABEL-ESCAPED-QUOTE', message: 'Escaped quotes (\\") in node labels are not supported by Mermaid. Use &quot; instead.', hint: 'Prefer "He said &quot;Hi&quot;".', length: 2 };
      }
      if (q?.kind === 'double-in-double') {
        return { line, column: q.column, severity: 'error', code: 'FL-LABEL-DOUBLE-IN-DOUBLE', message: 'Double quotes inside a double-quoted label are not supported. Use &quot; for inner quotes.', hint: 'Example: A["He said &quot;Hi&quot;"]', length: 1 };
      }
      return { line, column, severity: 'error', code: 'FL-NODE-UNCLOSED-BRACKET', message: "Unclosed '[( '. Add a matching ')]'.", hint: "Example: A[(Cylinder)]", length: len };
    }
    if (expecting(err, 'HexagonClose')) {
      const q = findInnerQuoteIssue('{');
      if (q?.kind === 'escaped') {
        return { line, column: q.column, severity: 'error', code: 'FL-LABEL-ESCAPED-QUOTE', message: 'Escaped quotes (\\") in node labels are not supported by Mermaid. Use &quot; instead.', hint: 'Prefer "He said &quot;Hi&quot;".', length: 2 };
      }
      if (q?.kind === 'double-in-double') {
        return { line, column: q.column, severity: 'error', code: 'FL-LABEL-DOUBLE-IN-DOUBLE', message: 'Double quotes inside a double-quoted label are not supported. Use &quot; for inner quotes.', hint: 'Example: A["He said &quot;Hi&quot;"]', length: 1 };
      }
      return { line, column, severity: 'error', code: 'FL-NODE-UNCLOSED-BRACKET', message: "Unclosed '{{ '. Add a matching '}}'.", hint: "Example: A{{Hexagon}}", length: len };
    }
  }

  // 4b) Quotes appear inside an unquoted label content
  if (isInRule(err, 'nodeContent') && err.name === 'MismatchedTokenException' && tokType === 'QuotedString') {
    return {
      line, column, severity: 'error', code: 'FL-LABEL-QUOTE-IN-UNQUOTED',
      message: 'Double quotes inside an unquoted label are not allowed. Wrap the entire label in quotes or use &quot;.',
      hint: 'Example: A["Calls logger.debug(&quot;message&quot;, data)"]',
      length: len
    };
  }

  

  // 5) Invalid/Incomplete class statement
  if (isInRule(err, 'classStatement')) {
    return {
      line, column, severity: 'error', code: 'FL-CLASS-MALFORMED',
      message: 'Invalid class statement. Provide node id(s) then a class name.',
      hint: 'Example: class A,B important',
      length: len
    };
  }

  // 6) Subgraph requires header (id or [Title])
  if (isInRule(err, 'subgraph') && err.name === 'NoViableAltException') {
    return {
      line, column, severity: 'error', code: 'FL-SUBGRAPH-MISSING-HEADER',
      message: 'Subgraph header is missing. Add an ID or a [Title] after the keyword.',
      hint: 'Example: subgraph API [API Layer]',
      length: len
    };
  }

  // 7) Unmatched 'end' with no open subgraph
  if (err.name === 'NotAllInputParsedException' && tokType === 'EndKeyword') {
    return {
      line, column, severity: 'error', code: 'FL-END-WITHOUT-SUBGRAPH',
      message: "'end' without a matching 'subgraph'.",
      hint: 'Remove this end or add a subgraph above.',
      length: len
    };
  }

  // Default: keep original message
  return {
    line,
    column,
    severity: 'error',
    message: err.message || 'Parser error',
    length: len
  };
}

export function mapPieParserError(err: IRecognitionException, text: string): ValidationError {
  const tok = err.token;
  const posFallback = endOfTextPos(text);
  const { line, column } = coercePos(tok?.startLine ?? null, tok?.startColumn ?? null, posFallback.line, posFallback.column);
  const found = tokenImage(tok);
  const len = typeof (tok as any)?.image === 'string' && (tok as any).image.length > 0 ? (tok as any).image.length : 1;
  const lines = text.split(/\r?\n/);
  const ltxt = lines[Math.max(0, line - 1)] || '';

  // Colon at top-level usually means missing quoted label before it
  if (err.name === 'NotAllInputParsedException' && tok?.tokenType?.name === 'Colon') {
    return {
      line, column, severity: 'error', code: 'PI-LABEL-REQUIRES-QUOTES',
      message: 'Slice labels must be quoted (single or double quotes).',
      hint: 'Example: "Dogs" : 10',
      length: len
    };
  }

  // Heuristic: unquoted label before a colon (token may point anywhere on the line)
  if (err.name === 'NotAllInputParsedException') {
    const colonIdx = ltxt.indexOf(':');
    if (colonIdx > 0) {
      const left = ltxt.slice(0, colonIdx);
      const startsWithQuote = left.trimStart().startsWith('"') || left.trimStart().startsWith("'");
      if (!startsWithQuote) {
        return {
          line,
          column: Math.max(1, colonIdx),
          severity: 'error',
          code: 'PI-LABEL-REQUIRES-QUOTES',
          message: 'Slice labels must be quoted (single or double quotes).',
          hint: 'Example: "Dogs" : 10',
          length: 1
        };
      }
    }
  }

  // Unclosed quote: token looks like it starts with a quote but never closed
  if (err.name === 'NotAllInputParsedException' && typeof tok?.image === 'string') {
    const s = tok.image as string;
    if ((s.startsWith('"') && !s.slice(1).includes('"')) || (s.startsWith("'") && !s.slice(1).includes("'"))) {
      return {
        line, column, severity: 'error', code: 'PI-QUOTE-UNCLOSED',
        message: 'Unclosed quote in slice label.',
        hint: 'Close the quote: "Dogs" : 10',
        length: len
      };
    }
  }

  // Missing colon between label and number
  if (expecting(err, 'Colon')) {
    // Heuristic: inner unescaped quotes inside a double-quoted label often yield an unexpected token before ':'
    const dbl = (ltxt.match(/\"/g) || []).length;
    const dq = (ltxt.match(/"/g) || []).length - dbl;
    if (dq >= 3) {
      const qPos: number[] = [];
      for (let i = 0; i < ltxt.length; i++) if (ltxt[i] === '"') qPos.push(i);
      const col3 = (qPos[2] ?? (column - 1)) + 1;
      return {
        line,
        column: col3,
        severity: 'error',
        code: 'PI-LABEL-DOUBLE-IN-DOUBLE',
        message: 'Double quotes inside a double-quoted slice label are not supported. Use &quot; for inner quotes.',
        hint: 'Example: "He said &quot;Hi&quot;" : 1',
        length: 1
      };
    }
    return {
      line, column, severity: 'error', code: 'PI-MISSING-COLON',
      message: 'Missing colon between slice label and value.',
      hint: 'Use: "Label" : 10',
      length: len
    };
  }

  // Missing number after colon
  if (expecting(err, 'NumberLiteral')) {
    return {
      line, column, severity: 'error', code: 'PI-MISSING-NUMBER',
      message: 'Missing numeric value after colon.',
      hint: 'Use a number like 10 or 42.5',
      length: len
    };
  }

  // Unquoted label
  if (expecting(err, 'QuotedString')) {
    return {
      line, column, severity: 'error', code: 'PI-LABEL-REQUIRES-QUOTES',
      message: 'Slice labels must be quoted (single or double quotes).',
      hint: 'Example: "Dogs" : 10',
      length: len
    };
  }

  return { line, column, severity: 'error', message: err.message || 'Parser error', length: len };
}

export function mapSequenceParserError(err: IRecognitionException, text: string): ValidationError {
  const tok = err.token;
  const posFallback = endOfTextPos(text);
  const { line, column } = coercePos(tok?.startLine ?? null, tok?.startColumn ?? null, posFallback.line, posFallback.column);
  const found = tokenImage(tok);
  const tokType = tok?.tokenType?.name;
  const len = typeof (tok as any)?.image === 'string' && (tok as any).image.length > 0 ? (tok as any).image.length : 1;
  const lines = text.split(/\r?\n/);
  const ltxt = lines[Math.max(0, line - 1)] || '';

  const inRule = (name: string) => isInRule(err, name);
  // Debug fallback: if in participantDecl when actorRef fails, treat as actorRef for quote heuristics
  const inActorRefContext = inRule('actorRef') || inRule('participantDecl');
  const exp = (name: string) => expecting(err, name);
  const atHeader = (err as any)?.context?.ruleStack?.[0] === 'diagram' && ((err as any)?.context?.ruleStack?.length === 1);

  // Generic handling for branch keywords (else/and/option)
  const branchRules: Array<{
    tok: string; key: string; allowedRule: string; allowedLabel: string; example: string
  }> = [
    { tok: 'ElseKeyword',   key: 'else',   allowedRule: 'altBlock',      allowedLabel: 'alt',      example: 'alt Condition\n  …\nelse\n  …\nend' },
    { tok: 'AndKeyword',    key: 'and',    allowedRule: 'parBlock',      allowedLabel: 'par',      example: 'par\n  …\nand\n  …\nend' },
    { tok: 'OptionKeyword', key: 'option', allowedRule: 'criticalBlock', allowedLabel: 'critical', example: 'critical\n  …\noption Label\n  …\nend' },
  ];
  const stack: string[] = ((err as any)?.context?.ruleStack) || [];
  const currentBlock = stack.slice().reverse().find((s: string) => /Block$/.test(s));
  const br = branchRules.find(r => r.tok === tokType);
  if (br) {
    if (!currentBlock) {
      // Keep specific legacy codes for else/and outside
      if (br.key === 'else') {
        return { line, column, severity: 'error', code: 'SE-ELSE-OUTSIDE-ALT', message: "'else' is only allowed inside 'alt' blocks.", hint: 'Use: alt Condition … else … end', length: len };
      }
      if (br.key === 'and') {
        return { line, column, severity: 'error', code: 'SE-AND-OUTSIDE-PAR', message: "'and' is only allowed inside 'par' blocks.", hint: 'Example: par … and … end (parallel branches).', length: len };
      }
      return {
        line, column, severity: 'error', code: 'SE-BRANCH-OUTSIDE-BLOCK',
        message: `'${br.key}' is only allowed inside a '${br.allowedLabel}' block.`,
        hint: `Start a ${br.allowedLabel} section:\n${br.example}`,
        length: len
      };
    }
    if (currentBlock !== br.allowedRule) {
      // Keep specific code for else-in-critical
      if (br.key === 'else' && currentBlock === 'criticalBlock') {
        return { line, column, severity: 'error', code: 'SE-ELSE-IN-CRITICAL', message: "'else' is not allowed inside a 'critical' block. Use 'option' or close the block with 'end'.", hint: "Replace with: option <label>\nExample:\noption Retry", length: len };
      }
      const actual = (currentBlock || '').replace(/Block$/, '') || 'block';
      return {
        line, column, severity: 'error', code: 'SE-BRANCH-IN-WRONG-BLOCK',
        message: `'${br.key}' is only valid in '${br.allowedLabel}' blocks (not inside '${actual}').`,
        hint: `Use the proper branch for '${actual}' or close it with 'end'.\nFor '${br.allowedLabel}', use:\n${br.example}`,
        length: len
      };
    }
  }

  // Header must be 'sequenceDiagram'
  if (atHeader && exp('SequenceKeyword')) {
    return { line, column, severity: 'error', code: 'SE-HEADER-MISSING', message: "Missing 'sequenceDiagram' header.", hint: "Start with: sequenceDiagram", length: len };
  }

  // Message syntax requires colon before message text
  if (inRule('messageStmt') && err.name === 'MismatchedTokenException' && exp('Colon')) {
    return { line, column, severity: 'error', code: 'SE-MSG-COLON-MISSING', message: 'Missing colon after target actor in message.', hint: 'Use: A->>B: Message text', length: len };
  }

  // Unclosed quotes in actor references (participant/actor names or aliases)
  if (inActorRefContext && (err.name === 'NoViableAltException' || err.name === 'MismatchedTokenException' || err.name === 'EarlyExitException')) {
    const unc = detectUnclosedQuotesInText(text, {
      code: 'SE-QUOTE-UNCLOSED',
      message: 'Unclosed quote in participant/actor name.',
      hint: 'Close the quote: participant "Bob"  or  participant Alice as "Alias"',
      limitPerFile: Number.MAX_SAFE_INTEGER
    });
    const onLine = unc.find(u => u.line === line);
    if (onLine) return { ...onLine, severity: 'warning' };

    const dblEsc = (ltxt.match(/\"/g) || []).length;
    const dq = (ltxt.match(/"/g) || []).length - dblEsc;
    const sq = (ltxt.match(/'/g) || []).length;
    if (dq >= 3) {
      const qPos: number[] = [];
      for (let i = 0; i < ltxt.length; i++) if (ltxt[i] === '"') qPos.push(i);
      const col3 = (qPos[2] ?? (column - 1)) + 1;
      return { line, column: col3, severity: 'warning', code: 'SE-LABEL-DOUBLE-IN-DOUBLE', message: 'Double quotes inside a double-quoted name/label are not supported. Use &quot; for inner quotes.', hint: 'Example: participant "Logger &quot;debug&quot;" as L', length: 1 };
    }
  }

  // Unknown/invalid arrow token
  if (inRule('arrow') && err.name === 'NoViableAltException') {
    return { line, column, severity: 'error', code: 'SE-ARROW-INVALID', message: `Invalid sequence arrow near '${found}'.`, hint: 'Use ->, -->, ->>, -->>, -x, --x, -), --), <<->>, or <<-->>', length: len };
  }

  // Note forms
  if (inRule('noteStmt')) {
    if (err.name === 'MismatchedTokenException' && exp('Colon')) {
      return { line, column, severity: 'error', code: 'SE-NOTE-MALFORMED', message: 'Malformed note: missing colon before the note text.', hint: 'Example: Note right of Alice: Hello', length: len };
    }
    if (err.name === 'NoViableAltException') {
      return { line, column, severity: 'error', code: 'SE-NOTE-MALFORMED', message: 'Malformed note statement. Use left|right of X or over X[,Y]: text', hint: 'Examples: Note over A,B: hi', length: len };
    }
  }

  // 'else' inside a 'critical' block is invalid (should use 'option')
  if (tokType === 'ElseKeyword' && isInRule(err, 'criticalBlock')) {
    return {
      line, column, severity: 'error', code: 'SE-ELSE-IN-CRITICAL',
      message: "'else' is not allowed inside a 'critical' block. Use 'option' or close the block with 'end'.",
      hint: "Replace with: option <label>\nExample:\noption Retry",
      length: len
    };
  }

  // Box blocks only allow participant declarations
  if (inRule('boxBlock') && (err.name === 'NoViableAltException' || err.name === 'MismatchedTokenException')) {
    // Check if we're seeing a message arrow or other non-participant statement
    const isMessage = /->|-->>|-->/.test(ltxt);
    const isNote = /note\s+(left|right|over)/i.test(ltxt);
    const isActivate = /activate\s+/i.test(ltxt);
    const isDeactivate = /deactivate\s+/i.test(ltxt);
    if (isMessage || isNote || isActivate || isDeactivate || tokType === 'NoteKeyword' || tokType === 'ActivateKeyword' || tokType === 'DeactivateKeyword') {
      // Check if there's an 'end' keyword later in the file - if not, it's missing-end, not invalid-content
      const lines = text.split(/\r?\n/);
      const boxLine = Math.max(0, line - 1);
      let hasEnd = false;
      // Find the opening box line upwards
      let openIdx = -1;
      for (let i = boxLine; i >= 0; i--) {
        if (/^\s*box\b/.test(lines[i] || '')) { openIdx = i; break; }
      }
      if (openIdx !== -1) {
        // Check if there's an 'end' after the current line
        for (let i = boxLine; i < lines.length; i++) {
          if (/^\s*end\s*$/.test(lines[i] || '')) { hasEnd = true; break; }
          // Stop if we find another block or outdent
          if (i > boxLine && /^\s*(sequenceDiagram|box|alt|opt|loop|par|rect|critical|break)\b/.test(lines[i] || '')) break;
        }
      }
      if (hasEnd) {
        // Check if there are ANY participants in the box
        let hasParticipants = false;
        for (let i = openIdx + 1; i < lines.length; i++) {
          const raw = lines[i] || '';
          if (/^\s*end\s*$/.test(raw)) break;
          if (/^\s*(participant|actor)\b/i.test(raw)) {
            hasParticipants = true;
            break;
          }
        }

        if (!hasParticipants) {
          // Box with no participants - suggest using 'rect' instead
          return {
            line: openIdx + 1, column: 1, severity: 'error', code: 'SE-BOX-EMPTY',
            message: "Box block has no participant/actor declarations. Use 'rect' to group messages visually.",
            hint: "Replace 'box' with 'rect' if you want to group messages:\nrect rgb(240, 240, 255)\n  A->>B: Message\n  Note over A: Info\nend",
            length: 3
          };
        }

        return {
          line, column, severity: 'error', code: 'SE-BOX-INVALID-CONTENT',
          message: 'Box blocks can only contain participant/actor declarations.',
          hint: 'Move messages, notes, and other statements outside the box block.\nExample:\nbox "Group"\n  participant A\n  participant B\nend\nA->>B: Message',
          length: len
        };
      }
      // Otherwise fall through to missing-end handler
    }
  }

  // Missing 'end' inside a block (alt/opt/loop/par/rect/critical/break/box)
  const blockRules: Array<{ rule: string; label: string }> = [
    { rule: 'altBlock', label: 'alt' },
    { rule: 'optBlock', label: 'opt' },
    { rule: 'loopBlock', label: 'loop' },
    { rule: 'parBlock', label: 'par' },
    { rule: 'rectBlock', label: 'rect' },
    { rule: 'criticalBlock', label: 'critical' },
    { rule: 'breakBlock', label: 'break' },
    { rule: 'boxBlock', label: 'box' },
  ];
  if (err.name === 'MismatchedTokenException' && exp('EndKeyword')) {
    const blk = blockRules.find(b => isInRule(err, b.rule));
    if (blk) {
      const lines = text.split(/\r?\n/);
      // Find opener and its indent
      const openerRe = /^(\s*)(alt\b|opt\b|loop\b|par\b|rect\b|critical\b|break\b|box\b)/;
      let openIdx = -1; let openIndent = '';
      for (let i = Math.max(0, line - 1); i >= 0; i--) {
        const m = openerRe.exec(lines[i] || '');
        if (m) { openIdx = i; openIndent = m[1] || ''; break; }
      }
      // Default caret line is current if opener not found
      let caretLine = line;
      if (openIdx !== -1) {
        // Find first non-empty line whose indent <= opener indent → insert before it
        caretLine = lines.length; // default to EOF
        for (let i = openIdx + 1; i < lines.length; i++) {
          const raw = lines[i] || '';
          if (raw.trim() === '') continue;
          const ind = (raw.match(/^(\s*)/)?.[1] || '');
          if (ind.length <= openIndent.length) { caretLine = i + 1; break; }
        }
        if (caretLine > lines.length) caretLine = lines.length + 1; // at EOF
      }
      return {
        line: caretLine,
        column: 1,
        severity: 'error',
        code: 'SE-BLOCK-MISSING-END',
        message: `Missing 'end' to close a '${blk.label}' block.`,
        hint: "Add 'end' on its own line aligned with the block's start.",
        length: 1
      };
    }
  }

  // Block control keywords outside blocks
  if ((err.name === 'NoViableAltException' || err.name === 'NotAllInputParsedException') && tokType === 'ElseKeyword') {
    return { line, column, severity: 'error', code: 'SE-ELSE-OUTSIDE-ALT', message: "'else' is only allowed inside 'alt' blocks.", hint: 'Use: alt Condition … else … end', length: len };
  }
  if ((err.name === 'NoViableAltException' || err.name === 'NotAllInputParsedException') && tokType === 'AndKeyword') {
    return { line, column, severity: 'error', code: 'SE-AND-OUTSIDE-PAR', message: "'and' is only allowed inside 'par' blocks.", hint: 'Example: par … and … end (parallel branches).', length: len };
  }
  if ((err.name === 'NoViableAltException' || err.name === 'NotAllInputParsedException') && tokType === 'EndKeyword') {
    return { line, column, severity: 'error', code: 'SE-END-WITHOUT-BLOCK', message: "'end' without an open block (alt/opt/loop/par/rect/critical/break/box).", hint: 'Add a block above (e.g., par … end | alt … end) or remove this end.', length: len };
  }

  // Fallback handled by shared detectors in validators; keep parser mapping focused.

  // Autonumber malformed / specific cases
  if (inRule('autonumberStmt')) {
    // Non-numeric step value
    if (tokType === 'Identifier') {
      return { line, column, severity: 'error', code: 'SE-AUTONUMBER-NON-NUMERIC', message: `Autonumber values must be numbers. Found '${found}'.`, hint: 'Use numbers: autonumber 10 or autonumber 10 10 (start and step).', length: len };
    }
    // Participant/actor where a number or newline is expected
    if (tokType === 'ParticipantKeyword' || tokType === 'ActorKeyword') {
      return { line, column, severity: 'error', code: 'SE-AUTONUMBER-EXTRANEOUS', message: "Unexpected token after 'autonumber'. Put 'autonumber' on its own line.", hint: 'Example:\nautonumber 10 10\nparticipant A', length: len };
    }
    if (err.name === 'NoViableAltException' || err.name === 'MismatchedTokenException' || err.name === 'NotAllInputParsedException') {
      return { line, column, severity: 'error', code: 'SE-AUTONUMBER-MALFORMED', message: 'Malformed autonumber statement.', hint: 'Use: autonumber | autonumber off | autonumber 10 10', length: len };
    }
  }

  // Create/destroy malformed
  if (inRule('createStmt') && (tokType === 'Newline' || tokType === 'EOF')) {
    return {
      line, column, severity: 'error', code: 'SE-CREATE-MISSING-NAME',
      message: "Missing name after 'create'.",
      hint: "Use: create participant A  or  create actor B",
      length: len
    };
  }
  if (inRule('createStmt') && (err.name === 'MismatchedTokenException' || err.name === 'NoViableAltException')) {
    return {
      line, column, severity: 'error', code: 'SE-CREATE-MALFORMED',
      message: "After 'create', specify 'participant' or 'actor' before the name.",
      hint: "Examples:\ncreate participant B\ncreate actor D as Donald",
      length: len
    };
  }
  if (inRule('destroyStmt') && err.name === 'MismatchedTokenException') {
    return { line, column, severity: 'error', code: 'SE-DESTROY-MALFORMED', message: "After 'destroy', specify 'participant' or 'actor' and a name.", hint: 'Examples:\ndestroy participant A\ndestroy actor B', length: len };
  }
  if (inRule('destroyStmt') && (tokType === 'Newline' || tokType === 'EOF')) {
    return {
      line, column, severity: 'error', code: 'SE-DESTROY-MISSING-NAME',
      message: "Missing name after 'destroy'.",
      hint: "Use: destroy participant A  or  destroy actor B",
      length: len
    };
  }

  // Generic fallback: if the current line has triple or more quotes, hint double-in-double
  const dblEsc2 = (ltxt.match(/\"/g) || []).length;
  const dq2 = (ltxt.match(/"/g) || []).length - dblEsc2;
  if (dq2 >= 3) {
    const qPos: number[] = [];
    for (let i = 0; i < ltxt.length; i++) if (ltxt[i] === '"') qPos.push(i);
    const col3 = (qPos[2] ?? (column - 1)) + 1;
    return { line, column: col3, severity: 'error', code: 'SE-LABEL-DOUBLE-IN-DOUBLE', message: 'Double quotes inside a double-quoted name/label are not supported. Use &quot; for inner quotes.', hint: 'Example: participant "Logger &quot;debug&quot;" as L', length: 1 };
  }

  return { line, column, severity: 'error', message: err.message || 'Parser error', length: len };
}

// ------------------ Class Diagram diagnostics ------------------
export function mapClassParserError(err: IRecognitionException, text: string): ValidationError {
  const tok = err.token;
  const posFallback = endOfTextPos(text);
  const { line, column } = coercePos(tok?.startLine ?? null, tok?.startColumn ?? null, posFallback.line, posFallback.column);
  const tokType = tok?.tokenType?.name;
  const len = typeof (tok as any)?.image === 'string' && (tok as any).image.length > 0 ? (tok as any).image.length : 1;
  const lines = text.split(/\r?\n/);
  const ltxt = lines[Math.max(0, line - 1)] || '';

  // Header required
  if (atHeader(err) && !expecting(err, 'ClassDiagramKeyword')) {
    return { line, column, severity: 'error', code: 'CL-HEADER-MISSING', message: "Missing 'classDiagram' header.", hint: 'Start with: classDiagram', length: len };
  }

  // Invalid relation operator
  if (isInRule(err, 'relationOp')) {
    // On class lines, let postLex handle the quoted-name diagnostic; return a generic parser error here to avoid duplicate codes.
    if (/^\s*class\b/.test(ltxt)) {
      return { line, column, severity: 'error', message: err.message || 'Parser error', length: len };
    }
    return { line, column, severity: 'error', code: 'CL-REL-INVALID', message: 'Invalid relationship operator. Use <|--, *--, o--, --, ..> or ..|>.', hint: 'Example: Foo <|-- Bar', length: len };
  }

  // Class block missing closing brace (can surface under classBlock or classLine)
  if ((isInRule(err, 'classBlock') || isInRule(err, 'classLine')) && err.name === 'MismatchedTokenException' && expecting(err, 'RCurly')) {
    return { line, column, severity: 'error', code: 'CL-BLOCK-MISSING-RBRACE', message: "Missing '}' to close class block.", hint: "Close the block: class Foo { ... }", length: len };
  }

  // Member line malformed (e.g., missing name)
  if (isInRule(err, 'memberLine') && (err.name === 'MismatchedTokenException' || err.name === 'NoViableAltException')) {
    return { line, column, severity: 'error', code: 'CL-MEMBER-MALFORMED', message: 'Malformed class member. Use visibility + name [()][: type].', hint: 'Examples: +foo() : void  |  -bar: int', length: len };
  }

  // Relation line missing target
  if (isInRule(err, 'relationStmt') && err.name === 'MismatchedTokenException') {
    return { line, column, severity: 'error', code: 'CL-REL-MALFORMED', message: 'Malformed relationship. Use: A <op> B [: label]', hint: 'Example: Foo <|-- Bar : extends', length: len };
  }

  // For class diagrams we prefer token-based detection for quoted names; no generic double-in-double fallback here.

  return { line, column, severity: 'error', message: err.message || 'Parser error', length: len };
}

// ------------------ State Diagram diagnostics ------------------
export function mapStateParserError(err: IRecognitionException, text: string): ValidationError {
  const tok = err.token;
  const posFallback = endOfTextPos(text);
  const { line, column } = coercePos(tok?.startLine ?? null, tok?.startColumn ?? null, posFallback.line, posFallback.column);
  const tokType = tok?.tokenType?.name;
  const len = typeof (tok as any)?.image === 'string' && (tok as any).image.length > 0 ? (tok as any).image.length : 1;
  const lines = text.split(/\r?\n/);
  const ltxt = lines[Math.max(0, line - 1)] || '';

  // Header must be stateDiagram or stateDiagram-v2
  if (atHeader(err) && !(expecting(err, 'StateDiagram') || expecting(err, 'StateDiagramV2'))) {
    return { line, column, severity: 'error', code: 'ST-HEADER-MISSING', message: "Missing 'stateDiagram' header.", hint: 'Start with: stateDiagram-v2', length: len };
  }

  // Invalid arrow token handled in postLex; avoid duplicate mapping here.

  // Missing colon in note forms
  if (isInRule(err, 'noteStmt') && (err.name === 'MismatchedTokenException' && expecting(err, 'Colon'))) {
    return { line, column, severity: 'error', code: 'ST-NOTE-MALFORMED', message: 'Malformed note: missing colon before note text.', hint: 'Example: Note right of A: message', length: len };
  }
  // (Removed) special-casing for 'Note over' now that grammar accepts it; glued notes handled in postLex.

  // state block missing closing brace
  if (isInRule(err, 'stateBlock') && err.name === 'MismatchedTokenException' && expecting(err, 'RCurly')) {
    return { line, column, severity: 'error', code: 'ST-BLOCK-MISSING-RBRACE', message: "Missing '}' to close a state block.", hint: "Close the block: state Foo { ... }", length: len };
  }

  // '---' outside of a state block
  if ((err.name === 'NoViableAltException' || err.name === 'MismatchedTokenException') && tokType === 'Dashes' && !isInRule(err, 'innerStatement')) {
    return { line, column, severity: 'error', code: 'ST-CONCURRENCY-OUTSIDE-BLOCK', message: "'---' is only allowed inside 'state { … }' blocks.", hint: "Move '---' inside a composite state block: state A { … --- … }", length: len };
  }

  // Double-in-double label/name heuristic
  const dblEsc = (ltxt.match(/\\\"/g) || []).length;
  const dq = (ltxt.match(/\"/g) || []).length - dblEsc;
  if (dq >= 3) {
    const qPos: number[] = [];
    for (let i = 0; i < ltxt.length; i++) if (ltxt[i] === '"') qPos.push(i);
    const col3 = (qPos[2] ?? (column - 1)) + 1;
    return { line, column: col3, severity: 'warning', code: 'ST-LABEL-DOUBLE-IN-DOUBLE', message: 'Double quotes inside a double-quoted name/label may be invalid. Use &quot; for inner quotes.', hint: 'Example: state "Logger &quot;core&quot;" as L', length: 1 };
  }

  return { line, column, severity: 'error', message: err.message || 'Parser error', length: len };
}
