import { tokenize } from '../diagrams/flowchart/lexer.js';
import { parserInstance } from '../diagrams/flowchart/parser.js';
import { GraphBuilder } from './graph-builder.js';
import { DagreLayoutEngine } from './layout.js';
import { SVGRenderer } from './svg-generator.js';
import type { Graph } from './types.js';
import type { ValidationError } from '../core/types.js';
import type { ILayoutEngine, IRenderer } from './interfaces.js';
import { buildPieModel } from './pie-builder.js';
import { renderPie } from './pie-renderer.js';
import { buildSequenceModel } from './sequence-builder.js';
import { renderSequence } from './sequence-renderer.js';
import { applyFlowLikeTheme } from './styles.js';
import { buildStateModel } from './state-builder.js';
import { renderState } from './state-renderer.js';
import { parseFrontmatter } from '../core/frontmatter.js';
import { buildClassModel } from './class-builder.js';
import { renderClass } from './class-renderer.js';

export interface RenderOptions {
  /** Include validation errors as overlays on the diagram */
  showErrors?: boolean;
  /** Custom width for the SVG */
  width?: number;
  /** Custom height for the SVG */
  height?: number;
  /** Custom layout engine (defaults to DagreLayoutEngine) */
  layoutEngine?: ILayoutEngine;
  /** Custom renderer (defaults to SVGRenderer) */
  renderer?: IRenderer;
}

export interface RenderResult {
  svg: string;
  graph: Graph;
  errors: ValidationError[];
}

/**
 * Main renderer class that orchestrates the rendering pipeline
 */
export class MermaidRenderer {
  private graphBuilder: GraphBuilder;
  private layoutEngine: ILayoutEngine;
  private renderer: IRenderer;

  constructor(layoutEngine?: ILayoutEngine, renderer?: IRenderer) {
    this.graphBuilder = new GraphBuilder();
    this.layoutEngine = layoutEngine || new DagreLayoutEngine();
    this.renderer = renderer || new SVGRenderer();
  }

  /**
   * Renders a Mermaid flowchart diagram
   */
  render(text: string, options: RenderOptions = {}): RenderResult {
    const errors: ValidationError[] = [];

    // Use custom engines if provided in options
    const layoutEngine = options.layoutEngine || this.layoutEngine;
    const renderer = options.renderer || this.renderer;

    try {
      // Step 1: Tokenize
      const lexResult = tokenize(text);

      // Check for lexer errors
      if (lexResult.errors && lexResult.errors.length > 0) {
        for (const error of lexResult.errors) {
          errors.push({
            line: error.line || 1,
            column: error.column || 1,
            message: error.message,
            severity: 'error',
            code: 'LEXER_ERROR'
          });
        }
      }

      // Step 2: Parse
      parserInstance.reset(); // Clear any previous state
      parserInstance.input = lexResult.tokens;
      const cst = parserInstance.diagram();

      // Check for parser errors
      if (parserInstance.errors && parserInstance.errors.length > 0) {
        for (const error of parserInstance.errors) {
          const token = error.token;
          errors.push({
            line: token?.startLine || 1,
            column: token?.startColumn || 1,
            message: error.message,
            severity: 'error',
            code: 'PARSER_ERROR'
          });
        }
      }

      // Step 3: Build graph model
      const graph = this.graphBuilder.build(cst);

      // Step 4: Calculate layout
      let layout;
      try {
        layout = layoutEngine.layout(graph);
      } catch (layoutError: any) {
        // Layout failed - likely due to subgraph issues
        errors.push({
          line: 1,
          column: 1,
          message: layoutError.message || 'Layout calculation failed',
          severity: 'error',
          code: 'LAYOUT_ERROR'
        });

        // Return empty output with error
        return {
          svg: this.generateErrorSvg(layoutError.message || 'Layout calculation failed'),
          graph,
          errors
        };
      }

      // Step 5: Generate output
      let svg = renderer.render(layout);

      // Add error overlays if requested
      if (options.showErrors && errors.length > 0) {
        svg = this.addErrorOverlays(svg, errors);
      }

      return {
        svg,
        graph,
        errors
      };
    } catch (error: any) {
      // Fallback error SVG
      const errorSvg = this.generateErrorSvg(error.message || 'Unknown error occurred');

      errors.push({
        line: 1,
        column: 1,
        message: error.message || 'Unknown error occurred',
        severity: 'error',
        code: 'RENDER_ERROR'
      });

      return {
        svg: errorSvg,
        graph: { nodes: [], edges: [], direction: 'TD' },
        errors
      };
    }
  }

