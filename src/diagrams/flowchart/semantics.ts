import type { IToken, CstNode } from 'chevrotain';
import { parserInstance } from './parser.js';
import type { ValidationError } from '../../core/types.js';

type Ctx = { errors: ValidationError[]; strict?: boolean };

// Build a CST visitor base from the parser instance
const BaseVisitor: any = (parserInstance as any).getBaseCstVisitorConstructorWithDefaults();

class FlowSemanticsVisitor extends BaseVisitor {
  private ctx: Ctx;
  private edgeCount = 0;
  private knownIds: Set<string>;

  constructor(ctx: Ctx, knownIds: Set<string>) {
    super();
    this.validateVisitor();
    this.ctx = ctx;
    this.knownIds = knownIds;
  }

  // Entry point
  diagram(ctx: any) {
    if (ctx.statement) ctx.statement.forEach((s: CstNode) => this.visit(s));
  }

  classStatement(ctx: any) {
    // Warn when class applies to unknown node ids (forward references permitted via pre-collection)
    const ids: IToken[] = (ctx.Identifier as IToken[] | undefined) || [];
    // Exclude the className token (labeled)
    const classNameTok: IToken | undefined = (ctx.className && ctx.className[0]) as IToken | undefined;
    for (const idTok of ids) {
      if (classNameTok && idTok.startOffset === classNameTok.startOffset) continue;
      const id = String(idTok.image);
      if (!this.knownIds.has(id)) {
        this.ctx.errors.push({
          line: idTok.startLine ?? 1,
          column: idTok.startColumn ?? 1,
          severity: 'warning',
          code: 'FL-CLASS-TARGET-UNKNOWN',
          message: `Unknown node id '${id}' in class statement.`,
          hint: 'Define the node before applying classes, or move the class line after the node.'
        });
      }
    }
  }

  styleStatement(ctx: any) {
    const idTok: IToken | undefined = (ctx.Identifier && ctx.Identifier[0]) as IToken | undefined;
    if (idTok) {
      const id = String(idTok.image);
      if (!this.knownIds.has(id)) {
        this.ctx.errors.push({
          line: idTok.startLine ?? 1,
          column: idTok.startColumn ?? 1,
          severity: 'warning',
          code: 'FL-STYLE-TARGET-UNKNOWN',
          message: `Unknown node id '${id}' in style statement.`,
          hint: 'Define the node before styling it, or move the style line after the node definition.'
        });
      }
    }
  }

  statement(ctx: any) {
    for (const k of Object.keys(ctx)) {
      const arr = (ctx as any)[k];
      if (Array.isArray(arr)) {
        arr.forEach((n) => {
          if (n && typeof (n as any).name === 'string') this.visit(n);
        });
      }
    }
  }

