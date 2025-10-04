import type { Layout, LayoutNode, LayoutEdge, NodeShape, ArrowType } from './types.js';
import { triangleAtEnd, triangleAtStart } from './arrow-utils.js';
import { buildSharedCss } from './styles.js';
import { blockBackground, blockOverlay } from './block-utils.js';
import type { IRenderer } from './interfaces.js';

/**
 * Generates SVG from a laid-out graph
 */
export class SVGRenderer implements IRenderer {
  private padding = 20;
  private fontSize = 14;
  private fontFamily = 'Arial, sans-serif';
  // Theme: tuned to resemble Mermaid default
  private defaultStroke = '#3f3f3f';
  private defaultFill = '#eef0ff'; // light violet-ish fill
  private arrowStroke = '#555555';
  private arrowMarkerSize = 9; // px (1.5x larger for better visibility)

  render(layout: Layout): string {
    // Compute dynamic bounds across nodes, subgraphs, and edge points
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of layout.nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    if ((layout as any).subgraphs) {
      for (const sg of (layout as any).subgraphs as Array<{x:number;y:number;width:number;height:number}>) {
        minX = Math.min(minX, sg.x);
        minY = Math.min(minY, sg.y);
        maxX = Math.max(maxX, sg.x + sg.width);
        maxY = Math.max(maxY, sg.y + sg.height);
      }
    }
    for (const e of layout.edges) {
      if (e.points) for (const p of e.points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    if (!isFinite(minX)) { minX = 0; }
    if (!isFinite(minY)) { minY = 0; }
    if (!isFinite(maxX)) { maxX = layout.width; }
    if (!isFinite(maxY)) { maxY = layout.height; }
    const extraPadX = Math.max(0, -Math.floor(minX) + 1);
    const extraPadY = Math.max(0, -Math.floor(minY) + 1);

    const padX = this.padding + extraPadX;
    const padY = this.padding + extraPadY;

    const bboxWidth = Math.ceil(maxX) - Math.min(0, Math.floor(minX));
    const bboxHeight = Math.ceil(maxY) - Math.min(0, Math.floor(minY));
    const width = bboxWidth + this.padding * 2 + extraPadX;
    const height = bboxHeight + this.padding * 2 + extraPadY;

    const elements: string[] = [];
    const overlays: string[] = [];

    // Add defs for markers (arrowheads)
    elements.push(this.generateDefs());

    // Draw subgraphs (cluster backgrounds) behind edges and nodes, using shared block utils
    if ((layout as any).subgraphs && (layout as any).subgraphs.length) {
      const sgs = (layout as any).subgraphs as Array<{id:string;label?:string;x:number;y:number;width:number;height:number;parent?:string}>;
      const order = sgs.slice().sort((a,b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0));
      const map = new Map(order.map(o=>[o.id,o]));
      const depthOf = (sg:any) => { let d=0; let p=sg.parent; while(p){ d++; p = map.get(p)?.parent; } return d; };
      const bgs: string[] = [];
      for (const sg of order) {
        // Skip lane subgraphs (layout-only) identified by id containing "__lane"
        if (sg.id && sg.id.includes('__lane')) continue;
        const x = sg.x + padX;
        const y = sg.y + padY;
        bgs.push(blockBackground(x, y, sg.width, sg.height, 0));
        const depth = depthOf(sg);
        const title = sg.label ? this.escapeXml(sg.label) : undefined;
        // slight nested offset for titles to avoid overlap (matches previous behavior)
        const titleYOffset = 7 + depth * 12;
        overlays.push(blockOverlay(x, y, sg.width, sg.height, title, [], titleYOffset, 'center', 'left', 0));
      }
      elements.push(`<g class="subgraph-bg">${bgs.join('')}</g>`);
    }

    // Build a padded node lookup for geometry intersections (include clusters)
    const nodeMap: Record<string, {x:number;y:number;width:number;height:number;shape:string}> = {};
    for (const n of layout.nodes) {
      nodeMap[n.id] = { x: n.x + padX, y: n.y + padY, width: n.width, height: n.height, shape: (n as any).shape };
    }
    if ((layout as any).subgraphs && (layout as any).subgraphs.length) {
      for (const sg of (layout as any).subgraphs as Array<{id:string;x:number;y:number;width:number;height:number}>) {
        nodeMap[sg.id] = { x: sg.x + padX, y: sg.y + padY, width: sg.width, height: sg.height, shape: 'rectangle' };
      }
    }

    // Draw nodes first so edges can connect visibly without being hidden by node borders
    for (const node of layout.nodes) {
      elements.push(this.generateNodeWithPad(node, padX, padY));
    }

    // Draw edges on top of nodes; arrowhead overlays still collected for final top-most draw
    for (const edge of layout.edges) {
      const { path, overlay } = this.generateEdge(edge, padX, padY, nodeMap);
      elements.push(path);
      if (overlay) overlays.push(overlay);
    }

    // White background + shared CSS classes for styling
    const bg = `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />`;
    const sharedCss = buildSharedCss({
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      nodeFill: this.defaultFill,
      nodeStroke: this.defaultStroke,
      edgeStroke: this.arrowStroke,
    });
    const css = `<style>${sharedCss}</style>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${bg}
  ${css}
  ${elements.join('\n  ')}
  ${overlays.join('\n  ')}
</svg>`;
  }

  private buildNodeStyleAttrs(style: { stroke?: string; strokeWidth?: number; fill?: string }): string {
    const decs: string[] = [];
    if (style.fill) decs.push(`fill:${style.fill}`);
    if (style.stroke) decs.push(`stroke:${style.stroke}`);
    if (style.strokeWidth != null) decs.push(`stroke-width:${style.strokeWidth}`);
    return decs.length ? `style=\"${decs.join(';')}\"` : '';
  }

  private buildNodeStrokeStyle(style: { stroke?: string; strokeWidth?: number }): string {
    const decs: string[] = [];
    if (style.stroke) decs.push(`stroke:${style.stroke}`);
    if (style.strokeWidth != null) decs.push(`stroke-width:${style.strokeWidth}`);
    return decs.length ? `style=\"${decs.join(';')}\"` : '';
  }

  private generateDefs(): string {
    // Use userSpaceOnUse so marker sizes are consistent across viewers.
    // Provide explicit viewBox for reliable rendering.
    const aw = Math.max(8, this.arrowMarkerSize + 2);
    const ah = Math.max(8, this.arrowMarkerSize + 2);
    const arefX = Math.max(6, aw);
    const arefY = Math.max(4, Math.round(ah / 2));
    return `<defs>
    <marker id="arrow" viewBox="0 0 ${aw} ${ah}" markerWidth="${aw}" markerHeight="${ah}" refX="${arefX}" refY="${arefY}" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M0,0 L0,${ah} L${aw},${arefY} z" fill="${this.arrowStroke}" />
    </marker>
    <marker id="circle-marker" viewBox="0 0 9 9" markerWidth="9" markerHeight="9" refX="4.5" refY="4.5" orient="auto" markerUnits="userSpaceOnUse">
      <circle cx="4.5" cy="4.5" r="4.5" fill="${this.arrowStroke}" />
    </marker>
    <marker id="cross-marker" viewBox="0 0 12 12" markerWidth="12" markerHeight="12" refX="6" refY="6" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M1.5,1.5 L10.5,10.5 M10.5,1.5 L1.5,10.5" stroke="${this.arrowStroke}" stroke-width="2.25" />
    </marker>
  </defs>`;
  }

  private generateNodeWithPad(node: LayoutNode, padX: number, padY: number): string {
    const x = node.x + padX;
    const y = node.y + padY;
    const cx = x + node.width / 2;
    const cy = y + node.height / 2;

    let shape = '';
    let labelCenterY = cy;
    const strokeWidth = (node.style?.strokeWidth ?? undefined);
    const stroke = (node.style?.stroke ?? undefined);
    const fill = (node.style?.fill ?? undefined);
    const styleAttr = this.buildNodeStyleAttrs({ stroke, strokeWidth, fill });
    const typed = (node as any).typed as (undefined | { padding?: number; cornerRadius?: number; lean?: 'l'|'r'; media?: { icon?: string; image?: string } });
    const innerPad = Math.max(0, (typed?.padding ?? 10));

    switch (node.shape) {
      case 'rectangle':
        shape = `<rect class="node-shape" ${styleAttr} x="${x}" y="${y}" width="${node.width}" height="${node.height}" rx="0" ry="0" />`;
        break;

      case 'round': {
        const rx = Math.max(0, typed?.cornerRadius ?? 5);
        shape = `<rect class="node-shape" ${styleAttr} x="${x}" y="${y}" width="${node.width}" height="${node.height}" rx="${rx}" ry="${rx}" />`;
        break;
      }

      case 'stadium':
        const radius = node.height / 2;
        shape = `<rect class="node-shape" ${styleAttr} x="${x}" y="${y}" width="${node.width}" height="${node.height}" rx="${radius}" ry="${radius}" />`;
        break;

      case 'circle':
        const r = Math.min(node.width, node.height) / 2;
        shape = `<circle class="node-shape" ${styleAttr} cx="${cx}" cy="${cy}" r="${r}" />`;
        break;

      case 'diamond': {
        const points = [
          `${cx},${y}`,                    // top
          `${x + node.width},${cy}`,       // right
          `${cx},${y + node.height}`,      // bottom
          `${x},${cy}`                      // left
        ].join(' ');
        shape = `<polygon class="node-shape" ${styleAttr} points="${points}" />`;
        break;
      }

      case 'hexagon': {
        const dx = node.width * 0.25;
        const points = [
          `${x + dx},${y}`,                         // top-left
          `${x + node.width - dx},${y}`,            // top-right
          `${x + node.width},${cy}`,                // right
          `${x + node.width - dx},${y + node.height}`, // bottom-right
          `${x + dx},${y + node.height}`,           // bottom-left
          `${x},${cy}`                               // left
        ].join(' ');
        shape = `<polygon class="node-shape" ${styleAttr} points="${points}" />`;
        break;
      }

      case 'parallelogram': {
        const skew = node.width * 0.15;
        const leftLean = typed?.lean === 'l';
        const points = (leftLean
          ? [
              `${x},${y}`,
              `${x + node.width - skew},${y}`,
              `${x + node.width},${y + node.height}`,
              `${x + skew},${y + node.height}`
            ]
          : [
              `${x + skew},${y}`,
              `${x + node.width},${y}`,
              `${x + node.width - skew},${y + node.height}`,
              `${x},${y + node.height}`
            ]).join(' ');
        shape = `<polygon class="node-shape" ${styleAttr} points="${points}" />`;
        break;
      }

      case 'trapezoid': {
        const inset = node.width * 0.15;
        const points = [
          `${x + inset},${y}`,                      // top-left
          `${x + node.width - inset},${y}`,         // top-right
          `${x + node.width},${y + node.height}`,   // bottom-right
          `${x},${y + node.height}`                 // bottom-left
        ].join(' ');
        shape = `<polygon class="node-shape" ${styleAttr} points="${points}" />`;
        break;
      }

      case 'trapezoidAlt': {
        const inset = node.width * 0.15;
        const points = [
          `${x},${y}`,                               // top-left (full width)
          `${x + node.width},${y}`,                  // top-right
          `${x + node.width - inset},${y + node.height}`, // bottom-right (narrow)
          `${x + inset},${y + node.height}`          // bottom-left (narrow)
        ].join(' ');
        shape = `<polygon class="node-shape" ${styleAttr} points="${points}" />`;
        break;
      }

      case 'cylinder': {
        // Scale the ellipse vertically based on node size
        const rx = Math.max(8, node.width / 2);
        const ry = Math.max(6, Math.min(node.height * 0.22, node.width * 0.25));
        const topCY = y + ry;
        const botCY = y + node.height - ry;
        const bodyH = Math.max(0, node.height - ry * 2);
        const strokeOnly = this.buildNodeStrokeStyle({ stroke, strokeWidth });
        shape = `<g>
          <rect class="node-shape" ${styleAttr} x="${x}" y="${topCY}" width="${node.width}" height="${bodyH}" />
          <ellipse class="node-shape" ${styleAttr} cx="${cx}" cy="${topCY}" rx="${node.width/2}" ry="${ry}" />
          <path class="node-shape" ${strokeOnly} d="M${x},${topCY} L${x},${botCY} A${node.width/2},${ry} 0 0,0 ${x + node.width},${botCY} L${x + node.width},${topCY}" fill="none" />
        </g>`;
        // Center label within the cylindrical body (between the caps)
        labelCenterY = topCY + bodyH / 2;
        break;
      }

      case 'subroutine':
        const insetX = 5;
        const strokeOnly2 = this.buildNodeStrokeStyle({ stroke, strokeWidth });
        shape = `<g>
          <rect class="node-shape" ${styleAttr} x="${x}" y="${y}" width="${node.width}" height="${node.height}" rx="0" ry="0" />
          <line class="node-shape" ${strokeOnly2} x1="${x + insetX}" y1="${y}" x2="${x + insetX}" y2="${y + node.height}" />
          <line class="node-shape" ${strokeOnly2} x1="${x + node.width - insetX}" y1="${y}" x2="${x + node.width - insetX}" y2="${y + node.height}" />
        </g>`;
        break;

      case 'double':
        const gap = 4;
        const strokeOnly3 = this.buildNodeStrokeStyle({ stroke, strokeWidth });
        shape = `<g>
          <rect class="node-shape" ${styleAttr} x="${x}" y="${y}" width="${node.width}" height="${node.height}" rx="0" ry="0" />
          <rect class="node-shape" ${strokeOnly3} x="${x + gap}" y="${y + gap}" width="${node.width - gap * 2}" height="${node.height - gap * 2}" rx="0" ry="0" fill="none" />
        </g>`;
        break;

      default:
        const s = this.buildNodeStyleAttrs({ stroke, strokeWidth, fill });
        shape = `<rect ${s} x="${x}" y="${y}" width="${node.width}" height="${node.height}" rx="0" ry="0" />`;
    }

    // Add text label with wrapping
    const text = this.generateWrappedText(node.label, cx, labelCenterY, node.width - innerPad * 2);

    // Optional typed media (image) near left edge
    let media = '';
    if (typed?.media?.image) {
      const iw = Math.min(24, Math.max(12, node.height - 10));
      const ih = iw;
      const ix = x + 4;
      const iy = y + (node.height - ih) / 2;
      media = `<image xlink:href="${this.escapeXml(typed.media.image)}" x="${ix}" y="${iy}" width="${iw}" height="${ih}" />`;
    }

    const baseGroup = `<g id="${node.id}">
    ${shape}
    ${media}
    ${text}
  </g>`;
    const link = (node as any).link as (undefined | { href?: string; target?: string; tooltip?: string; call?: string });
    if (link && link.href) {
      const tt = link.tooltip ? `<title>${this.escapeXml(link.tooltip)}</title>` : '';
      const tgt = link.target ? ` target="${this.escapeXml(link.target)}" rel="noopener noreferrer"` : '';
      return `<a xlink:href="${this.escapeXml(link.href)}"${tgt} class="node-link">${tt}${baseGroup}</a>`;
    }
    if (link && link.tooltip) {
      return `<g class="node-call">
<title>${this.escapeXml(link.tooltip)}</title>
${baseGroup}
</g>`;
    }
    return baseGroup;
  }

  private generateWrappedText(text: string, x: number, y: number, maxWidth: number): string {
    // If the label contains basic HTML, use the rich renderer
    if (text.includes('<')) {
      return this.generateRichText(text, x, y, maxWidth);
    }
    // Estimate character width (tuned to Mermaid)
    const charWidth = 7; // px per character
    const maxCharsPerLine = Math.floor(maxWidth / charWidth);

    if (maxCharsPerLine <= 0 || text.length <= maxCharsPerLine) {
      // Single line - use dy offset for better vertical centering
      const dyOffset = this.fontSize * 0.35; // Empirical value for vertical centering
      return `<text class="node-label" x="${x}" y="${y + dyOffset}" text-anchor="middle">${this.escapeXml(text)}</text>`;
    }

    // Split text into words
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;

      if (testLine.length > maxCharsPerLine && currentLine) {
        // Current line is full, start new line
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    // Add remaining text
    if (currentLine) {
      lines.push(currentLine);
    }

    // Generate SVG text with tspans for each line
    const lineHeight = 18; // px - add a bit more vertical space
    const totalHeight = (lines.length - 1) * lineHeight;
    const startY = y - totalHeight / 2 + this.fontSize * 0.35; // Add dy offset for centering

    const tspans = lines.map((line, i) => {
      const lineY = startY + i * lineHeight;
      // Remove dominant-baseline and use explicit y positioning
      return `<tspan x="${x}" y="${lineY}" text-anchor="middle">${this.escapeXml(line)}</tspan>`;
    }).join('\n    ');

    return `<text class="node-label">
    ${tspans}
  </text>`;
  }

  // Basic HTML-aware text renderer supporting <br>, <b>/<strong>, <i>/<em>, <u>
  private generateRichText(html: string, x: number, y: number, maxWidth: number): string {
    // Normalize tag spacing so tokens like "< br / >" become "<br/>"
    html = this.normalizeHtml(html);
    type Seg = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; br?: boolean };
    const segments: Seg[] = [];
    // Normalize <br> variants to a unique token and tokenize tags
    const re = /<\/?(br|b|strong|i|em|u)\s*\/?\s*>/gi;
    let lastIndex = 0;
    const state = { bold: false, italic: false, underline: false };
    const pushText = (t: string) => {
      if (!t) return;
      segments.push({ text: this.htmlDecode(t), bold: state.bold, italic: state.italic, underline: state.underline });
    };
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      // text before tag
      pushText(html.slice(lastIndex, m.index));
      const tag = m[0].toLowerCase();
      const name = m[1].toLowerCase();
      const isClose = tag.startsWith('</');
      if (name === 'br') {
        segments.push({ text: '', br: true });
      } else if (name === 'b' || name === 'strong') {
        state.bold = !isClose ? true : false;
      } else if (name === 'i' || name === 'em') {
        state.italic = !isClose ? true : false;
      } else if (name === 'u') {
        state.underline = !isClose ? true : false;
      }
      lastIndex = re.lastIndex;
    }
    pushText(html.slice(lastIndex));

    // Wrap into lines with forced breaks
    const lines: Seg[][] = [];
    const charWidth = 7;
    const maxCharsPerLine = Math.max(1, Math.floor(maxWidth / charWidth));
    let current: Seg[] = [];
    let currentLen = 0;
    const flush = () => { if (current.length) { lines.push(current); current = []; currentLen = 0; } };
    const splitWords = (s: Seg): Seg[] => {
      if (!s.text) return [s];
      const words = s.text.split(/(\s+)/); // keep spaces
      return words.map(w => ({ ...s, text: w }));
    };

    for (const seg of segments) {
      if (seg.br) { flush(); continue; }
      for (const w of splitWords(seg)) {
        const wlen = w.text.length;
        if (currentLen + wlen > maxCharsPerLine && currentLen > 0) {
          flush();
        }
        current.push(w);
        currentLen += wlen;
      }
    }
    flush();

    // Emit SVG tspans
    const lineHeight = 18; // richer text lines spacing up slightly
    const totalHeight = (lines.length - 1) * lineHeight;
    const startY = y - totalHeight / 2 + this.fontSize * 0.35;
    const tspans: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const lineY = startY + i * lineHeight;
      // Build inline tspans for style changes
      let acc = '';
      let cursorX = x;
      // Use a grouping <tspan> to align the full line by x/y, and nest inline tspans
      const inner: string[] = [];
      let buffer = '';
      let style = { bold: false, italic: false, underline: false };
      const flushInline = () => {
        if (!buffer) return;
        const styleAttr = `${style.bold ? 'font-weight="bold" ' : ''}${style.italic ? 'font-style="italic" ' : ''}${style.underline ? 'text-decoration="underline" ' : ''}`;
        inner.push(`<tspan ${styleAttr}>${this.escapeXml(buffer)}</tspan>`);
        buffer = '';
      };
      for (const w of lines[i]) {
        const wStyle = { bold: !!w.bold, italic: !!w.italic, underline: !!w.underline };
        if (wStyle.bold !== style.bold || wStyle.italic !== style.italic || wStyle.underline !== style.underline) {
          flushInline();
          style = wStyle;
        }
        buffer += w.text;
      }
      flushInline();
      tspans.push(`<tspan x="${x}" y="${lineY}" text-anchor="middle">${inner.join('')}</tspan>`);
    }

    return `<text font-family="${this.fontFamily}" font-size="${this.fontSize}" fill="#333">${tspans.join('\n    ')}</text>`;
  }

