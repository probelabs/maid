import type { ValidationError, TextEditLC, FixLevel } from './types.js';
import { insertAt, replaceRange, lineTextAt, inferIndentFromLine } from './edits.js';

// Helpers
function at(e: ValidationError) { return { line: e.line, column: e.column }; }

function is(code: string, e: ValidationError) { return e.code === code; }

export function computeFixes(text: string, errors: ValidationError[], level: FixLevel = 'safe'): TextEditLC[] {
  const edits: TextEditLC[] = [];
  const patchedLines = new Set<number>();
  const seen = new Set<string>();
  const piQuoteClosedLines = new Set<number>();
  for (const e of errors) {
    const key = `${e.code}@${e.line}:${e.column}:${e.length ?? 1}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Flowchart fixes
    if (is('FL-ARROW-INVALID', e)) {
      edits.push(replaceRange(text, at(e), e.length ?? 2, '-->'));
      continue;
    }
    if (is('CL-NAME-DOUBLE-QUOTED', e)) {
      // Safer transform:
      // - If alias present: class "Label" as ID  => class ID["Label"]
      // - Else: class "Label" => class `Label`
      const lineText = lineTextAt(text, e.line);
      const kwIdx = lineText.indexOf('class');
      const startSearch = kwIdx >= 0 ? kwIdx + 5 : 0;
      const q1 = lineText.indexOf('"', startSearch);
      if (q1 !== -1) {
        const asIdx = lineText.indexOf(' as ', q1 + 1);
        const q2 = asIdx !== -1 ? lineText.lastIndexOf('"', asIdx - 1) : lineText.lastIndexOf('"');
        if (q2 > q1) {
          if (asIdx !== -1) {
            // Extract label text and build a double-quoted label with &quot; for inner quotes
            const innerLbl = lineText.slice(q1 + 1, q2);
            const dblQuoted = '"' + innerLbl.replace(/\"/g, '"').replace(/"/g, '&quot;') + '"';
            // Build: class <alias>["..."] (remove the quoted name and 'as')
            const alias = lineText.slice(asIdx + 4).trim();
            const before = lineText.slice(0, startSearch).trimEnd();
            const newLine = `${before} ${alias}[${dblQuoted}]`;
            edits.push({ start: { line: e.line, column: 1 }, end: { line: e.line, column: lineText.length + 1 }, newText: newLine });
          } else {
            // No alias: switch to backticks around name
            edits.push(replaceRange(text, { line: e.line, column: q1 + 1 }, 1, '`'));
            edits.push(replaceRange(text, { line: e.line, column: q2 + 1 }, 1, '`'));
          }
        }
      }
      continue;
    }
    if (is('FL-LABEL-ESCAPED-QUOTE', e)) {
      // Prefer rewriting the whole double-quoted span within a shape so we catch all occurrences at once
      const lineText = lineTextAt(text, e.line);
      const caret0 = Math.max(0, e.column - 1);
      const opens = [
        { tok: '[[', idx: lineText.lastIndexOf('[[', caret0), delta: 2 },
        { tok: '{',  idx: lineText.lastIndexOf('{',  caret0), delta: 1 },
        { tok: '[',  idx: lineText.lastIndexOf('[',  caret0), delta: 1 },
        { tok: '((', idx: lineText.lastIndexOf('((', caret0), delta: 2 },
      ].filter(o => o.idx !== -1).sort((a,b)=> a.idx - b.idx);
      const open = opens.pop();
      if (open) {
        const closeIdxCandidates = [
          lineText.indexOf(']]', caret0),
          lineText.indexOf('}',  caret0),
          lineText.indexOf(']',  caret0),
          lineText.indexOf('))', caret0),
        ].filter(i => i !== -1).sort((a,b)=> a-b);
        const closeIdx = closeIdxCandidates.length ? closeIdxCandidates[0] : -1;
        if (closeIdx !== -1) {
          const q1 = lineText.indexOf('"', open.idx + open.delta);
          const q2 = lineText.lastIndexOf('"', closeIdx - 1);
          if (q1 !== -1 && q2 !== -1 && q2 > q1) {
            const inner = lineText.slice(q1 + 1, q2);
            if (inner.includes('\\"')) {
              const replaced = inner.split('\\\"').join('&quot;');
              edits.push({ start: { line: e.line, column: q1 + 2 }, end: { line: e.line, column: q2 + 1 }, newText: replaced });
              continue;
            }
          }
        }
      }
      // Fallback: replace only the current occurrence
      edits.push(replaceRange(text, at(e), e.length ?? 2, '&quot;'));
      continue;
    }
    // Flowchart: fix inner quotes inside a double-quoted label within shapes ([], (), {}, [[ ]], (( ))).
    if (is('FL-LABEL-DOUBLE-IN-DOUBLE', e)) {
      const lineText = lineTextAt(text, e.line);
      const caret0 = Math.max(0, e.column - 1);
      // Find nearest shape opener before caret
      const opens = [
        { tok: '[[', idx: lineText.lastIndexOf('[[', caret0) },
        { tok: '((', idx: lineText.lastIndexOf('((', caret0) },
        { tok: '{',  idx: lineText.lastIndexOf('{', caret0) },
        { tok: '(',  idx: lineText.lastIndexOf('(', caret0) },
        { tok: '[',  idx: lineText.lastIndexOf('[', caret0) },
      ];
      const open = opens.sort((a,b)=> (a.idx||-1) - (b.idx||-1)).pop();
      const openIdx = open && open.idx >= 0 ? open.idx : -1;
      if (openIdx >= 0) {
        // Find nearest closer after caret
        const closers = [
          { tok: ']]', idx: lineText.indexOf(']]', caret0) },
          { tok: '))', idx: lineText.indexOf('))', caret0) },
          { tok: '}',  idx: lineText.indexOf('}',  caret0) },
          { tok: ')',  idx: lineText.indexOf(')',  caret0) },
          { tok: ']',  idx: lineText.indexOf(']',  caret0) },
        ].filter(c => c.idx !== -1).sort((a,b)=> a.idx - b.idx);
        const close = closers[0];
        const closeIdx = close ? close.idx : lineText.length;
        // Outer quotes within the shape content
        const q1 = lineText.indexOf('"', openIdx + 1);
        const q2 = lineText.lastIndexOf('"', closeIdx - 1);
        if (q1 !== -1 && q2 !== -1 && q2 > q1) {
          const inner = lineText.slice(q1 + 1, q2);
          const replaced = inner.split('&quot;').join('\u0000').split('"').join('&quot;').split('\u0000').join('&quot;');
          if (replaced !== inner) {
            const start = { line: e.line, column: q1 + 2 };
            const end = { line: e.line, column: q2 + 1 };
            edits.push({ start, end, newText: replaced });
            continue;
          }
        }
      }
      // Fallback: replace the current character only
      edits.push(replaceRange(text, at(e), e.length ?? 1, '&quot;'));
      continue;
    }
    if (is('FL-LABEL-DOUBLE-IN-SINGLE', e)) {
      const lineText = lineTextAt(text, e.line);
      const caret0 = Math.max(0, e.column - 1);
      const q1 = lineText.lastIndexOf("'", caret0);
      const q2 = lineText.indexOf("'", Math.max(caret0 + 1, q1 + 1));
      if (q1 !== -1 && q2 !== -1 && q2 > q1) {
        const inner = lineText.slice(q1 + 1, q2);
        const replaced = inner.split('&quot;').join('\u0000').split('"').join('&quot;').split('\u0000').join('&quot;');
        if (replaced !== inner) {
          const start = { line: e.line, column: q1 + 2 };
          const end = { line: e.line, column: q2 + 1 };
          edits.push({ start, end, newText: replaced });
          patchedLines.add(e.line);
          continue;
        }
      }
      // Fallback: replace the current character only
      if (patchedLines.has(e.line)) { continue; }
      edits.push(replaceRange(text, at(e), e.length ?? 1, '&quot;'));
      continue;
    }
    if (is('FL-NODE-MIXED-BRACKETS', e)) {
      // Prefer fixing the opener for the common case: opened '(' but closed with ']'
      const msg = e.message || '';
      const lineText = lineTextAt(text, e.line);
      const caret0 = Math.max(0, e.column - 1);
      if (msg.includes("opened '('") && msg.includes("closed with ']'")) {
        const openIdx = lineText.lastIndexOf('(', caret0);
        if (openIdx !== -1) {
          edits.push({ start: { line: e.line, column: openIdx + 1 }, end: { line: e.line, column: openIdx + 2 }, newText: '[' });
          continue;
        }
      }
      // Otherwise, replace the wrong closer with the correct one inferred from the message
      let closer = ')';
      if (msg.includes("opened '['")) closer = ']';
      else if (msg.includes("opened '('")) closer = ')';
      else if (msg.includes("opened '{'")) closer = '}';
      else if (msg.includes("opened '[[ '")) closer = ']]';
      else if (msg.includes("opened '(( '")) closer = '))';
      edits.push(replaceRange(text, at(e), e.length ?? 1, closer));
      continue;
    }
    if (is('FL-NODE-EMPTY', e)) {
      // Remove empty square-bracket shape like A[""], A[" "], or A[] → keep just the node id (A)
      const lineText = lineTextAt(text, e.line);
      const caret0 = Math.max(0, e.column - 1);
      // Find nearest '[' before caret if caret is at '"'
      let openIdx = lineText[caret0] === '[' ? caret0 : lineText.lastIndexOf('[', caret0);
      if (openIdx >= 0) {
        const closeIdx = lineText.indexOf(']', Math.max(openIdx + 1, caret0));
        if (closeIdx !== -1) {
          const start = { line: e.line, column: openIdx + 1 };
          const len = closeIdx - openIdx + 1;
          edits.push(replaceRange(text, start, len, ''));
        }
      }
      continue;
    }
    if (is('FL-DIR-KW-INVALID', e)) {
      edits.push(replaceRange(text, at(e), e.length ?? 0, 'direction'));
      continue;
    }
    if (is('FL-DIR-MISSING', e)) {
      if (level === 'safe' || level === 'all') {
        // Default to TD
        edits.push(insertAt(text, at(e), ' TD'));
      }
      continue;
    }
    if (is('FL-LINK-MISSING', e)) {
      if (level === 'all') {
        const line = e.line;
        const lineText = lineTextAt(text, line);
        if (!/-->/.test(lineText)) {
          // Heuristic: find two consecutive node refs and insert an arrow between them
          // Supports simple IDs and IDs with immediate shapes: A[...], A(...), A{...}, A[[...]], A((...))
          const shapePart = "(?:\\[[^\\]]*\\]|\\([^\\)]*\\)|\\{[^}]*\\}|\\[\\[[^\\]]*\\]\\]|\\(\\([^\\)]*\\)\\))?";
          const id = "[A-Za-z0-9_]+";
          const re = new RegExp(`^\\s*(${id}${shapePart})\\s+(${id})`);
          const m = re.exec(lineText);
          if (m) {
            const before = m[0];
            const insertIdx = (before.length - m[2].length); // 0-based index where second id starts
            const col = insertIdx + 1; // to 1-based column
            edits.push(insertAt(text, { line, column: col }, ' --> '));
          } else {
            // Fallback to original caret-based insertion
            edits.push(insertAt(text, at(e), ' --> '));
          }
        }
      }
      continue;
    }
    if (is('FL-NODE-UNCLOSED-BRACKET', e)) {
      if (level === 'safe' || level === 'all') {
        const lineText = lineTextAt(text, e.line);
        const caret0 = Math.max(0, e.column - 1);
        // Prefer wrap+encode when it looks like quotes inside an unquoted label within square brackets
        const sqOpen = lineText.lastIndexOf('[', caret0);
        const sqClose = lineText.indexOf(']', caret0);
        if (sqOpen !== -1 && sqClose !== -1 && sqClose > sqOpen) {
          const innerSeg = lineText.slice(sqOpen + 1, sqClose);
          if (innerSeg.includes('"')) {
            const ltrim = innerSeg.match(/^\s*/)?.[0] ?? '';
            const rtrim = innerSeg.match(/\s*$/)?.[0] ?? '';
            const core = innerSeg.slice(ltrim.length, innerSeg.length - rtrim.length);
            const left = core.slice(0, 1);
            const right = core.slice(-1);
            const isSlashPair = (l: string, r: string) => (l === '/' && r === '/') || (l === '\\' && r === '\\') || (l === '/' && r === '\\') || (l === '\\' && r === '/');
            let newInner: string;
            if (core.length >= 2 && isSlashPair(left, right)) {
              const mid = core.slice(1, -1);
              const replacedMid = mid.split('&quot;').join('\u0000').split('"').join('&quot;').split('\u0000').join('&quot;');
              newInner = ltrim + left + replacedMid + right + rtrim;
            } else {
              const replaced = innerSeg.split('&quot;').join('\u0000').split('"').join('&quot;').split('\u0000').join('&quot;');
              newInner = '"' + replaced + '"';
            }
            edits.push({ start: { line: e.line, column: sqOpen + 2 }, end: { line: e.line, column: sqClose + 1 }, newText: newInner });
            patchedLines.add(e.line);
            continue;
          }
        }
        // Fallback: determine opener shape before caret and replace current closer token with the right closer
        if (patchedLines.has(e.line)) {
          continue;
        }
        const opens = [
          { open: '{{', close: '}}', idx: lineText.lastIndexOf('{{', caret0), len: 2 },
          { open: '[[', close: ']]', idx: lineText.lastIndexOf('[[', caret0), len: 2 },
          { open: '([', close: '])', idx: lineText.lastIndexOf('([', caret0), len: 2 },
          { open: '[(', close: ')]', idx: lineText.lastIndexOf('[(', caret0), len: 2 },
          { open: '{',  close: '}',  idx: lineText.lastIndexOf('{',  caret0), len: 1 },
          { open: '(',  close: ')',  idx: lineText.lastIndexOf('(',  caret0), len: 1 },
          { open: '[',  close: ']',  idx: lineText.lastIndexOf('[',  caret0), len: 1 },
        ];
        let opened = opens.filter(o => o.idx !== -1).sort((a,b)=> a.idx - b.idx).pop();
        // Prefer double/open-pair tokens over their single-char counterparts when adjacent
        if (opened) {
          if (opened.open === '{') {
            const dj = lineText.lastIndexOf('{{', caret0);
            if (dj !== -1 && dj + 1 === opened.idx) opened = { open: '{{', close: '}}', idx: dj, len: 2 } as any;
          } else if (opened.open === '[') {
            const jj = lineText.lastIndexOf('[[', caret0);
            const cj = lineText.lastIndexOf('[(', caret0);
            if (jj !== -1 && jj === opened.idx) opened = { open: '[[', close: ']]', idx: jj, len: 2 } as any;
            else if (cj !== -1 && cj === opened.idx) opened = { open: '[(', close: ')]', idx: cj, len: 2 } as any;
          } else if (opened.open === '(') {
            const jj = lineText.lastIndexOf('((', caret0);
            const sj = lineText.lastIndexOf('([', caret0);
            const cj2 = lineText.lastIndexOf('[(', caret0);
            if (jj !== -1 && jj === opened.idx) opened = { open: '((', close: '))', idx: jj, len: 2 } as any;
            else if (sj !== -1 && sj === opened.idx - 1) opened = { open: '([', close: '])', idx: sj, len: 2 } as any;
            else if (cj2 !== -1 && cj2 === opened.idx - 1) opened = { open: '[(', close: ')]', idx: cj2, len: 2 } as any;
          }
        }
        let closer = ']';
        if (opened) closer = opened.close;
        // Replace the wrong token(s) at caret with the correct closer
        const avail = lineText.slice(caret0);
        const replaceLen = Math.min(closer.length, Math.max(1, avail.length));
        edits.push({ start: { line: e.line, column: caret0 + 1 }, end: { line: e.line, column: caret0 + 1 + replaceLen }, newText: closer });
      }
      continue;
    }
    if (is('FL-QUOTE-UNCLOSED', e)) {
      // Heuristic: if line has an odd number of double quotes and a closing bracket ahead,
      // insert a closing quote just before the nearest bracket. Conservative → only under --fix=all.
      if (level === 'all') {
        const lineText = lineTextAt(text, e.line);
        const caret0 = Math.max(0, e.column - 1);
        const withoutEsc = lineText.replace(/\\\"/g, '');
        const dq = (withoutEsc.match(/\"/g) || []).length;
        if (dq % 2 === 1) {
          // candidates of bracket closers after caret
          const candidates: Array<{idx:number}> = [];
          const pushIdx = (i:number) => { if (i >= 0) candidates.push({ idx: i }); };
          pushIdx(lineText.indexOf(']]', caret0));
          pushIdx(lineText.indexOf('))', caret0));
          pushIdx(lineText.indexOf('}', caret0));
          pushIdx(lineText.indexOf(']', caret0));
          pushIdx(lineText.indexOf(')', caret0));
          if (candidates.length) {
            const ins = candidates.reduce((a,b)=> a.idx !== -1 && a.idx <= b.idx ? a : b);
            const col = (ins.idx >= 0 ? ins.idx : lineText.length) + 1; // 1-based
            edits.push(insertAt(text, { line: e.line, column: col }, '"'));
          }
        }
      }
      continue;
    }
    // Flowchart: quotes inside unquoted label → wrap whole label content and encode inner quotes (Safe)
    if (is('FL-LABEL-QUOTE-IN-UNQUOTED', e)) {
      if (level === 'safe' || level === 'all') {
        const lineText = lineTextAt(text, e.line);
        const caret0 = Math.max(0, e.column - 1);
        // Find nearest opener before caret
        const openPairs: Array<{open:string, close:string, idx:number, delta:number}> = [
          { open: '[[', close: ']]', idx: lineText.lastIndexOf('[[', caret0), delta: 2 },
          { open: '((', close: '))', idx: lineText.lastIndexOf('((', caret0), delta: 2 },
          { open: '{',  close: '}',  idx: lineText.lastIndexOf('{',  caret0), delta: 1 },
          { open: '[',  close: ']',  idx: lineText.lastIndexOf('[',  caret0), delta: 1 },
        ];
        const opened = openPairs.filter(o => o.idx !== -1).sort((a,b)=> a.idx - b.idx).pop();
        if (opened) {
          const contentStart = opened.idx + opened.delta;
          const closeIdx = lineText.indexOf(opened.close, Math.max(caret0, contentStart));
          if (closeIdx !== -1) {
            const inner = lineText.slice(contentStart, closeIdx);
            // Preserve [/.../], [\...\], [/...\], [\.../] by wrapping the middle portion only
            const ltrim = inner.match(/^\s*/)?.[0] ?? '';
            const rtrim = inner.match(/\s*$/)?.[0] ?? '';
            const core = inner.slice(ltrim.length, inner.length - rtrim.length);
            const left = core.slice(0, 1);
            const right = core.slice(-1);
            const isSlashPair = (l: string, r: string) => (l === '/' && r === '/') || (l === '\\' && r === '\\') || (l === '/' && r === '\\') || (l === '\\' && r === '/');
            let newInner: string;
            if (core.length >= 2 && isSlashPair(left, right)) {
              const mid = core.slice(1, -1);
              const replacedMid = mid.split('&quot;').join('\u0000').split('"').join('&quot;').split('\u0000').join('&quot;');
              // Encode-only for slash/backslash shapes; do not add wrapper quotes
              newInner = ltrim + left + replacedMid + right + rtrim;
            } else {
              // Regular case: wrap whole label content
              const replaced = inner.split('&quot;').join('\u0000').split('"').join('&quot;').split('\u0000').join('&quot;');
              newInner = '"' + replaced + '"';
            }
            edits.push({ start: { line: e.line, column: contentStart + 1 }, end: { line: e.line, column: closeIdx + 1 }, newText: newInner });
            patchedLines.add(e.line);
          }
        }
      }
      continue;
    }


    // Pie fixes
    if (is('PI-LABEL-ESCAPED-QUOTE', e)) {
      edits.push(replaceRange(text, at(e), e.length ?? 1, '&quot;'));
      continue;
    }
    if (is('PI-MISSING-COLON', e)) {
      edits.push(insertAt(text, at(e), ' : '));
      continue;
    }
    if (is('PI-LABEL-DOUBLE-IN-DOUBLE', e)) {
      // Replace inner double quotes inside a double-quoted label (before the colon)
      const lineText = lineTextAt(text, e.line);
      const q1 = lineText.indexOf('"');
      const colon = lineText.indexOf(':');
      const q2 = colon !== -1 ? lineText.lastIndexOf('"', colon - 1) : lineText.lastIndexOf('"');
      if (q1 !== -1 && q2 !== -1 && q2 > q1) {
        const inner = lineText.slice(q1 + 1, q2);
        const replaced = inner.split('&quot;').join('\u0000').split('"').join('&quot;').split('\u0000').join('&quot;');
        if (replaced !== inner) {
          edits.push({ start: { line: e.line, column: q1 + 2 }, end: { line: e.line, column: q2 + 1 }, newText: replaced });
        }
      }
      continue;
    }
    if (is('PI-LABEL-REQUIRES-QUOTES', e)) {
      // Wrap label before colon
      const lineText = lineTextAt(text, e.line);
      const colon = lineText.indexOf(':');
      if (colon > 0) {
        const raw = lineText.slice(0, colon);
        const startIdx = raw.search(/\S/);
        const endIdx = raw.replace(/\s+$/,'').length;
        if (startIdx >= 0 && endIdx > startIdx) {
          edits.push(insertAt(text, { line: e.line, column: startIdx + 1 }, '"'));
          edits.push(insertAt(text, { line: e.line, column: endIdx + 1 }, '"'));
        }
      }
      continue;
    }
    if (is('PI-QUOTE-UNCLOSED', e)) {
      if (level === 'all') {
        if (piQuoteClosedLines.has(e.line)) continue;
        const lineText = lineTextAt(text, e.line);
        const colon = lineText.indexOf(':');
        // Insert the closing quote immediately before the first colon, or at EOL if no colon.
        const insertCol = colon > 0 ? (colon + 1) : (lineText.length + 1);
        edits.push(insertAt(text, { line: e.line, column: insertCol }, '"'));
        piQuoteClosedLines.add(e.line);
      }
      continue;
    }

    // Sequence fixes
    if (is('SE-MSG-COLON-MISSING', e)) {
      const lineText = lineTextAt(text, e.line);
      // Heuristic: insert ' : ' immediately after the target actorRef.
      // 1) Find the first arrow occurrence on the line
      const arrows = ['<<-->>','<<->>','-->>','->>','-->', '->', '--x','-x','--)', '-)'];
      let ai = -1, alen = 0;
      for (const a of arrows) {
        const idx = lineText.indexOf(a);
        if (idx !== -1 && (ai === -1 || idx < ai)) { ai = idx; alen = a.length; }
      }
      if (ai !== -1) {
        let i = ai + alen;
        // optional + or - suffix after arrow
        if (lineText[i] === '+' || lineText[i] === '-') i++;
        // skip spaces
        while (i < lineText.length && /\s/.test(lineText[i])) i++;
        // actorRef may be quoted or identifier-like; find its end index j (exclusive)
        let j = i;
        if (lineText[i] === '"' || lineText[i] === "'") {
          const quote = lineText[i];
          j = i + 1;
          while (j < lineText.length) {
            if (lineText[j] === '\\') { j += 2; continue; }
            if (lineText[j] === quote) { j++; break; }
            j++;
          }
        } else {
          while (j < lineText.length && !/\s/.test(lineText[j]) && lineText[j] !== ':') j++;
        }
        const insertCol = j + 1; // 1-based column after actorRef
        const nextCh = lineText[j] || '';
        if (nextCh === ' ') {
          // Replace the following space with ' : '
          edits.push(replaceRange(text, { line: e.line, column: insertCol }, 1, ' : '));
        } else {
          edits.push(insertAt(text, { line: e.line, column: insertCol }, ' : '));
        }
      } else {
        // Fallback: insert at current caret
        edits.push(insertAt(text, at(e), ': '));
      }
      continue;
    }
    if (is('SE-NOTE-MALFORMED', e)) {
      const lineText = lineTextAt(text, e.line);
      const mLR = /^(\s*)Note\s+(left|right)\s+of\s+(.+?)\s+(.+)$/.exec(lineText);
      const mOver = /^(\s*)Note\s+over\s+(.+?)\s+(.+)$/.exec(lineText);
      let insertCol = e.column;
      if (mLR) {
        const indent = mLR[1] || '';
        const beforeHeader = `${indent}Note ${mLR[2]} of ${mLR[3]}`;
        insertCol = beforeHeader.length + 1; // 1-based after header
      } else if (mOver) {
        const indent = mOver[1] || '';
        const beforeHeader = `${indent}Note over ${mOver[2]}`;
        insertCol = beforeHeader.length + 1;
      }
      // Normalize spaces around colon: ensure one space before and one after
      // If there is already a space at insertCol, replace it
      const idx0 = Math.max(0, insertCol - 1);
      const nextCh = lineText[idx0] || '';
      if (nextCh === ' ') {
        edits.push(replaceRange(text, { line: e.line, column: insertCol }, 1, ' : '));
      } else {
        edits.push(insertAt(text, { line: e.line, column: insertCol }, ' : '));
      }
      continue;
    }
    if (is('SE-ELSE-IN-CRITICAL', e)) {
      edits.push(replaceRange(text, at(e), e.length ?? 4, 'option'));
      continue;
    }
    if (is('SE-BOX-EMPTY', e)) {
      // Convert empty box to rect
      const lines = text.split(/\r?\n/);
      const boxIdx = Math.max(0, e.line - 1);
      const boxLine = lines[boxIdx] || '';
      // Extract the label from box "Label"
      const labelMatch = /^\s*box\s+(.+)$/.exec(boxLine);
      if (labelMatch) {
        const indent = boxLine.match(/^\s*/)?.[0] || '';
        // Convert to rect with a light color
        const newLine = `${indent}rect rgb(240, 240, 255)`;
        edits.push({ start: { line: e.line, column: 1 }, end: { line: e.line, column: boxLine.length + 1 }, newText: newLine });
      }
      continue;
    }
    if (is('SE-BOX-INVALID-CONTENT', e)) {
      // Move messages, notes, and other invalid content outside the box block
      const lines = text.split(/\r?\n/);
      const curIdx = Math.max(0, e.line - 1);
      // Find the opening box line upwards
      const boxRe = /^(\s*)box\b/;
      let openIdx = -1;
      let openIndent = '';
      for (let i = curIdx; i >= 0; i--) {
        const m = boxRe.exec(lines[i] || '');
        if (m) { openIdx = i; openIndent = m[1] || ''; break; }
      }
      if (openIdx !== -1) {
        // Find the closing 'end' line
        let endIdx = -1;
        for (let i = openIdx + 1; i < lines.length; i++) {
          const trimmed = (lines[i] || '').trim();
          if (trimmed === 'end') { endIdx = i; break; }
        }
        if (endIdx !== -1) {
          // Collect all invalid lines (messages, notes, etc.) inside the box
          const invalidLines: number[] = [];
          for (let i = openIdx + 1; i < endIdx; i++) {
            const raw = lines[i] || '';
            const trimmed = raw.trim();
            if (trimmed === '') continue; // skip blank lines
            // Check if it's NOT a participant/actor declaration
            if (!/^\s*(participant|actor)\b/i.test(raw)) {
              invalidLines.push(i);
            }
          }
          // Move invalid lines after the 'end' keyword
          if (invalidLines.length > 0) {
            // Adjust indentation: moved content should align with 'end', not with box content
            const endIndent = openIndent; // 'end' has same indent as 'box'
            const movedContent = invalidLines.map(i => {
              const line = lines[i] || '';
              // Remove existing indentation and apply 'end' indentation
              const trimmed = line.trimStart();
              return endIndent + trimmed;
            }).join('\n') + '\n';
            // Delete invalid lines from inside the box (in reverse to maintain indices)
            for (let i = invalidLines.length - 1; i >= 0; i--) {
              const idx = invalidLines[i];
              edits.push({ start: { line: idx + 1, column: 1 }, end: { line: idx + 2, column: 1 }, newText: '' });
            }
            // Insert moved content after 'end'
            edits.push(insertAt(text, { line: endIdx + 2, column: 1 }, movedContent));
          }
        }
      }
      continue;
    }
    if (is('SE-BLOCK-MISSING-END', e)) {
      // Insert 'end' aligned with the opening block's indentation, before the next outdented line.
      const lines = text.split(/\r?\n/);
      const curIdx = Math.max(0, e.line - 1);
      // Find the opening block line upwards
      const openerRe = /^(\s*)(alt\b|opt\b|loop\b|par\b|rect\b|critical\b|break\b|box\b)/;
      let openIdx = -1;
      let openIndent = '';
      for (let i = curIdx; i >= 0; i--) {
        const m = openerRe.exec(lines[i] || '');
        if (m) { openIdx = i; openIndent = m[1] || ''; break; }
      }
      if (openIdx === -1) {
        // Fallback: align with current line's indent and insert at start of current line
        const indent = inferIndentFromLine(lines[curIdx] || '');
        edits.push(insertAt(text, { line: curIdx + 1, column: 1 }, `${indent}end\n`));
        continue;
      }
      // Walk forward to find first non-empty line whose indent <= openIndent → insert before it
      let insIdx = lines.length; // default append at EOF
      for (let i = openIdx + 1; i < lines.length; i++) {
        const raw = lines[i] || '';
        if (raw.trim() === '') continue;
        const ind = inferIndentFromLine(raw);
        if (ind.length <= openIndent.length) { insIdx = i; break; }
      }
      const insertLine = insIdx; // insert before this line (0-based)
      edits.push(insertAt(text, { line: insertLine + 1, column: 1 }, `${openIndent}end\n`));
      continue;
    }
    if (is('SE-AUTONUMBER-EXTRANEOUS', e)) {
      // Move the rest of the line (starting at the extraneous token) to the next line.
      const lineText = lineTextAt(text, e.line);
      const lineLen = lineText.length;
      const indent = inferIndentFromLine(lineText); // preserve original line indentation only
      const startCol = e.column; // 1-based column of the extraneous token
      // Trim any spaces immediately before the extraneous token to avoid trailing spaces at EOL
      const left = lineText.slice(0, Math.max(0, startCol - 1));
      const leftTrimmed = left.replace(/\s+$/, '');
      const startCol2 = leftTrimmed.length + 1;
      const tail = lineText.slice(Math.max(0, startCol - 1)).replace(/^\s+/, '');
      edits.push({ start: { line: e.line, column: startCol2 }, end: { line: e.line, column: lineLen + 1 }, newText: `\n${indent}${tail}` });
      continue;
    }
    if (is('SE-AUTONUMBER-MALFORMED', e) || is('SE-AUTONUMBER-NON-NUMERIC', e)) {
      if (level === 'all') {
        const lineText = lineTextAt(text, e.line);
        const idx = lineText.indexOf('autonumber');
        if (idx >= 0) {
          // Replace from start of 'autonumber' to end of line with just 'autonumber'
          edits.push({ start: { line: e.line, column: idx + 1 }, end: { line: e.line, column: lineText.length + 1 }, newText: 'autonumber' });
        }
      }
      continue;
    }
    if (is('SE-LABEL-ESCAPED-QUOTE', e)) {
      edits.push(replaceRange(text, at(e), e.length ?? 1, '&quot;'));
      continue;
    }
    if (is('SE-LABEL-DOUBLE-IN-DOUBLE', e)) {
      // Safer targeted fix for participant/actor lines: replace inner quotes within the outer name quotes
      const lineText = lineTextAt(text, e.line);
      const ts = lineText.trimStart();
      if (/^(participant|actor)\b/.test(ts)) {
        const kwIdx = lineText.indexOf('participant');
        const kwIdx2 = kwIdx === -1 ? lineText.indexOf('actor') : kwIdx;
        const startSearch = kwIdx2 >= 0 ? kwIdx2 : 0;
        const q1 = lineText.indexOf('"', startSearch);
        if (q1 !== -1) {
          // If ' as ' exists after q1, close at the last quote before ' as '; else use last quote in line
          const asIdx = lineText.indexOf(' as ', q1 + 1);
          const q2 = asIdx !== -1 ? lineText.lastIndexOf('"', asIdx - 1) : lineText.lastIndexOf('"');
          if (q2 > q1) {
            const inner = lineText.slice(q1 + 1, q2);
            const replaced = inner.split('&quot;').join('\u0000').split('"').join('&quot;').split('\u0000').join('&quot;');
            if (replaced !== inner) {
              const start = { line: e.line, column: q1 + 2 };
              const end = { line: e.line, column: q2 + 1 };
              edits.push({ start, end, newText: replaced });
            }
          }
        }
      }
      continue;
    }
    if (is('SE-QUOTE-UNCLOSED', e)) {
      if (level === 'all') {
        const lineText = lineTextAt(text, e.line);
        const insertCol = lineText.length + 1;
        edits.push(insertAt(text, { line: e.line, column: insertCol }, '"'));
      }
      continue;
    }

    // State fixes
    if (is('ST-ARROW-INVALID', e)) {
      // Replace '->' with '-->' at caret
      edits.push(replaceRange(text, at(e), e.length ?? 2, '-->'));
      continue;
    }
    if (is('ST-NOTE-MALFORMED', e)) {
      // Normalize to: 'Note <left|right> of <target> : <text>' (convert 'over' to 'right')
      // and ensure the target state exists before the note by inserting a stub if needed.
      const lines = text.split(/\r?\n/);
      const raw = lineTextAt(text, e.line);
      const mLeft = /^(\s*)Note\s+(left|right)\s+of\s+([^:]+?)\s+(.+)$/.exec(raw);
      const mOver = /^(\s*)Note\s+over\s+([^:]+?)\s+(.+)$/.exec(raw);
      let indent = '';
      let dir = 'right';
      let target = '';
      let rest = '';
      if (mLeft) {
        indent = mLeft[1] || '';
        dir = (mLeft[2] || 'right').toLowerCase();
        target = (mLeft[3] || '').trim();
        rest = (mLeft[4] || '').trim();
      } else if (mOver) {
        indent = mOver[1] || '';
        dir = 'right';
        const targets = (mOver[2] || '').split(',').map(s => s.trim()).filter(Boolean);
        target = targets[0] || '';
        rest = (mOver[3] || '').trim();
      }
      if (target) {
        const newLine = `${indent}Note ${dir} of ${target} : ${rest}`;
        const upper = lines.slice(0, Math.max(0, e.line - 1)).join('\n');
        const seenEarlier = new RegExp(`(^|\n|\b)${target}(\b)`).test(upper);
        if (seenEarlier) {
          // Replace in place
          edits.push({ start: { line: e.line, column: 1 }, end: { line: e.line, column: raw.length + 1 }, newText: newLine });
        } else {
          // Move note after the next line that mentions the target; else to EOF
          let afterLine = lines.length + 1;
          for (let i = e.line; i < lines.length; i++) {
            const ln = lines[i] || '';
            if (new RegExp(`(^|\\b)${target}(\\b)`).test(ln)) { afterLine = i + 2; break; }
          }
          // Delete current note line and insert new note after the found line
          edits.push({ start: { line: e.line, column: 1 }, end: { line: e.line + 1, column: 1 }, newText: '' });
          edits.push(insertAt(text, { line: afterLine, column: 1 }, newLine + '\n'));
        }
      } else {
        // Fallback: just insert the colon after detected header
        const mHdr = /^(\s*Note\s+(?:left|right)\s+of\s+[^:]+|\s*Note\s+over\s+[^:]+)/i.exec(raw);
        const col = (mHdr ? (mHdr[0] || '').length + 1 : e.column);
        edits.push(insertAt(text, { line: e.line, column: col }, ' : '));
      }
      continue;
    }
    if (is('ST-BLOCK-MISSING-RBRACE', e)) {
      // Insert '}' aligned with the opening 'state' and before next outdented line
      const lines = text.split(/\r?\n/);
      const curIdx = Math.max(0, e.line - 1);
      const openerRe = /^(\s*)state\b/;
      let openIdx = -1; let openIndent = '';
      for (let i = curIdx; i >= 0; i--) {
        const m = openerRe.exec(lines[i] || '');
        if (m) { openIdx = i; openIndent = m[1] || ''; break; }
      }
      if (openIdx === -1) {
        const indent = inferIndentFromLine(lines[curIdx] || '');
        edits.push(insertAt(text, { line: curIdx + 1, column: 1 }, `${indent}}\n`));
        continue;
      }
      let insIdx = lines.length;
      for (let i = openIdx + 1; i < lines.length; i++) {
        const raw = lines[i] || '';
        if (raw.trim() === '') continue;
        const ind = inferIndentFromLine(raw);
        if (ind.length <= openIndent.length) { insIdx = i; break; }
      }
      edits.push(insertAt(text, { line: insIdx + 1, column: 1 }, `${openIndent}}\n`));
      continue;
    }

    // Class fixes
    if (is('CL-REL-INVALID', e)) {
      // Replace first occurrence of '->' on the line with '--'
      const lineText = lineTextAt(text, e.line);
      const idx = lineText.indexOf('->');
      if (idx >= 0) {
        edits.push({ start: { line: e.line, column: idx + 1 }, end: { line: e.line, column: idx + 3 }, newText: '--' });
      }
      continue;
    }
    if (is('CL-BLOCK-MISSING-RBRACE', e)) {
      // Insert '}' aligned with 'class X {'
      const lines = text.split(/\r?\n/);
      const curIdx = Math.max(0, e.line - 1);
      const openerRe = /^(\s*)class\b.*\{\s*$/;
      let openIdx = -1; let openIndent = '';
      for (let i = curIdx; i >= 0; i--) {
        const m = openerRe.exec(lines[i] || '');
        if (m) { openIdx = i; openIndent = m[1] || ''; break; }
      }
      if (openIdx === -1) {
        const indent = inferIndentFromLine(lines[curIdx] || '');
        edits.push(insertAt(text, { line: curIdx + 1, column: 1 }, `${indent}}\n`));
        continue;
      }
      let insIdx = lines.length;
      for (let i = openIdx + 1; i < lines.length; i++) {
        const raw = lines[i] || '';
        if (raw.trim() === '') continue;
        const ind = inferIndentFromLine(raw);
        if (ind.length <= openIndent.length) { insIdx = i; break; }
      }
      edits.push(insertAt(text, { line: insIdx + 1, column: 1 }, `${openIndent}}\n`));
      continue;
    }
    if (is('CL-LABEL-DOUBLE-IN-DOUBLE', e)) {
      // Replace inner quotes within the quoted class name (before optional ' as ')
      const lineText = lineTextAt(text, e.line);
      const q1 = lineText.indexOf('"');
      if (q1 !== -1) {
        const asIdx = lineText.indexOf(' as ', q1 + 1);
        const q2 = asIdx !== -1 ? lineText.lastIndexOf('"', asIdx - 1) : lineText.lastIndexOf('"');
        if (q2 > q1) {
          const inner = lineText.slice(q1 + 1, q2);
          const replaced = inner.split('&quot;').join('\u0000').split('"').join('&quot;').split('\u0000').join('&quot;');
          if (replaced !== inner) {
            edits.push({ start: { line: e.line, column: q1 + 2 }, end: { line: e.line, column: q2 + 1 }, newText: replaced });
          }
        }
      } else {
        edits.push(replaceRange(text, at(e), e.length ?? 1, '&quot;'));
      }
      continue;
    }

    // Strict mode quote requirement (apply only in 'all' to stay conservative)
    if (is('FL-STRICT-LABEL-QUOTES-REQUIRED', e)) {
      if (level === 'all') {
        const lineText = lineTextAt(text, e.line);
        const caret = Math.max(0, e.column - 1);
        const before = lineText.slice(0, caret);
        const after = lineText.slice(caret);
        const openIdx = Math.max(before.lastIndexOf('['), before.lastIndexOf('('), before.lastIndexOf('{'));
        if (openIdx >= 0) {
          const openCh = before[openIdx];
          const closeCh = openCh === '[' ? ']' : openCh === '(' ? ')' : '}';
          const closeIdx = lineText.indexOf(closeCh, caret);
          if (closeIdx > openIdx) {
            edits.push(insertAt(text, { line: e.line, column: openIdx + 2 }, '"'));
            edits.push(insertAt(text, { line: e.line, column: closeIdx + 1 }, '"'));
          }
        }
      }
      continue;
    }
  }

  // No global rewrite pass: prefer targeted, diagnostic-driven fixes above to avoid over-editing.

  // De-duplicate identical edits that may arise from overlapping detectors
  const uniq: TextEditLC[] = [];
  const seenEd = new Set<string>();
  for (const ed of edits) {
    const key = `${ed.start.line}:${ed.start.column}:${ed.end?.line ?? 0}:${ed.end?.column ?? 0}:${ed.newText}`;
    if (seenEd.has(key)) continue;
    seenEd.add(key);
    uniq.push(ed);
  }
  return uniq;
}
