import { createToken, Lexer, type IToken } from 'chevrotain';

// Identifiers - define first since used by keywords
// Identifiers allow hyphens only between alphanumeric segments to avoid capturing '--' arrows.
export const Identifier = createToken({
    name: "Identifier",
    // e.g., id-2, _id, A1, but not A-- (that belongs to an arrow token)
    pattern: /[a-zA-Z_][a-zA-Z0-9_]*(?:-[a-zA-Z0-9_]+)*/
});

// Numbers (for node IDs like node1, node2)
export const NumberLiteral = createToken({
    name: "NumberLiteral",
    pattern: /[0-9]+/
});

// Keywords
export const FlowchartKeyword = createToken({ 
    name: "FlowchartKeyword", 
    pattern: /flowchart/,
    longer_alt: Identifier
});

export const GraphKeyword = createToken({ 
    name: "GraphKeyword", 
    pattern: /graph/,
    longer_alt: Identifier
});

// Direction tokens
export const Direction = createToken({ 
    name: "Direction", 
    pattern: /TD|TB|BT|RL|LR/,
    longer_alt: Identifier
});

// Subgraph keywords
export const SubgraphKeyword = createToken({ 
    name: "SubgraphKeyword", 
    pattern: /subgraph/,
    longer_alt: Identifier
});

export const EndKeyword = createToken({ 
    name: "EndKeyword", 
    pattern: /end/,
    longer_alt: Identifier
});

// Style keywords
export const ClassKeyword = createToken({ 
    name: "ClassKeyword", 
    pattern: /class/,
    longer_alt: Identifier
});

export const StyleKeyword = createToken({ 
    name: "StyleKeyword", 
    pattern: /style/,
    longer_alt: Identifier
});

export const ClassDefKeyword = createToken({ 
    name: "ClassDefKeyword", 
    pattern: /classDef/,
    longer_alt: Identifier
});
// Interactions
export const ClickKeyword = createToken({ name: "ClickKeyword", pattern: /click/, longer_alt: Identifier });
export const LinkStyleKeyword = createToken({ name: "LinkStyleKeyword", pattern: /linkStyle/, longer_alt: Identifier });


// Special operators
export const Ampersand = createToken({ 
    name: "Ampersand", 
    pattern: /&/ 
});

export const Comma = createToken({ 
    name: "Comma", 
    pattern: /,/ 
});

export const Semicolon = createToken({ 
    name: "Semicolon", 
    pattern: /;/ 
});

export const Colon = createToken({ 
    name: "Colon", 
    pattern: /:/ 
});

// Triple colon for class annotations (e.g., A:::class)
export const TripleColon = createToken({
    name: "TripleColon",
    pattern: /:::/
});

// Arrow/Link types - Order matters! More specific first

// Bidirectional and special end markers
export const BiDirectionalArrow = createToken({ 
    name: "BiDirectionalArrow", 
    pattern: /<-->/ 
});

export const CircleEndLine = createToken({ 
    name: "CircleEndLine", 
    pattern: /o--o|o---o|o----o/ 
});

export const CrossEndLine = createToken({ 
    name: "CrossEndLine", 
    pattern: /x--x|x---x|x----x/ 
});

// Dotted arrows with various lengths
export const DottedArrowRight = createToken({ 
    name: "DottedArrowRight", 
    pattern: /-\.->|-\.\.->|-\.\.\.->/ 
});

export const DottedArrowLeft = createToken({ 
    name: "DottedArrowLeft", 
    pattern: /<-\.-|<-\.\.-|<-\.\.\.-/ 
});

// Thick arrows
export const ThickArrowRight = createToken({ 
    name: "ThickArrowRight", 
    pattern: /==>|===>|====>/ 
});

export const ThickArrowLeft = createToken({ 
    name: "ThickArrowLeft", 
    pattern: /<==|<===|<====/ 
});

// Regular arrows with various lengths
export const ArrowRight = createToken({ 
    name: "ArrowRight", 
    pattern: /-->|--->|---->/ 
});

export const ArrowLeft = createToken({ 
    name: "ArrowLeft", 
    pattern: /<--|<---|<----/ 
});

// Lines (no arrows)
export const DottedLine = createToken({ 
    name: "DottedLine", 
    pattern: /-\.-|-\.\.-|-\.\.\.-/ 
});

export const ThickLine = createToken({ 
    name: "ThickLine", 
    pattern: /===|====|=====/ 
});

export const Line = createToken({ 
    name: "Line", 
    pattern: /---|----/ 
});

// Two dashes (for -- text --> pattern)
export const TwoDashes = createToken({ 
    name: "TwoDashes", 
    pattern: /--/ 
});

// Invalid single arrow (for error detection)
export const InvalidArrow = createToken({ 
    name: "InvalidArrow", 
    pattern: /->(?!>)/ 
});

// Node shapes - Special brackets
export const DoubleSquareOpen = createToken({ name: "DoubleSquareOpen", pattern: /\[\[/ });
export const DoubleSquareClose = createToken({ name: "DoubleSquareClose", pattern: /\]\]/ });
export const DoubleRoundOpen = createToken({ name: "DoubleRoundOpen", pattern: /\(\(/ });
export const DoubleRoundClose = createToken({ name: "DoubleRoundClose", pattern: /\)\)/ });
export const HexagonOpen = createToken({ name: "HexagonOpen", pattern: /\{\{/ });
export const HexagonClose = createToken({ name: "HexagonClose", pattern: /\}\}/ });