  clickStatement(ctx: any) {
    // Prefer structured subrules when available
    const href = (ctx as any).clickHref?.[0] as CstNode | undefined;
    const call = !href ? ((ctx as any).clickCall?.[0] as CstNode | undefined) : undefined;
    if (href) {
      const ch: any = (href.children || {});
      const modeTok = ch.mode?.[0];
      const urlTok = ch.url?.[0];
      const tipTok = ch.tooltip?.[0];
      const tgtTok = ch.target?.[0];
      const mode = String(modeTok?.image || '').toLowerCase();
      if (mode !== 'href') {
        this.ctx.errors.push({ line: modeTok?.startLine ?? 1, column: modeTok?.startColumn ?? 1, severity: 'error', code: 'FL-CLICK-MODE-INVALID', message: `Unknown click mode '${modeTok?.image}'. Use 'href' or 'call'.`, hint: 'Examples: href "…" | call fn()' });
        return;
      }
      if (!urlTok) {
        this.ctx.errors.push({ line: modeTok?.startLine ?? 1, column: modeTok?.startColumn ?? 1, severity: 'error', code: 'FL-CLICK-HREF-URL-MISSING', message: "'click … href' requires a quoted URL.", hint: 'Example: click A href "https://example.com" "Open" _blank' });
      }
      if (tgtTok && !/^_(blank|self|parent|top)$/i.test(String(tgtTok.image || ''))) {
        this.ctx.errors.push({ line: tgtTok.startLine ?? 1, column: tgtTok.startColumn ?? 1, severity: 'warning', code: 'FL-CLICK-TARGET-UNKNOWN', message: `Unknown target '${tgtTok.image}'. Use _blank/_self/_parent/_top.`, hint: 'Example: … _blank' });
      }
      return;
    }
    if (call) {
      const ch: any = (call.children || {});
      const modeTok = ch.mode?.[0];
      const mode = String(modeTok?.image || '').toLowerCase();
      if (!(mode === 'call' || mode === 'callback')) {
        this.ctx.errors.push({ line: modeTok?.startLine ?? 1, column: modeTok?.startColumn ?? 1, severity: 'error', code: 'FL-CLICK-MODE-INVALID', message: `Unknown click mode '${modeTok?.image}'. Use 'href' or 'call'.`, hint: 'Examples: href "…" | call fn()' });
        return;
      }
      const fnTok = ch.fn?.[0];
      if (!fnTok) {
        this.ctx.errors.push({ line: modeTok?.startLine ?? 1, column: modeTok?.startColumn ?? 1, severity: 'error', code: 'FL-CLICK-CALL-NAME-MISSING', message: "'click … call' requires a function name.", hint: 'Example: click A call doThing() "Tooltip"' });
      }
      // Current Mermaid CLI rejects tooltip/target text following call(...)
      const tipTok = ch.tooltip?.[0];
      if (tipTok) {
        this.ctx.errors.push({ line: tipTok.startLine ?? 1, column: tipTok.startColumn ?? 1, severity: 'error', code: 'FL-CLICK-CALL-EXTRA-TEXT', message: "Tooltip/text after 'call()' is not supported by Mermaid CLI.", hint: 'Use: click A call doThing()' });
      }
      return;
    }
    // Fallback (legacy permissive parsing)
    const ids: any[] = (ctx as any).Identifier || [];
    const q: any[] = (ctx as any).QuotedString || [];
    const t0 = ids[0];
    const modeTok = ids[1];
    const mode = (modeTok?.image || '').toLowerCase();
    if (!mode) {
      this.ctx.errors.push({
        line: (t0?.startLine ?? 1),
        column: (t0?.startColumn ?? 1),
        severity: 'error',
        code: 'FL-CLICK-MODE-MISSING',
        message: "After 'click <id>' specify 'href' or 'call'.",
        hint: "Examples: click A href \"https://…\" \"Tip\" _blank | click A call doThing() \"Tip\"",
      });
      return;
    }
    if (mode === 'href') {
      if (q.length < 1) {
        this.ctx.errors.push({
          line: (modeTok.startLine ?? 1),
          column: (modeTok.startColumn ?? 1),
          severity: 'error',
          code: 'FL-CLICK-HREF-URL-MISSING',
          message: "'click … href' requires a quoted URL.",
          hint: 'Example: click A href "https://example.com" "Open" _blank'
        });
      }
      const tgt = ids[2];
      if (tgt && !/^_(blank|self|parent|top)$/i.test((tgt.image || ''))) {
        this.ctx.errors.push({
          line: tgt.startLine ?? 1,
          column: tgt.startColumn ?? 1,
          severity: 'warning',
          code: 'FL-CLICK-TARGET-UNKNOWN',
          message: `Unknown target '${tgt.image}'. Use _blank/_self/_parent/_top.`,
          hint: 'Example: … _blank'
        });
      }
      return;
    }
    if (mode === 'call' || mode === 'callback') {
      const fnTok = ids[2];
      if (!fnTok) {
        this.ctx.errors.push({
          line: (modeTok.startLine ?? 1),
          column: (modeTok.startColumn ?? 1),
          severity: 'error',
          code: 'FL-CLICK-CALL-NAME-MISSING',
          message: "'click … call' requires a function name.",
          hint: 'Example: click A call doThing() "Tooltip"'
        });
      }
      return;
    }
    this.ctx.errors.push({
      line: (modeTok.startLine ?? 1),
      column: (modeTok.startColumn ?? 1),
      severity: 'error',
      code: 'FL-CLICK-MODE-INVALID',
      message: `Unknown click mode '${modeTok.image}'. Use 'href' or 'call'.`,
      hint: 'Examples: href "…" | call fn()'
    });
  }

