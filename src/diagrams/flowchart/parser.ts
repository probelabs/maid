import { CstParser, EOF, type IToken } from 'chevrotain';
import * as tokens from './lexer.js';

export class MermaidParser extends CstParser {
    constructor() {
        super(tokens.allTokens);
        
        // Perform self analysis to detect grammar errors
        this.performSelfAnalysis();
    }
    
    // Main rule - a flowchart diagram
    public diagram = this.RULE("diagram", () => {
        this.OR([
            { ALT: () => this.CONSUME(tokens.FlowchartKeyword) },
            { ALT: () => this.CONSUME(tokens.GraphKeyword) }
        ]);
        
        this.CONSUME(tokens.Direction);
        
        // Optional newline after header
        this.OPTION(() => {
            this.CONSUME(tokens.Newline);
        });
        
        // Statements
        this.MANY(() => {
            this.SUBRULE(this.statement);
        });
    });
    
    // A statement can be various things
    private statement = this.RULE("statement", () => {
        this.OR([
            { ALT: () => this.SUBRULE(this.nodeStatement) },
            { ALT: () => this.SUBRULE(this.subgraph) },
            { ALT: () => this.SUBRULE(this.classStatement) },
            { ALT: () => this.SUBRULE(this.styleStatement) },
            { ALT: () => this.SUBRULE(this.classDefStatement) },
            { ALT: () => this.CONSUME(tokens.Newline) } // Empty lines
        ]);
    });
    
    // Node statement - handles both single nodes and chains with parallel connections
    private nodeStatement = this.RULE("nodeStatement", () => {
        // First node or parallel group
        this.SUBRULE(this.nodeOrParallelGroup);
        
        // Optional link and continuation
        this.OPTION(() => {
            this.SUBRULE(this.link);
            this.SUBRULE2(this.nodeOrParallelGroup);
            
            // Can continue chaining
            this.MANY(() => {
                this.SUBRULE2(this.link);
                this.SUBRULE3(this.nodeOrParallelGroup);
            });
        });
        
        // Optional semicolon terminator
        this.OPTION2(() => this.CONSUME(tokens.Semicolon));
        // Statement must end at newline or EOF (prevents multiple nodes on one line without arrows)
        this.OR2([
            { ALT: () => this.CONSUME(tokens.Newline) },
            { ALT: () => this.CONSUME(EOF as any) }
        ]);
    });
    
    // Node or parallel group (A & B & C)
    private nodeOrParallelGroup = this.RULE("nodeOrParallelGroup", () => {
        this.SUBRULE(this.node);
        
        // Optional parallel nodes
        this.MANY(() => {
            this.CONSUME(tokens.Ampersand);
            this.SUBRULE2(this.node);
        });
    });
    
    // A node with optional shape and content
    private node = this.RULE("node", () => {
        // Node ID can be identifier or identifier+number
        this.OR([
            { 
                ALT: () => {
                    this.CONSUME(tokens.Identifier, { LABEL: "nodeId" });
                    this.OPTION(() => {
                        this.CONSUME(tokens.NumberLiteral, { LABEL: "nodeIdSuffix" });
                    });
                }
            },
            { 
                ALT: () => {
                    this.CONSUME2(tokens.NumberLiteral, { LABEL: "nodeIdNum" });
                }
            }
        ]);
        
        // Optional shape and content
        this.OPTION2(() => {
            this.SUBRULE(this.nodeShape);
        });

        // Optional class annotation like :::className
        this.OPTION3(() => {
            this.CONSUME(tokens.TripleColon);
            this.CONSUME3(tokens.Identifier, { LABEL: 'nodeClass' });
        });
    });
    
