import type { SequenceModel } from './sequence-types.js';
import type { SequenceLayout, LayoutParticipant, LayoutMessage, LayoutNote, LayoutBlock, LayoutActivation } from './sequence-layout.js';
import { layoutSequence } from './sequence-layout.js';
import { escapeXml, measureText } from './utils.js';
import { triangleAtEnd, triangleAtStart } from './arrow-utils.js';
import { blockBackground, blockOverlay } from './block-utils.js';
import { buildSharedCss, applyFlowLikeTheme } from './styles.js';

export interface SequenceRenderOptions {
  width?: number; // not used, layout is intrinsic
  height?: number;
  theme?: Record<string, any>;
}

export function renderSequence(model: SequenceModel, opts: SequenceRenderOptions = {}): string {
  const layout = layoutSequence(model);
  const svgParts: string[] = [];
  const width = Math.ceil(layout.width);
  const height = Math.ceil(layout.height);

  svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width+50}" height="${height+40}" viewBox="-50 -10 ${width+50} ${height+40}">`);
  const sharedCss = buildSharedCss({
    fontFamily: 'Arial, sans-serif',
    fontSize: 14,
    nodeFill: '#eef0ff',
    nodeStroke: '#3f3f3f',
    edgeStroke: '#555555',
  });
  svgParts.push(`  <style>${sharedCss}</style>`);

  // Accessible <title>/<desc> and visible title
  const accTitle = model.accTitle || model.title || undefined;
  const accDesc = model.accDescr || undefined;
  if (accTitle) svgParts.push(`  <title>${escapeXml(accTitle)}</title>`);
  if (accDesc) svgParts.push(`  <desc>${escapeXml(accDesc)}</desc>`);
  if (model.title) {
    const t = escapeXml(model.title);
    const tW = Math.max(20, measureText(model.title, 16));
    const xMid = width / 2;
    // place near top, above participant boxes
    svgParts.push(`  <text class="node-label" x="${xMid}" y="0" text-anchor="middle" font-size="16">${t}</text>`);
  }

  // Participants
  for (const p of layout.participants) drawParticipant(svgParts, p);
  // Block backgrounds behind content
  for (const b of layout.blocks) svgParts.push(blockBackground(b.x, b.y, b.width, b.height, 0));
  // Lifelines
  for (const l of layout.lifelines) svgParts.push(`  <line class="lifeline" x1="${l.x}" y1="${l.y1}" x2="${l.x}" y2="${l.y2}"/>`);
  // Activations
  for (const a of layout.activations) svgParts.push(`  <rect class="activation" x="${a.x}" y="${a.y}" width="${a.width}" height="${a.height}" />`);

  // Messages (autonumbering applied to labels)
  let counter = model.autonumber?.on ? (model.autonumber.start ?? 1) : undefined;
  const step = model.autonumber?.on ? (model.autonumber.step ?? 1) : undefined;
  for (const m of layout.messages) {
    drawMessage(svgParts, m);
    const label = formatMessageLabel(m.text, counter);
    if (label) drawMessageLabel(svgParts, m, label, counter);
    if (counter != null) counter += step!;
  }

  // Notes
  for (const n of layout.notes) drawNote(svgParts, n);
  // Block borders/titles on top
  for (const b of layout.blocks) {
    const title = b.title ? `${b.type}: ${b.title}` : b.type;
    const branches = (b.branches || []).map(br => ({ y: br.y, title: br.title }));
    // Left-align title/branch labels to mirror Mermaid's sequence blocks
    svgParts.push(blockOverlay(b.x, b.y, b.width, b.height, title, branches.map(br => ({...br, y: br.y + 0.5})), 8, 'left', 'left', 0));
  }

  // Bottom actor boxes (Mermaid draws both top and bottom)
  for (const p of layout.participants) drawParticipantBottom(svgParts, p, layout);

  svgParts.push('</svg>');
  let svg = svgParts.join('\n');
  // Apply baseline flow-like theme, then sequence-specific overrides
  if (opts.theme) svg = applySequenceTheme(applyFlowLikeTheme(svg, opts.theme), opts.theme);
  return svg;
}