  private normalizeHtml(s: string): string {
    // collapse spaces between < and tag name, around '/', and before >
    let out = s.replace(/<\s+/g, '<')
               .replace(/\s+>/g, '>')
               .replace(/<\s*\//g, '</')
               .replace(/\s*\/\s*>/g, '/>')
               .replace(/<\s*(br)\s*>/gi, '<$1/>'); // turn <br> into <br/>
    return out;
  }

  private htmlDecode(s: string): string {
    return s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  private generateEdge(edge: LayoutEdge, padX: number, padY: number, nodeMap: Record<string, {x:number;y:number;width:number;height:number;shape:string}>): { path: string; overlay?: string } {
    if (!edge.points || edge.points.length < 2) {
      return { path: '' };
    }

    // Build smoothed path (Catmull-Rom to Bezier) from dagre points
    const points = edge.points.map(p => ({ x: p.x + padX, y: p.y + padY }));
    const segData = this.buildSmoothSegments(points);

    // Style based on arrow type
    let strokeDasharray = '';
    let strokeWidth = 1.5;
    // Do not assume a default arrowhead; rely on model markers
    let markerEnd = '';
    let markerStart = '';

    switch (edge.type) {
      case 'open':
        markerEnd = '';
        break;
      case 'dotted':
        strokeDasharray = '3,3';
        break;
      case 'thick':
        strokeWidth = 3;
        break;
      case 'invisible':
        strokeDasharray = '0,100000';
        markerEnd = '';
        break;
    }

    // Build Mermaid-like path
    const mStart = (edge as any).markerStart as (undefined|string);
    const mEnd = (edge as any).markerEnd as (undefined|string);
    const sourceNode = nodeMap[(edge as any).source];
    const targetNode = nodeMap[(edge as any).target];
    // Compute boundary tips by intersecting first/last polyline legs
    let boundaryStart = points[0];
    let boundaryEnd = points[points.length - 1];
    if (sourceNode && points.length >= 2) {
      const pseudo = { start: points[0], segs: [{ c1: points[1], c2: points[Math.max(0, points.length - 2)], to: points[points.length - 1] }] } as any;
      boundaryStart = this.intersectSegmentsStart(pseudo, sourceNode).start;
    }
    if (targetNode && points.length >= 2) {
      const pseudo = { start: points[0], segs: [{ c1: points[1], c2: points[Math.max(0, points.length - 2)], to: points[points.length - 1] }] } as any;
      const after = this.intersectSegmentsEnd(pseudo, targetNode) as any;
      boundaryEnd = after.segs.length ? after.segs[after.segs.length - 1].to : boundaryEnd;
    }
    const pathParts: string[] = [];
    pathParts.push(`M${boundaryStart.x},${boundaryStart.y}`);
    // Short, straight lead-out segment from the source boundary
    let startFlat = points.length >= 2 ? points[1] : boundaryStart;
    if (points.length >= 2) {
      const svx = points[1].x - boundaryStart.x;
      const svy = points[1].y - boundaryStart.y;
      const slen = Math.hypot(svx, svy) || 1;
      const SFLAT = Math.min(22, Math.max(10, slen * 0.15));
      startFlat = { x: boundaryStart.x + (svx / slen) * SFLAT, y: boundaryStart.y + (svy / slen) * SFLAT };
      pathParts.push(`L${startFlat.x},${startFlat.y}`);
    }
    const orthogonal = (edge as any).pathMode === 'orthogonal';
    if (points.length >= 4 && !orthogonal) {
      // Multiple interior points: C segments for interior, then L into boundary
      const pts = [points[0], ...points, points[points.length - 1]]; // duplicate ends
      for (let i = 1; i < pts.length - 3; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2];
        const c1x = p1.x + (p2.x - p0.x) / 6; const c1y = p1.y + (p2.y - p0.y) / 6;
        const c2x = p2.x - (p3.x - p1.x) / 6; const c2y = p2.y - (p3.y - p1.y) / 6;
        pathParts.push(`C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`);
      }
      // Final straight into boundary
      pathParts.push(`L${boundaryEnd.x},${boundaryEnd.y}`);
    } else if (points.length === 3 && !orthogonal) {
      // One interior point: end with a short flat segment into boundary like Mermaid
      const p0 = boundaryStart, p1 = points[1], p2 = boundaryEnd;
      // Approach point: a bit before the boundary along the last leg
      const ax = boundaryEnd.x - p1.x;
      const ay = boundaryEnd.y - p1.y;
      const alen = Math.hypot(ax, ay) || 1;
      const FLAT_IN = Math.min(20, Math.max(10, alen * 0.15));
      const preEnd = { x: boundaryEnd.x - (ax/alen) * FLAT_IN, y: boundaryEnd.y - (ay/alen) * FLAT_IN };
      // Control points: CR-like near start, and align the last control along the final leg into preEnd
      // First control oriented along the initial leg from boundaryStart → points[1]
      const sdx = startFlat.x - boundaryStart.x; const sdy = startFlat.y - boundaryStart.y;
      const sdirx = (sdx === 0 && sdy === 0) ? (p1.x - p0.x) : sdx; // fallback if startFlat==start
      const sdiry = (sdx === 0 && sdy === 0) ? (p1.y - p0.y) : sdy;
      const sdlen = Math.hypot(sdirx, sdiry) || 1;
      const c1len = Math.min(40, Math.max(12, sdlen * 1.2));
      const c1x = startFlat.x + (sdirx / sdlen) * c1len;
      const c1y = startFlat.y + (sdiry / sdlen) * c1len;
      // Second control aligned with the last leg towards boundaryEnd
      const dirx = (boundaryEnd.x - p1.x) / alen; const diry = (boundaryEnd.y - p1.y) / alen;
      const c2x = preEnd.x - dirx * (FLAT_IN * 0.6);
      const c2y = preEnd.y - diry * (FLAT_IN * 0.6);
      pathParts.push(`C${c1x},${c1y} ${c2x},${c2y} ${preEnd.x},${preEnd.y}`);
      pathParts.push(`L${boundaryEnd.x},${boundaryEnd.y}`);
    } else {
      // Only two points: straight line
      pathParts.push(`L${boundaryEnd.x},${boundaryEnd.y}`);
    }
    // If orthogonal path is requested, emit pure L segments across all interior points
    if (orthogonal) {
      pathParts.length = 0;
      pathParts.push(`M${boundaryStart.x},${boundaryStart.y}`);
      for (const p of points.slice(1, -1)) pathParts.push(`L${p.x},${p.y}`);
      pathParts.push(`L${boundaryEnd.x},${boundaryEnd.y}`);
    }
    const pathData = pathParts.join(' ');

    let edgeElement = `<path class="edge-path" d="${pathData}" stroke-linecap="round" stroke-linejoin="round"`;
    // Per-edge style overrides (from linkStyle)
    const styleStroke = (edge as any).style?.stroke as (string|undefined);
    const styleStrokeWidth = (edge as any).style?.strokeWidth as (number|undefined);
    const styleStrokeOpacity = (edge as any).style?.strokeOpacity as (number|undefined);
    if ((edge as any).dasharray) strokeDasharray = String((edge as any).dasharray);
    if (strokeDasharray) {
      edgeElement += ` stroke-dasharray="${strokeDasharray}"`;
    }
    if (styleStrokeWidth != null) {
      edgeElement += ` stroke-width="${styleStrokeWidth}"`;
    } else {
      if (strokeWidth && strokeWidth !== 1.5) edgeElement += ` stroke-width="${strokeWidth}"`;
    }
    if (styleStrokeOpacity != null) {
      edgeElement += ` stroke-opacity="${styleStrokeOpacity}"`;
    }
    if (styleStroke) {
      edgeElement += ` stroke="${styleStroke}"`;
    }
    // Apply explicit markers from edge if present
    // Use overlay shapes for arrow/circle/cross; avoid marker URLs so per-edge color applies
    const startMarkUrl = '';
    const endMarkUrl = (markerEnd || '');
    // No tangent fix needed: last command is a straight L into the node boundary
    // Prefer overlay triangles for arrowheads; keep circle/cross as markers
    if (startMarkUrl && mStart !== 'arrow') edgeElement += ` marker-start="${startMarkUrl}"`;
    if (endMarkUrl && mEnd !== 'arrow') edgeElement += ` marker-end="${endMarkUrl}"`;
    edgeElement += ' />';

    // Add edge label if present
    if (edge.label) {
      const pos = this.pointAtRatio(points, 0.55);
      const text = this.escapeXml(edge.label);
      const padding = 4;
      const fontSize = this.fontSize - 3; // slightly smaller than node labels
      const width = Math.max(18, Math.min(220, text.length * 6 + padding * 2));
      const height = 14;
      const x = pos.x - width / 2;
      const y = pos.y - height / 2;
      const labelBg = `<rect class="edge-label-bg" x="${x}" y="${y}" width="${width}" height="${height}" rx="3" />`;
      const labelText = `<text class="edge-label-text" x="${pos.x}" y="${pos.y}" text-anchor="middle" dominant-baseline="middle">${text}</text>`;

      // Overlay arrowheads (same logic as unlabeled case), drawn last for visibility
      let overlay = '';
      const prevEndL = points.length >= 2 ? points[points.length - 2] : boundaryEnd;
      const vxl = boundaryEnd.x - prevEndL.x; const vyl = boundaryEnd.y - prevEndL.y;
      const vlenl = Math.hypot(vxl, vyl) || 1;
      const uxl = vxl / vlenl; const uyl = vyl / vlenl;
      const nxl = -uyl; const nyl = uxl;
      // Scale overlay arrowhead with stroke width if provided (linkStyle)
      const ow = (styleStrokeWidth != null ? styleStrokeWidth : strokeWidth);
      const triLenL = Math.max(6, Math.min(14, 6 + (ow - 1.5) * 3));
      const triWL   = Math.max(5, Math.min(12, 5 + (ow - 1.5) * 2.5));
      // Arrow points forward in direction of travel: tip AT boundaryEnd, base pulled back
      const p1xL = boundaryEnd.x, p1yL = boundaryEnd.y; // tip at boundary
      const baseXL = boundaryEnd.x - uxl * triLenL; const baseYL = boundaryEnd.y - uyl * triLenL;
      const p2xL = baseXL + nxl * (triWL/2), p2yL = baseYL + nyl * (triWL/2);
      const p3xL = baseXL - nxl * (triWL/2), p3yL = baseYL - nyl * (triWL/2);
      overlay += triangleAtEnd(prevEndL, boundaryEnd, (styleStroke || this.arrowStroke), triLenL, triWL);
      if (mStart === 'arrow' && points.length >= 2) {
        const firstLeg = points[1];
        const svx = boundaryStart.x - firstLeg.x; const svy = boundaryStart.y - firstLeg.y;
        const slen = Math.hypot(svx, svy) || 1; const sux = svx/slen; const suy = svy/slen;
        const snx = -suy; const sny = sux;
        const sbaseX = boundaryStart.x - sux * triLenL; const sbaseY = boundaryStart.y - suy * triLenL;
        overlay += triangleAtStart(boundaryStart, firstLeg, (styleStroke || this.arrowStroke), triLenL, triWL);
      }

      const pathGroup = `<g>
    ${edgeElement}
    ${labelBg}
    ${labelText}
    ${overlay}
  </g>`;
      return { path: pathGroup };
    }

    // Build optional overlay arrowheads for viewers with limited marker support (triangles only)
    let overlay = '';
    // For direction, use last polyline leg (points.length-2 -> boundaryEnd)
    const prevEnd = points.length >= 2 ? points[points.length - 2] : boundaryEnd;
    const vx = boundaryEnd.x - prevEnd.x; const vy = boundaryEnd.y - prevEnd.y;
    const vlen = Math.hypot(vx, vy) || 1;
    const ux = vx / vlen; const uy = vy / vlen;
    const nx = -uy; const ny = ux;
    // Scale overlay arrowhead with stroke width if provided (linkStyle)
    const ow2 = (styleStrokeWidth != null ? styleStrokeWidth : strokeWidth);
    const triLen = Math.max(6, Math.min(14, 6 + (ow2 - 1.5) * 3));
    const triW   = Math.max(5, Math.min(12, 5 + (ow2 - 1.5) * 2.5));
    // Arrow points forward in direction of travel: tip AT boundaryEnd, base pulled back
    const p1x = boundaryEnd.x, p1y = boundaryEnd.y; // tip at boundary
    const baseX = boundaryEnd.x - ux * triLen;
    const baseY = boundaryEnd.y - uy * triLen;
    const p2x = baseX + nx * (triW/2), p2y = baseY + ny * (triW/2);
    const p3x = baseX - nx * (triW/2), p3y = baseY - ny * (triW/2);

    if (mEnd === 'arrow') overlay += triangleAtEnd(prevEnd, boundaryEnd, (styleStroke || this.arrowStroke), triLen, triW);
    // Optional: support start arrow overlay if needed
    if (mStart === 'arrow' && points.length >= 2) {
      const firstLeg = points[1];
      const svx = boundaryStart.x - firstLeg.x; const svy = boundaryStart.y - firstLeg.y;
      const slen = Math.hypot(svx, svy) || 1; const sux = svx/slen; const suy = svy/slen;
      const snx = -suy; const sny = sux;
      // Arrow points backward from boundaryStart toward firstLeg (start arrow points back toward source)
      overlay += triangleAtStart(boundaryStart, firstLeg, (styleStroke || this.arrowStroke), triLen, triW);
    }
    // Circle/Cross overlays for both ends
    const owStroke = (styleStroke || this.arrowStroke);
    const addCircle = (at:{x:number;y:number}) => `<circle cx=\"${at.x}\" cy=\"${at.y}\" r=\"4.5\" fill=\"none\" stroke=\"${owStroke}\" stroke-width=\"${ow2}\" />`;
    const addCross = (at:{x:number;y:number}) => `<g transform=\"translate(${at.x},${at.y})\"><path d=\"M -4 -4 L 4 4\" stroke=\"${owStroke}\" stroke-width=\"${ow2}\"/><path d=\"M -4 4 L 4 -4\" stroke=\"${owStroke}\" stroke-width=\"${ow2}\"/></g>`;
    if (mEnd === 'circle') overlay += addCircle(boundaryEnd);
    if (mEnd === 'cross') overlay += addCross(boundaryEnd);
    if (mStart === 'circle') overlay += addCircle(boundaryStart);
    if (mStart === 'cross') overlay += addCross(boundaryStart);

    if (overlay) {
      const grouped = `<g>${edgeElement}\n${overlay}</g>`;
      return { path: grouped };
    }
    return { path: edgeElement };
  }

  // --- helpers ---
  private buildSmoothSegments(points: Array<{x:number;y:number}>): { start:{x:number;y:number}; segs: Array<{c1:{x:number;y:number}; c2:{x:number;y:number}; to:{x:number;y:number}}>} {
    if (points.length < 2) {
      const p = points[0] || {x:0,y:0};
      return { start: p, segs: [] };
    }
    if (points.length === 2) {
      const p0 = points[0];
      const p1 = points[1];
      const c1 = { x: p0.x + (p1.x - p0.x) / 3, y: p0.y + (p1.y - p0.y) / 3 };
      const c2 = { x: p0.x + 2*(p1.x - p0.x) / 3, y: p0.y + 2*(p1.y - p0.y) / 3 };
      return { start: p0, segs: [{ c1, c2, to: p1 }] };
    }
    const pts = [points[0], ...points, points[points.length - 1]]; // duplicate ends
    const segs: Array<{c1:{x:number;y:number}; c2:{x:number;y:number}; to:{x:number;y:number}}> = [];
    const firstIdx = 1;
    const lastIdx = pts.length - 3; // index i of the last produced segment
    const midFactor = 1.0;          // keep mid segments as-is
    const endFactor = 0.35;         // reduce handle magnitude near the ends more
    const FLAT_LEN = 28;            // ~28px straight approach near node boundaries (closer to Mermaid)
    for (let i = 1; i < pts.length - 2; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2];
      const f1 = (i === firstIdx) ? endFactor : midFactor;
      const f2 = (i === lastIdx)  ? endFactor : midFactor;
      // Initial CR->Bezier handles
      let c1 = { x: p1.x + ((p2.x - p0.x) / 6) * f1, y: p1.y + ((p2.y - p0.y) / 6) * f1 };
      let c2 = { x: p2.x - ((p3.x - p1.x) / 6) * f2, y: p2.y - ((p3.y - p1.y) / 6) * f2 };

      // Flatten start/end approach to nodes by aligning the endpoint handle along the chord
      if (i === firstIdx) {
        const dx = p2.x - p1.x, dy = p2.y - p1.y; const len = Math.hypot(dx, dy) || 1;
        const t = Math.min(FLAT_LEN, len * 0.5);
        c1 = { x: p1.x + (dx/len) * t, y: p1.y + (dy/len) * t };
      }
      if (i === lastIdx) {
        const dx = p2.x - p1.x, dy = p2.y - p1.y; const len = Math.hypot(dx, dy) || 1;
        const t = Math.min(FLAT_LEN, len * 0.5);
        c2 = { x: p2.x - (dx/len) * t, y: p2.y - (dy/len) * t };
      }
      segs.push({ c1, c2, to: { x: p2.x, y: p2.y } });
    }
    return { start: pts[1], segs };
  }