  linkStyleStatement(ctx: any) {
    // Prefer structured indexList/pairs if available
    const idxNode = (ctx as any).linkStyleIndexList?.[0] as CstNode | undefined;
    const pairNode = (ctx as any).linkStylePairs?.[0] as CstNode | undefined;
    const getTokens = (node: CstNode | undefined, name: string) => (node ? (((node.children || {}) as any)[name] as IToken[] | undefined) || [] : []);

    const idxToks = getTokens(idxNode, 'index');
    const nums: number[] = idxToks.map(t => parseInt(t.image, 10)).filter(n => Number.isFinite(n));
    if (nums.length === 0) {
      const anyTok: any = (ctx as any).LinkStyleKeyword?.[0] || idxToks[0];
      this.ctx.errors.push({ line: anyTok?.startLine ?? 1, column: anyTok?.startColumn ?? 1, severity: 'error', code: 'FL-LINKSTYLE-NO-INDICES', message: "'linkStyle' requires one or more link indices (comma separated).", hint: 'Example: linkStyle 0,1 stroke:#f66,stroke-width:2px' });
      return;
    }
    // Extract pairs and validate presence
    const pairChildren = (pairNode?.children || {}) as any;
    const pairCount = (pairChildren.linkStylePair || []).length;
    if (!pairCount) {
      const firstNum: any = idxToks[0];
      this.ctx.errors.push({ line: firstNum?.startLine ?? 1, column: firstNum?.startColumn ?? 1, severity: 'error', code: 'FL-LINKSTYLE-MISSING-STYLE', message: 'Missing style declarations after indices.', hint: 'Example: linkStyle 0 stroke:#f00,stroke-width:2px' });
    }
    // Duplicate indices
    const seen = new Set<number>();
    for (const n of nums) {
      if (seen.has(n)) {
        const numTok: any = idxToks.find((t: any) => parseInt(t.image, 10) === n);
        this.ctx.errors.push({ line: numTok?.startLine ?? 1, column: numTok?.startColumn ?? 1, severity: 'warning', code: 'FL-LINKSTYLE-DUPLICATE-INDEX', message: `Duplicate linkStyle index ${n}.`, hint: 'Remove duplicates.' });
      }
      seen.add(n);
    }
    // Out-of-range indices
    for (const n of nums) {
      if (!(n >= 0 && n < this.edgeCount)) {
        const numTok: any = idxToks.find((t: any) => parseInt(t.image, 10) === n);
        this.ctx.errors.push({ line: numTok?.startLine ?? 1, column: numTok?.startColumn ?? 1, severity: 'error', code: 'FL-LINKSTYLE-INDEX-OUT-OF-RANGE', message: `linkStyle index ${n} is out of range (0..${Math.max(0, this.edgeCount - 1)}).`, hint: `Use an index between 0 and ${Math.max(0, this.edgeCount - 1)} or add more links first.` });
      }
    }
  }

  subgraph(ctx: any) {
    if (ctx.subgraphStatement) ctx.subgraphStatement.forEach((s: CstNode) => this.visit(s));
  }

  subgraphStatement(ctx: any) {
    for (const k of Object.keys(ctx)) {
      const arr = (ctx as any)[k];
      if (Array.isArray(arr)) {
        arr.forEach((n) => {
          if (n && typeof (n as any).name === 'string') this.visit(n);
        });
      }
    }
  }