    // All possible node shapes
    private nodeShape = this.RULE("nodeShape", () => {
        this.OR([
            // Square brackets: [text]
            { 
                ALT: () => {
                    this.CONSUME(tokens.SquareOpen);
                    this.OPTION(() => this.SUBRULE(this.nodeContent));
                    this.CONSUME(tokens.SquareClose);
                }
            },
            // Double square: [[text]] (subroutine)
            { 
                ALT: () => {
                    this.CONSUME(tokens.DoubleSquareOpen);
                    this.OPTION2(() => this.SUBRULE2(this.nodeContent));
                    this.CONSUME(tokens.DoubleSquareClose);
                }
            },
            // Round brackets: (text)
            { 
                ALT: () => {
                    this.CONSUME(tokens.RoundOpen);
                    this.OPTION3(() => this.SUBRULE3(this.nodeContent));
                    this.CONSUME(tokens.RoundClose);
                }
            },
            // Double round: ((text)) (circle)
            { 
                ALT: () => {
                    this.CONSUME(tokens.DoubleRoundOpen);
                    this.OPTION4(() => this.SUBRULE4(this.nodeContent));
                    this.CONSUME(tokens.DoubleRoundClose);
                }
            },
            // Diamond: {text}
            { 
                ALT: () => {
                    this.CONSUME(tokens.DiamondOpen);
                    this.OPTION5(() => this.SUBRULE5(this.nodeContent));
                    this.CONSUME(tokens.DiamondClose);
                }
            },
            // Hexagon: {{text}}
            { 
                ALT: () => {
                    this.CONSUME(tokens.HexagonOpen);
                    this.OPTION6(() => this.SUBRULE6(this.nodeContent));
                    this.CONSUME(tokens.HexagonClose);
                }
            },
            // Stadium: ([text])
            { 
                ALT: () => {
                    this.CONSUME(tokens.StadiumOpen);
                    this.OPTION7(() => this.SUBRULE7(this.nodeContent));
                    this.CONSUME(tokens.StadiumClose);
                }
            },
            // Cylinder/Database: [(text)]
            { 
                ALT: () => {
                    this.CONSUME(tokens.CylinderOpen);
                    this.OPTION8(() => this.SUBRULE8(this.nodeContent));
                    this.CONSUME(tokens.CylinderClose);
                }
            }
        ]);
    });
    
    // Content inside node shapes - very flexible
    private nodeContent = this.RULE("nodeContent", () => {
        this.OR([
            { ALT: () => this.CONSUME(tokens.QuotedString) },
            { ALT: () => this.CONSUME(tokens.MultilineText) },
            { 
                ALT: () => {
                    // Unquoted text - can be many different tokens
                    this.AT_LEAST_ONE(() => {
                        this.OR2([
                            { ALT: () => this.CONSUME(tokens.Identifier) },
                            { ALT: () => this.CONSUME(tokens.Text) },
                            { ALT: () => this.CONSUME(tokens.NumberLiteral) },
                            { ALT: () => this.CONSUME(tokens.RoundOpen) },
                            { ALT: () => this.CONSUME(tokens.RoundClose) },
                            // Allow HTML-like tags (e.g., <br/>) inside labels
                            { ALT: () => this.CONSUME(tokens.AngleLess) },
                            { ALT: () => this.CONSUME(tokens.AngleOpen) },
                            { ALT: () => this.CONSUME(tokens.ForwardSlash) },
                            { ALT: () => this.CONSUME(tokens.Backslash) },
                            { ALT: () => this.CONSUME(tokens.Comma) },
                            { ALT: () => this.CONSUME(tokens.Colon) },
                            // HTML entities and ampersands inside labels
                            { ALT: () => this.CONSUME(tokens.Ampersand) },
                            { ALT: () => this.CONSUME(tokens.Semicolon) },
                            // Allow hyphens/lines inside labels without forcing them to be links
                            { ALT: () => this.CONSUME(tokens.TwoDashes) },
                            { ALT: () => this.CONSUME(tokens.Line) },
                            { ALT: () => this.CONSUME(tokens.ThickLine) },
                            { ALT: () => this.CONSUME(tokens.DottedLine) }
                        ]);
                    });
                }
            }
        ]);
    });
    