// Stadium shape: ([...])
export const StadiumOpen = createToken({ name: "StadiumOpen", pattern: /\(\[/ });
export const StadiumClose = createToken({ name: "StadiumClose", pattern: /\]\)/ });

// Database/Cylinder shape: [(...)]
export const CylinderOpen = createToken({ name: "CylinderOpen", pattern: /\[\(/ });
export const CylinderClose = createToken({ name: "CylinderClose", pattern: /\)\]/ });

// Trapezoid and Parallelogram shapes - these have complex syntax
// For now, we'll handle them as special text patterns in the parser

// Single character brackets
export const SquareOpen = createToken({ name: "SquareOpen", pattern: /\[/ });
export const SquareClose = createToken({ name: "SquareClose", pattern: /\]/ });
export const RoundOpen = createToken({ name: "RoundOpen", pattern: /\(/ });
export const RoundClose = createToken({ name: "RoundClose", pattern: /\)/ });
export const DiamondOpen = createToken({ name: "DiamondOpen", pattern: /\{/ });
export const DiamondClose = createToken({ name: "DiamondClose", pattern: /\}/ });
export const AngleOpen = createToken({ name: "AngleOpen", pattern: />/ });
// Support '<' inside labels (e.g., <br/>) when not part of an arrow token
export const AngleLess = createToken({ name: "AngleLess", pattern: /</ });
// Attribute marker for typed shapes (e.g., A@{ shape: rect })
export const AtSign = createToken({ name: "AtSign", pattern: /@/ });

// Link text delimiter
export const Pipe = createToken({ name: "Pipe", pattern: /\|/ });

// Slash tokens (used in shapes like [/text/] and [\\text/])
export const ForwardSlash = createToken({ name: 'ForwardSlash', pattern: /\// });
export const Backslash = createToken({ name: 'Backslash', pattern: /\\/ });

// Text content patterns
export const QuotedString = createToken({
    name: "QuotedString",
    // Allow escaped characters within quotes (Mermaid accepts \" inside "...")
    pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/
});

export const MultilineText = createToken({
    name: "MultilineText",
    pattern: /"""[\s\S]*?"""/,
    line_breaks: true
});

// Comments
export const Comment = createToken({
    name: "Comment",
    pattern: /%%[^\n\r]*/,
    group: Lexer.SKIPPED
});

// Style values (colors, etc)
export const ColorValue = createToken({
    name: "ColorValue",
    pattern: /#[0-9a-fA-F]{3,6}/
});

// General text - must be less greedy
export const Text = createToken({
    name: "Text",
    pattern: /[^[\](){}|<>\n\r\t &,;:]+/
});

// Whitespace
export const WhiteSpace = createToken({
    name: "WhiteSpace",
    pattern: /[ \t]+/,
    group: Lexer.SKIPPED
});

// Newline
export const Newline = createToken({
    name: "Newline",
    pattern: /[\n\r]+/,
    line_breaks: true
});

// Token order is CRUCIAL - most specific first
export const allTokens = [
    // Comments (skipped)
    Comment,
    
    // Multi-line strings before regular strings
    MultilineText,
    QuotedString,
    
    // Keywords before identifiers
    FlowchartKeyword,
    GraphKeyword,
    SubgraphKeyword,
    EndKeyword,
    ClassDefKeyword,
    ClassKeyword,
    StyleKeyword,
    ClickKeyword,
    LinkStyleKeyword,
    Direction,
    
    // Special multi-char brackets before arrows (some contain > or -)
    DoubleSquareOpen,
    DoubleSquareClose,
    DoubleRoundOpen,
    DoubleRoundClose,
    HexagonOpen,
    HexagonClose,
    StadiumOpen,
    StadiumClose,
    CylinderOpen,
    CylinderClose,
    
    // Arrows and lines (most specific first)
    BiDirectionalArrow,
    CircleEndLine,
    CrossEndLine,
    DottedArrowRight,
    DottedArrowLeft,
    ThickArrowRight,
    ThickArrowLeft,
    ArrowRight,
    ArrowLeft,
    DottedLine,
    ThickLine,
    Line,
    TwoDashes,
    InvalidArrow,
    
    // Single char brackets and symbols
    SquareOpen,
    SquareClose,
    RoundOpen,
    RoundClose,
    DiamondOpen,
    DiamondClose,
    AngleOpen,
    AngleLess,
    AtSign,
    ForwardSlash,
    Backslash,
    Pipe,
    TripleColon,
    Ampersand,
    Comma,
    Semicolon,
    Colon,
    
    // Values
    ColorValue,
    NumberLiteral,
    
    // Identifiers and text (most general)
    Identifier,
    Text,
    
    // Whitespace
    WhiteSpace,
    Newline
];

// Create and export the lexer
export const MermaidLexer = new Lexer(allTokens);

// Helper function to tokenize input
export function tokenize(text: string) {
    const lexResult = MermaidLexer.tokenize(text);
    // Do not log lexer errors directly; callers produce user-facing diagnostics.
    return lexResult;
}