  private pathFromSegments(data: { start:{x:number;y:number}; segs: Array<{c1:{x:number;y:number}; c2:{x:number;y:number}; to:{x:number;y:number}}>}): string {
    let d = `M${data.start.x},${data.start.y}`;
    for (const s of data.segs) {
      d += ` C${s.c1.x},${s.c1.y} ${s.c2.x},${s.c2.y} ${s.to.x},${s.to.y}`;
    }
    return d;
  }

  private trimSegmentsEnd(data: { start:{x:number;y:number}; segs: Array<{c1:{x:number;y:number}; c2:{x:number;y:number}; to:{x:number;y:number}}>} , cut: number) {
    const segs = data.segs.slice();
    if (!segs.length) return data;
    const last = { ...segs[segs.length - 1] };
    const vx = last.to.x - last.c2.x;
    const vy = last.to.y - last.c2.y;
    const len = Math.hypot(vx, vy) || 1;
    // Clamp cut to avoid crossing the control point which would invert direction
    const eff = Math.max(0.1, Math.min(cut, Math.max(0, len - 0.2)));
    const nx = vx / len;
    const ny = vy / len;
    const newTo = { x: last.to.x - nx * eff, y: last.to.y - ny * eff };
    last.to = newTo;
    segs[segs.length - 1] = last;
    return { start: data.start, segs };
  }

