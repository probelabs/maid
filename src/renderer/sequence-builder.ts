import type { CstNode, IToken } from 'chevrotain';
import { tokenize as lexSequence } from '../diagrams/sequence/lexer.js';
import { parserInstance } from '../diagrams/sequence/parser.js';
import type { SequenceModel, SequenceEvent, Participant, Message, Block, BlockBranch, Note, ArrowMarker, MessageLine } from './sequence-types.js';
import { actorRefToText, lineRemainderToText } from '../diagrams/sequence/cst-utils.js';

function textFromTokens(tokens: IToken[] | undefined): string {
  if (!tokens || tokens.length === 0) return '';
  const parts: string[] = [];
  for (const t of tokens) {
    const img = t.image;
    if (!img) continue;
    if ((t as any).tokenType && (t as any).tokenType.name === 'QuotedString') {
      if (img.startsWith('"') && img.endsWith('"')) parts.push(img.slice(1, -1));
      else if (img.startsWith("'") && img.endsWith("'")) parts.push(img.slice(1, -1));
      else parts.push(img);
    } else {
      parts.push(img);
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// actorRefToText + lineRemainderToText are shared from cst-utils

function canonicalId(raw: string): string {
  // Keep letters/digits/_; collapse spaces to _; strip quotes already handled
  const t = raw.trim().replace(/\s+/g, '_');
  return t;
}

function ensureParticipant(map: Map<string, Participant>, byDisplay: Map<string,string>, idLike: string, display?: string): Participant {
  // Prefer existing by id or display-as
  const idGuess = canonicalId(idLike);
  const existing = map.get(idGuess) || (byDisplay.get(idLike) ? map.get(byDisplay.get(idLike)!) : undefined);
  if (existing) return existing;
  const p: Participant = { id: idGuess, display: display || idLike };
  map.set(p.id, p);
  byDisplay.set(p.display, p.id);
  return p;
}

function msgFromArrow(arrowCst: CstNode): { line: MessageLine; start: ArrowMarker; end: ArrowMarker; async?: boolean } {
  const ch = (arrowCst.children || {}) as any;
  // Token presence discriminates
  if (ch.BidirAsyncDotted) return { line: 'dotted', start: 'arrow', end: 'arrow', async: true };
  if (ch.BidirAsync) return { line: 'solid', start: 'arrow', end: 'arrow', async: true };
  if (ch.DottedAsync) return { line: 'dotted', start: 'none', end: 'arrow', async: true };
  if (ch.Async) return { line: 'solid', start: 'none', end: 'arrow', async: true };
  if (ch.Dotted) return { line: 'dotted', start: 'none', end: 'arrow' };
  if (ch.Solid) return { line: 'solid', start: 'none', end: 'arrow' };
  if (ch.DottedCross) return { line: 'dotted', start: 'none', end: 'cross' };
  if (ch.Cross) return { line: 'solid', start: 'none', end: 'cross' };
  if (ch.DottedOpen) return { line: 'dotted', start: 'none', end: 'open' };
  if (ch.Open) return { line: 'solid', start: 'none', end: 'open' };
  return { line: 'solid', start: 'none', end: 'arrow' };
}

export function buildSequenceModel(text: string): SequenceModel {
  const { tokens } = lexSequence(text);
  parserInstance.input = tokens as any;
  const cst: CstNode = (parserInstance as any).diagram();

  const participantsMap = new Map<string, Participant>();
  const byDisplay = new Map<string, string>();
  const events: SequenceEvent[] = [];
  let autonumber = { on: false } as any;
  let title: string | undefined;
  let accTitle: string | undefined;
  let accDescr: string | undefined;

  const diagramChildren = (cst.children || {}) as any;
  const lines = (diagramChildren.line as CstNode[] | undefined) || [];

  const openBlocks: Block[] = [];

  function processLineNode(ln: CstNode) {
    const ch = (ln.children || {}) as any;

    // metaStmt: title / accTitle / accDescr
    if (ch.metaStmt) {
      const m = ch.metaStmt[0] as CstNode;
      const mch = (m.children || {}) as any;
      const value = lineRemainderToText(mch.lineRemainder?.[0]) || '';
      if (mch.TitleKeyword) title = value;
      if (mch.AccTitleKeyword) accTitle = value;
      if (mch.AccDescrKeyword) accDescr = value;
      return;
    }

    // participantDecl
    if (ch.participantDecl) {
      const decl = ch.participantDecl[0] as CstNode;
      const dch = (decl.children || {}) as any;
      const ref1 = dch.actorRef?.[0] as CstNode;
      const ref2 = dch.actorRef?.[1] as CstNode | undefined;
      const idText = actorRefToText(ref1);
      const aliasText = ref2 ? actorRefToText(ref2) : undefined;
      const id = canonicalId(idText);
      const display = aliasText || idText;
      const p = ensureParticipant(participantsMap, byDisplay, id, display);
      // Create explicit event for future if needed
      events.push({ kind: 'create', actor: p.id, display: p.display });
      return;
    }

    // autonumberStmt
    if (ch.autonumberStmt) {
      const stmt = ch.autonumberStmt[0] as CstNode;
      const sch = (stmt.children || {}) as any;
      autonumber = { on: true } as any;
      const nums = (sch.NumberLiteral as IToken[] | undefined) || [];
      if (nums.length >= 1) (autonumber as any).start = Number(nums[0].image);
      if (nums.length >= 2) (autonumber as any).step = Number(nums[1].image);
      if (sch.OffKeyword) autonumber = { on: false };
      return;
    }

    // activate / deactivate
    if (ch.activateStmt) {
      const st = ch.activateStmt[0] as CstNode; const sch = (st.children || {}) as any;
      const idTxt = actorRefToText(sch.actorRef?.[0]); const p = ensureParticipant(participantsMap, byDisplay, idTxt);
      events.push({ kind: 'activate', actor: p.id });
      return;
    }
    if (ch.deactivateStmt) {
      const st = ch.deactivateStmt[0] as CstNode; const sch = (st.children || {}) as any;
      const idTxt = actorRefToText(sch.actorRef?.[0]); const p = ensureParticipant(participantsMap, byDisplay, idTxt);
      events.push({ kind: 'deactivate', actor: p.id });
      return;
    }

    // create / destroy lines
    if (ch.createStmt) {
      const st = ch.createStmt[0] as CstNode; const sch = (st.children || {}) as any;
      const idTxt = actorRefToText(sch.actorRef?.[0]);
      const alias = sch.lineRemainder ? lineRemainderToText(sch.lineRemainder[0]) : undefined;
      const p = ensureParticipant(participantsMap, byDisplay, idTxt, alias || idTxt);
      events.push({ kind: 'create', actor: p.id, display: p.display });
      return;
    }
    if (ch.destroyStmt) {
      const st = ch.destroyStmt[0] as CstNode; const sch = (st.children || {}) as any;
      const idTxt = actorRefToText(sch.actorRef?.[0]);
      const p = ensureParticipant(participantsMap, byDisplay, idTxt);
      events.push({ kind: 'destroy', actor: p.id });
      return;
    }

    // noteStmt
    if (ch.noteStmt) {
      const st = ch.noteStmt[0] as CstNode; const sch = (st.children || {}) as any;
      const text = lineRemainderToText(sch.lineRemainder?.[0]) || '';
      if (sch.LeftKeyword || sch.RightKeyword) {
        const pos: 'leftOf' | 'rightOf' = sch.LeftKeyword ? 'leftOf' : 'rightOf';
        const actorTxt = actorRefToText(sch.actorRef?.[0]); const p = ensureParticipant(participantsMap, byDisplay, actorTxt);
        const note: Note = { pos, actors: [p.id], text };
        events.push({ kind: 'note', note });
      } else if (sch.OverKeyword) {
        const a1 = actorRefToText(sch.actorRef?.[0]);
        const a2 = sch.actorRef?.[1] ? actorRefToText(sch.actorRef?.[1]) : undefined;
        const p1 = ensureParticipant(participantsMap, byDisplay, a1);
        const ids = [p1.id];
        if (a2) { const p2 = ensureParticipant(participantsMap, byDisplay, a2); ids.push(p2.id); }
        events.push({ kind: 'note', note: { pos: 'over', actors: ids, text } });
      }
      return;
    }

    // Blocks: alt/opt/loop/par/critical/break/rect/box
    const blockKinds: Array<{ key: string; type: Block['type']; branchKeys?: Array<{ key: string; kind: BlockBranch['kind'] }> }>= [
      { key: 'altBlock', type: 'alt', branchKeys: [{ key: 'ElseKeyword', kind: 'else' }] },
      { key: 'optBlock', type: 'opt' },
      { key: 'loopBlock', type: 'loop' },
      { key: 'parBlock', type: 'par', branchKeys: [{ key: 'AndKeyword', kind: 'and' }] },
      { key: 'criticalBlock', type: 'critical', branchKeys: [{ key: 'OptionKeyword', kind: 'option' }] },
      { key: 'breakBlock', type: 'break' },
      { key: 'rectBlock', type: 'rect' },
      { key: 'boxBlock', type: 'box' },
    ];
    let handledBlock = false;
    for (const spec of blockKinds) {
      if (ch[spec.key]) {
        handledBlock = true;
        const bnode = ch[spec.key][0] as CstNode; const bch = (bnode.children || {}) as any;
        const title = lineRemainderToText(bch.lineRemainder?.[0]);
        const block: Block = { type: spec.type, title, branches: spec.branchKeys ? [] : undefined };
        openBlocks.push(block);
        events.push({ kind: 'block-start', block });
        if (spec.branchKeys) {
          // scan internal children for branch keywords occurrences (ElseKeyword/AndKeyword/OptionKeyword)
          const newlines = (bch.Newline as IToken[] | undefined) || [];
          // The CST shape stores branch tokens explicitly in child arrays with 2/3 suffixes; here rely on keys existence
          const branchKey = spec.branchKeys[0].key; // one kind per block in our grammar
          const branchTokArr = (bch as any)[branchKey] as IToken[] | undefined;
          const lrArr = (bch as any).lineRemainder as CstNode[] | undefined;
          if (branchTokArr && branchTokArr.length) {
            // There are N branches; lineRemainder occurrences after first belong to branches
            const lr = (lrArr || []).slice(1); // after block header
            for (let i = 0; i < branchTokArr.length; i++) {
              const title2 = lr[i] ? lineRemainderToText(lr[i]) : undefined;
              const br: BlockBranch = { kind: spec.branchKeys[0].kind, title: title2 } as any;
              block.branches!.push(br);
              events.push({ kind: 'block-branch', block, branch: br });
            }
          }
        }
        events.push({ kind: 'block-end', block });
        openBlocks.pop();
        break;
      }
    }
    if (handledBlock) return;

    // messageStmt
    if (ch.messageStmt) {
      const st = ch.messageStmt[0] as CstNode; const sch = (st.children || {}) as any;
      const fromTxt = actorRefToText(sch.actorRef?.[0]);
      const toTxt = actorRefToText(sch.actorRef?.[1]);
      const from = ensureParticipant(participantsMap, byDisplay, fromTxt).id;
      const to = ensureParticipant(participantsMap, byDisplay, toTxt).id;
      const arrow = msgFromArrow(sch.arrow?.[0]);
      const text = lineRemainderToText(sch.lineRemainder?.[0]);
      const activateTarget = !!sch.Plus;
      const deactivateTarget = !!sch.Minus;
      const msg: Message = { from, to, text, line: arrow.line, startMarker: arrow.start, endMarker: arrow.end, async: arrow.async, activateTarget, deactivateTarget };
      events.push({ kind: 'message', msg });
      return;
    }

    // linkStmt (ignored for rendering for now)
    if (ch.linkStmt) { events.push({ kind: 'noop' }); return; }

    // blankLine or anything else ignored
    events.push({ kind: 'noop' });
  }

  // Collect nested line rules from a block node (alt/opt/loop/par/critical/break/rect/box)
  function collectInnerLines(blockNode: CstNode): CstNode[] {
    const out: CstNode[] = [];
    const ch = (blockNode.children || {}) as any;
    for (const key of Object.keys(ch)) {
      const arr = ch[key];
      if (Array.isArray(arr)) {
        for (const node of arr) {
          if (node && typeof node === 'object' && (node as CstNode).name === 'line') out.push(node as CstNode);
        }
      }
    }
    return out;
  }

  for (const ln of lines) {
    processLineNode(ln);
    // If the top-level line was a block, recurse into its internal lines
    const ch = (ln.children || {}) as any;
    const block = ch.altBlock?.[0] || ch.optBlock?.[0] || ch.loopBlock?.[0] || ch.parBlock?.[0] || ch.criticalBlock?.[0] || ch.breakBlock?.[0] || ch.rectBlock?.[0] || ch.boxBlock?.[0];
    if (block) {
      for (const inner of collectInnerLines(block)) processLineNode(inner);
    }
  }

  return {
    participants: Array.from(participantsMap.values()),
    events,
    autonumber: (autonumber as any).on === true || (autonumber as any).on === false ? (autonumber as any) : { on: false },
    title,
    accTitle,
    accDescr,
  };
}
