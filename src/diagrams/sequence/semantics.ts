import type { CstNode, IToken } from 'chevrotain';
import type { ValidationError } from '../../core/types.js';
import { parserInstance } from './parser.js';
import * as t from './lexer.js';
import { actorRefToText } from './cst-utils.js';

// Minimal semantic pass scaffold (hooks for future rules)
const BaseVisitor: any = (parserInstance as any).getBaseCstVisitorConstructorWithDefaults();

class SequenceSemanticsVisitor extends BaseVisitor {
  constructor(private ctx: { tokens: IToken[] }) {
    super();
    this.validateVisitor();
  }
}

export function analyzeSequence(_cst: CstNode, _tokens: IToken[]): ValidationError[] {
  const ctx = { tokens: _tokens };
  const v = new SequenceSemanticsVisitor(ctx);
  // Temporary CLI-parity checks: current mermaid-cli rejects meta/properties/details lines
  const errs: ValidationError[] = [];
  // Determine the first token on each line (after skipping whitespace/comments in lexer)
  const firstByLine = new Map<number, IToken>();
  for (const tk of _tokens) {
    const ln = tk.startLine ?? 1;
    const col = tk.startColumn ?? 1;
    const prev = firstByLine.get(ln);
    if (!prev || (prev.startColumn ?? Infinity) > col) firstByLine.set(ln, tk);
  }
  for (const tok of _tokens) {
    if (tok.tokenType === t.TitleKeyword || tok.tokenType === t.AccTitleKeyword || tok.tokenType === t.AccDescrKeyword) {
      // Only treat as meta header when token starts the line (avoid catching '... Accessible Title')
      const isLineStart = firstByLine.get(tok.startLine ?? 1) === tok;
      if (isLineStart) errs.push({
        line: tok.startLine ?? 1,
        column: tok.startColumn ?? 1,
        severity: 'error',
        code: 'SE-META-UNSUPPORTED',
        message: 'Title/accTitle/accDescr are not accepted by current Mermaid CLI for sequence diagrams.',
        hint: "Remove this line (e.g., 'title …') to match mermaid-cli.",
        length: (tok.image?.length ?? 5)
      });
    }
    if (tok.tokenType === t.PropertiesKeyword && firstByLine.get(tok.startLine ?? 1) === tok) {
      errs.push({
        line: tok.startLine ?? 1,
        column: tok.startColumn ?? 1,
        severity: 'error',
        code: 'SE-PROPERTIES-UNSUPPORTED',
        message: "'properties' is not accepted by current Mermaid CLI for sequence diagrams.",
        hint: "Remove the 'properties:' line to match mermaid-cli.",
        length: (tok.image?.length ?? 10)
      });
    }
    if (tok.tokenType === t.DetailsKeyword && firstByLine.get(tok.startLine ?? 1) === tok) {
      errs.push({
        line: tok.startLine ?? 1,
        column: tok.startColumn ?? 1,
        severity: 'error',
        code: 'SE-DETAILS-UNSUPPORTED',
        message: "'details' is not accepted by current Mermaid CLI for sequence diagrams.",
        hint: "Remove the 'details:' line to match mermaid-cli.",
        length: (tok.image?.length ?? 7)
      });
    }
  }
  // Additional human-friendly warnings: activation balance and create -> creating message
  type Ev = { kind:'activate'|'deactivate'|'message'|'create'; line:number; actor?:string; from?:string; to?:string };
  const lines: Map<number, IToken[]> = new Map();
  for (const tk of _tokens) {
    if (tk.tokenType === t.Newline) continue;
    const ln = tk.startLine ?? 1;
    (lines.get(ln) || lines.set(ln, []).get(ln)!).push(tk);
  }
  const events: Ev[] = [];
  const tokensByLine = Array.from(lines.entries()).sort((a,b)=>a[0]-b[0]);
  const grabActorRef = (arr: IToken[], startIdx: number): string => {
    const parts: string[] = [];
    for (let i=startIdx;i<arr.length;i++){
      const tk=arr[i];
      if (tk.tokenType === t.Colon || tk.tokenType === t.Newline) break;
      if (tk.tokenType === t.Identifier || tk.tokenType === t.QuotedString || tk.tokenType === t.NumberLiteral || tk.tokenType === t.Text) parts.push(tk.image);
      if (tk.tokenType === t.Async || tk.tokenType === t.Solid || tk.tokenType === t.Dotted || tk.tokenType === t.DottedAsync || tk.tokenType === t.BidirAsync || tk.tokenType === t.BidirAsyncDotted) break;
    }
    const raw = parts.join(' ').trim();
    return raw.replace(/^"|"$/g,'');
  };
  for (const [ln, arr] of tokensByLine){
    // classify line
    if (arr.some(tk => tk.tokenType === t.ActivateKeyword)) {
      const idx = arr.findIndex(tk => tk.tokenType === t.ActivateKeyword);
      const actor = grabActorRef(arr, idx+1);
      if (actor) events.push({ kind:'activate', line: ln, actor});
      continue;
    }
    if (arr.some(tk => tk.tokenType === t.DeactivateKeyword)) {
      const idx = arr.findIndex(tk => tk.tokenType === t.DeactivateKeyword);
      const actor = grabActorRef(arr, idx+1);
      if (actor) events.push({ kind:'deactivate', line: ln, actor});
      continue;
    }
    if (arr.some(tk => tk.tokenType === t.CreateKeyword)) {
      const idx = arr.findIndex(tk => tk.tokenType === t.CreateKeyword);
      // after 'create' there may be participant/actor keyword then actorRef
      const after = arr.slice(idx+1);
      const aidx = after.findIndex(tk => tk.tokenType === t.ParticipantKeyword || tk.tokenType === t.ActorKeyword);
      const actor = aidx >= 0 ? grabActorRef(after, aidx+1) : grabActorRef(arr, idx+1);
      if (actor) events.push({ kind:'create', line: ln, actor});
      continue;
    }
    // message line: detect arrow token
    const arrowIdx = arr.findIndex(tk => [t.Async,t.DottedAsync,t.Solid,t.Dotted,t.Cross,t.DottedCross,t.DottedOpen,t.Open,t.BidirAsync,t.BidirAsyncDotted].includes(tk.tokenType as any));
    if (arrowIdx > 0) {
      const from = grabActorRef(arr, 0);
      const to = grabActorRef(arr, arrowIdx+1);
      if (from || to) {
        // suffix checks: presence of Plus/Minus tokens on the line
        const plusTok = arr.find(tk => tk.tokenType === t.Plus);
        const minusTok = arr.find(tk => tk.tokenType === t.Minus);
        (events as any).push({ kind:'message', line: ln, from, to, plus: Boolean(plusTok), minus: Boolean(minusTok), plusTok, minusTok });
      }
    }
  }
  // activation balance + suffix checks
  const actStack = new Map<string, { line:number }[]>();
  for (const ev of events){
    if (ev.kind === 'activate' && ev.actor){
      const a = actStack.get(ev.actor) || []; a.push({ line: ev.line }); actStack.set(ev.actor, a);
    } else if (ev.kind === 'deactivate' && ev.actor){
      const a = actStack.get(ev.actor) || []; a.pop(); actStack.set(ev.actor, a);
    } else if (ev.kind === 'message' && (ev as any).to) {
      const target = (ev as any).to as string;
      const plus = Boolean((ev as any).plus);
      const minus = Boolean((ev as any).minus);
      const plusTok: IToken | undefined = (ev as any).plusTok;
      const minusTok: IToken | undefined = (ev as any).minusTok;
      if (plus) {
        const a = actStack.get(target) || [];
        if (a.length > 0) {
          const col = plusTok?.startColumn ?? 1;
          errs.push({ line: ev.line, column: col, severity: 'warning', code: 'SE-ACTIVATION-ALREADY-ACTIVE', message: `Message indicates '+ (activate)' but '${target}' is already active.`, hint: `Remove '+' or deactivate first: deactivate ${target}`, length: 1 });
        } else {
          a.push({ line: ev.line }); actStack.set(target, a);
        }
      }
      if (minus) {
        const a = actStack.get(target) || [];
        if (a.length === 0) {
          const col = minusTok?.startColumn ?? 1;
          errs.push({ line: ev.line, column: col, severity: 'warning', code: 'SE-DEACTIVATE-NO-ACTIVE', message: `Message indicates '- (deactivate)' but '${target}' is not active.`, hint: `Remove '-' or ensure 'activate ${target}' occurred before.`, length: 1 });
        } else {
          a.pop(); actStack.set(target, a);
        }
      }
    }
  }
  for (const [actor, arr] of actStack.entries()){
    if (arr.length){
      const top = arr[arr.length-1];
      errs.push({
        line: top.line,
        column: 1,
        severity: 'warning',
        code: 'SE-ACTIVATION-UNBALANCED',
        message: `Unbalanced activation: '${actor}' was activated but not deactivated.`,
        hint: `Add 'deactivate ${actor}' after the active section.`,
        length: actor.length
      });
    }
  }
  // create -> next creating message involving the new actor
  for (let i=0;i<events.length;i++){
    const ev = events[i];
    if (ev.kind === 'create' && ev.actor){
      const next = events[i+1];
      if (!(next && next.kind === 'message' && (next.from === ev.actor || next.to === ev.actor))){
        errs.push({
          line: ev.line,
          column: 1,
          severity: 'warning',
          code: 'SE-CREATE-NO-CREATING-MESSAGE',
          message: `Actor '${ev.actor}' is created but the next line is not a message involving it.`,
          hint: `Add a creating message to or from '${ev.actor}' immediately after the create line.`,
          length: ev.actor.length
        });
      }
    }
  }
  return errs;
}
