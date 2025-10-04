import type { SequenceModel, SequenceEvent, Participant, Message, Note, Block, BlockBranch } from './sequence-types.js';
import { measureText } from './utils.js';

export interface LayoutParticipant {
  id: string;
  display: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutMessage {
  from: string; to: string; text?: string;
  y: number; x1: number; x2: number;
  line: 'solid'|'dotted'|'thick';
  startMarker: 'none'|'arrow'|'open'|'cross';
  endMarker: 'none'|'arrow'|'open'|'cross';
  async?: boolean;
}

export interface LayoutNote {
  x: number; y: number; width: number; height: number; text: string; anchor: 'left'|'right'|'over';
}

export interface LayoutBlock {
  type: Block['type'];
  title?: string;
  x: number; y: number; width: number; height: number;
  branches?: Array<{ title?: string; y: number }>; // divider y positions with titles
}

export interface LayoutActivation { actor: string; x: number; y: number; width: number; height: number }

export interface SequenceLayout {
  width: number; height: number;
  participants: LayoutParticipant[];
  lifelines: Array<{ x: number; y1: number; y2: number }>;
  messages: LayoutMessage[];
  notes: LayoutNote[];
  blocks: LayoutBlock[];
  activations: LayoutActivation[];
}

const MARGIN_X = 24;
const MARGIN_Y = 24;
const ACTOR_FONT_SIZE = 16;
const ACTOR_H = 30;
const LIFELINE_GAP = 4; // closer to Mermaid
const ACTOR_PAD_X = 12;
const COL_MIN = 110;
const ROW_H = 36; // row height tuned for parity
const NOTE_W = 160;
const NOTE_PAD = 8;
const BLOCK_PAD = 12;
const TITLE_EXTRA_TOP = 12; // extra space to fit the title pill

export function layoutSequence(model: SequenceModel): SequenceLayout {
  // Determine participant order by first mention (participantDecl/create/message/note)
  const order: string[] = [];
  const seen = new Set<string>();
  const partById = new Map(model.participants.map(p => [p.id, p] as const));
  function touch(id: string) { if (!seen.has(id)) { seen.add(id); order.push(id); } }

  for (const ev of model.events) {
    if (ev.kind === 'message') { touch(ev.msg.from); touch(ev.msg.to); }
    if (ev.kind === 'note') { ev.note.actors.forEach(touch); }
    if (ev.kind === 'activate' || ev.kind === 'deactivate' || ev.kind === 'create' || ev.kind === 'destroy') touch(ev.actor);
  }
  // Ensure declared participants appear first in their declared order
  for (const p of model.participants) touch(p.id);

  // Place columns
  const participants: LayoutParticipant[] = [];
  let x = MARGIN_X;
  for (const id of order) {
    const p = partById.get(id) || { id, display: id } as Participant;
    const w = Math.max(COL_MIN, measureText(p.display, ACTOR_FONT_SIZE) + ACTOR_PAD_X * 2);
    participants.push({ id, display: p.display, x, y: MARGIN_Y, width: w, height: ACTOR_H });
    x += w + MARGIN_X;
  }
  const width = Math.max(320, x);

  // Event row mapping
  const rowIndexForEvent = new Map<number, number>();
  let row = 0;
  const openBlocks: { block: Block, startRow: number, branches: Array<{ title?: string; row: number }> }[] = [];

  function consumeRow(idx: number) { rowIndexForEvent.set(idx, row++); }

  // First pass to assign rows for visible items and collect block structure
  model.events.forEach((ev, idx) => {
    switch (ev.kind) {
      case 'message': consumeRow(idx); break;
      case 'note': consumeRow(idx); break;
      case 'block-start':
        openBlocks.push({ block: ev.block, startRow: row, branches: [] });
        consumeRow(idx); // header row
        break;
      case 'block-branch': {
        const top = openBlocks[openBlocks.length - 1];
        if (top) top.branches.push({ title: ev.branch.title, row });
        consumeRow(idx); // branch header row
        break;
      }
      case 'block-end':
        // does not consume row by itself
        break;
      case 'activate':
      case 'deactivate':
      case 'create':
      case 'destroy':
      case 'noop':
        // no visual row
        break;
    }
  });

  const lifelineTop = MARGIN_Y + ACTOR_H + LIFELINE_GAP;
  const contentHeight = row * ROW_H;
  const height = lifelineTop + contentHeight + MARGIN_Y + ACTOR_H; // reserve space for bottom actor boxes

  // Lifelines
  const lifelines = participants.map(p => ({ x: p.x + p.width / 2, y1: lifelineTop, y2: height - MARGIN_Y - ACTOR_H }));

  // row -> y
  function yForRow(r: number): number { return lifelineTop + r * ROW_H + ROW_H / 2; }

  // participants map
  const col = new Map(participants.map(p => [p.id, p] as const));

  // Messages, notes, activations, blocks
  const messages: LayoutMessage[] = [];
  const notes: LayoutNote[] = [];
  const blocks: LayoutBlock[] = [];
  const activations: LayoutActivation[] = [];
  const actStack = new Map<string, number[]>(); // actor -> stack of start rows

  // Helper to start/end activation at a row
  const startAct = (actor: string, r: number) => {
    const arr = actStack.get(actor) || []; arr.push(r); actStack.set(actor, arr);
  };
  const endAct = (actor: string, r: number) => {
    const arr = actStack.get(actor) || [];
    const start = arr.pop();
    if (start != null) {
      const p = col.get(actor);
      if (p) {
        activations.push({ actor, x: p.x + p.width / 2 - 3, y: yForRow(start) - ROW_H / 2, width: 6, height: yForRow(r) - yForRow(start) });
      }
    }
    actStack.set(actor, arr);
  };

  // Track open blocks stack for layout metrics
  const openForLayout: Array<{ block: Block; startRow: number; branches: Array<{ title?: string; row: number }>; lastRow?: number; }> = [];

  model.events.forEach((ev, idx) => {
    const r = rowIndexForEvent.has(idx) ? rowIndexForEvent.get(idx)! : null;
    switch (ev.kind) {
      case 'message': {
        const p1 = col.get(ev.msg.from), p2 = col.get(ev.msg.to);
        if (p1 && p2 && r != null) {
          const y = yForRow(r);
          const x1 = p1.x + p1.width / 2;
          const x2 = p2.x + p2.width / 2;
          messages.push({ from: p1.id, to: p2.id, text: ev.msg.text, y, x1, x2, line: ev.msg.line, startMarker: ev.msg.startMarker, endMarker: ev.msg.endMarker, async: ev.msg.async });
          if (ev.msg.activateTarget) startAct(ev.msg.to, r);
          if (ev.msg.deactivateTarget) endAct(ev.msg.to, r);
          const top = openForLayout[openForLayout.length - 1];
          if (top) top.lastRow = r;
        }
        break;
      }
      case 'note': {
        if (r == null) break;
        // Estimate note height based on text length and width
        const estLines = (text: string, width: number) => {
          const charsPerLine = Math.max(8, Math.floor((width - NOTE_PAD * 2) / 7));
          const length = text ? text.length : 0;
          return Math.max(1, Math.ceil(length / charsPerLine));
        };
        const y = yForRow(r) - NOTE_PAD; // top of note
        if (ev.note.pos === 'over') {
          const [a, b] = ev.note.actors;
          const p1 = col.get(a), p2 = b ? col.get(b) : p1;
          if (p1 && p2) {
            const left = Math.min(p1.x + p1.width / 2, p2.x + p2.width / 2);
            const right = Math.max(p1.x + p1.width / 2, p2.x + p2.width / 2);
            const w = (right - left) + NOTE_PAD * 2;
            const lines = estLines(ev.note.text, w);
            const h = Math.max(ROW_H - NOTE_PAD, lines * 16 + NOTE_PAD);
            notes.push({ x: left - NOTE_PAD, y, width: w, height: h, text: ev.note.text, anchor: 'over' });
          }
        } else {
          const actor = ev.note.actors[0];
          const p = col.get(actor);
          if (p) {
            const leftSide = ev.note.pos === 'leftOf';
            const x = leftSide ? p.x - NOTE_W - 10 : p.x + p.width + 10;
            const lines = estLines(ev.note.text, NOTE_W);
            const h = Math.max(ROW_H - NOTE_PAD, lines * 16 + NOTE_PAD);
            notes.push({ x, y, width: NOTE_W, height: h, text: ev.note.text, anchor: leftSide ? 'left' : 'right' });
          }
        }
        const top = openForLayout[openForLayout.length - 1];
        if (top && r != null) top.lastRow = r;
        break;
      }
      case 'activate': if (r != null) startAct(ev.actor, r); break;
      case 'deactivate': if (r != null) endAct(ev.actor, r); break;
      case 'block-start': {
        const startRow = r != null ? r : row; // if header consumed, r is the header row
        openForLayout.push({ block: ev.block, startRow, branches: [] });
        break;
      }
      case 'block-branch': {
        const top = openForLayout[openForLayout.length - 1];
        if (top && r != null) { top.branches.push({ title: ev.branch.title, row: r }); top.lastRow = r; }
        break;
      }
      case 'block-end': {
        const top = openForLayout.pop();
        if (top) {
          // Encapsulate entire participant span
          const first = participants.length > 0 ? participants[0] : undefined;
          const last = participants.length > 0 ? participants[participants.length - 1] : undefined;
          const left = first ? first.x : MARGIN_X;
          const right = last ? (last.x + last.width) : (left + 200);
          const yTop = yForRow(top.startRow) - ROW_H / 2 - (BLOCK_PAD + TITLE_EXTRA_TOP);
          const endRow = top.lastRow != null ? top.lastRow : top.startRow;
          const yBot = yForRow(endRow) + ROW_H / 2 + BLOCK_PAD;
          const layout: LayoutBlock = { type: top.block.type, title: top.block.title, x: left - BLOCK_PAD, y: yTop, width: (right - left) + BLOCK_PAD * 2, height: (yBot - yTop) };
          if (top.branches.length) layout.branches = top.branches.map(b => ({ title: b.title, y: yForRow(b.row) - ROW_H / 2 }));
          blocks.push(layout);
        }
        break;
      }
      default: break;
    }
  });

  // Close any remaining activations at end
  const lastRow = row;
  for (const [actor, arr] of actStack.entries()) {
    while (arr.length) { const start = arr.pop()!; const p = col.get(actor); if (p) activations.push({ actor, x: p.x + p.width / 2 - 3, y: yForRow(start) - ROW_H / 2, width: 6, height: yForRow(lastRow) - yForRow(start) }); }
  }

  return { width, height, participants, lifelines, messages, notes, blocks, activations };
}
