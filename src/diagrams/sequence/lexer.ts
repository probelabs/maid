import { createToken, Lexer } from 'chevrotain';

// Identifiers (actor/participant ids)
// Keep '-' out to avoid consuming the '-' of arrows like A->B
export const Identifier = createToken({ name: 'Identifier', pattern: /[A-Za-z_][A-Za-z0-9_]*/ });

export const NumberLiteral = createToken({ name: 'NumberLiteral', pattern: /[0-9]+/ });

// Header
export const SequenceKeyword = createToken({ name: 'SequenceKeyword', pattern: /sequenceDiagram/, longer_alt: Identifier });

// Keywords (case-insensitive for common ones)
export const ParticipantKeyword = createToken({ name: 'ParticipantKeyword', pattern: /participant/i, longer_alt: Identifier });
export const ActorKeyword = createToken({ name: 'ActorKeyword', pattern: /actor/i, longer_alt: Identifier });
export const AsKeyword = createToken({ name: 'AsKeyword', pattern: /as/i, longer_alt: Identifier });

export const AutonumberKeyword = createToken({ name: 'AutonumberKeyword', pattern: /autonumber/i, longer_alt: Identifier });
export const OffKeyword = createToken({ name: 'OffKeyword', pattern: /off/i, longer_alt: Identifier });

export const NoteKeyword = createToken({ name: 'NoteKeyword', pattern: /note/i, longer_alt: Identifier });
export const LeftKeyword = createToken({ name: 'LeftKeyword', pattern: /left/i, longer_alt: Identifier });
export const RightKeyword = createToken({ name: 'RightKeyword', pattern: /right/i, longer_alt: Identifier });
export const OverKeyword = createToken({ name: 'OverKeyword', pattern: /over/i, longer_alt: Identifier });
export const OfKeyword = createToken({ name: 'OfKeyword', pattern: /of/i, longer_alt: Identifier });
export const TitleKeyword = createToken({ name: 'TitleKeyword', pattern: /title/i, longer_alt: Identifier });
export const AccTitleKeyword = createToken({ name: 'AccTitleKeyword', pattern: /acc_title|accTitle/i, longer_alt: Identifier });
export const AccDescrKeyword = createToken({ name: 'AccDescrKeyword', pattern: /acc_descr|accDescr/i, longer_alt: Identifier });

export const ActivateKeyword = createToken({ name: 'ActivateKeyword', pattern: /activate/i, longer_alt: Identifier });
export const DeactivateKeyword = createToken({ name: 'DeactivateKeyword', pattern: /deactivate/i, longer_alt: Identifier });

export const CreateKeyword = createToken({ name: 'CreateKeyword', pattern: /create/i, longer_alt: Identifier });
export const DestroyKeyword = createToken({ name: 'DestroyKeyword', pattern: /destroy/i, longer_alt: Identifier });

export const AltKeyword = createToken({ name: 'AltKeyword', pattern: /alt/i, longer_alt: Identifier });
export const ElseKeyword = createToken({ name: 'ElseKeyword', pattern: /else/i, longer_alt: Identifier });
export const OptionKeyword = createToken({ name: 'OptionKeyword', pattern: /option/i, longer_alt: Identifier });
export const OptKeyword = createToken({ name: 'OptKeyword', pattern: /opt/i, longer_alt: Identifier });
export const LoopKeyword = createToken({ name: 'LoopKeyword', pattern: /loop/i, longer_alt: Identifier });
export const ParKeyword = createToken({ name: 'ParKeyword', pattern: /par/i, longer_alt: Identifier });
export const AndKeyword = createToken({ name: 'AndKeyword', pattern: /and/i, longer_alt: Identifier });
export const RectKeyword = createToken({ name: 'RectKeyword', pattern: /rect/i, longer_alt: Identifier });
export const CriticalKeyword = createToken({ name: 'CriticalKeyword', pattern: /critical/i, longer_alt: Identifier });
export const BoxKeyword = createToken({ name: 'BoxKeyword', pattern: /box/i, longer_alt: Identifier });
export const EndKeyword = createToken({ name: 'EndKeyword', pattern: /end/i, longer_alt: Identifier });