  directionStatement(ctx: any) {
    const kwTok = ctx.dirKw?.[0] as IToken | undefined;
    if (kwTok && kwTok.image !== 'direction') {
      this.ctx.errors.push({
        line: kwTok.startLine ?? 1,
        column: kwTok.startColumn ?? 1,
        severity: 'error',
        code: 'FL-DIR-KW-INVALID',
        message: `Unknown keyword '${kwTok.image}' before direction. Use 'direction TB' / 'LR' / etc.`,
        hint: "Example inside subgraph: 'direction TB'",
        length: (kwTok.image?.length ?? 0)
      });
    }
  }

  nodeStatement(ctx: any) {
    if (ctx.nodeOrParallelGroup) ctx.nodeOrParallelGroup.forEach((n: CstNode) => this.visit(n));
    const linksHere = Array.isArray((ctx as any).link) ? (ctx as any).link.length : 0;
    if (linksHere > 0) this.edgeCount += linksHere;
  }

  nodeOrParallelGroup(ctx: any) {
    if (ctx.node) ctx.node.forEach((n: CstNode) => this.visit(n));
  }

  node(ctx: any) {
    const hasAttr = Array.isArray((ctx as any).attrObject) && (ctx as any).attrObject.length > 0;
    const hasShape = Array.isArray(ctx.nodeShape) && ctx.nodeShape.length > 0;
    if (hasAttr && hasShape) {
      const tokArr: any[] = (ctx as any).attrObject?.[0]?.children?.attrLCurly || [];
      const tok = tokArr[0];
      this.ctx.errors.push({
        line: tok?.startLine ?? 1,
        column: tok?.startColumn ?? 1,
        severity: 'warning',
        code: 'FL-TYPED-SHAPE-CONFLICT',
        message: "Both bracket shape and '@{ shape: … }' provided. Bracket shape will be used.",
        hint: 'Pick one style: either A[Label] or A@{ shape: rect, label: "Label" }'
      });
    }
    if (ctx.nodeShape) ctx.nodeShape.forEach((n: CstNode) => this.visit(n));

    if (hasAttr) {
      const attr = (ctx as any).attrObject?.[0];
      const pairs: any[] = (attr?.children?.attrPair || []);
      const validKeys = new Set(['shape','label','padding','cornerRadius','icon','image']);
      const shapes = new Set(['rect','round','rounded','stadium','subroutine','circle','cylinder','diamond','trapezoid','trapezoidAlt','parallelogram','hexagon','lean-l','lean-r','icon','image']);
      for (const p of pairs) {
        const keyTok: any = p.children?.attrKey?.[0];
        const valTok: any = (p.children?.QuotedString?.[0] || p.children?.Identifier?.[0] || p.children?.NumberLiteral?.[0] || p.children?.Text?.[0]);
        if (!keyTok) continue;
        const key = keyTok.image;
        if (!validKeys.has(key)) {
          this.ctx.errors.push({
            line: keyTok.startLine ?? 1,
            column: keyTok.startColumn ?? 1,
            severity: 'warning',
            code: 'FL-TYPED-KEY-UNKNOWN',
            message: `Unknown typed-shape key '${key}'.`,
            hint: "Allowed keys: shape, label, padding, cornerRadius, icon, image"
          });
          continue;
        }
        if (key === 'shape' && valTok) {
          const v = String(valTok.image).replace(/^"|"$/g,'');
          if (!shapes.has(v)) {
            this.ctx.errors.push({
              line: valTok.startLine ?? 1,
              column: valTok.startColumn ?? 1,
              severity: 'error',
              code: 'FL-TYPED-SHAPE-UNKNOWN',
              message: `Unknown shape '${v}' in '@{ shape: … }'.`,
              hint: 'Use one of: rect, round, stadium, subroutine, circle, cylinder, diamond, trapezoid, parallelogram, hexagon, lean-l, lean-r, icon, image'
            });
          } else {
            // Parity with mermaid-cli: only a subset of typed-shape values are supported today
            const supportedByCli = new Set(['rect','round','rounded','diamond','circle','cylinder','stadium','subroutine','lean-l','lean-r']);
            if (!supportedByCli.has(v)) {
              this.ctx.errors.push({
                line: valTok.startLine ?? 1,
                column: valTok.startColumn ?? 1,
                severity: 'error',
                code: 'FL-TYPED-SHAPE-UNSUPPORTED',
                message: `Typed shape '${v}' is not supported by current Mermaid CLI.`,
                hint: 'Use one of: rect, rounded, diamond, circle, cylinder, stadium, subroutine, "lean-l", "lean-r"'
              });
            }
          }
        }
        if (key === 'label' && valTok && valTok.tokenType?.name !== 'QuotedString') {
          this.ctx.errors.push({
            line: valTok.startLine ?? 1,
            column: valTok.startColumn ?? 1,
            severity: 'warning',
            code: 'FL-TYPED-LABEL-NOT-STRING',
            message: "Typed-shape 'label' should be a quoted string.",
            hint: 'Example: A@{ shape: rect, label: "Start" }'
          });
        }
        if ((key === 'padding' || key === 'cornerRadius') && valTok) {
          const raw = String(valTok.image).replace(/^"|"$/g,'');
          if (!/^\d+(px)?$/.test(raw)) {
            this.ctx.errors.push({
              line: valTok.startLine ?? 1,
              column: valTok.startColumn ?? 1,
              severity: 'warning',
              code: 'FL-TYPED-NUMERIC-EXPECTED',
              message: `'${key}' expects a number (optionally with px).`,
              hint: `Use: ${key}: 8 or ${key}: "8px"`
            });
          }
        }
      }
    }
  }

