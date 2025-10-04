import dagre from 'dagre';
import type { Graph, Layout, LayoutNode, LayoutEdge, Direction, LayoutSubgraph, NodeShape } from './types.js';
import type { ILayoutEngine } from './interfaces.js';

/**
 * Calculates node and edge positions using dagre layout algorithm
 */
export class DagreLayoutEngine implements ILayoutEngine {
  private nodeWidth = 120;
  private nodeHeight = 50;
  private rankSep = 50;     // Base vertical spacing
  private nodeSep = 50;     // Base horizontal spacing
  private edgeSep = 10;     // Spacing between edges

  layout(graph: Graph): Layout {
    // Create dagre graph
    const g = new dagre.graphlib.Graph();

    // Configure graph - set compound if there are subgraphs
    // Increase spacing when clusters are present to better match Mermaid visuals
    const hasClusters = !!(graph.subgraphs && graph.subgraphs.length > 0);
    const dir = this.mapDirection(graph.direction);
    let ranksep = this.rankSep;
    let nodesep = this.nodeSep;
    if (hasClusters) {
      if (dir === 'LR' || dir === 'RL') {
        // LR layouts: widen horizontally, keep vertical tighter
        ranksep += 20;
        nodesep += 70;
      } else {
        // TD/BT layouts: more vertical room, modest horizontal
        ranksep += 70;
        nodesep += 20;
      }
    }
    const graphConfig: any = {
      rankdir: dir,
      ranksep,
      nodesep,
      edgesep: this.edgeSep,
      marginx: 20,
      marginy: 20
    };
    // With clusters + horizontal layouts, encourage wider graphs and fewer vertical ranks.
    if (hasClusters && (dir === 'LR' || dir === 'RL')) {
      // Favor wider, flatter layouts for horizontal directions
      graphConfig.ranker = 'network-simplex';
      graphConfig.acyclicer = 'greedy';
      nodesep += 40; // more horizontal separation
      ranksep = Math.max(30, ranksep - 20); // slightly tighter vertical ranks
    }

    // Enable compound mode if there are subgraphs
    if (hasClusters) {
      graphConfig.compound = true;
    }

    g.setGraph(graphConfig);

    // Default edge label (needed for dagre)
    g.setDefaultEdgeLabel(() => ({}));

    // Add subgraphs FIRST (before nodes and edges) so Dagre knows they exist
    if (graph.subgraphs && graph.subgraphs.length > 0) {
      // Register subgraphs as clusters for layout grouping
      for (const subgraph of graph.subgraphs) {
        g.setNode(subgraph.id, { label: subgraph.label || subgraph.id, clusterLabelPos: 'top' });
      }
    }

    // Add nodes
    for (const node of graph.nodes) {
      // Respect explicit width/height when provided by the caller (e.g., class/state renderers)
      const providedW = (node as any).width as number | undefined;
      const providedH = (node as any).height as number | undefined;
      const dimensions = (providedW && providedH)
        ? { width: providedW, height: providedH }
        : this.calculateNodeDimensions(node.label, node.shape);
      g.setNode(node.id, {
        width: dimensions.width,
        height: dimensions.height,
        label: node.label,
        shape: node.shape
      });
    }

    // Set parent relationships for nodes in subgraphs
    if (graph.subgraphs && graph.subgraphs.length > 0) {
      for (const subgraph of graph.subgraphs) {
        for (const nodeId of subgraph.nodes) {
          if (g.hasNode(nodeId)) {
            try { g.setParent(nodeId, subgraph.id); } catch {}
          }
        }
        if (subgraph.parent && g.hasNode(subgraph.parent)) {
          try { g.setParent(subgraph.id, subgraph.parent); } catch {}
        }
      }
    }

    // Add edges AFTER subgraphs and nodes are registered
    for (const edge of graph.edges) {
      g.setEdge(edge.source, edge.target, {
        label: edge.label,
        width: edge.label ? edge.label.length * 8 : 0,
        height: edge.label ? 20 : 0
      });
    }

    // Run layout
    dagre.layout(g);

    // Extract layout information
    const graphInfo = g.graph();
    const layoutNodes: LayoutNode[] = [];
    const layoutEdges: LayoutEdge[] = [];

    // Process nodes
    for (const node of graph.nodes) {
      const nodeLayout = g.node(node.id);
      if (nodeLayout) {
        layoutNodes.push({
          ...node,
          x: nodeLayout.x - nodeLayout.width / 2,
          y: nodeLayout.y - nodeLayout.height / 2,
          width: nodeLayout.width,
          height: nodeLayout.height
        });
      }
    }

    // Process subgraphs (clusters) first so we can use their anchors for edges
    const layoutSubgraphs: LayoutSubgraph[] = [];
    if (graph.subgraphs && graph.subgraphs.length > 0) {
      for (const sg of graph.subgraphs) {
        // Compute bounds from member nodes (includes nested members due to builder stacking)
        const members = layoutNodes.filter(nd => sg.nodes.includes(nd.id));
        if (members.length) {
          const minX = Math.min(...members.map(m => m.x));
          const minY = Math.min(...members.map(m => m.y));
          const maxX = Math.max(...members.map(m => m.x + m.width));
          const maxY = Math.max(...members.map(m => m.y + m.height));
          const pad = 30; // slightly roomier cluster padding to match Mermaid
          layoutSubgraphs.push({
            id: sg.id,
            label: sg.label || sg.id,
            x: minX - pad,
            y: minY - pad - 18, // space for title
            width: (maxX - minX) + pad * 2,
            height: (maxY - minY) + pad * 2 + 18,
            parent: sg.parent
          });
        }
      }

      // Expand parent bounds to also contain child subgraphs
      const byId: Record<string, LayoutSubgraph> = Object.fromEntries(layoutSubgraphs.map(s => [s.id, s]));
      for (const sg of layoutSubgraphs) {
        if (!sg.parent) continue;
        const p = byId[sg.parent];
        if (!p) continue;
        const minX = Math.min(p.x, sg.x);
        const minY = Math.min(p.y, sg.y);
        const maxX = Math.max(p.x + p.width, sg.x + sg.width);
        const maxY = Math.max(p.y + p.height, sg.y + sg.height);
        p.x = minX; p.y = minY; p.width = maxX - minX; p.height = maxY - minY;
      }
    }

    // Process edges (after subgraphs are available)
    const subgraphById: Record<string, LayoutSubgraph> = Object.fromEntries(layoutSubgraphs.map(sg => [sg.id, sg]));
    for (const edge of graph.edges) {
      const edgeLayout = g.edge(edge.source, edge.target);
      let pts = edgeLayout && Array.isArray(edgeLayout.points) ? edgeLayout.points.slice() : [];
      const hasNaN = pts.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y));
      const srcSg = subgraphById[edge.source];
      const dstSg = subgraphById[edge.target];
      // Build orthogonal two‑elbow route when any endpoint is a cluster or dagre points are invalid/missing
      let synthesized = false;
      if (!pts.length || hasNaN || srcSg || dstSg) {
        const rankdir = this.mapDirection(graph.direction);
        const getNode = (id: string): LayoutNode | undefined => {
          const n = g.node(id);
          if (!n) return undefined;
          return {
            id,
            label: n.label || id,
            shape: (n.shape || 'rectangle') as NodeShape,
            x: n.x - n.width / 2,
            y: n.y - n.height / 2,
            width: n.width,
            height: n.height,
            style: {}
          };
        };
        const start = srcSg ? this.clusterAnchor(srcSg, rankdir, 'out') : this.nodeAnchor(getNode(edge.source), rankdir, 'out');
        const end = dstSg ? this.clusterAnchor(dstSg, rankdir, 'in') : this.nodeAnchor(getNode(edge.target), rankdir, 'in');
        if (start && end) {
          const PAD = 20;
          // Detect if subgraphs are horizontally adjacent (both are subgraphs + more horizontal than vertical separation)
          const horizontallyAdjacent = srcSg && dstSg && Math.abs(srcSg.x - dstSg.x) > Math.abs(srcSg.y - dstSg.y);
          const horizontalSubgraphs = horizontallyAdjacent;
          if (rankdir === 'LR' || rankdir === 'RL') {
            // Step out to the right from source clusters, and step in from left to target clusters
            const outX = start.x + (rankdir === 'LR' ? PAD : -PAD);
            const inX = end.x + (rankdir === 'LR' ? -PAD : PAD);
            const startOut = { x: srcSg ? outX : start.x, y: start.y };
            const endPre = { x: dstSg ? inX : end.x, y: end.y };
            const alpha = 0.72; // bias elbows slightly closer to target for smoother end approach
            const midX = startOut.x + (endPre.x - startOut.x) * alpha;
            const m1 = { x: midX, y: startOut.y };
            const m2 = { x: midX, y: endPre.y };
            // Only include final 'end' point if it's not a subgraph target (arrows should stop at border)
            pts = dstSg ? [start, startOut, m1, m2, endPre] : [start, startOut, m1, m2, endPre, end];
          } else {
            // TD/BT: step below/above clusters by PAD
            // For horizontally-adjacent subgraphs, use simple horizontal line
            if (horizontalSubgraphs && srcSg && dstSg) {
              // Simple horizontal line at vertical center between subgraphs
              const midY = (srcSg.y + srcSg.height / 2 + dstSg.y + dstSg.height / 2) / 2;

              // Create horizontal line from source border to target border
              if (srcSg.x < dstSg.x) {
                // Source on left, target on right (normal left-to-right flow)
                const startX = srcSg.x + srcSg.width;
                const endX = dstSg.x;
                pts = [{ x: startX, y: midY }, { x: endX, y: midY }];
              } else {
                // Source on right, target on left (right-to-left flow)
                const startX = srcSg.x;
                const endX = dstSg.x + dstSg.width;
                pts = [{ x: startX, y: midY }, { x: endX, y: midY }];
              }
            } else {
              // Normal vertical routing
              const outY = start.y + (rankdir === 'TD' ? PAD : -PAD);
              const inY = end.y + (rankdir === 'TD' ? -PAD : PAD);
              const startOut = { x: start.x, y: srcSg ? outY : start.y };
              const endPre = { x: end.x, y: dstSg ? inY : end.y };
              const alpha = 0.68;
              const midY = startOut.y + (endPre.y - startOut.y) * alpha;
              const m1 = { x: startOut.x, y: midY };
              const m2 = { x: endPre.x, y: midY };
              // Only include final 'end' point if it's not a subgraph target (arrows should stop at border)
              pts = dstSg ? [start, startOut, m1, m2, endPre] : [start, startOut, m1, m2, endPre, end];
            }
          }
          synthesized = true;
        }
      }
      if (pts.length) {
        layoutEdges.push({ ...edge, points: pts, pathMode: synthesized ? 'orthogonal' : 'smooth' });
      }
    }

    const rawW: number | undefined = (graphInfo as any).width;
    const rawH: number | undefined = (graphInfo as any).height;
    const w: number = Number.isFinite(rawW as number) && (rawW as number) > 0 ? (rawW as number) : 800;
    const h: number = Number.isFinite(rawH as number) && (rawH as number) > 0 ? (rawH as number) : 600;
    // Keep dagre's computed routing for all edges, including cluster edges.

    return {
      nodes: layoutNodes,
      edges: layoutEdges,
      width: w,
      height: h,
      subgraphs: layoutSubgraphs
    };
  }

  private mapDirection(direction: Direction): string {
    switch (direction) {
      case 'TB':
      case 'TD':
        return 'TB';
      case 'BT':
        return 'BT';
      case 'LR':
        return 'LR';
      case 'RL':
        return 'RL';
      default:
        return 'TB';
    }
  }

  private calculateNodeDimensions(label: string, shape: string): { width: number; height: number } {
    // Base dimensions on label length with wrapping – tuned to resemble Mermaid
    const charWidth = 7;     // tighter text measure
    const padding = 20;
    const minWidth = 80;
    const minHeight = 40;
    const maxWidth = 240;    // allow a bit wider boxes
    const lineHeight = 18;   // a bit more vertical space for readability

    // Handle explicit line breaks with <br/> or <br> (with optional spaces around tag and slash)
    const explicitLines = label.split(/<\s*br\s*\/?\s*>/i);
    const hasExplicitBreaks = explicitLines.length > 1;

    let width: number;
    let lines: number;

    if (hasExplicitBreaks) {
      // Calculate width based on the longest line
      const maxLineLength = Math.max(...explicitLines.map(line => line.length));
      width = Math.min(
        Math.max(maxLineLength * charWidth + padding * 2, minWidth),
        maxWidth
      );
      lines = explicitLines.length;
    } else {
      // Calculate width (capped at maxWidth)
      width = Math.min(
        Math.max(label.length * charWidth + padding * 2, minWidth),
        maxWidth
      );
      // Calculate number of lines needed for wrapping
      const charsPerLine = Math.max(1, Math.floor((width - padding * 2) / charWidth));
      lines = Math.ceil(label.length / charsPerLine);
    }

    // Calculate height based on lines
    let height = Math.max(lines * lineHeight + padding, minHeight);

    // Adjust based on shape
    switch (shape) {
      case 'circle':
        // Make it square for circles
        const size = Math.max(width, height);
        width = size;
        height = size;
        break;

      case 'diamond': {
        // Render as a perfect rhombus (equal width/height)
        const size = Math.max(width, height) * 1.2; // slight padding for readability
        width = size;
        height = size;
        break;
      }

      case 'hexagon':
        // Needs extra width/height for corners
        width *= 1.3;
        height *= 1.2;
        break;

      case 'stadium':
        // Stadium needs to be wider
        width *= 1.2;
        break;

      case 'cylinder':
        // Cylinder needs more height for the curved caps; give extra room for label
        height *= 1.5;
        break;

      case 'subroutine':
      case 'double':
        // These need extra space for borders
        width += 10;
        height += 10;
        break;

      case 'parallelogram':
      case 'trapezoid':
        // These need extra width for the slanted sides
        width *= 1.3;
        break;
    }

    return { width: Math.round(width), height: Math.round(height) };
  }

  private clusterAnchor(sg: LayoutSubgraph, rankdir: string, mode: 'in'|'out') {
    switch (rankdir) {
      case 'LR': return { x: mode === 'out' ? sg.x + sg.width : sg.x, y: sg.y + sg.height / 2 };
      case 'RL': return { x: mode === 'out' ? sg.x : sg.x + sg.width, y: sg.y + sg.height / 2 };
      case 'BT': return { x: sg.x + sg.width / 2, y: mode === 'out' ? sg.y : sg.y + sg.height };
      case 'TB':
      default:   return { x: sg.x + sg.width / 2, y: mode === 'out' ? sg.y + sg.height : sg.y };
    }
  }

  private nodeAnchor(n: LayoutNode | undefined, rankdir: string, mode: 'in'|'out') {
    if (!n) return { x: 0, y: 0 };
    switch (rankdir) {
      case 'LR': return { x: mode === 'in' ? n.x : n.x + n.width, y: n.y + n.height / 2 };
      case 'RL': return { x: mode === 'in' ? n.x + n.width : n.x, y: n.y + n.height / 2 };
      case 'BT': return { x: n.x + n.width / 2, y: mode === 'in' ? n.y + n.height : n.y };
      case 'TB':
      default:   return { x: n.x + n.width / 2, y: mode === 'in' ? n.y : n.y + n.height };
    }
  }
}
