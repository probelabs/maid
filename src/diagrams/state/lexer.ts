import { createToken, Lexer } from 'chevrotain';

export const Identifier = createToken({ name: 'Identifier', pattern: /[A-Za-z_][A-Za-z0-9_]*/ });
export const NumberLiteral = createToken({ name: 'NumberLiteral', pattern: /[0-9]+/ });

export const StateDiagramV2 = createToken({ name: 'StateDiagramV2', pattern: /stateDiagram-v2/ });
export const StateDiagram = createToken({ name: 'StateDiagram', pattern: /stateDiagram/, longer_alt: Identifier });
export const StateKw = createToken({ name: 'StateKw', pattern: /state/, longer_alt: Identifier });
export const AsKw = createToken({ name: 'AsKw', pattern: /as/, longer_alt: Identifier });
export const DirectionKw = createToken({ name: 'DirectionKw', pattern: /direction/, longer_alt: Identifier });
export const Direction = createToken({ name: 'Direction', pattern: /LR|RL|TB|BT|TD/, longer_alt: Identifier });
export const NoteKw = createToken({ name: 'NoteKw', pattern: /note/i, longer_alt: Identifier });
export const LeftKw = createToken({ name: 'LeftKw', pattern: /left/, longer_alt: Identifier });
export const RightKw = createToken({ name: 'RightKw', pattern: /right/, longer_alt: Identifier });
export const OfKw = createToken({ name: 'OfKw', pattern: /of/, longer_alt: Identifier });
export const OverKw = createToken({ name: 'OverKw', pattern: /over/, longer_alt: Identifier });
// Markers like <<choice>>, <<fork>>, <<join>>
export const AngleAngleOpen = createToken({ name: 'AngleAngleOpen', pattern: /<</ });
export const AngleAngleClose = createToken({ name: 'AngleAngleClose', pattern: />>/ });
// Concurrency separator inside composite states
export const Dashes = createToken({ name: 'Dashes', pattern: /---+/ });
// Accept style statements (pass-through)
export const StyleClassDefKw = createToken({ name: 'StyleClassDefKw', pattern: /classDef/, longer_alt: Identifier });
export const StyleClassKw = createToken({ name: 'StyleClassKw', pattern: /class(?!Diagram)/, longer_alt: Identifier });

export const Start = createToken({ name: 'Start', pattern: /\[\*\]/ });
export const HistoryShallow = createToken({ name: 'HistoryShallow', pattern: /\[H\]/ });
export const HistoryDeep = createToken({ name: 'HistoryDeep', pattern: /\[H\*\]/ });
export const Arrow = createToken({ name: 'Arrow', pattern: /-->/ });
export const InvalidArrow = createToken({ name: 'InvalidArrow', pattern: /->(?!>)/ });
export const Hyphen = createToken({ name: 'Hyphen', pattern: /-/ });

export const LCurly = createToken({ name: 'LCurly', pattern: /\{/ });
export const RCurly = createToken({ name: 'RCurly', pattern: /\}/ });
export const Colon = createToken({ name: 'Colon', pattern: /:/ });
export const Comma = createToken({ name: 'Comma', pattern: /,/ });

export const QuotedString = createToken({ name: 'QuotedString', pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/ });
export const Comment = createToken({ name: 'Comment', pattern: /%%[^\n\r]*/, group: Lexer.SKIPPED });
export const WhiteSpace = createToken({ name: 'WhiteSpace', pattern: /[ \t]+/, group: Lexer.SKIPPED });
export const Newline = createToken({ name: 'Newline', pattern: /[\n\r]+/, line_breaks: true });
// Free-form label content segments, but never start at '-' or '<' so arrow/markers win.
export const LabelChunk = createToken({ name: 'LabelChunk', pattern: /[^\n\r<\-][^\n\r]*/ });

export const allTokens = [
  Comment,
  QuotedString,
  StateDiagramV2,
  StateDiagram,
  StateKw,
  AsKw,
  DirectionKw,
  Direction,
  NoteKw, LeftKw, RightKw, OfKw, OverKw,
  AngleAngleOpen, AngleAngleClose,
  Start,
  HistoryDeep,
  HistoryShallow,
  Arrow,
  InvalidArrow,
  Dashes,
  Hyphen,
  StyleClassDefKw, StyleClassKw,
  LCurly, RCurly,
  Colon, Comma,
  NumberLiteral,
  Identifier,
  WhiteSpace,
  LabelChunk,
  Newline,
];

export const StateLexer = new Lexer(allTokens);
export function tokenize(text: string) { return StateLexer.tokenize(text); }