function drawParticipant(out: string[], p: LayoutParticipant) {
  out.push(`  <g class="actor" transform="translate(${p.x},${p.y})">`);
  out.push(`    <rect class="node-shape" width="${p.width}" height="${p.height}" rx="0"/>`);
  out.push(`    <text class="node-label" x="${p.width / 2}" y="${p.height / 2}" text-anchor="middle" dominant-baseline="middle">${escapeXml(p.display)}</text>`);
  out.push('  </g>');
}

function drawParticipantBottom(out: string[], p: LayoutParticipant, layout: SequenceLayout) {
  // bottom actor box aligned with lifeline end (y2)
  const lifeline = layout.lifelines.find(l => Math.abs(l.x - (p.x + p.width / 2)) < 0.001);
  const y = lifeline ? lifeline.y2 : (layout.height - 28);
  out.push(`  <g class="actor" transform="translate(${p.x},${y})">`);
  out.push(`    <rect class="node-shape" width="${p.width}" height="${p.height}" rx="0"/>`);
  out.push(`    <text class="node-label" x="${p.width / 2}" y="${p.height / 2}" text-anchor="middle" dominant-baseline="middle">${escapeXml(p.display)}</text>`);
  out.push('  </g>');
}


function drawMessage(out: string[], m: LayoutMessage) {
  const cls = `msg-line ${m.line}`.trim();
  const x1 = m.x1, x2 = m.x2, y = m.y;
  out.push(`  <path class="${cls}" d="M ${x1} ${y} L ${x2} ${y}" />`);
  // Markers: start/end
  const start = { x: x1, y } as const; const end = { x: x2, y } as const;
  // Slightly larger overlay triangles for sequence arrows
  if (m.endMarker === 'arrow') out.push('  ' + triangleAtEnd(start, end, undefined as any, 9, 7));
  if (m.startMarker === 'arrow') out.push('  ' + triangleAtStart(start, end, undefined as any, 9, 7));
  if (m.endMarker === 'open') out.push(`  <circle class="openhead" cx="${x2}" cy="${y}" r="4" />`);
  if (m.startMarker === 'open') out.push(`  <circle class="openhead" cx="${x1}" cy="${y}" r="4" />`);
  if (m.endMarker === 'cross') out.push(`  <g class="crosshead" transform="translate(${x2},${y})"><path d="M -4 -4 L 4 4"/><path d="M -4 4 L 4 -4"/></g>`);
  if (m.startMarker === 'cross') out.push(`  <g class="crosshead" transform="translate(${x1},${y})"><path d="M -4 -4 L 4 4"/><path d="M -4 4 L 4 -4"/></g>`);
}

// drawMarker no longer used; arrowheads rendered via triangleAtEnd/triangleAtStart helpers

function formatMessageLabel(text?: string, counter?: number): string | undefined {
  if (!text && counter == null) return undefined;
  if (counter != null && text) return `${counter}: ${text}`;
  if (counter != null) return String(counter);
  return text;
}

function drawMessageLabel(out: string[], m: LayoutMessage, label: string, _counter?: number) {
  const xMid = (m.x1 + m.x2) / 2;
  const h = 16;
  const w = Math.max(20, measureText(label, 12) + 10);
  const x = xMid - w / 2;
  const y = m.y - 14 - h / 2; // a bit more above the line
  out.push(`  <rect class=\"msg-label-bg\" x=\"${x}\" y=\"${y}\" width=\"${w}\" height=\"${h}\" rx=\"3\"/>`);
  out.push(`  <text class=\"msg-label\" x=\"${xMid}\" y=\"${y + h/2}\" text-anchor=\"middle\">${escapeXml(label)}</text>`);
}


function drawNote(out: string[], n: LayoutNote) {
  out.push(`  <g class="note" transform="translate(${n.x},${n.y})">`);
  out.push(`    <rect width="${n.width}" height="${n.height}" rx="0"/>`);
  out.push(`    <text class="note-text" x="${n.width / 2}" y="${n.height / 2 + 4}" text-anchor="middle">${escapeXml(n.text)}</text>`);
  out.push('  </g>');
}