export const LinksKeyword = createToken({ name: 'LinksKeyword', pattern: /links/i, longer_alt: Identifier });
export const LinkKeyword = createToken({ name: 'LinkKeyword', pattern: /link/i, longer_alt: Identifier });
export const PropertiesKeyword = createToken({ name: 'PropertiesKeyword', pattern: /properties/i, longer_alt: Identifier });
export const DetailsKeyword = createToken({ name: 'DetailsKeyword', pattern: /details/i, longer_alt: Identifier });

export const BreakKeyword = createToken({ name: 'BreakKeyword', pattern: /break/i, longer_alt: Identifier });

// Arrows (order matters: longest first)
export const BidirAsyncDotted = createToken({ name: 'BidirAsyncDotted', pattern: /<<-->>/ });
export const BidirAsync = createToken({ name: 'BidirAsync', pattern: /<<->>/ });

export const DottedAsync = createToken({ name: 'DottedAsync', pattern: /-->>/ });
export const Async = createToken({ name: 'Async', pattern: /->>/ });
export const Dotted = createToken({ name: 'Dotted', pattern: /-->/ });
export const Solid = createToken({ name: 'Solid', pattern: /->/ });
export const DottedCross = createToken({ name: 'DottedCross', pattern: /--x/ });
export const Cross = createToken({ name: 'Cross', pattern: /-x/ });
export const DottedOpen = createToken({ name: 'DottedOpen', pattern: /--\)/ });
export const Open = createToken({ name: 'Open', pattern: /-\)/ });

// Suffix markers on target: + (activate) or - (deactivate)
export const Plus = createToken({ name: 'Plus', pattern: /\+/ });
export const Minus = createToken({ name: 'Minus', pattern: /-/ });

// Punctuation
export const Comma = createToken({ name: 'Comma', pattern: /,/ });
export const Colon = createToken({ name: 'Colon', pattern: /:/ });
export const LParen = createToken({ name: 'LParen', pattern: /\(/ });
export const RParen = createToken({ name: 'RParen', pattern: /\)/ });

// Strings and text
// Allow escaped characters within quotes (e.g., \" inside "...")
export const QuotedString = createToken({ name: 'QuotedString', pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/ });

// Comments and whitespace
export const Comment = createToken({ name: 'Comment', pattern: /%%[^\n\r]*/, group: Lexer.SKIPPED });
export const WhiteSpace = createToken({ name: 'WhiteSpace', pattern: /[ \t]+/, group: Lexer.SKIPPED });
export const Newline = createToken({ name: 'Newline', pattern: /[\n\r]+/, line_breaks: true });

// Any text until end of line (for message/note bodies)
export const Text = createToken({ name: 'Text', pattern: /[^\n\r]+/ });

export const allTokens = [
  // Skip
  Comment,
  // Strings
  QuotedString,
  // Whitespace and newlines first so Text won't eat indentation
  WhiteSpace,
  Newline,
  // Header/Keywords
  SequenceKeyword,
  TitleKeyword,
  AccTitleKeyword,
  AccDescrKeyword,
  ParticipantKeyword,
  ActorKeyword,
  AsKeyword,
  AutonumberKeyword,
  OffKeyword,
  NoteKeyword,
  LeftKeyword,
  RightKeyword,
  OverKeyword,
  OfKeyword,
  ActivateKeyword,
  DeactivateKeyword,
  CreateKeyword,
  DestroyKeyword,
  AltKeyword,
  ElseKeyword,
  OptionKeyword,
  OptKeyword,
  LoopKeyword,
  ParKeyword,
  AndKeyword,
  RectKeyword,
  CriticalKeyword,
  BreakKeyword,
  BoxKeyword,
  EndKeyword,
  LinksKeyword,
  LinkKeyword,
  PropertiesKeyword,
  DetailsKeyword,
  // Arrows
  BidirAsyncDotted,
  BidirAsync,
  DottedAsync,
  Async,
  Dotted,
  Solid,
  DottedCross,
  Cross,
  DottedOpen,
  Open,
  // Punct
  Comma,
  Colon,
  LParen,
  RParen,
  Plus,
  Minus,
  // Values
  NumberLiteral,
  Identifier,
  Text,
];

export const SequenceLexer = new Lexer(allTokens);

export function tokenize(text: string) {
  return SequenceLexer.tokenize(text);
}
