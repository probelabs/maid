export type SharedStyleOptions = {
  fontFamily?: string;
  fontSize?: number;
  nodeFill?: string;
  nodeStroke?: string;
  edgeStroke?: string;
};

export function buildSharedCss(opts: SharedStyleOptions = {}): string {
  const fontFamily = opts.fontFamily || 'Arial, sans-serif';
  const fontSize = opts.fontSize ?? 14;
  const nodeFill = opts.nodeFill || '#eef0ff';
  const nodeStroke = opts.nodeStroke || '#3f3f3f';
  const edgeStroke = opts.edgeStroke || '#555555';

  return `
    .node-shape { fill: ${nodeFill}; stroke: ${nodeStroke}; stroke-width: 1px; }
    .node-label { fill: #333; font-family: ${fontFamily}; font-size: ${fontSize}px; }
    .edge-path { stroke: ${edgeStroke}; stroke-width: 2px; fill: none; }
    .edge-label-bg { fill: rgba(232,232,232, 0.8); opacity: 0.5; }
    .edge-label-text { fill: #333; font-family: ${fontFamily}; font-size: ${Math.max(10, fontSize - 2)}px; }
    .edge-marker { stroke: ${edgeStroke}; }
    .edge-marker-fill { fill: ${edgeStroke}; }

    /* Cluster (flowchart + sequence blocks) */
    .cluster-bg { fill: #ffffde; }
    .cluster-border { fill: none; stroke: #aaaa33; stroke-width: 1px; }
    .cluster-title-bg { fill: rgba(255,255,255,0.8); }
    .cluster-label-text { fill: #333; font-family: ${fontFamily}; font-size: 12px; }

    /* Notes */
    .note { fill: #fff5ad; stroke: #aaaa33; stroke-width: 1px; }
    .note-text { fill: #333; font-family: ${fontFamily}; font-size: 12px; }

    /* Sequence-specific add-ons (safe for flowcharts too) */
    .actor-rect { fill: #eaeaea; stroke: #666; stroke-width: 1.5px; }
    .actor-label { fill: #111; font-family: ${fontFamily}; font-size: 16px; }
    .lifeline { stroke: #999; stroke-width: 1px; }
    .activation { fill: #f4f4f4; stroke: #666; stroke-width: 1px; }
    .msg-line { stroke: #333; stroke-width: 1.5px; fill: none; }
    .msg-line.dotted { stroke-dasharray: 2 2; }
    .msg-line.thick { stroke-width: 3px; }
    .openhead { fill: none; stroke: #333; stroke-width: 1.5px; }
    .crosshead path { stroke: #333; stroke-width: 1.5px; }
    .msg-label { fill: #333; font-family: ${fontFamily}; font-size: 12px; dominant-baseline: middle; }
    .msg-label-bg { fill: #ffffff; stroke: #cccccc; stroke-width: 1px; rx: 3; }

    /* State overlays */
    .lane-divider { stroke: #aaaaaa; stroke-width: 1px; stroke-dasharray: 4 3; }
    .end-double { stroke: #3f3f3f; stroke-width: 1px; fill: none; }
  `;
}

// Apply node/edge/cluster theme variables similarly across flow-like diagrams (flowchart, class)
export function applyFlowLikeTheme(svg: string, theme?: Record<string, any>): string {
  if (!theme) return svg;
  let out = svg;
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
    out = out.replace(/\.edge-label-text\s*\{[^}]*\}/, (m) => m.replace(/fill:\s*[^;]+;/, `fill: ${String(theme.nodeTextColor)};`));
  }
  if ((theme as any).edgeLabelTextColor) {
    const c = String((theme as any).edgeLabelTextColor);
    out = out.replace(/\.edge-label-text\s*\{[^}]*\}/, (m) => m.replace(/fill:\s*[^;]+;/, `fill: ${c};`));
  }
  if (theme.lineColor) {
    out = out.replace(/\.edge-path\s*\{[^}]*\}/, (m) => m.replace(/stroke:\s*[^;]+;/, `stroke: ${String(theme.lineColor)};`));
  }
  if (theme.arrowheadColor) {
    // Class/state markers via CSS classes
    out = out.replace(/\.edge-marker\s*\{[^}]*\}/, (m) => m.replace(/stroke:\s*[^;]+;/, `stroke: ${String(theme.arrowheadColor)};`));
    out = out.replace(/\.edge-marker-fill\s*\{[^}]*\}/, (m) => m.includes('fill:') ? m.replace(/fill:\s*[^;]+;/, `fill: ${String(theme.arrowheadColor)};`) : m.replace(/\}/, ` fill: ${String(theme.arrowheadColor)}; }`));
    // Sequence heads via classes
    out = out.replace(/\.openhead\s*\{[^}]*\}/, (m) => m.replace(/stroke:\s*[^;]+;/, `stroke: ${String(theme.arrowheadColor)};`));
    out = out.replace(/\.crosshead path\s*\{[^}]*\}/, (m) => m.replace(/stroke:\s*[^;]+;/, `stroke: ${String(theme.arrowheadColor)};`));
  }
  if (theme.clusterBkg) out = out.replace(/\.cluster-bg\s*\{[^}]*\}/, (m) => m.replace(/fill:\s*[^;]+;/, `fill: ${String(theme.clusterBkg)};`));
  if (theme.clusterBorder) out = out.replace(/\.cluster-border\s*\{[^}]*\}/, (m) => m.replace(/stroke:\s*[^;]+;/, `stroke: ${String(theme.clusterBorder)};`));
  if (theme.clusterTextColor) out = out.replace(/\.cluster-label-text\s*\{[^}]*\}/, (m) => m.replace(/fill:\s*[^;]+;/, `fill: ${String(theme.clusterTextColor)};`));
  if ((theme as any).clusterTitleBg || (theme as any).clusterTitleBackground) {
    const c = String((theme as any).clusterTitleBg || (theme as any).clusterTitleBackground);
    out = out.replace(/\.cluster-title-bg\s*\{[^}]*\}/, (m) => m.replace(/fill:\s*[^;]+;/, `fill: ${c};`));
  }
  if (theme.fontFamily) {
    const f = String(theme.fontFamily);
    out = out.replace(/\.node-label\s*\{[^}]*\}/, (m) => m.replace(/font-family:\s*[^;]+;/, `font-family: ${f};`));
    out = out.replace(/\.edge-label-text\s*\{[^}]*\}/, (m) => m.replace(/font-family:\s*[^;]+;/, `font-family: ${f};`));
    out = out.replace(/\.note-text\s*\{[^}]*\}/, (m) => m.replace(/font-family:\s*[^;]+;/, `font-family: ${f};`));
  }
  if (theme.fontSize) {
    const s = String(theme.fontSize);
    out = out.replace(/\.node-label\s*\{[^}]*\}/, (m) => m.replace(/font-size:\s*[^;]+;/, `font-size: ${s}px;`));
    // Keep edge/note slightly smaller than node labels
    const sub = Math.max(10, Number(theme.fontSize) - 2);
    out = out.replace(/\.edge-label-text\s*\{[^}]*\}/, (m) => m.replace(/font-size:\s*[^;]+;/, `font-size: ${sub}px;`));
    out = out.replace(/\.note-text\s*\{[^}]*\}/, (m) => m.replace(/font-size:\s*[^;]+;/, `font-size: ${sub}px;`));
  }
  return out;
}