function drawBlock(out: string[], b: LayoutBlock) {
  out.push(`  <g class="group" transform="translate(${b.x},${b.y})">`);
  out.push(`    <rect class="group-frame" width="${b.width}" height="${b.height}"/>`);
  const titleText = b.title ? `${b.type}: ${b.title}` : b.type;
  const titleW = Math.max(24, measureText(titleText, 12) + 10);
  out.push(`    <rect class="group-title-bg" x="6" y="-2" width="${titleW}" height="18" rx="0"/>`);
  out.push(`    <text class="group-title" x="${6 + titleW/2}" y="11" text-anchor="middle">${escapeXml(titleText)}</text>`);
  if (b.branches && b.branches.length) {
    for (const br of b.branches) {
      const yRel = br.y - b.y;
      out.push(`    <line x1="0" y1="${yRel}" x2="${b.width}" y2="${yRel}" class="group-frame" />`);
      if (br.title) {
        const bw = Math.max(24, measureText(br.title, 12) + 10);
        out.push(`    <rect class="group-title-bg" x="6" y="${yRel - 10}" width="${bw}" height="18" rx="0"/>`);
        out.push(`    <text class="group-title" x="${6 + bw/2}" y="${yRel + 1}" text-anchor="middle">${escapeXml(br.title)}</text>`);
      }
    }
  }
  out.push('  </g>');
}

function applySequenceTheme(svg: string, theme: Record<string, any>): string {
  let out = svg;
  // Participant colors piggyback on .node-shape/.node-label via applyFlowLikeTheme;
  // lifeline color
  if (theme.lifelineColor) out = out.replace(/\.lifeline\s*\{[^}]*\}/, (m) => m.replace(/stroke:\s*[^;]+;/, `stroke: ${String(theme.lifelineColor)};`));
  // message line + arrowhead
  if (theme.lineColor) out = out.replace(/\.msg-line\s*\{[^}]*\}/, (m) => m.replace(/stroke:\s*[^;]+;/, `stroke: ${String(theme.lineColor)};`));
  if (theme.arrowheadColor) {
    // Replace inline triangle fills (overlay arrowheads)
    out = out.replace(/(<path d=\"M[0-9.,\s-]+Z\" fill=\")[^\"]+(\")/g, (_m, p1, p2) => `${p1}${String(theme.arrowheadColor)}${p2}`);
    out = out.replace(/\.openhead\s*\{[^}]*\}/, (m) => m.replace(/stroke:\s*[^;]+;/, `stroke: ${String(theme.arrowheadColor)};`));
    out = out.replace(/\.crosshead\s*\{[^}]*\}/, (m) => m.replace(/stroke:\s*[^;]+;/, `stroke: ${String(theme.arrowheadColor)};`));
  }
  // notes
  if (theme.noteBkg) out = out.replace(/\.note\s*\{[^}]*\}/, (m) => m.replace(/fill:\s*[^;]+;/, `fill: ${String(theme.noteBkg)};`));
  if (theme.noteBorder) out = out.replace(/\.note\s*\{[^}]*\}/, (m) => m.replace(/stroke:\s*[^;]+;/, `stroke: ${String(theme.noteBorder)};`));
  if (theme.noteTextColor) out = out.replace(/\.note-text\s*\{[^}]*\}/, (m) => m.replace(/fill:\s*[^;]+;/, `fill: ${String(theme.noteTextColor)};`));
  // activation
  if (theme.activationBkg) out = out.replace(/\.activation\s*\{[^}]*\}/, (m) => m.replace(/fill:\s*[^;]+;/, `fill: ${String(theme.activationBkg)};`));
  if (theme.activationBorder) out = out.replace(/\.activation\s*\{[^}]*\}/, (m) => m.replace(/stroke:\s*[^;]+;/, `stroke: ${String(theme.activationBorder)};`));
  return out;
}
