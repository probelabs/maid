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
  const subgraphCollisionRename = new Map<string, string>();
  // Utility: sanitize all quoted segments inside shape labels on a given line
  function sanitizeAllQuotedSegmentsInShapes(lineText: string, lineNo: number) {
    // Shapes and their closers in order of preference (double before single)
    const shapes: Array<{ open: string; close: string }> = [
      { open: '[[', close: ']]' },
      { open: '((', close: '))' },
      { open: '{{', close: '}}' },
      { open: '[(', close: ')]' },
      { open: '([', close: '])' },
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
    ];
    let idx = 0; let produced = 0;
    while (idx < lineText.length) {
      // Find next shape opener
      let found: { open: string; close: string; i: number } | null = null;
      for (const s of shapes) {
        const i = lineText.indexOf(s.open, idx);
        if (i !== -1 && (found === null || i < found.i)) found = { ...s, i };
      }
      if (!found) break;
      const contentStart = found.i + found.open.length;
      const closeIdx = lineText.indexOf(found.close, contentStart);
      if (closeIdx === -1) { idx = contentStart; continue; }
      // Within the shape content, look for the outermost quoted segment (double-quotes)
      let q1 = -1; for (let i = contentStart; i < closeIdx; i++) { if (lineText[i] === '"' && lineText[i-1] !== '\\') { q1 = i; break; } }
      if (q1 !== -1) {
        let q2 = -1; for (let j = closeIdx - 1; j > q1; j--) { if (lineText[j] === '"' && lineText[j-1] !== '\\') { q2 = j; break; } }
        if (q2 !== -1) {
          const inner = lineText.slice(q1 + 1, q2);
          const replaced = sanitizeQuotedInner(inner);
          if (replaced !== inner) {
            edits.push({ start: { line: lineNo, column: q1 + 2 }, end: { line: lineNo, column: q2 + 1 }, newText: replaced });
            produced++;
          }
        }
      }
      idx = closeIdx + found.close.length;
    }
    return produced;
  }
  
  // Sanitize unsafe characters inside quoted labels so Mermaid CLI can parse them.
  function sanitizeQuotedInner(inner: string): string {
    const SENT_Q = '\u0000__Q__';
    let out = inner.split('&quot;').join(SENT_Q);
    // Remove backticks (Mermaid doesn't support numeric entities, so just remove them)
    out = out.replace(/`/g, '');
    // Encode quotes
    out = out.replace(/\\\"/g, '&quot;');
    out = out.replace(/\"/g, '&quot;');
    out = out.replace(/"/g, '&quot;');
    // Curly braces work fine in quoted labels - leave them as-is
    // Note: The FL-LABEL-CURLY-IN-QUOTED error is for parser/safety, not rendering
    // Restore any pre-existing &quot;
    out = out.split(SENT_Q).join('&quot;');
    return out;
  }

  function escapeUnescapedSemicolons(textPart: string): string {
    let out = '';
    for (let i = 0; i < textPart.length; i++) {
      const ch = textPart[i];
      if (ch !== ';') {
        out += ch;
        continue;
      }
      const upto = textPart.slice(0, i + 1);
      const isEntity = /(?:#\d+|&#\d+|&[A-Za-z][A-Za-z0-9]+);$/.test(upto);
      out += isEntity ? ';' : '#59;';
    }
    return out;
  }

  for (const e of errors) {
    const key = `${e.code}@${e.line}:${e.column}:${e.length ?? 1}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Flowchart fixes
    // If we see any quoted-label hazard on this line, sanitize all quoted segments inside shapes once
    if ((e.code === 'FL-LABEL-ESCAPED-QUOTE' || e.code === 'FL-LABEL-CURLY-IN-QUOTED' || e.code === 'FL-LABEL-DOUBLE-IN-DOUBLE' || e.code === 'FL-LABEL-BACKTICK') && !patchedLines.has(e.line)) {
      const lineText = lineTextAt(text, e.line);
      const produced = sanitizeAllQuotedSegmentsInShapes(lineText, e.line);
      // Mark line as patched regardless of whether changes were made, to prevent duplicate processing
      patchedLines.add(e.line);
      if (produced > 0) { continue; }
    }
    if (is('FL-ARROW-INVALID', e)) {
      edits.push(replaceRange(text, at(e), e.length ?? 2, '-->'));
      continue;
    }
    if (is('FL-LINK-UNSUPPORTED-MARKER', e)) {
      // Remove the unsupported one-sided marker (x/o) from the inline link text
      edits.push(replaceRange(text, at(e), e.length ?? 1, ''));
      continue;
    }
    // Fix quoted edge labels to use pipe syntax
    if (is('FL-EDGE-LABEL-QUOTED', e)) {
      const lineText = lineTextAt(text, e.line);
      const col = Math.max(0, e.column - 1);

      // Find the quoted string
      const quoteStart = lineText.indexOf('"', col);
      if (quoteStart !== -1) {
        const quoteEnd = lineText.indexOf('"', quoteStart + 1);
        if (quoteEnd !== -1) {
          const labelText = lineText.slice(quoteStart + 1, quoteEnd);

          // Find the connector pattern before the quote
          const beforeQuote = lineText.slice(0, quoteStart).trim();
          const afterQuote = lineText.slice(quoteEnd + 1).trim();

          // Detect the full arrow pattern (start --> end)
          let linkStart = '--';
          let linkEnd = '-->';

          if (beforeQuote.endsWith('==')) {
            linkStart = '==';
            linkEnd = '==>';
          } else if (beforeQuote.endsWith('-.-')) {
            linkStart = '-.-';
            linkEnd = '.->';
          } else if (beforeQuote.endsWith('-.')) {
            linkStart = '-.';
            linkEnd = '.->';
          }

          // Find where the link starts (including leading spaces)
          const beforeQuoteUntrimmed = lineText.slice(0, quoteStart);
          const linkStartIdx = beforeQuoteUntrimmed.lastIndexOf(linkStart);
          if (linkStartIdx === -1) continue;
          // Extract parts (preserve spaces and node before link)
          const prefix = lineText.slice(0, linkStartIdx);

          // The suffix should start after the arrow part (not include it)
          let suffix = afterQuote;
          if (suffix.startsWith('-->')) suffix = suffix.slice(3).trim();
          else if (suffix.startsWith('==>')) suffix = suffix.slice(3).trim();
          else if (suffix.startsWith('.->')) suffix = suffix.slice(3).trim();
          else if (suffix.startsWith('->')) suffix = suffix.slice(2).trim();

          // Add space before suffix node if needed
          if (suffix && !suffix.startsWith(' ')) suffix = ' ' + suffix;

          // Construct the fixed line
          const fixedLine = `${prefix}${linkStart}|${labelText}|${linkEnd}${suffix}`;

          edits.push({
            start: { line: e.line, column: 1 },
            end: { line: e.line, column: lineText.length + 1 },
            newText: fixedLine
          });
        }
      }
      continue;
    }
        if (is('FL-EDGE-LABEL-BRACKET', e) || is('FL-EDGE-LABEL-CURLY-IN-PIPES', e) || is('FL-EDGE-LABEL-QUOTE-IN-PIPES', e)) {
      const lineText = lineTextAt(text, e.line);
      const col = Math.max(0, e.column - 1);
      const firstBar = lineText.lastIndexOf('|', col);
      const secondBar = firstBar >= 0 ? lineText.indexOf('|', col + 1) : -1;
      if (firstBar >= 0 && secondBar > firstBar) {
        const before = lineText.slice(0, firstBar + 1);
        const label = lineText.slice(firstBar + 1, secondBar);
        const after = lineText.slice(secondBar);
        let fixedLabel = label.replace(/\[/g, '&#91;').replace(/\]/g, '&#93;');
        fixedLabel = fixedLabel.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
        fixedLabel = fixedLabel.replace(/\\"/g, '&quot;').replace(/"/g, '&quot;');
        const fixedLine = before + fixedLabel + after;
        const finalLine = fixedLine.replace(/\[([^\]]*)\]/g, (m, seg) => '[' + String(seg).replace(/`/g, '') + ']');
        edits.push({ start: { line: e.line, column: 1 }, end: { line: e.line, column: lineText.length + 1 }, newText: finalLine });
      }
      continue;
    }
    if (is('FL-EDGE-LABEL-BACKTICK', e)) {
      // Transform inline edge labels containing backticks into pipe labels and strip backticks.
      // Example: A -- Detects `"` in unquoted label --> B  =>  A --|Detects " in unquoted label|--> B
      const lineText = lineTextAt(text, e.line);
      const re = /^(.*?--)\s*([^|>]+?)\s*(-->|==>|\.->|->)(.*)$/;
      const m = re.exec(lineText);
      if (m) {
        const before = m[1];
        const label = (m[2] || '').replace(/`/g, '').replace(/\"/g, '"').replace(/"/g, '&quot;');
        const arrow = m[3];
        const after = m[4] || '';
        let fixedLine = `${before}|${label}|${arrow}${after}`;
        // Also sanitize any square-bracket node label segments on the same line
        fixedLine = fixedLine.replace(/\[([^\]]*)\]/g, (_m, seg) => {
          const cleaned = String(seg).replace(/`/g, '').replace(/\"/g, '"').replace(/"/g, '&quot;');
          return '[' + cleaned + ']';
        });
        edits.push({ start: { line: e.line, column: 1 }, end: { line: e.line, column: lineText.length + 1 }, newText: fixedLine });
      } else {
        // Fallback: just remove backticks; also encode quotes to avoid pipe conflicts if any
        edits.push({ start: { line: e.line, column: 1 }, end: { line: e.line, column: lineText.length + 1 }, newText: lineText.replace(/`/g, '').replace(/\"/g, '"').replace(/"/g, '&quot;') });
      }
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
    // Remove backticks inside unquoted node labels (warning-level)
    if (is('FL-LABEL-BACKTICK', e)) {
      const lineText = lineTextAt(text, e.line);
      const caret0 = Math.max(0, e.column - 1);
      // Prefer square-bracket labels on this line
      const openIdx = lineText.lastIndexOf('[', caret0);
      if (openIdx !== -1) {
        const closeIdx = lineText.indexOf(']', openIdx + 1);
        if (closeIdx !== -1) {
          const before = lineText.slice(0, openIdx + 1);
          const seg = lineText.slice(openIdx + 1, closeIdx);
          const after = lineText.slice(closeIdx);
          const fixedSeg = seg.replace(/`/g, '');
          const newLine = before + fixedSeg + after;
          edits.push({ start: { line: e.line, column: 1 }, end: { line: e.line, column: lineText.length + 1 }, newText: newLine });
          continue;
        }
      }
      // Fallback: remove all backticks on the line
      edits.push({ start: { line: e.line, column: 1 }, end: { line: e.line, column: lineText.length + 1 }, newText: lineText.replace(/`/g, '') });
      continue;
    }
    if (is('CL-NAMESPACE-NAME-QUOTED', e)) {
      // Remove quotes from namespace name and convert to identifier
      // namespace "ProbeAgent Core" { } => namespace ProbeAgentCore { }
      const lineText = lineTextAt(text, e.line);
      const nsIdx = lineText.indexOf('namespace');
      const startSearch = nsIdx >= 0 ? nsIdx + 9 : 0;
      const q1 = lineText.indexOf('"', startSearch);
      if (q1 !== -1) {
        const q2 = lineText.indexOf('"', q1 + 1);
        if (q2 > q1) {
          // Extract the namespace name and remove spaces/special chars to make valid identifier
          const namespaceName = lineText.slice(q1 + 1, q2);
          const validIdentifier = namespaceName.replace(/[^A-Za-z0-9_]/g, '');
          // Replace the quoted string with the unquoted identifier
          edits.push(replaceRange(text, { line: e.line, column: q1 + 1 }, q2 - q1 + 1, validIdentifier));
        }
      }
      continue;
    }
    if (is('CL-INTERFACE-KEYWORD-UNSUPPORTED', e)) {
      // Simple transform: interface Foo => class Foo (let user add <<interface>> annotation manually or use mermaid.js default)
      // For now, just change the keyword - the annotation placement is complex and version-dependent
      const lineText = lineTextAt(text, e.line);
      const ifIdx = lineText.indexOf('interface');
      if (ifIdx !== -1) {
        // Just replace 'interface' with 'class'
        edits.push(replaceRange(text, { line: e.line, column: ifIdx + 1 }, 9, 'class'));
      }
      continue;
    }
    if (is('FL-LABEL-ESCAPED-QUOTE', e)) {
      // Skip if line was already patched by sanitizeAllQuotedSegmentsInShapes
      if (patchedLines.has(e.line)) continue;
      // Prefer rewriting the whole double-quoted span within a shape so we catch all occurrences at once
      const lineText = lineTextAt(text, e.line);
      // Guard against very long or code-fenced lines (often code/JSON examples) unless aggressive '--fix=all'
      
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
            const replaced = sanitizeQuotedInner(inner);
            if (replaced !== inner) {
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

    if (is('FL-META-UNSUPPORTED', e)) {
      // Remove the unsupported meta line (e.g., 'title ...'). Keep conservative under --fix=all only.
      if (level === 'all') {
        const lineText = lineTextAt(text, e.line);
        edits.push({ start: { line: e.line, column: 1 }, end: { line: e.line + 1, column: 1 }, newText: '' });
      }
      continue;
    }
    // FL-LABEL-BACKTICK for unquoted labels (warnings): remove the backtick
    // For quoted labels (errors): handled by sanitizeAllQuotedSegmentsInShapes above
    if (is('FL-LABEL-BACKTICK', e) && e.severity === 'warning') {
      edits.push(replaceRange(text, at(e), e.length ?? 1, ''));
      continue;
    }
    if (is('FL-LABEL-CURLY-IN-QUOTED', e)) {
      // Replace { and } inside the surrounding quoted segment with HTML entities
      const lineText = lineTextAt(text, e.line);
      
      const caret0 = Math.max(0, e.column - 1);
      // Find opening quote before caret
      let qOpenIdx = -1; let qChar: string | null = null;
      for (let i = caret0; i >= 0; i--) {
        const ch = lineText[i];
        const code = ch ? ch.charCodeAt(0) : -1;
        if (code === 34 || code === 39) {
          const bs = i > 0 && lineText[i - 1] === '\\';
          if (!bs) { qOpenIdx = i; qChar = ch; break; }
        }
      }
      if (qOpenIdx !== -1 && qChar) {
        // Find matching closing quote
        let qCloseIdx = -1;
        for (let j = qOpenIdx + 1; j < lineText.length; j++) {
          const ch = lineText[j];
          const code = ch ? ch.charCodeAt(0) : -1;
          if (code === (qChar ? qChar.charCodeAt(0) : -1)) {
            const bs = lineText[j - 1] === '\\';
            if (!bs) { qCloseIdx = j; break; }
          }
        }
        if (qCloseIdx > qOpenIdx) {
          const inner = lineText.slice(qOpenIdx + 1, qCloseIdx);
          const replaced = sanitizeQuotedInner(inner);
          if (replaced !== inner) {
            edits.push({ start: { line: e.line, column: qOpenIdx + 2 }, end: { line: e.line, column: qCloseIdx + 1 }, newText: replaced });
            continue;
          }
        }
      }
      // Fallback: Curly braces work fine in quoted labels (Mermaid doesn't decode numeric entities anyway)
      // So we skip this error - it's a false positive from the parser
      continue;
    }

    // Flowchart: unmatched 'end' without a subgraph — remove the stray line (all-level fix)
    if (is('FL-END-WITHOUT-SUBGRAPH', e)) {
      if (level === 'all') {
        edits.push({ start: { line: e.line, column: 1 }, end: { line: e.line + 1, column: 1 }, newText: '' });
      }
      continue;
    }

    // Flowchart: unmatched 'end' without a subgraph — remove the stray line (all-level fix)
    // Flowchart: fix inner quotes inside a double-quoted label within shapes ([], (), {}, [[ ]], (( ))).
    if (is('FL-LABEL-DOUBLE-IN-DOUBLE', e)) {
      const lineText = lineTextAt(text, e.line);
      const caret0 = Math.max(0, e.column - 1);
      // Safety guard unless aggressive '--fix=all'
      const rawDqCount = (lineText.match(/\"/g) || []).length;
      const unescapedDqCount = (lineText.replace(/\\\"/g, '').match(/\"/g) || []).length;
      if ((rawDqCount + unescapedDqCount > 8) && level !== 'all') {
        continue;
      }
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
          const replaced = sanitizeQuotedInner(inner);
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
      // Handle common nested opener pairs with targeted replacements and then stop further fixes for this line
      // Case: '([' ... '})'  => replace '}' with ']'
      {
        const openIdx = lineText.indexOf('([');
        if (openIdx !== -1) {
          const badClose = lineText.indexOf('})', openIdx + 2);
          if (badClose !== -1) {
            edits.push({ start: { line: e.line, column: badClose + 1 }, end: { line: e.line, column: badClose + 2 }, newText: ']' });
            patchedLines.add(e.line);
            continue;
          }
        }
      }
      // Case: '[(' ... '))'  => replace the second ')' with ']'
      {
        const openIdx = lineText.indexOf('[(');
        if (openIdx !== -1) {
          const closePair = lineText.indexOf('))', openIdx + 2);
          if (closePair !== -1) {
            // second ')' is at closePair + 1 (0-based)
            edits.push({ start: { line: e.line, column: closePair + 2 }, end: { line: e.line, column: closePair + 3 }, newText: ']' });
            patchedLines.add(e.line);
            continue;
          }
        }
      }

      // Robust special-case: if the line opens with '([' and later we see a '})', turn it into '])'
      {
        const openPair = lineText.indexOf('([');
        if (openPair !== -1) {
          const badClose = lineText.indexOf('})', openPair + 2);
          if (badClose !== -1) {
            edits.push({ start: { line: e.line, column: badClose + 1 }, end: { line: e.line, column: badClose + 2 }, newText: ']' });
            continue;
          }
        }
      }

      // Special-case: mixed pair '([' should close as '])' — if we see '})' at the caret, replace '}' with ']'
      if (/\(\[/.test(lineText) && lineText.indexOf('})', Math.max(0, caret0 - 1)) !== -1) {
        edits.push(replaceRange(text, at(e), e.length ?? 1, ']'));
        continue;
      }
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

        // Determine the expected bracket type from the error message
        // e.g., "Unclosed '['." or "Unclosed '{' ."
        const msg = e.message || '';
        const bracketMatch = msg.match(/Unclosed '(.+?)'/);
        const expectedOpener = bracketMatch ? (bracketMatch[1] || '').trim() : null;
        // Content-aware fix for double-circle opener '((' under --fix=all: insert a minimal label and the closer.
        if (expectedOpener === '((') {
          if (level === 'all') {
            // Find the last '((' before caret
            const openIdx = lineText.lastIndexOf('((', caret0);
            if (openIdx !== -1) {
              const contentStart = openIdx + 2;
              // Find the first link/arrow or end-of-line to place the closer before it
              const picks: number[] = [];
              const pushIdx2 = (i: number) => { if (i >= 0) picks.push(i); };
              pushIdx2(lineText.indexOf('-', contentStart));
              pushIdx2(lineText.indexOf('=', contentStart));
              pushIdx2(lineText.indexOf('.', contentStart));
              pushIdx2(lineText.indexOf('|', contentStart));
              let insertIdx = picks.length ? Math.min(...picks) : lineText.length;
              // Infer label from node id just before the "((" opener
              const before = lineText.slice(0, openIdx);
              const m = before.match(/([A-Za-z0-9_]+)\s*$/);
              const inferred = m ? m[1] : '';
              if (inferred) {
                // Replace from contentStart..insertIdx with '<id>))' (no spaces)
                edits.push({ start: { line: e.line, column: contentStart + 1 }, end: { line: e.line, column: insertIdx + 1 }, newText: inferred + '))' });
                patchedLines.add(e.line);
                continue;
              }
              // If we cannot infer a label from the id, do not guess; skip auto-fix
              patchedLines.add(e.line);
              continue;
            }
          }
          // If not --fix=all, skip editing to avoid invalid empty label
          continue;
        }

        // Map opener to closer
        const bracketMap: Record<string, string> = {
          '[': ']', '{': '}', '(': ')',
          '[[': ']]', '{{': '}}', '((': '))',
          '([': '])', '[(': ')]'
        };
        const expectedCloser = expectedOpener ? bracketMap[expectedOpener] : null;

        // Find the last occurrence of the expected opener before caret
        let opened: { open: string; close: string; idx: number; len: number } | null = null;
        if (expectedOpener && expectedCloser) {
          const idx = lineText.lastIndexOf(expectedOpener, caret0);
          if (idx !== -1) {
            opened = { open: expectedOpener, close: expectedCloser, idx, len: expectedOpener.length };
          }
        }

        // Fallback: search for any opener if we couldn't determine from message
        if (!opened) {
          const opens = [
            { open: '{{', close: '}}', idx: lineText.lastIndexOf('{{', caret0), len: 2 },
            { open: '[[', close: ']]', idx: lineText.lastIndexOf('[[', caret0), len: 2 },
            { open: '([', close: '])', idx: lineText.lastIndexOf('([', caret0), len: 2 },
            { open: '[(', close: ')]', idx: lineText.lastIndexOf('[(', caret0), len: 2 },
            { open: '{',  close: '}',  idx: lineText.lastIndexOf('{',  caret0), len: 1 },
            { open: '(',  close: ')',  idx: lineText.lastIndexOf('(',  caret0), len: 1 },
            { open: '[',  close: ']',  idx: lineText.lastIndexOf('[',  caret0), len: 1 },
          ];
          opened = opens.filter(o => o.idx !== -1).sort((a,b)=> a.idx - b.idx).pop() || null;
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
        }

        // Now try to find the closer on the same line
        if (opened) {
            const closerIdx = lineText.indexOf(opened.close, caret0);
            if (closerIdx !== -1) {
              // Extract the content between opener and closer
              const innerSeg = lineText.slice(opened.idx + opened.len, closerIdx);
              // DEBUG
              if (process.env.DEBUG_FIXES) {
                console.log('DEBUG FL-NODE-UNCLOSED-BRACKET:');
                console.log('  opened.idx:', opened.idx, 'opened.len:', opened.len, 'opened.open:', opened.open, 'opened.close:', opened.close);
                console.log('  closerIdx:', closerIdx);
                console.log('  innerSeg:', innerSeg);
                console.log('  caret0:', caret0, 'lineText[caret0]:', lineText[caret0]);
              }
              // Check if there are quotes inside
              if (innerSeg.includes('"') || innerSeg.includes("'")) {
                // Wrap the label in double quotes and escape inner double quotes
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
                edits.push({ start: { line: e.line, column: opened.idx + opened.len + 1 }, end: { line: e.line, column: closerIdx + 1 }, newText: newInner });
                patchedLines.add(e.line);
                continue;
              }
              // If there are parentheses inside an unquoted label, encode them as HTML entities
              if (innerSeg.includes('(') || innerSeg.includes(')')) {
                const replaced = innerSeg.replace(/\(/g, '&#40;').replace(/\)/g, '&#41;');
                if (replaced !== innerSeg) {
                  edits.push({ start: { line: e.line, column: opened.idx + opened.len + 1 }, end: { line: e.line, column: closerIdx + 1 }, newText: replaced });
                  patchedLines.add(e.line);
                  continue;
                }
              }
            }
        }

        // Fallback: if no opener found or no closer found or no quotes inside, just replace current char with closer
        if (patchedLines.has(e.line)) {
          continue;
        }
        let closer = ']';
        if (opened) closer = opened.close;
        // Prefer a targeted insertion for the common square-bracket case: place ']' just before the link/arrow
        if (closer === ']') {
          const openIdxSq = lineText.lastIndexOf('[', caret0);
          if (openIdxSq !== -1) {
            // Find first link-like token after the opener
            const picks: number[] = [];
            const pushIdx2 = (i: number) => { if (i >= 0) picks.push(i); };
            pushIdx2(lineText.indexOf('-', openIdxSq + 1));
            pushIdx2(lineText.indexOf('=', openIdxSq + 1));
            pushIdx2(lineText.indexOf('.', openIdxSq + 1));
            pushIdx2(lineText.indexOf('|', openIdxSq + 1));
            let ins = picks.length ? Math.min(...picks) : lineText.length;
            // Trim trailing spaces before insertion
            let tl = ins - 1;
            while (tl >= 0 && /\s/.test(lineText[tl])) tl--;
            const startCol2 = (tl + 1) + 1; // after last non-space
            const endCol2 = ins + 1;        // at insertion point
            edits.push({ start: { line: e.line, column: startCol2 }, end: { line: e.line, column: endCol2 }, newText: closer });
          } else {
            const avail = lineText.slice(caret0);
            const replaceLen = Math.min(closer.length, Math.max(1, avail.length));
            edits.push({ start: { line: e.line, column: caret0 + 1 }, end: { line: e.line, column: caret0 + 1 + replaceLen }, newText: closer });
          }
        } else {
          // Generic fallback
          const avail = lineText.slice(caret0);
          const replaceLen = Math.min(closer.length, Math.max(1, avail.length));
          edits.push({ start: { line: e.line, column: caret0 + 1 }, end: { line: e.line, column: caret0 + 1 + replaceLen }, newText: closer });
        }
      }
      continue;
    }
    if (is('FL-QUOTE-UNCLOSED', e)) {
      if (patchedLines.has(e.line)) { continue; }
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
    // Flowchart: unquoted subgraph title with spaces → quote it (Safe)
    if (is('FL-SUBGRAPH-UNQUOTED-TITLE', e)) {
      if (level === 'safe' || level === 'all') {
        const lineText = lineTextAt(text, e.line);
        const subgraphIdx = lineText.indexOf('subgraph');
        if (subgraphIdx !== -1) {
          const beforeSubgraph = lineText.slice(0, subgraphIdx + 8);
          const afterSubgraph = lineText.slice(subgraphIdx + 8);
          const trimmed = afterSubgraph.trim();
          const leadingSpaces = afterSubgraph.match(/^(\s*)/)?.[1] || '';

          // Quote the title
          const quotedTitle = `"${trimmed}"`;
          const fixedLine = beforeSubgraph + leadingSpaces + quotedTitle;

          edits.push({
            start: { line: e.line, column: 1 },
            end: { line: e.line, column: lineText.length + 1 },
            newText: fixedLine
          });
        }
      }
      continue;
    }
    // Flowchart: node id conflicts with an enclosing subgraph id (heuristic rename)
    if (is('FL-SUBGRAPH-ID-COLLISION', e)) {
      if (level === 'all') {
        const lineText = lineTextAt(text, e.line);
        if (lineText.trimStart().startsWith('subgraph')) continue;
        const caret0 = Math.max(0, e.column - 1);
        const slice = lineText.slice(caret0);
        const m = slice.match(/^([A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*)/);
        if (m) {
          const id = m[1];
          let newId = subgraphCollisionRename.get(id);
          if (!newId) {
            newId = id.endsWith('_node') ? `${id}2` : `${id}_node`;
            subgraphCollisionRename.set(id, newId);
          }
          if (newId !== id) {
            edits.push(replaceRange(text, { line: e.line, column: caret0 + 1 }, id.length, newId));
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
        // Safety guard: very long, quote-dense labels are likely code samples.
        // Avoid rewriting these to prevent content corruption; leave as-is for manual editing.
        const dq = (lineText.replace(/\\\"/g, '').match(/\"/g) || []).length;
        if (lineText.length > 600 || dq > 8) {
          continue;
        }
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
            // Encode double quotes in-place (do not wrap). This avoids introducing
            // new quotes that could interact badly with other heuristics.
            let newInner: string;
            if (core.length >= 2 && isSlashPair(left, right)) {
              const mid = core.slice(1, -1);
              const replacedMid = mid.split('&quot;').join('\u0000').split('"').join('&quot;').split('\u0000').join('&quot;');
              newInner = ltrim + left + replacedMid + right + rtrim;
            } else {
              const replaced = inner.split('&quot;').join('\u0000').split('"').join('&quot;').split('\u0000').join('&quot;');
              newInner = replaced;
            }
            edits.push({ start: { line: e.line, column: contentStart + 1 }, end: { line: e.line, column: closeIdx + 1 }, newText: newInner });
            patchedLines.add(e.line);
          }
        }
      }
      continue;
    }
    // Flowchart: wrap or normalize unquoted labels containing special characters
    if (is('FL-LABEL-PARENS-UNQUOTED', e) || is('FL-LABEL-AT-IN-UNQUOTED', e) || is('FL-LABEL-SLASH-UNQUOTED', e) || is('FL-LABEL-CURLY-IN-UNQUOTED', e) || is('FL-LABEL-BRACKET-IN-UNQUOTED', e)) {
      if (level === 'safe' || level === 'all') {
        if (patchedLines.has(e.line)) continue; // Already patched this line
        const lineText = lineTextAt(text, e.line);
        const caret0 = Math.max(0, e.column - 1);
        // Find ALL shape openers/closers on this line to identify label boundaries
        const shapes = [
          { open: '{{', close: '}}' },
          { open: '[[', close: ']]' },
          { open: '((', close: '))' },
          { open: '([', close: '])' },
          { open: '[(', close: ')]' },
          { open: '{',  close: '}' },
          { open: '[',  close: ']' },
          { open: '(',  close: ')' }
        ];

        // Helper to find the matching closer, accounting for nested delimiters
        const findMatchingCloser = (text: string, openIdx: number, opener: string, closer: string): number => {
          let pos = openIdx + opener.length;
          let depth = 1;
          while (pos < text.length && depth > 0) {
            if (text.slice(pos, pos + opener.length) === opener) {
              depth++;
              pos += opener.length;
            } else if (text.slice(pos, pos + closer.length) === closer) {
              depth--;
              if (depth === 0) return pos;
              pos += closer.length;
            } else {
              pos++;
            }
          }
          return -1; // No matching closer found
        };

        // Find which shape contains the problematic parenthesis
        for (const shape of shapes) {
          let searchStart = 0;
          while (true) {
            const openIdx = lineText.indexOf(shape.open, searchStart);
            if (openIdx === -1) break;
            const contentStart = openIdx + shape.open.length;
            // Use smart matching for round shapes to handle nested parentheses
            const closeIdx = ((shape.open === '(' && shape.close === ')') || (shape.open === '[' && shape.close === ']'))
              ? findMatchingCloser(lineText, openIdx, shape.open, shape.close)
              : lineText.indexOf(shape.close, contentStart);
            if (closeIdx === -1) break;

            // Check if this shape contains the caret position (the parenthesis)
            if (openIdx <= caret0 && caret0 < closeIdx) {
              const inner = lineText.slice(contentStart, closeIdx);
              // Check if already quoted
              const trimmed = inner.trim();
              if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
                break; // Already quoted
              }
              // For round-paren shapes like (text), the caret points to the shape's own parens, skip
              if (shape.open === '(' && (caret0 === openIdx || caret0 === closeIdx - 1)) {
                break;
              }
              // Check for parallelogram/trapezoid shapes [/.../], [\...\], [/...\], [\.../]
              // For these shapes, we encode both parentheses AND quotes (but don't wrap in quotes)
              const ltrim = inner.match(/^\s*/)?.[0] ?? '';
              const rtrim = inner.match(/\s*$/)?.[0] ?? '';
              const core = inner.slice(ltrim.length, inner.length - rtrim.length);
              const left = core.slice(0, 1);
              const right = core.slice(-1);
              const isSlashPair = (l: string, r: string) => (l === '/' && r === '/') || (l === '\\' && r === '\\') || (l === '/' && r === '\\') || (l === '\\' && r === '/');
              const isParallelogramShape = core.length >= 2 && isSlashPair(left, right);

              // Primary strategy: wrap in quotes (standard Mermaid syntax for special characters)
              // Fallback: for parallelogram/trapezoid shapes, encode only characters that break parsing
              let replaced: string;
              if (is('FL-LABEL-BRACKET-IN-UNQUOTED', e) && !isParallelogramShape) {
                // For simple bracket-only labels, encode brackets in place.
                // If other unsafe chars are present too, prefer full quoting so one fix resolves all.
                const hasOtherHazards = /[(){}@]/.test(inner) || inner.includes('"') || inner.includes('\\"');
                if (hasOtherHazards) {
                  const escaped = inner
                    .replace(/`/g, '')
                    .replace(/\\"/g, '&quot;')
                    .replace(/"/g, '&quot;');
                  replaced = '"' + escaped + '"';
                } else {
                  replaced = inner.replace(/\[/g, '&#91;').replace(/\]/g, '&#93;');
                }
              } else if (is('FL-LABEL-CURLY-IN-UNQUOTED', e)) {
                // Curly braces in unquoted labels break Mermaid parsing; encode in place.
                replaced = inner.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
              } else if (!isParallelogramShape) {
                // Wrap in quotes and escape internal double quotes. Curly braces and parens are fine inside quotes.
                const escaped = inner
                  .replace(/`/g, '')
                  .replace(/\\"/g, '&quot;')
                  .replace(/"/g, '&quot;');
                replaced = '"' + escaped + '"';
              } else {
                // Parallelogram/trapezoid shapes don't support quotes: encode unsafe characters only
                replaced = inner
                  .replace(/`/g, '')
                  .replace(/\(/g, '&#40;').replace(/\)/g, '&#41;')
                  .replace(/\[/g, '&#91;').replace(/\]/g, '&#93;')
                  .replace(/\\"/g, '&quot;')
                  .replace(/"/g, '&quot;');
              }

              if (replaced !== inner) {
                edits.push({ start: { line: e.line, column: contentStart + 1 }, end: { line: e.line, column: closeIdx + 1 }, newText: replaced });
                patchedLines.add(e.line);
              }
              break;
            }
            searchStart = openIdx + 1;
          }
          if (patchedLines.has(e.line)) break; // Found and patched, stop searching
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
    if (is('SE-MSG-SEMICOLON-UNESCAPED', e)) {
      const lineText = lineTextAt(text, e.line);
      const arrows = ['<<-->>', '<<->>', '-->>', '->>', '-->', '->', '--x', '-x', '--)', '-)'];
      let ai = -1;
      let alen = 0;
      for (const a of arrows) {
        const idx = lineText.indexOf(a);
        if (idx !== -1 && (ai === -1 || idx < ai)) { ai = idx; alen = a.length; }
      }
      if (ai !== -1) {
        const colonIdx = lineText.indexOf(':', ai + alen);
        if (colonIdx !== -1) {
          const head = lineText.slice(0, colonIdx + 1);
          const tail = lineText.slice(colonIdx + 1);
          const fixedTail = escapeUnescapedSemicolons(tail);
          if (fixedTail !== tail) {
            edits.push({
              start: { line: e.line, column: 1 },
              end: { line: e.line, column: lineText.length + 1 },
              newText: head + fixedTail
            });
          }
        }
      }
      continue;
    }
    if (is('SE-NOTE-MALFORMED', e)) {
      const lineText = lineTextAt(text, e.line);
      // Single-line header with inline body
      const mLR = /^(\s*)Note\s+(left|right)\s+of\s+(.+?)\s+(.+)$/.exec(lineText);
      const mOver = /^(\s*)Note\s+over\s+(.+?)\s+(.+)$/.exec(lineText);
      // Header-only (multiline) without inline body
      const mLRml = /^(\s*)Note\s+(left|right)\s+of\s+([^:]+?)\s*$/.exec(lineText);
      const mOverml = /^(\s*)Note\s+over\s+([^:]+?)\s*$/.exec(lineText);
      let insertCol = e.column;
      if (mLR) {
        const indent = mLR[1] || '';
        const beforeHeader = `${indent}Note ${mLR[2]} of ${mLR[3]}`;
        insertCol = beforeHeader.length + 1; // 1-based after header
      } else if (mOver) {
        const indent = mOver[1] || '';
        const beforeHeader = `${indent}Note over ${mOver[2]}`;
        insertCol = beforeHeader.length + 1;
      } else if (mLRml || mOverml) {
        // Convert multiline block note to single-line note by inlining the body and removing 'end note'
        const lines = text.split(/\r?\n/);
        const headerIdx = Math.max(0, e.line - 1);
        let endIdx = -1;
        for (let i = headerIdx + 1; i < lines.length; i++) {
          if (/^\s*end\s+note\s*$/i.test(lines[i] || '')) { endIdx = i; break; }
        }
        const indent = (mLRml ? mLRml[1] : mOverml![1]) || '';
        const beforeHeader = mLRml
          ? `${indent}Note ${mLRml[2]} of ${mLRml[3].trimEnd()}`
          : `${indent}Note over ${mOverml![2].trimEnd()}`;
        const body = endIdx !== -1 ? lines.slice(headerIdx + 1, endIdx).map(s => s.trim()).join(' ') : '';
        const newHeader = `${beforeHeader} : ${body}`.replace(/\s+$/,'');
        // Replace header line with inlined single-line note
        const hdrLine = lineTextAt(text, e.line);
        edits.push({ start: { line: e.line, column: 1 }, end: { line: e.line, column: hdrLine.length + 1 }, newText: newHeader });
        if (endIdx !== -1) {
          // Delete body lines and the 'end note' line
          edits.push({ start: { line: headerIdx + 2, column: 1 }, end: { line: endIdx + 2, column: 1 }, newText: '' });
        }
        continue;
      }
      // Normalize spaces around colon: ensure one space before and one after
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
      if (level === 'all') {
        // Convert empty box to rect, but only when doing so is likely to produce
        // a valid diagram. If the box body contains activation markers (+/-)
        // on messages, skip the transform (previews require fixed output to be valid).
        const lines = text.split(/\r?\n/);
        const boxIdx = Math.max(0, e.line - 1);
        const boxLine = lines[boxIdx] || '';
        // Find aligned 'end' for this box
        const openIndent = (boxLine.match(/^(\s*)/)?.[1] || '').length;
        let endIdx = -1;
        for (let i = boxIdx + 1; i < lines.length; i++) {
          const raw = lines[i] || '';
          const ind = (raw.match(/^(\s*)/)?.[1] || '').length;
          if (/^\s*end\s*$/.test(raw) && ind <= openIndent) { endIdx = i; break; }
        }
        let hasMsgWithAct = false;
        if (endIdx !== -1) {
          const body = lines.slice(boxIdx + 1, endIdx).map(s => (s || '').trim());
          hasMsgWithAct = body.some(s => /->/.test(s) && /[+-]/.test(s));
        }
        if (!hasMsgWithAct) {
          const labelMatch = /^\s*box\s+(.+)$/.exec(boxLine);
          if (labelMatch) {
            const indent = boxLine.match(/^\s*/)?.[0] || '';
            const newLine = `${indent}rect rgb(240, 240, 255)`;
            edits.push({ start: { line: e.line, column: 1 }, end: { line: e.line, column: boxLine.length + 1 }, newText: newLine });
          }
        }
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
    if (is('CL-NAMESPACE-MISSING-RBRACE', e)) {
      // Insert '}' aligned with 'namespace X {'
      const lines = text.split(/\r?\n/);
      const curIdx = Math.max(0, e.line - 1);
      const openerRe = /^(\s*)namespace\b.*\{\s*$/;
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