  private checkEmptyContent(openTok: IToken, contentNodes: CstNode[] | undefined) {
    // No content nodes at all
    if (!contentNodes || contentNodes.length === 0) {
      this.ctx.errors.push({
        line: openTok.startLine ?? 1,
        column: openTok.startColumn ?? 1,
        severity: 'error',
        message: 'Empty label inside a shape.',
        code: 'FL-NODE-EMPTY',
        hint:
          'Write non-empty text inside the brackets, e.g., A["Start"] or A[Start]. If you want no label, omit the brackets and just use A.'
      });
      return;
    }
    // content exists – check quoted empty strings
    for (const cn of contentNodes) {
      const ch: any = (cn as any).children || {};
      const qs: IToken[] = ([] as IToken[])
        .concat(ch.QuotedString || [])
        .concat(ch.MultilineText || []);
      for (const q of qs) {
        const img = q.image;
        if (!img) continue;
        // remove wrappers
        const text = img.startsWith('"') || img.startsWith("'") ? img.slice(1, -1) : img;
        if (text.trim().length === 0) {
          this.ctx.errors.push({
            line: q.startLine ?? 1,
            column: q.startColumn ?? 1,
            severity: 'error',
            message: 'Empty label inside a shape (only empty quotes/whitespace).',
            code: 'FL-NODE-EMPTY',
            hint:
              'Provide non-empty text, e.g., A["Start"] or A[Start]. If you want no label, omit the brackets and just use A.'
          });
        }
      }
    }
  }