  /**
   * Renders supported diagram types (flowchart + pie for now)
   */
  renderAny(text: string, options: RenderOptions = {}): RenderResult {
    // Detect diagram type with optional Mermaid frontmatter
    let content = text;
    let theme: Record<string, any> | undefined;
    if (text.trimStart().startsWith('---')) {
      const fm = parseFrontmatter(text);
      if (fm) {
        content = fm.body;
        theme = fm.themeVariables || (fm.config && fm.config.themeVariables) || undefined;
      }
    }
    const firstLine = content.trim().split('\n')[0];

    if (/^(flowchart|graph)\s+/i.test(firstLine)) {
      const res = this.render(content, options);
      const svg2 = theme ? applyFlowchartTheme(res.svg, theme) : res.svg;
      return { svg: svg2, graph: res.graph, errors: res.errors };
    }
    if (/^pie\b/i.test(firstLine)) {
      // Render a pie chart via dedicated pipeline (no Dagre layout)
      try {
        const { model, errors } = buildPieModel(content);
        const svg = renderPie(model, {
          width: options.width,
          height: options.height,
          rimStroke: theme?.pieStrokeColor,
          rimStrokeWidth: theme?.pieOuterStrokeWidth,
        });
        const themedSvg = applyPieTheme(svg, theme);
        return { svg: themedSvg, graph: { nodes: [], edges: [], direction: 'TD' }, errors };
      } catch (e: any) {
        const msg = e?.message || 'Pie render error';
        const err = [{ line: 1, column: 1, message: msg, severity: 'error', code: 'PIE_RENDER' } as ValidationError];
        return { svg: this.generateErrorSvg(msg), graph: { nodes: [], edges: [], direction: 'TD' }, errors: err };
      }
    }
    if (/^sequenceDiagram\b/.test(firstLine)) {
      try {
        const model = buildSequenceModel(content);
        const svg = renderSequence(model, { theme });
        return { svg, graph: { nodes: [], edges: [], direction: 'TD' }, errors: [] };
      } catch (e: any) {
        const msg = e?.message || 'Sequence render error';
        const err = [{ line: 1, column: 1, message: msg, severity: 'error', code: 'SEQUENCE_RENDER' } as ValidationError];
        return { svg: this.generateErrorSvg(msg), graph: { nodes: [], edges: [], direction: 'TD' }, errors: err };
      }
    }
    if (/^classDiagram\b/.test(firstLine)) {
      try {
        const model = buildClassModel(content);
        const svg = renderClass(model, { theme });
        const themed = theme ? applyFlowLikeTheme(svg, theme) : svg;
        return { svg: themed, graph: { nodes: [], edges: [], direction: model.direction }, errors: [] };
      } catch (e: any) {
        const msg = e?.message || 'Class render error';
        const err = [{ line: 1, column: 1, message: msg, severity: 'error', code: 'CLASS_RENDER' } as ValidationError];
        return { svg: this.generateErrorSvg(msg), graph: { nodes: [], edges: [], direction: 'TD' }, errors: err };
      }
    }
    if (/^stateDiagram(?:-v2)?\b/.test(firstLine)) {
      try {
        const model = buildStateModel(content);
        const svg = renderState(model);
        const themed = theme ? applyFlowLikeTheme(svg, theme) : svg;
        return { svg: themed, graph: { nodes: [], edges: [], direction: model.direction }, errors: [] };
      } catch (e: any) {
        const msg = e?.message || 'State render error';
        const err = [{ line: 1, column: 1, message: msg, severity: 'error', code: 'STATE_RENDER' } as ValidationError];
        return { svg: this.generateErrorSvg(msg), graph: { nodes: [], edges: [], direction: 'TD' }, errors: err };
      }
    }

    // Unsupported diagram type
    const errorSvg = this.generateErrorSvg('Unsupported diagram type. Rendering supports flowchart, pie, sequence, class, and state.');

    return {
      svg: errorSvg,
      graph: { nodes: [], edges: [], direction: 'TD' },
      errors: [{
        line: 1,
        column: 1,
        message: 'Unsupported diagram type',
        severity: 'error',
        code: 'UNSUPPORTED_TYPE'
      }]
    };
  }