  private trimSegmentsStart(data: { start:{x:number;y:number}; segs: Array<{c1:{x:number;y:number}; c2:{x:number;y:number}; to:{x:number;y:number}}>} , cut: number) {
    const segs = data.segs.slice();
    if (!segs.length) return data;
    const first = { ...segs[0] };
    const vx = first.c1.x - data.start.x;
    const vy = first.c1.y - data.start.y;
    const len = Math.hypot(vx, vy) || 1;
    const eff = Math.max(0.1, Math.min(cut, Math.max(0, len - 0.2)));
    const nx = vx / len;
    const ny = vy / len;
    const newStart = { x: data.start.x + nx * eff, y: data.start.y + ny * eff };
    return { start: newStart, segs };
  }

  // ---- shape intersections ----
  private intersectSegmentsEnd(data: { start:{x:number;y:number}; segs: Array<{c1:{x:number;y:number}; c2:{x:number;y:number}; to:{x:number;y:number}}>} , node: {x:number;y:number;width:number;height:number;shape:string}) {
    if (!data.segs.length) return data;
    const last = data.segs[data.segs.length - 1];
    const p1 = last.c2; const p2 = last.to;
    const hit = this.intersectLineWithNode(p1, p2, node);
    if (hit) {
      const segs = data.segs.slice();
      segs[segs.length - 1] = { ...last, to: hit };
      return { start: data.start, segs };
    }
    return data;
  }