  private checkEscapedQuotes(contentNodes: CstNode[] | undefined) {
    if (!contentNodes) return;
    for (const cn of contentNodes) {
      const ch: any = (cn as any).children || {};
      const tokens: IToken[] = ([] as IToken[])
        .concat(ch.QuotedString || [])
        .concat(ch.Text || [])
        .concat(ch.Identifier || [])
        .concat(ch.NumberLiteral || []);
      for (const t of tokens) {
        if (t.image && t.image.includes('\\"')) {
          this.ctx.errors.push({
            line: t.startLine ?? 1,
            column: t.startColumn ?? 1,
            severity: 'error',
            message: 'Escaped quotes (\\") in node labels are not supported by Mermaid. Use &quot; instead.',
            code: 'FL-LABEL-ESCAPED-QUOTE',
            hint: 'Prefer "He said &quot;Hi&quot;".'
          });
        }
      }
    }
  }

  private checkDoubleInSingleQuoted(contentNodes: CstNode[] | undefined) {
    if (!contentNodes) return;
    for (const cn of contentNodes) {
      const ch: any = (cn as any).children || {};
      const qs: IToken[] = ch.QuotedString || [];
      for (const q of qs) {
        const s = q.image || '';
        if (s.startsWith("'") && s.endsWith("'") && s.includes('"')) {
          const innerIdx = s.indexOf('"');
          const col = (q.startColumn ?? 1) + Math.max(0, innerIdx);
          this.ctx.errors.push({
            line: q.startLine ?? 1,
            column: col,
            severity: 'error',
            message: 'Double quotes inside a single-quoted label are not supported by Mermaid. Replace inner " with &quot; or use a double-quoted label with &quot;.',
            code: 'FL-LABEL-DOUBLE-IN-SINGLE',
            hint: 'Change to "She said &quot;Hello&quot;" or replace inner " with &quot;.',
            length: 1
          });
        }
      }
    }
  }

  private checkDoubleInDoubleQuoted(contentNodes: CstNode[] | undefined) {
    if (!contentNodes) return;
    for (const cn of contentNodes) {
      const ch: any = (cn as any).children || {};
      const qs: IToken[] = ch.QuotedString || [];
      if (qs.length >= 2) {
        const q2 = qs[1];
        this.ctx.errors.push({
          line: q2.startLine ?? 1,
          column: q2.startColumn ?? 1,
          severity: 'error',
          code: 'FL-LABEL-DOUBLE-IN-DOUBLE',
          message: 'Double quotes inside a double-quoted label are not supported. Use &quot; for inner quotes.',
          hint: 'Example: A["He said &quot;Hi&quot;"]',
          length: 1
        });
      }
    }
  }

  private warnParensInUnquoted(contentNodes: CstNode[] | undefined) {
    if (!contentNodes) return;
    for (const cn of contentNodes) {
      const ch: any = (cn as any).children || {};
      const hasQuoted: boolean = Array.isArray(ch.QuotedString) && ch.QuotedString.length > 0;
      if (hasQuoted) continue; // wrapped, fine
      const opens: IToken[] = ch.RoundOpen || [];
      const closes: IToken[] = ch.RoundClose || [];
      const offenders = [...opens, ...closes];
      if (offenders.length > 0) {
        const t = offenders[0];
        this.ctx.errors.push({
          line: t.startLine ?? 1,
          column: t.startColumn ?? 1,
          severity: 'warning',
          code: 'FL-LABEL-PARENS-UNQUOTED',
          message: 'Parentheses inside an unquoted label may be ambiguous. Wrap the label in quotes.',
          hint: 'Example: A["Calls func(arg)"]'
        });
      }
    }
  }

