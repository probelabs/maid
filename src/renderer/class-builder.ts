import type { CstNode, IToken } from 'chevrotain';
import { tokenize as lexClass } from '../diagrams/class/lexer.js';
import { parserInstance } from '../diagrams/class/parser.js';
import type { ClassModel, ClassDef, Relation, RelationKind } from './class-types.js';

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

function classRefToText(refCst: CstNode | undefined): string {
  if (!refCst) return '';
  const ch = (refCst.children || {}) as any;
  const toks: IToken[] = [];
  ['Identifier','QuotedString','BacktickName'].forEach((k) => {
    const arr = ch[k] as IToken[] | undefined; arr?.forEach(t => toks.push(t));
  });
  toks.sort((a,b) => (a.startOffset ?? 0) - (b.startOffset ?? 0));
  return textFromTokens(toks);
}

function memberLineToText(member: CstNode): { text: string; isMethod: boolean } {
  const ch = (member.children || {}) as any;
  // Visibility + name + optional (params) + optional : type
  const toks: IToken[] = [];
  const order = ['Visibility','Identifier','QuotedString','LParen','RParen','Comma','Colon','NumberLiteral'];
  for (const k of order) (ch[k] as IToken[] | undefined)?.forEach(t => toks.push(t));
  toks.sort((a,b) => (a.startOffset ?? 0) - (b.startOffset ?? 0));
  const txt = textFromTokens(toks);
  const isMethod = /(\)\s*:|\)$)/.test(txt) || /\(/.test(txt);
  return { text: txt, isMethod };
}

function canonicalId(raw: string): string { return raw.trim().replace(/\s+/g, '_'); }