    // Links between nodes - all variations
    private link = this.RULE("link", () => {
        this.OR([
            // Arrows with inline text (e.g., -.text.-> or ==text==>)
            {
                ALT: () => {
                    this.OR2([
                        { ALT: () => this.CONSUME(tokens.DottedLine) },
                        { ALT: () => this.CONSUME(tokens.ThickLine) },
                        { ALT: () => this.CONSUME(tokens.TwoDashes) }
                    ]);
                    this.SUBRULE(this.linkTextInline);
                    this.OR3([
                        { ALT: () => this.CONSUME(tokens.ArrowRight) },
                        { ALT: () => this.CONSUME(tokens.DottedArrowRight) },
                        { ALT: () => this.CONSUME(tokens.ThickArrowRight) }
                    ]);
                }
            },
            // Inline text carrier patterns like '-.text.->' or '==text==>' tokenized as Text + '>'
            {
                ALT: () => {
                    this.CONSUME(tokens.Text, { LABEL: 'inlineCarrier' });
                    this.CONSUME(tokens.AngleOpen); // '>'
                }
            },
            // Regular arrows/lines
            { ALT: () => this.CONSUME2(tokens.BiDirectionalArrow) },
            { ALT: () => this.CONSUME2(tokens.CircleEndLine) },
            { ALT: () => this.CONSUME2(tokens.CrossEndLine) },
            { ALT: () => this.CONSUME2(tokens.ArrowRight) },
            { ALT: () => this.CONSUME2(tokens.ArrowLeft) },
            { ALT: () => this.CONSUME2(tokens.DottedArrowRight) },
            { ALT: () => this.CONSUME2(tokens.DottedArrowLeft) },
            { ALT: () => this.CONSUME2(tokens.ThickArrowRight) },
            { ALT: () => this.CONSUME2(tokens.ThickArrowLeft) },
            { ALT: () => this.CONSUME2(tokens.Line) },
            { ALT: () => this.CONSUME2(tokens.DottedLine) },
            { ALT: () => this.CONSUME2(tokens.ThickLine) },
            { ALT: () => this.CONSUME(tokens.InvalidArrow) } // Capture for error
        ]);
        
        // Optional link text in pipes |text|
        this.OPTION(() => {
            this.CONSUME(tokens.Pipe);
            this.SUBRULE(this.linkText);
            this.CONSUME2(tokens.Pipe);
        });
    });
    
    // Text inside link (between pipes)
    private linkText = this.RULE("linkText", () => {
        this.AT_LEAST_ONE(() => {
            this.OR([
                { ALT: () => this.CONSUME(tokens.Identifier) },
                { ALT: () => this.CONSUME(tokens.Text) },
                { ALT: () => this.CONSUME(tokens.NumberLiteral) }
            ]);
        });
    });
    
    // Inline link text (e.g., in -.text.-> or -- text -->)
    private linkTextInline = this.RULE("linkTextInline", () => {
        this.AT_LEAST_ONE(() => {
            this.OR([
                { ALT: () => this.CONSUME(tokens.Identifier) },
                { ALT: () => this.CONSUME(tokens.Text) },
                { ALT: () => this.CONSUME(tokens.NumberLiteral) },
                { ALT: () => this.CONSUME(tokens.Pipe) } // Sometimes used in inline
            ]);
        });
    });
    
    // Subgraph definition
    private subgraph = this.RULE("subgraph", () => {
        this.CONSUME(tokens.SubgraphKeyword);
        // Require at least an ID, a quoted title, or a title in brackets
        this.OR([
            {
                ALT: () => {
                    this.CONSUME(tokens.Identifier, { LABEL: 'subgraphId' });
                    this.OPTION(() => {
                        this.CONSUME1(tokens.SquareOpen);
                        this.SUBRULE(this.nodeContent);
                        this.CONSUME1(tokens.SquareClose);
                    });
                }
            },
            {
                ALT: () => {
                    // Quoted subgraph title: subgraph "My Title"
                    this.CONSUME(tokens.QuotedString, { LABEL: 'subgraphTitleQ' });
                }
            },
            {
                ALT: () => {
                    this.CONSUME2(tokens.SquareOpen);
                    this.SUBRULE2(this.nodeContent);
                    this.CONSUME2(tokens.SquareClose);
                }
            }
        ]);
        
        this.CONSUME(tokens.Newline);
        
        // Subgraph statements (allow nested direction changes inside subgraphs)
        this.MANY(() => {
            this.SUBRULE(this.subgraphStatement);
        });
        
        this.CONSUME(tokens.EndKeyword);
        this.OPTION3(() => {
            this.CONSUME2(tokens.Newline);
        });
    });