  private intersectSegmentsStart(data: { start:{x:number;y:number}; segs: Array<{c1:{x:number;y:number}; c2:{x:number;y:number}; to:{x:number;y:number}}>} , node: {x:number;y:number;width:number;height:number;shape:string}) {
    if (!data.segs.length) return data;
    const first = data.segs[0];
    const p1 = data.start; const p2 = first.c1;
    const hit = this.intersectLineWithNode(p1, p2, node);
    if (hit) {
      return { start: hit, segs: data.segs };
    }
    return data;
  }

  private intersectLineWithNode(p1:{x:number;y:number}, p2:{x:number;y:number}, node:{x:number;y:number;width:number;height:number;shape:string}): {x:number;y:number} | null {
    const shape = node.shape;
    const rectPoly = () => ([
      {x:node.x, y:node.y},
      {x:node.x+node.width, y:node.y},
      {x:node.x+node.width, y:node.y+node.height},
      {x:node.x, y:node.y+node.height}
    ]);
    switch (shape) {
      case 'round': {
        // Approximate as rectangle for intersection; fall back to nearest boundary
        const poly = [
          {x:node.x, y:node.y},
          {x:node.x+node.width, y:node.y},
          {x:node.x+node.width, y:node.y+node.height},
          {x:node.x, y:node.y+node.height}
        ];
        const hit = this.linePolygonIntersection(p1, p2, poly);
        return hit || this.nearestPointOnPolygon(p2, poly);
      }
      case 'circle': {
        const cx = node.x + node.width/2; const cy = node.y + node.height/2; const r = Math.min(node.width, node.height)/2;
        return this.lineCircleIntersection(p1, p2, {cx, cy, r});
      }
      case 'diamond': {
        const cx = node.x + node.width/2; const cy = node.y + node.height/2;
        const poly = [ {x:cx, y:node.y}, {x:node.x+node.width, y:cy}, {x:cx, y:node.y+node.height}, {x:node.x, y:cy} ];
        const hit = this.linePolygonIntersection(p1, p2, poly);
        return hit || this.nearestPointOnPolygon(p2, poly);
      }
      case 'hexagon': {
        const s = Math.max(10, node.width * 0.2);
        const poly = [
          {x:node.x + s, y:node.y},
          {x:node.x + node.width - s, y:node.y},
          {x:node.x + node.width, y:node.y + node.height/2},
          {x:node.x + node.width - s, y:node.y + node.height},
          {x:node.x + s, y:node.y + node.height},
          {x:node.x, y:node.y + node.height/2}
        ];
        const hit = this.linePolygonIntersection(p1, p2, poly);
        return hit || this.nearestPointOnPolygon(p2, poly);
      }
      case 'parallelogram': {
        const o = Math.min(node.width*0.25, node.height*0.6);
        const poly = [
          {x:node.x + o, y:node.y},
          {x:node.x + node.width, y:node.y},
          {x:node.x + node.width - o, y:node.y + node.height},
          {x:node.x, y:node.y + node.height}
        ];
        const hit = this.linePolygonIntersection(p1, p2, poly);
        return hit || this.nearestPointOnPolygon(p2, poly);
      }
      case 'trapezoid': { // top narrow
        const o = Math.min(node.width*0.2, node.height*0.5);
        const poly = [
          {x:node.x + o, y:node.y},
          {x:node.x + node.width - o, y:node.y},
          {x:node.x + node.width, y:node.y + node.height},
          {x:node.x, y:node.y + node.height}
        ];
        const hit = this.linePolygonIntersection(p1, p2, poly);
        return hit || this.nearestPointOnPolygon(p2, poly);
      }
      case 'trapezoidAlt': { // bottom narrow
        const o = Math.min(node.width*0.2, node.height*0.5);
        const poly = [
          {x:node.x, y:node.y},
          {x:node.x + node.width, y:node.y},
          {x:node.x + node.width - o, y:node.y + node.height},
          {x:node.x + o, y:node.y + node.height}
        ];
        const hit = this.linePolygonIntersection(p1, p2, poly);
        return hit || this.nearestPointOnPolygon(p2, poly);
      }
      case 'stadium': { // capsule: rectangle with semicircle caps left/right
        const r = Math.min(node.height/2, node.width/2);
        // First try rectangle middle
        const rect = [
          {x:node.x + r, y:node.y},
          {x:node.x + node.width - r, y:node.y},
          {x:node.x + node.width - r, y:node.y + node.height},
          {x:node.x + r, y:node.y + node.height}
        ];
        const hitRect = this.linePolygonIntersection(p1, p2, rect);
        if (hitRect) return hitRect;
        // Left cap
        const left = this.lineCircleIntersection(p1, p2, { cx: node.x + r, cy: node.y + node.height/2, r });
        // Right cap
        const right = this.lineCircleIntersection(p1, p2, { cx: node.x + node.width - r, cy: node.y + node.height/2, r });
        // Choose the intersection closer to p2 (end)
        const pick = (...pts: ({x:number;y:number}|null)[]) => {
          let best=null as any; let bestd=-Infinity;
          for (const pt of pts) if (pt) { const d = -( (pt.x - p2.x)**2 + (pt.y - p2.y)**2 ); if (d>bestd) { bestd=d; best=pt; } }
          return best;
        };
        const hit = pick(left, right);
        return hit || this.nearestPointOnPolygon(p2, rect);
      }
      default: {
        // default to rectangle
        const poly = rectPoly();
        const hit = this.linePolygonIntersection(p1, p2, poly);
        return hit || this.nearestPointOnPolygon(p2, poly);
      }
    }
  }