  private addErrorOverlays(svg: string, errors: ValidationError[]): string {
    // Simple error indicator - add a red border and error count
    const errorStyle = `
    <style>
      .error-indicator {
        fill: #ff0000;
        opacity: 0.8;
      }
      .error-text {
        fill: white;
        font-family: Arial, sans-serif;
        font-size: 12px;
        font-weight: bold;
      }
    </style>`;

    const errorIndicator = `
    <g id="errors">
      <rect x="5" y="5" width="100" height="25" rx="3" class="error-indicator" />
      <text x="55" y="20" text-anchor="middle" class="error-text">${errors.length} error${errors.length !== 1 ? 's' : ''}</text>
    </g>`;

    // Insert before closing </svg> tag
    return svg.replace('</svg>', `${errorStyle}${errorIndicator}</svg>`);
  }

  private generateErrorSvg(message: string): string {
    const width = 400;
    const height = 200;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#fee" stroke="#c00" stroke-width="2" />
  <text x="${width/2}" y="${height/2 - 20}" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#c00">
    Render Error
  </text>
  <text x="${width/2}" y="${height/2 + 10}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#666">
    ${this.wrapText(message, 40).map((line, i) =>
      `<tspan x="${width/2}" dy="${i === 0 ? 0 : 15}">${this.escapeXml(line)}</tspan>`
    ).join('')}
  </text>
</svg>`;
  }

  private wrapText(text: string, maxLength: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if (currentLine.length + word.length + 1 <= maxLength) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }

    if (currentLine) lines.push(currentLine);
    return lines.slice(0, 3); // Limit to 3 lines
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

// Apply basic pie theme variables to the generated SVG.
function applyPieTheme(svg: string, theme?: Record<string, any>): string {
  if (!theme) return svg;
  let out = svg;
  // Apply rim and slice outlines via CSS when provided
  if (theme.pieOuterStrokeWidth != null || theme.pieStrokeColor) {
    out = out.replace(/\.pieOuterCircle\s*\{[^}]*\}/, (m) => {
      let rule = m;
      if (theme.pieStrokeColor) rule = rule.replace(/stroke:\s*[^;]+;/, `stroke: ${String(theme.pieStrokeColor)};`);
      if (theme.pieOuterStrokeWidth != null) rule = rule.replace(/stroke-width:\s*[^;]+;/, `stroke-width: ${String(theme.pieOuterStrokeWidth)};`);
      return rule;
    });
    if (theme.pieStrokeColor) {
      out = out.replace(/\.pieCircle\s*\{[^}]*\}/, (m) => m.replace(/stroke:\s*[^;]+;/, `stroke: ${String(theme.pieStrokeColor)};`));
    }
  }
// pieSectionTextColor
  if (theme.pieSectionTextColor) {
    const c = String(theme.pieSectionTextColor);
    // Replace the default style color for labels, and also add fill on <text> nodes
    out = out.replace(/\.slice-label \{[^}]*\}/, (m) => m.replace(/fill:\s*#[0-9A-Fa-f]{3,8}|fill:\s*rgb\([^)]*\)/, `fill: ${c}`));
    out = out.replace(/<text class="slice-label"([^>]*)>/g, `<text class="slice-label"$1 fill="${c}">`);
  }
  // pieTitleTextColor
  if (theme.pieTitleTextColor) {
    const c = String(theme.pieTitleTextColor);
    out = out.replace(/<text class="pie-title"([^>]*)>/g, `<text class="pie-title"$1 fill="${c}">`);
  }
  // pieSectionTextSize
  if (theme.pieSectionTextSize) {
    const size = String(theme.pieSectionTextSize);
    out = out.replace(/<text class="slice-label"([^>]*)>/g, `<text class="slice-label"$1 font-size="${size}">`);
  }
  // pieTitleTextSize
  if (theme.pieTitleTextSize) {
    const size = String(theme.pieTitleTextSize);
    out = out.replace(/<text class="pie-title"([^>]*)>/g, `<text class="pie-title"$1 font-size="${size}">`);
  }
  // pie1..pie12 color overrides: replace fill of path slices in order
  const colors: string[] = [];
  for (let i = 1; i <= 24; i++) {
    const key = 'pie' + i;
    if (theme[key]) colors.push(String(theme[key]));
  }
  if (colors.length) {
    let idx = 0;
    out = out.replace(/<path[^>]*class="pieCircle"[^>]*\sfill="([^"]+)"/g, (_m) => {
      const color = colors[idx] ?? null;
      idx++;
      if (color) return _m.replace(/fill="([^"]+)"/, `fill="${color}"`);
      return _m;
    });
  }
  return out;
}

function applyFlowchartTheme(svg: string, theme?: Record<string, any>): string {
  if (!theme) return svg;
  let out = svg;
  // Node colors via CSS
  if (theme.nodeBkg || theme.nodeBorder) {
    out = out.replace(/\.node-shape\s*\{[^}]*\}/, (m) => {
      let rule = m;
      if (theme.nodeBkg) rule = rule.replace(/fill:\s*[^;]+;/, `fill: ${String(theme.nodeBkg)};`);
      if (theme.nodeBorder) rule = rule.replace(/stroke:\s*[^;]+;/, `stroke: ${String(theme.nodeBorder)};`);
      return rule;
    });
  }
  if (theme.nodeTextColor) {
    out = out.replace(/\.node-label\s*\{[^}]*\}/, (m) => m.replace(/fill:\s*[^;]+;/, `fill: ${String(theme.nodeTextColor)};`));
  }
  // Edge + arrow colors via CSS
  if (theme.lineColor) {
    out = out.replace(/\.edge-path\s*\{[^}]*\}/, (m) => m.replace(/stroke:\s*[^;]+;/, `stroke: ${String(theme.lineColor)};`));
  }
  if (theme.arrowheadColor) {
    out = out.replace(/(<path d="M0,0 L0,[0-9.]+ L[0-9.]+,[0-9.]+ z"[^>]*)(fill="[^"]*")/g, (_m, p1) => `${p1}fill="${String(theme.arrowheadColor)}"`);
    out = out.replace(/(<circle cx="4\.5" cy="4\.5" r="4\.5"[^>]*)(fill="[^"]*")/g, (_m, p1) => `${p1}fill="${String(theme.arrowheadColor)}"`);
  }
  // Edge label text color (optional)
  if ((theme as any).edgeLabelTextColor) {
    const c = String((theme as any).edgeLabelTextColor);
    out = out.replace(/\.edge-label-text\s*\{[^}]*\}/, (m) => m.replace(/fill:\s*[^;]+;/, `fill: ${c};`));
  }
  // Cluster styles via CSS (background and border are separate classes)
  if (theme.clusterBkg) {
    out = out.replace(/\.cluster-bg\s*\{[^}]*\}/, (m) => m.replace(/fill:\s*[^;]+;/, `fill: ${String(theme.clusterBkg)};`));
  }
  if (theme.clusterBorder) {
    out = out.replace(/\.cluster-border\s*\{[^}]*\}/, (m) => m.replace(/stroke:\s*[^;]+;/, `stroke: ${String(theme.clusterBorder)};`));
  }
  if (theme.clusterTextColor) {
    out = out.replace(/\.cluster-label-text\s*\{[^}]*\}/, (m) => m.replace(/fill:\s*[^;]+;/, `fill: ${String(theme.clusterTextColor)};`));
  }
  // Notes styling (shared CSS)
  if ((theme as any).noteBkg) out = out.replace(/\.note\s*\{[^}]*\}/, (m) => m.replace(/fill:\s*[^;]+;/, `fill: ${String((theme as any).noteBkg)};`));
  if ((theme as any).noteBorder) out = out.replace(/\.note\s*\{[^}]*\}/, (m) => m.replace(/stroke:\s*[^;]+;/, `stroke: ${String((theme as any).noteBorder)};`));
  if ((theme as any).noteTextColor) out = out.replace(/\.note-text\s*\{[^}]*\}/, (m) => m.replace(/fill:\s*[^;]+;/, `fill: ${String((theme as any).noteTextColor)};`));
  // Fonts via CSS
  if (theme.fontFamily) out = out.replace(/\.node-label\s*\{[^}]*\}/, (m) => m.replace(/font-family:\s*[^;]+;/, `font-family: ${String(theme.fontFamily)};`));
  if (theme.fontSize) out = out.replace(/\.node-label\s*\{[^}]*\}/, (m) => m.replace(/font-size:\s*[^;]+;/, `font-size: ${String(theme.fontSize)};`));
  return out;
}


// Export main render function for convenience
export function renderMermaid(text: string, options: RenderOptions = {}): RenderResult {
  const renderer = new MermaidRenderer(options.layoutEngine, options.renderer);
  return renderer.renderAny(text, options);
}

// Export interfaces and implementations for pluggability
export type { ILayoutEngine, IRenderer } from './interfaces.js';
export type { Graph, Layout, Node, Edge, LayoutNode, LayoutEdge } from './types.js';
export { DagreLayoutEngine } from './layout.js';
export { SVGRenderer } from './svg-generator.js';
export { DotRenderer } from './dot-renderer.js';