    // Statements allowed inside a subgraph (includes local direction changes)
    private subgraphStatement = this.RULE("subgraphStatement", () => {
        this.OR([
            { ALT: () => this.SUBRULE(this.directionStatement) },
            { ALT: () => this.SUBRULE(this.nodeStatement) },
            { ALT: () => this.SUBRULE(this.subgraph) },
            { ALT: () => this.SUBRULE(this.classStatement) },
            { ALT: () => this.SUBRULE(this.styleStatement) },
            { ALT: () => this.SUBRULE(this.classDefStatement) },
            { ALT: () => this.CONSUME(tokens.Newline) }
        ]);
    });

    // direction TB/RL/LR/BT as a standalone statement
    private directionStatement = this.RULE("directionStatement", () => {
        this.CONSUME(tokens.Identifier, { LABEL: 'dirKw' });
        this.CONSUME(tokens.Direction);
        this.OPTION(() => this.CONSUME(tokens.Newline));
    });
    
    // Class statement: class nodeId,nodeId2 className
    private classStatement = this.RULE("classStatement", () => {
        this.CONSUME(tokens.ClassKeyword);
        
        // Node IDs (comma-separated)
        this.CONSUME(tokens.Identifier);
        this.MANY(() => {
            this.CONSUME(tokens.Comma);
            this.CONSUME2(tokens.Identifier);
        });
        
        // Class name
        this.CONSUME3(tokens.Identifier, { LABEL: "className" });
        
        this.OPTION(() => {
            this.CONSUME(tokens.Newline);
        });
    });
    
    // Style statement: style nodeId fill:#f9f,stroke:#333
    private styleStatement = this.RULE("styleStatement", () => {
        this.CONSUME(tokens.StyleKeyword);
        this.CONSUME(tokens.Identifier);
        
        // Style properties - very flexible
        this.MANY(() => {
            this.OR([
                { ALT: () => this.CONSUME(tokens.Text) },
                { ALT: () => this.CONSUME2(tokens.Identifier) },
                { ALT: () => this.CONSUME(tokens.ColorValue) },
                { ALT: () => this.CONSUME(tokens.Colon) },
                { ALT: () => this.CONSUME(tokens.Comma) },
                { ALT: () => this.CONSUME(tokens.NumberLiteral) }
            ]);
        });
        
        this.OPTION(() => {
            this.CONSUME(tokens.Newline);
        });
    });
    
    // classDef statement: classDef className fill:#f9f
    private classDefStatement = this.RULE("classDefStatement", () => {
        this.CONSUME(tokens.ClassDefKeyword);
        this.CONSUME(tokens.Identifier);
        
        // Style properties
        this.MANY(() => {
            this.OR([
                { ALT: () => this.CONSUME(tokens.Text) },
                { ALT: () => this.CONSUME2(tokens.Identifier) },
                { ALT: () => this.CONSUME(tokens.ColorValue) },
                { ALT: () => this.CONSUME(tokens.Colon) },
                { ALT: () => this.CONSUME(tokens.Comma) },
                { ALT: () => this.CONSUME(tokens.NumberLiteral) }
            ]);
        });
        
        this.OPTION(() => {
            this.CONSUME(tokens.Newline);
        });
    });

    // Extend 'node' to support optional class annotations like A:::className
    // Note: update is kept here to avoid reordering rule definitions
    private _augmentNodeRule() {
        const originalNode = this.node;
        this.node = this.RULE("node", () => {
            // original content
            this.OR([
                { 
                    ALT: () => {
                        this.CONSUME(tokens.Identifier, { LABEL: "nodeId" });
                        this.OPTION(() => {
                            this.CONSUME(tokens.NumberLiteral, { LABEL: "nodeIdSuffix" });
                        });
                    }
                },
                { 
                    ALT: () => {
                        this.CONSUME2(tokens.NumberLiteral, { LABEL: "nodeIdNum" });
                    }
                }
            ]);
            this.OPTION2(() => {
                this.SUBRULE(this.nodeShape);
            });
            // Optional class annotation
            this.OPTION3(() => {
                this.CONSUME(tokens.TripleColon);
                this.CONSUME3(tokens.Identifier, { LABEL: 'nodeClass' });
            });
        });
    }
}

// Create parser instance
export const parserInstance = new MermaidParser();

// Helper function to parse input
export function parse(tokensArr: IToken[]) {
    parserInstance.input = tokensArr;
    const cst = parserInstance.diagram();
    // Do not log internal parser errors here; callers handle user-facing diagnostics.
    return {
        cst,
        errors: parserInstance.errors
    };
}
