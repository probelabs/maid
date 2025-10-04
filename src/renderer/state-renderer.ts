import type { StateModel } from './state-types.js';
import type { Graph, Node, Edge, Subgraph } from './types.js';
import { DagreLayoutEngine } from './layout.js';
import { SVGRenderer } from './svg-generator.js';
import { buildSharedCss } from './styles.js';

function toGraph(model: StateModel): { graph: Graph; laneGroups: Array<{ parentId: string; id: string; nodes: string[] }> } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const subgraphs: Subgraph[] = [];

  for (const s of model.nodes) {
    let shape: Node['shape'] = 'rectangle';
    let label = s.label || s.id;
    if (s.kind === 'start') { shape = 'circle'; label = ''; }
    else if (s.kind === 'end') { shape = 'circle'; label = ''; }
    else if (s.kind === 'history') { shape = 'circle'; label = 'H'; }
    else if (s.kind === 'history-deep') { shape = 'circle'; label = 'H*'; }
    else if (s.kind === 'choice') { shape = 'diamond'; }
    else if (s.kind === 'fork' || s.kind === 'join') { shape = 'rectangle'; }
    const node: Node = { id: s.id, label, shape };
    if (s.kind === 'fork' || s.kind === 'join') { (node as any).width = 80; (node as any).height = 8; }
    nodes.push(node);
  }

  for (const t of model.transitions) {
    edges.push({ id: `${t.source}->${t.target}-${Math.random().toString(36).slice(2,7)}`, source: t.source, target: t.target, label: t.label, type: 'arrow', markerEnd: 'arrow' });
  }

  // Include all composites (including lane subgraphs) so Dagre can separate them spatially.
  for (const c of model.composites) {
    subgraphs.push({ id: c.id, label: c.label, nodes: c.nodes, parent: c.parent });
  }
  const laneGroups = (model.lanes || []).slice();
  return { graph: { nodes, edges, subgraphs, direction: model.direction } as Graph, laneGroups };
}

export function renderState(model: StateModel): string {
  const { graph, laneGroups } = toGraph(model);
  const layout = new DagreLayoutEngine().layout(graph);
  let svg = new SVGRenderer().render(layout);
  // Build overlays: lane dividers + end double circles
  const byId: Record<string, { x:number;y:number;width:number;height:number }> = Object.fromEntries(layout.nodes.map(n => [n.id, { x:n.x, y:n.y, width:n.width, height:n.height }]));
  const subById: Record<string, { x:number;y:number;width:number;height:number;label?:string }> = Object.fromEntries(((layout as any).subgraphs || []).map((s:any)=>[s.id,{x:s.x,y:s.y,width:s.width,height:s.height,label:s.label}]));
  const overlays: string[] = [];
  // Draw lane dividers between adjacent lanes per parent (midpoint between lane bounds)
  const groupByParent: Record<string, Array<{ id:string; nodes: Array<{x:number;y:number;width:number;height:number}> }>> = {};
  for (const lg of laneGroups) {
    const parent = subById[lg.parentId]; if (!parent) continue;
    const members = lg.nodes.map(id => byId[id]).filter(Boolean); if (!members.length) continue;
    (groupByParent[lg.parentId] ||= []).push({ id: lg.id, nodes: members });
  }
  const laneIndex = (id: string) => { const m = /(.*)__lane(\d+)/.exec(id); return m ? parseInt(m[2],10) : Number.POSITIVE_INFINITY; };
  for (const pid of Object.keys(groupByParent)) {
    const parent = subById[pid]; if (!parent) continue;
    const lanes = groupByParent[pid].slice();
    if (lanes.every(l => /__lane\d+/.test(l.id))) lanes.sort((a,b)=>laneIndex(a.id)-laneIndex(b.id));
    else if (graph.direction === 'LR' || graph.direction === 'RL') lanes.sort((a,b)=>Math.min(...a.nodes.map(n=>n.x)) - Math.min(...b.nodes.map(n=>n.x)));
    else lanes.sort((a,b)=>Math.min(...a.nodes.map(n=>n.y)) - Math.min(...b.nodes.map(n=>n.y)));
    for (let i=1;i<lanes.length;i++){
      const prev = lanes[i-1]; const next = lanes[i];
      if (graph.direction === 'LR' || graph.direction === 'RL') {
        const prevMaxX = Math.max(...prev.nodes.map(n => n.x + n.width));
        const nextMinX = Math.min(...next.nodes.map(n => n.x));
        const x = Math.max(parent.x, Math.min(parent.x + parent.width, (prevMaxX + nextMinX) / 2));
        overlays.push(`<line class="lane-divider" x1="${x}" y1="${parent.y}" x2="${x}" y2="${parent.y + parent.height}" />`);
      } else {
        const prevMaxY = Math.max(...prev.nodes.map(n => n.y + n.height));
        const nextMinY = Math.min(...next.nodes.map(n => n.y));
        const y = Math.max(parent.y, Math.min(parent.y + parent.height, (prevMaxY + nextMinY) / 2));
        overlays.push(`<line class="lane-divider" x1="${parent.x}" y1="${y}" x2="${parent.x + parent.width}" y2="${y}" />`);
      }
    }
  }
  for (const n of layout.nodes) {
    // End nodes only
    const src = (model.nodes || []).find(nn => nn.id === n.id);
    if (!src || src.kind !== 'end') continue;
    const cx = n.x + n.width/2; const cy = n.y + n.height/2;
    const r = Math.max(1, Math.min(n.width, n.height)/2 - 3);
    overlays.push(`<circle class="end-double" cx="${cx}" cy="${cy}" r="${r}" fill="none" />`);
  }
  if (overlays.length) {
    svg = svg.replace('</svg>', `<g class="state-overlays">${overlays.join('\n')}</g></svg>`);
  }
  // Ensure shared CSS present
  if (!/<style>/.test(svg)) {
    const css = buildSharedCss();
    svg = svg.replace('<svg ', `<svg `).replace('</svg>', `<style>${css}</style></svg>`);
  }
  return svg;
}