export function buildClassModel(text: string): ClassModel {
  const { tokens } = lexClass(text);
  parserInstance.input = tokens as any;
  const cst: CstNode = (parserInstance as any).diagram();

  const classes = new Map<string, ClassDef>();
  const relations: Relation[] = [];
  const notes: Array<{ target: string; text: string }> = [];
  let direction: ClassModel['direction'] = 'TD';

  function ensureClass(idRaw: string, display?: string): ClassDef {
    const id = canonicalId(idRaw);
    const existing = classes.get(id);
    if (existing) return existing;
    const def: ClassDef = { id, display: display || idRaw, attributes: [], methods: [] };
    classes.set(id, def);
    return def;
  }

  // Walk statements
  const diagramChildren = (cst.children || {}) as any;
  const stmts = (diagramChildren.statement as CstNode[] | undefined) || [];
  for (const st of stmts) {
    const ch = (st.children || {}) as any;
    if (ch.directionStmt) {
      const d = (ch.directionStmt[0].children.Direction?.[0]?.image as string | undefined) || 'TD';
      if (d === 'TB') direction = 'TB'; else if (d === 'BT') direction = 'BT'; else if (d === 'LR') direction = 'LR'; else if (d === 'RL') direction = 'RL'; else direction = 'TD';
      continue;
    }
    if (ch.classLine) {
      const node = ch.classLine[0] as CstNode; const nch = (node.children || {}) as any;
      const name = classRefToText(nch.classRef?.[0]);
      const def = ensureClass(name);
      // Optional label and stereotype/alias
      if (nch.LTlt && nch.Identifier && nch.GTgt) {
        def.stereotype = (nch.Identifier[0] as IToken).image;
      }
      // Inline block of members
      if (nch.LCurly && nch.memberLineStmt) {
        const lines = (nch.memberLineStmt as CstNode[]);
        for (const m of lines) {
          const mm = memberLineToText((m.children as any).memberLine?.[0] as CstNode);
          if (!mm.text) continue;
          (mm.isMethod ? def.methods : def.attributes).push(mm.text);
        }
      }
      continue;
    }
    if (ch.memberAssignStmt) {
      const node = ch.memberAssignStmt[0] as CstNode; const nch = (node.children || {}) as any;
      const clsName = classRefToText(nch.classRef?.[0]); const def = ensureClass(clsName);
      const mm = memberLineToText((nch.memberLine?.[0]) as CstNode);
      if (mm.text) (mm.isMethod ? def.methods : def.attributes).push(mm.text);
      continue;
    }
    if (ch.noteStmt) {
      const node = ch.noteStmt[0] as CstNode; const nch = (node.children || {}) as any;
      const target = classRefToText(nch.classRef?.[0]);
      const labelToks: IToken[] = [];
      ['QuotedString','Identifier','NumberLiteral'].forEach(k => (nch[k] as IToken[] | undefined)?.forEach(t => labelToks.push(t)));
      const text = textFromTokens(labelToks);
      if (target && text) notes.push({ target: canonicalId(target), text });
      continue;
    }
    if (ch.relationStmt) {
      const node = ch.relationStmt[0] as CstNode; const rch = (node.children || {}) as any;
      const leftName = classRefToText(rch.classRef?.[0]); const rightName = classRefToText(rch.classRef?.[1]);
      const left = ensureClass(leftName).id; const right = ensureClass(rightName).id;
      // Cardinalities: use labeled CST fields when present
      const leftCardTok: IToken | undefined = rch.leftCard?.[0];
      const rightCardTok: IToken | undefined = rch.rightCard?.[0];
      const leftCard = leftCardTok?.image ? (leftCardTok.image as string).slice(1, -1) : undefined;
      const rightCard = rightCardTok?.image ? (rightCardTok.image as string).slice(1, -1) : undefined;
      // Label after colon (one or more labelText entries)
      let label: string | undefined;
      if (rch.labelText) {
        const toks: IToken[] = [];
        (rch.labelText as CstNode[]).forEach((lt: any) => {
          const ch2 = lt.children || {};
          ['QuotedString','Identifier','NumberLiteral','GenericAngle'].forEach((k) => {
            (ch2[k] as IToken[] | undefined)?.forEach(t => toks.push(t))
          });
        });
        toks.sort((a,b) => (a.startOffset ?? 0) - (b.startOffset ?? 0));
        label = textFromTokens(toks);
      }

      // Determine kind from which relation operator is present
      const relMap: Array<{ key: string; kind: RelationKind }> = [
        { key: 'RelAssociation', kind: 'association' },
        { key: 'RelDependency', kind: 'dependency' },
        { key: 'RelRealization', kind: 'realization' },
        { key: 'RelExtends', kind: 'extends' },
        { key: 'RelAggregation', kind: 'aggregation' },
        { key: 'RelComposition', kind: 'composition' },
        { key: 'RelDependencyLeft', kind: 'dependency' },
        { key: 'RelRealizationLeft', kind: 'realization' },
        { key: 'RelExtendsRight', kind: 'extends' },
        { key: 'RelAggBoth', kind: 'aggregation-both' },
        { key: 'RelCompBoth', kind: 'composition-both' },
        { key: 'RelAggToComp', kind: 'aggregation-to-comp' },
        { key: 'RelCompToAgg', kind: 'composition-to-agg' },
        { key: 'LollipopLeft', kind: 'lollipop-left' },
        { key: 'LollipopRight', kind: 'lollipop-right' },
      ];
      let kind: RelationKind = 'association';
      for (const m of relMap) { if ((rch as any)[m.key]) { kind = m.kind; break; } }

      // Normalize direction: model edges go left->right in the written order; for leftward ops we swap
      // Leftward tokens set above; here adjust for extends-left style where triangle sits near left class
      let src = left, dst = right;
      if ((rch as any).RelExtends || (rch as any).RelDependencyLeft || (rch as any).RelRealizationLeft || (rch as any).LollipopLeft) {
        // These place the special marker near the left class: edge is right -> left
        src = right; dst = left;
      }
      const rel: Relation = { source: src, target: dst, kind, label, leftCard, rightCard };
      relations.push(rel);
      continue;
    }
  }

  return {
    direction,
    classes: Array.from(classes.values()),
    relations,
    notes,
  };
}
