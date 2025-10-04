import { createToken, Lexer } from 'chevrotain';

// Identifiers and basic tokens
export const Identifier = createToken({ name: 'Identifier', pattern: /[A-Za-z_][A-Za-z0-9_$]*/ });
export const NumberLiteral = createToken({ name: 'NumberLiteral', pattern: /[0-9]+/ });

// Header and keywords
export const ClassDiagramKeyword = createToken({ name: 'ClassDiagramKeyword', pattern: /classDiagram/, longer_alt: Identifier });
export const DirectionKw = createToken({ name: 'DirectionKw', pattern: /direction/, longer_alt: Identifier });
export const Direction = createToken({ name: 'Direction', pattern: /LR|RL|TB|BT|TD/, longer_alt: Identifier });
export const ClassKw = createToken({ name: 'ClassKw', pattern: /class/, longer_alt: Identifier });
export const AsKw = createToken({ name: 'AsKw', pattern: /as/, longer_alt: Identifier });
export const NoteKw = createToken({ name: 'NoteKw', pattern: /note/, longer_alt: Identifier });
export const ForKw = createToken({ name: 'ForKw', pattern: /for/, longer_alt: Identifier });

// Relationship operators (order matters: longest first)
export const RelCompToAgg = createToken({ name: 'RelCompToAgg', pattern: /\*--o/ });
export const RelAggToComp = createToken({ name: 'RelAggToComp', pattern: /o--\*/ });
export const RelCompBoth = createToken({ name: 'RelCompBoth', pattern: /\*--\*/ });
export const RelAggBoth = createToken({ name: 'RelAggBoth', pattern: /o--o/ });
export const LollipopLeft = createToken({ name: 'LollipopLeft', pattern: /\(\)--/ });
export const LollipopRight = createToken({ name: 'LollipopRight', pattern: /--\(\)/ });
export const RelExtends = createToken({ name: 'RelExtends', pattern: /<\|--/ });
export const RelComposition = createToken({ name: 'RelComposition', pattern: /\*--/ });
export const RelAggregation = createToken({ name: 'RelAggregation', pattern: /o--/ });
export const RelDependency = createToken({ name: 'RelDependency', pattern: /\.\.>/ });
export const RelRealization = createToken({ name: 'RelRealization', pattern: /\.\.\|>/ });
export const RelAssociation = createToken({ name: 'RelAssociation', pattern: /--/ });
// Leftward variants
export const RelDependencyLeft = createToken({ name: 'RelDependencyLeft', pattern: /<\.\./ });
export const RelRealizationLeft = createToken({ name: 'RelRealizationLeft', pattern: /<\|\.\./ });
export const RelExtendsRight = createToken({ name: 'RelExtendsRight', pattern: /--\|>/ });
// Invalid short arrow used by mistake in relations
export const InvalidRelArrow = createToken({ name: 'InvalidRelArrow', pattern: /->(?!>)/ });

// Punctuation and misc
export const LCurly = createToken({ name: 'LCurly', pattern: /\{/ });
export const RCurly = createToken({ name: 'RCurly', pattern: /\}/ });
export const LParen = createToken({ name: 'LParen', pattern: /\(/ });
export const RParen = createToken({ name: 'RParen', pattern: /\)/ });
export const Colon = createToken({ name: 'Colon', pattern: /:/ });
export const Comma = createToken({ name: 'Comma', pattern: /,/ });
export const Visibility = createToken({ name: 'Visibility', pattern: /[+\-#~]/ });
export const LTlt = createToken({ name: 'LTlt', pattern: /<</ });
export const GTgt = createToken({ name: 'GTgt', pattern: />>/ });
// Simple generic angle segment <...> (no nesting)
export const GenericAngle = createToken({ name: 'GenericAngle', pattern: /<[^\n\r>]+>/ });

export const QuotedString = createToken({ name: 'QuotedString', pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/ });
export const BacktickName = createToken({ name: 'BacktickName', pattern: /`(?:\\.|[^`\\])*`/ });
export const SquareOpen = createToken({ name: 'SquareOpen', pattern: /\[/ });
export const SquareClose = createToken({ name: 'SquareClose', pattern: /\]/ });
export const Comment = createToken({ name: 'Comment', pattern: /%%[^\n\r]*/, group: Lexer.SKIPPED });
export const WhiteSpace = createToken({ name: 'WhiteSpace', pattern: /[ \t]+/, group: Lexer.SKIPPED });
export const Newline = createToken({ name: 'Newline', pattern: /[\n\r]+/, line_breaks: true });

export const allTokens = [
  Comment,
  QuotedString,
  // Keywords
  ClassDiagramKeyword,
  DirectionKw,
  ClassKw,
  AsKw,
  NoteKw,
  ForKw,
  Direction,
  // Relationship ops
  RelCompToAgg,
  RelAggToComp,
  RelCompBoth,
  RelAggBoth,
  LollipopLeft,
  LollipopRight,
  RelRealization,
  RelDependency,
  RelExtends,
  RelDependencyLeft,
  RelRealizationLeft,
  RelExtendsRight,
  RelComposition,
  RelAggregation,
  RelAssociation,
  InvalidRelArrow,
  // Punct
  LTlt,
  GTgt,
  GenericAngle,
  LCurly, RCurly,
  LParen, RParen,
  SquareOpen, SquareClose,
  Colon, Comma,
  Visibility,
  // Atoms
  NumberLiteral,
  BacktickName,
  Identifier,
  // Layout
  WhiteSpace,
  Newline,
];

export const ClassLexer = new Lexer(allTokens);
export function tokenize(text: string) { return ClassLexer.tokenize(text); }
