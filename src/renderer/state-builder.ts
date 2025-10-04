import type { CstNode, IToken } from 'chevrotain';
import { tokenize as lexState } from '../diagrams/state/lexer.js';
import { parserInstance } from '../diagrams/state/parser.js';
import type { StateModel, StateNodeDef, TransitionDef } from './state-types.js';

function textFromTokens(tokens: IToken[] | undefined): string {
  if (!tokens || tokens.length === 0) return '';
  const parts: string[] = [];
  for (const t of tokens) {
    const img = t.image ?? '';
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

function actorRefToId(ref: CstNode | undefined, ctx: { isTarget?: boolean } = {}): { id: string; label?: string; kind: StateNodeDef['kind'] } {
  if (!ref) return { id: '', kind: 'simple' };
  const ch = (ref.children || {}) as any;
  if (ch.Start) {
    const kind = ctx.isTarget ? 'end' : 'start';
    return { id: `__${kind}_${(ch.Start[0] as IToken).startOffset ?? 0}`, kind: kind as StateNodeDef['kind'] };
  }
  if (ch.HistoryDeep) return { id: `__histdeep_${(ch.HistoryDeep[0] as IToken).startOffset ?? 0}`, label: 'H*', kind: 'history-deep' };
  if (ch.HistoryShallow) return { id: `__hist_${(ch.HistoryShallow[0] as IToken).startOffset ?? 0}`, label: 'H', kind: 'history' };
  // Markers like <<choice>> / <<fork>> / <<join>>
  let special: StateNodeDef['kind'] | undefined;
  if (ch.AngleAngleOpen && ch.Identifier && ch.AngleAngleClose) {
    const k = String((ch.Identifier[0] as IToken).image).toLowerCase();
    if (k === 'choice') special = 'choice';
    else if (k === 'fork') special = 'fork';
    else if (k === 'join') special = 'join';
  }
  // Identifier or QuotedString
  const toks: IToken[] = [];
  (ch.Identifier as IToken[] | undefined)?.forEach(t => toks.push(t));
  (ch.QuotedString as IToken[] | undefined)?.forEach(t => toks.push(t));
  toks.sort((a,b) => (a.startOffset ?? 0) - (b.startOffset ?? 0));
  const txt = textFromTokens(toks) || '';
  const id = txt.trim().replace(/\s+/g, '_');
  return { id, label: txt, kind: special || 'simple' };
}

export function buildStateModel(text: string): StateModel {
  const { tokens } = lexState(text);
  parserInstance.input = tokens as any;
  const cst: CstNode = (parserInstance as any).diagram();

  let direction: StateModel['direction'] = 'TD';
  const nodes = new Map<string, StateNodeDef>();
  const transitions: TransitionDef[] = [];
  const composites: Array<{ id: string; label?: string; nodes: string[]; parent?: string }> = [];
  const lanes: Array<{ parentId: string; id: string; nodes: string[] }> = [];

  type CompCtx = { id: string; lane: number };
  const stack: CompCtx[] = [];
  const diagramChildren = (cst.children || {}) as any;
  const stmts = (diagramChildren.statement as CstNode[] | undefined) || [];

  function ensureNode(def: StateNodeDef) {
    const ex = nodes.get(def.id);
    if (ex) return ex;
    nodes.set(def.id, def);
    // add to current composite parent
    const parentCtx = stack[stack.length - 1];
    if (parentCtx) {
      const parent = parentCtx.id;
      // Create lane subgraph id if inside lanes
      const laneId = `${parent}__lane${parentCtx.lane}`;
      let laneSg = composites.find(c => c.id === laneId);
      if (!laneSg) {
        // Ensure parent composite exists
        if (!composites.find(c => c.id === parent)) composites.push({ id: parent, label: parent, nodes: [], parent: stack.length > 1 ? stack[stack.length-2].id : undefined });
        composites.push({ id: laneId, label: undefined, nodes: [], parent });
        lanes.push({ parentId: parent, id: laneId, nodes: [] });
      }
      laneSg = composites.find(c => c.id === laneId)!;
      if (!laneSg.nodes.includes(def.id)) laneSg.nodes.push(def.id);
      const laneRec = lanes.find(l => l.id === laneId);
      if (laneRec && !laneRec.nodes.includes(def.id)) laneRec.nodes.push(def.id);
      def.parent = laneId;
    }
    return def;
  }

  function visitStatement(node: CstNode) {
    const ch = (node.children || {}) as any;
    if (ch.directionStmt) {
      const d = (ch.directionStmt[0].children.Direction?.[0]?.image as string | undefined) || 'TD';
      direction = (d as any) as StateModel['direction'];
      return;
    }
    if (ch.stateDecl) {
      const n = ch.stateDecl[0] as CstNode; const dch = (n.children || {}) as any;
      // Two variants: state "Label" as id, or state id [: desc]
      if (dch.QuotedString && dch.AsKw && dch.Identifier) {
        const label = (dch.QuotedString[0] as IToken).image.slice(1, -1);
        const id = (dch.Identifier[0] as IToken).image;
        ensureNode({ id, label, kind: 'simple' });
      } else if (dch.Identifier) {
        const id = (dch.Identifier[0] as IToken).image;
        ensureNode({ id, label: id, kind: 'simple' });
      }
      return;
    }
    if (ch.stateBlock) {
      const b = ch.stateBlock[0] as CstNode; const bch = (b.children || {}) as any;
      const idTok = (bch.Identifier?.[0] || bch.QuotedString?.[0]) as IToken | undefined;
      const idRaw = idTok ? (idTok.image.startsWith('"') ? idTok.image.slice(1,-1) : idTok.image) : `__state_${b.location ?? Math.random()}`;
      const id = idRaw.replace(/\s+/g, '_');
      // Register composite container (no lane yet; lanes created on demand)
      ensureNode({ id, label: idRaw, kind: 'composite' });
      if (!composites.find(c => c.id === id)) composites.push({ id, label: idRaw, nodes: [], parent: stack.length ? stack[stack.length - 1].id : undefined });
      stack.push({ id, lane: 0 });
      const inner = (bch.innerStatement as CstNode[] | undefined) || [];
      for (const s of inner) visitStatement(s);
      stack.pop();
      return;
    }
    if (ch.transitionStmt) {
      const t = ch.transitionStmt[0] as CstNode; const tch = (t.children || {}) as any;
      const left = actorRefToId(tch.actorRef?.[0], { isTarget: false });
      const right = actorRefToId(tch.actorRef?.[1], { isTarget: true });
      if (left.id) ensureNode({ id: left.id, label: left.label || left.id, kind: left.kind });
      if (right.id) ensureNode({ id: right.id, label: right.label || right.id, kind: right.kind });
      let label: string | undefined;
      if (tch.Colon && tch.labelText) {
        const toks: IToken[] = [];
        (tch.labelText as CstNode[]).forEach((lt: any) => {
          const ch2 = lt.children || {};
          ['QuotedString','Identifier','NumberLiteral','LabelChunk'].forEach((k) => (ch2[k] as IToken[] | undefined)?.forEach(tt => toks.push(tt)));
        });
        toks.sort((a,b) => (a.startOffset ?? 0) - (b.startOffset ?? 0));
        label = textFromTokens(toks);
      }
      if (left.id && right.id) transitions.push({ source: left.id, target: right.id, label });
      return;
    }
    // Lane separator inside composite
    if ((node as any).name === 'innerStatement') {
      const ich = (node.children || {}) as any;
      if (ich.Dashes && ich.Dashes.length && stack.length) {
        stack[stack.length - 1].lane += 1;
        return;
      }
    }
    if (ch.noteStmt) {
      // Represent notes as dashed-edge rectangle nodes labeled and connected to the referenced state
      const n = ch.noteStmt[0] as CstNode; const nch = (n.children || {}) as any;
      const txtToks: IToken[] = [];
      const targetRef = (nch.actorRef?.[0] as CstNode | undefined);
      const target = actorRefToId(targetRef);
      ['QuotedString','Identifier','NumberLiteral','LabelChunk'].forEach(k => (nch[k] as IToken[] | undefined)?.forEach(tk => txtToks.push(tk)));
      const text = textFromTokens(txtToks);
      if (target.id && text) {
        const noteId = `__note_${(n.location ?? Math.random()).toString().slice(2)}`;
        ensureNode({ id: noteId, label: text, kind: 'simple' });
        ensureNode({ id: target.id, label: target.label || target.id, kind: target.kind });
        transitions.push({ source: noteId, target: target.id, label: undefined });
      }
      return;
    }
    if (ch.stateDescriptionStmt) {
      // S : description — user-level label; ensure node exists with that label
      const s = ch.stateDescriptionStmt[0] as CstNode; const sch = (s.children || {}) as any;
      const nameTok = (sch.Identifier?.[0] || sch.QuotedString?.[0]) as IToken | undefined;
      if (nameTok) {
        const raw = nameTok.image.startsWith('"') ? nameTok.image.slice(1,-1) : nameTok.image;
        const id = raw.replace(/\s+/g, '_');
        const labelToks: IToken[] = [];
        ['QuotedString','Identifier','NumberLiteral','LabelChunk'].forEach(k => (sch[k] as IToken[] | undefined)?.forEach(tt => labelToks.push(tt)));
        const lbl = textFromTokens(labelToks);
        ensureNode({ id, label: lbl || raw, kind: 'simple' });
      }
      return;
    }
    // Recurse if nested
    for (const key of Object.keys(ch)) {
      const arr = (ch as any)[key];
      if (Array.isArray(arr)) arr.forEach((n: CstNode) => visitStatement(n));
    }
  }

  for (const st of stmts) visitStatement(st);

  return {
    direction,
    nodes: Array.from(nodes.values()),
    transitions,
    composites,
    lanes,
  };
}