  private lineCircleIntersection(p1:{x:number;y:number}, p2:{x:number;y:number}, c:{cx:number;cy:number;r:number}): {x:number;y:number} | null {
    // parametric p = p1 + t*(p2-p1)
    const dx = p2.x - p1.x; const dy = p2.y - p1.y;
    const fx = p1.x - c.cx; const fy = p1.y - c.cy;
    const a = dx*dx + dy*dy;
    const b = 2*(fx*dx + fy*dy);
    const cc = fx*fx + fy*fy - c.r*c.r;
    const disc = b*b - 4*a*cc; if (disc < 0) return null;
    const s = Math.sqrt(disc);
    // we need t in (0,1), nearest to 1 (closest to p2)
    const t1 = (-b - s) / (2*a);
    const t2 = (-b + s) / (2*a);
    const ts = [t1, t2].filter(t => t >= 0 && t <= 1);
    if (!ts.length) return null;
    const t = Math.max(...ts);
    return { x: p1.x + dx*t, y: p1.y + dy*t };
  }

  private linePolygonIntersection(p1:{x:number;y:number}, p2:{x:number;y:number}, poly:Array<{x:number;y:number}>): {x:number;y:number} | null {
    let bestT = -Infinity; let best=null as any;
    for (let i=0;i<poly.length;i++){
      const a = poly[i]; const b = poly[(i+1)%poly.length];
      const hit = this.segmentIntersection(p1,p2,a,b);
      if (hit && hit.t >= 0 && hit.t <= 1 && hit.u >=0 && hit.u <=1){
        if (hit.t > bestT){ bestT = hit.t; best = {x: hit.x, y: hit.y}; }
      }
    }
    return best;
  }

