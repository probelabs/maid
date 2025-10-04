// Sequence diagram model types (renderer-facing)

export type ArrowMarker = 'none' | 'arrow' | 'open' | 'cross';
export type MessageLine = 'solid' | 'dotted' | 'thick';

export interface Participant {
  id: string;             // canonical id (A, User, etc.)
  display: string;        // display name (may include spaces)
}

export interface Message {
  from: string;           // participant id
  to: string;             // participant id
  text?: string;          // label after ':'
  line: MessageLine;      // solid | dotted | thick (==)
  startMarker: ArrowMarker; // marker at source end
  endMarker: ArrowMarker;   // marker at target end
  async?: boolean;          // async ("<<" style)
  activateTarget?: boolean; // trailing + on target
  deactivateTarget?: boolean; // trailing - on target
}

export type NotePos = 'leftOf' | 'rightOf' | 'over';

export interface Note {
  pos: NotePos;
  actors: string[]; // 1 or 2 ids
  text: string;
}

export type BlockType = 'alt' | 'opt' | 'loop' | 'par' | 'critical' | 'break' | 'rect' | 'box';

export interface BlockBranch {
  kind: 'else' | 'and' | 'option';
  title?: string;
  // Indices in the event stream filled during layout
  startIndex?: number;
  endIndex?: number;
}

export interface Block {
  type: BlockType;
  title?: string;
  branches?: BlockBranch[]; // for alt/par/critical
  startIndex?: number;
  endIndex?: number;
}

export interface Activation {
  actor: string;
  startIndex: number; // event index where activation starts
  endIndex?: number;  // when known
}

export interface AutonumberConfig {
  on: boolean;
  start?: number;
  step?: number;
}

export type SequenceEvent =
  | { kind: 'message'; msg: Message }
  | { kind: 'note'; note: Note }
  | { kind: 'activate'; actor: string }
  | { kind: 'deactivate'; actor: string }
  | { kind: 'block-start'; block: Block }
  | { kind: 'block-branch'; block: Block; branch: BlockBranch }
  | { kind: 'block-end'; block: Block }
  | { kind: 'create'; actor: string; display?: string }
  | { kind: 'destroy'; actor: string }
  | { kind: 'noop' };

export interface SequenceModel {
  participants: Participant[];
  events: SequenceEvent[];
  autonumber: AutonumberConfig;
  /** Optional diagram title ("title ...") */
  title?: string;
  /** Optional accessibility title ("accTitle ...") */
  accTitle?: string;
  /** Optional accessibility description ("accDescr ...") */
  accDescr?: string;
}