  nodeShape(ctx: any) {
    // Determine shape and collect the corresponding content node array key
    const openTok: IToken | undefined =
      (ctx.SquareOpen && ctx.SquareOpen[0]) ||
      (ctx.DoubleSquareOpen && ctx.DoubleSquareOpen[0]) ||
      (ctx.RoundOpen && ctx.RoundOpen[0]) ||
      (ctx.DoubleRoundOpen && ctx.DoubleRoundOpen[0]) ||
      (ctx.DiamondOpen && ctx.DiamondOpen[0]) ||
      (ctx.HexagonOpen && ctx.HexagonOpen[0]) ||
      (ctx.StadiumOpen && ctx.StadiumOpen[0]) ||
      (ctx.CylinderOpen && ctx.CylinderOpen[0]);

    // Gather any of nodeContentX properties
    const contentNodes: CstNode[] = [];
    for (const key of Object.keys(ctx)) {
      if (key.startsWith('nodeContent')) {
        const arr = (ctx as any)[key];
        if (Array.isArray(arr)) contentNodes.push(...arr);
      }
    }

    if (openTok) {
      this.checkEmptyContent(openTok, contentNodes.length ? contentNodes : undefined);
      // Mermaid accepts backslash-escaped quotes inside labels; do not flag as error.
      this.checkDoubleInSingleQuoted(contentNodes);
      this.warnParensInUnquoted(contentNodes);

      // Strict mode: require quoted labels inside shapes
      if (this.ctx.strict) {
        let quoted = false;
        let firstContentTok: IToken | undefined;
        for (const cn of contentNodes) {
          const ch: any = (cn as any).children || {};
          if ((ch.QuotedString && ch.QuotedString.length) || (ch.MultilineText && ch.MultilineText.length)) {
            quoted = true;
            break;
          }
          // track first token as pointer
          const candidates: IToken[] = ([] as IToken[])
            .concat(ch.Identifier || [])
            .concat(ch.Text || [])
            .concat(ch.NumberLiteral || [])
            .concat(ch.RoundOpen || [])
            .concat(ch.RoundClose || [])
            .concat(ch.Comma || [])
            .concat(ch.Colon || [])
            .concat(ch.Pipe || []);
          if (!firstContentTok && candidates.length) firstContentTok = candidates[0];
        }
        if (contentNodes.length > 0 && !quoted) {
          const p = firstContentTok ?? openTok;
          this.ctx.errors.push({
            line: p.startLine ?? 1,
            column: p.startColumn ?? 1,
            severity: 'error',
            code: 'FL-STRICT-LABEL-QUOTES-REQUIRED',
            message: 'Strict mode: Node label must be quoted (use double quotes and &quot; inside).',
            hint: 'Example: A["Label with &quot;quotes&quot; and (parens)"]'
          });
        }
      }
    }
  }
}

// Pre-pass to collect node ids (so we can allow forward references in class/style)
class NodeIdCollector extends BaseVisitor {
  public ids = new Set<string>();
  constructor() { super(); this.validateVisitor(); }
  node(ctx: any) {
    const idTok: IToken | undefined = (ctx.nodeId && ctx.nodeId[0]) as IToken | undefined;
    const idNumTok: IToken | undefined = (ctx.nodeIdNum && ctx.nodeIdNum[0]) as IToken | undefined;
    if (idTok) this.ids.add(String(idTok.image));
    else if (idNumTok) this.ids.add(String(idNumTok.image));
  }
  nodeOrParallelGroup(ctx: any) { if (ctx.node) ctx.node.forEach((n: CstNode) => this.visit(n)); }
  nodeStatement(ctx: any) { if (ctx.nodeOrParallelGroup) ctx.nodeOrParallelGroup.forEach((n: CstNode) => this.visit(n)); }
  statement(ctx: any) {
    for (const k of Object.keys(ctx)) {
      const arr = (ctx as any)[k];
      if (Array.isArray(arr)) arr.forEach((n) => { if (n && typeof (n as any).name === 'string') this.visit(n); });
    }
  }
  diagram(ctx: any) { if (ctx.statement) ctx.statement.forEach((s: CstNode) => this.visit(s)); }
}

export function analyzeFlowchart(cst: CstNode, _tokens: IToken[], opts?: { strict?: boolean }): ValidationError[] {
  const ctx: Ctx = { errors: [], strict: opts?.strict };
  const collector = new NodeIdCollector();
  collector.visit(cst);
  const v = new FlowSemanticsVisitor(ctx, collector.ids);
  v.visit(cst);
  return ctx.errors;
}