  // Fallback helpers when lines are colinear or miss due to smoothing
  private nearestPointOnSegment(p:{x:number;y:number}, a:{x:number;y:number}, b:{x:number;y:number}): {x:number;y:number} {
    const abx = b.x - a.x, aby = b.y - a.y;
    const ab2 = abx*abx + aby*aby || 1;
    const apx = p.x - a.x, apy = p.y - a.y;
    let t = (apx*abx + apy*aby) / ab2; t = Math.max(0, Math.min(1, t));
    return { x: a.x + abx*t, y: a.y + aby*t };
  }

  private nearestPointOnPolygon(to:{x:number;y:number}, poly:Array<{x:number;y:number}>): {x:number;y:number} {
    let best = poly[0]; let bestD = Infinity;
    for (let i=0;i<poly.length;i++){
      const a = poly[i]; const b = poly[(i+1)%poly.length];
      const p = this.nearestPointOnSegment(to, a, b);
      const d = (p.x - to.x)*(p.x - to.x) + (p.y - to.y)*(p.y - to.y);
      if (d < bestD) { bestD = d; best = p; }
    }
    return { x: best.x, y: best.y };
  }

  private segmentIntersection(p:{x:number;y:number}, p2:{x:number;y:number}, q:{x:number;y:number}, q2:{x:number;y:number}): {x:number;y:number;t:number;u:number}|null {
    const r = { x: p2.x - p.x, y: p2.y - p.y };
    const s = { x: q2.x - q.x, y: q2.y - q.y };
    const rxs = r.x*s.y - r.y*s.x; if (Math.abs(rxs) < 1e-6) return null;
    const q_p = { x: q.x - p.x, y: q.y - p.y };
    const t = (q_p.x*s.y - q_p.y*s.x)/rxs;
    const u = (q_p.x*r.y - q_p.y*r.x)/rxs;
    const x = p.x + t*r.x; const y = p.y + t*r.y;
    return {x,y,t,u};
  }

  private pointAtRatio(points: Array<{x:number;y:number}>, ratio: number): {x:number;y:number} {
    const clampRatio = Math.max(0, Math.min(1, ratio));
    let total = 0;
    const segs: number[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const dx = points[i+1].x - points[i].x;
      const dy = points[i+1].y - points[i].y;
      const len = Math.hypot(dx, dy);
      segs.push(len);
      total += len;
    }
    if (total === 0) return points[Math.floor(points.length / 2)];
    let target = total * clampRatio;
    for (let i = 0; i < segs.length; i++) {
      if (target <= segs[i]) {
        const t = segs[i] === 0 ? 0 : target / segs[i];
        return {
          x: points[i].x + (points[i+1].x - points[i].x) * t,
          y: points[i].y + (points[i+1].y - points[i].y) * t,
        };
      }
      target -= segs[i];
    }
    return points[points.length - 1];
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
