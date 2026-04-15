export type FlowchartNoteBlock = {
  startLine: number;
  endLine: number;
  targetId: string;
  position: 'left' | 'right' | 'over';
  text: string;
  hasInlineBody: boolean;
};

type NoteHeader = {
  targetId: string;
  position: 'left' | 'right' | 'over';
  inlineText: string;
};

function parseFlowchartNoteHeader(raw: string): NoteHeader | null {
  const leftOrRight = /^\s*note\s+(left|right)\s+of\s+([A-Za-z_][A-Za-z0-9_-]*)\s*(?::\s*(.*))?\s*$/i.exec(raw);
  if (leftOrRight) {
    return {
      position: String(leftOrRight[1]).toLowerCase() as 'left' | 'right',
      targetId: String(leftOrRight[2] || ''),
      inlineText: String(leftOrRight[3] || '').trim()
    };
  }

  const over = /^\s*note\s+over\s+([A-Za-z_][A-Za-z0-9_-]*)(?:\s*,\s*[A-Za-z_][A-Za-z0-9_-]*)?\s*(?::\s*(.*))?\s*$/i.exec(raw);
  if (over) {
    return {
      position: 'over',
      targetId: String(over[1] || ''),
      inlineText: String(over[2] || '').trim()
    };
  }

  return null;
}

export function findFlowchartNoteBlocks(text: string): FlowchartNoteBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: FlowchartNoteBlock[] = [];

  for (let i = 0; i < lines.length; i++) {
    const header = parseFlowchartNoteHeader(lines[i] || '');
    if (!header || !header.targetId) continue;

    const startLine = i + 1;
    if (header.inlineText) {
      blocks.push({
        startLine,
        endLine: startLine,
        targetId: header.targetId,
        position: header.position,
        text: header.inlineText,
        hasInlineBody: true
      });
      continue;
    }

    let endLine = startLine;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const bodyRaw = lines[j] || '';
      if (/^\s*end\s*note\s*$/i.test(bodyRaw) || /^\s*endnote\s*$/i.test(bodyRaw)) {
        endLine = j + 1;
        i = j;
        break;
      }
      body.push(bodyRaw.trim());
    }

    blocks.push({
      startLine,
      endLine,
      targetId: header.targetId,
      position: header.position,
      text: endLine > startLine ? body.filter(Boolean).join('<br/>').trim() : '',
      hasInlineBody: false
    });
  }

  return blocks;
}
