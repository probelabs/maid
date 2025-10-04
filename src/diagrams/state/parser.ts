import { CstParser, EOF, type IToken } from 'chevrotain';
import * as t from './lexer.js';

export class StateParser extends CstParser {
  constructor() {
    super(t.allTokens);
    this.performSelfAnalysis();
  }

  public diagram = this.RULE('diagram', () => {
    this.OR([
      { ALT: () => this.CONSUME(t.StateDiagramV2) },
      { ALT: () => this.CONSUME(t.StateDiagram) },
    ]);
    this.OPTION(() => this.CONSUME(t.Newline));
    this.MANY(() => this.SUBRULE(this.statement));
  });

  private statement = this.RULE('statement', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.directionStmt) },
      { ALT: () => this.SUBRULE(this.transitionStmt) },
      { ALT: () => this.SUBRULE(this.stateBlock) },
      { ALT: () => this.SUBRULE(this.stateDecl) },
      // '---' only allowed inside state blocks; not at top level
      { ALT: () => this.SUBRULE(this.stateDescriptionStmt) },
      { ALT: () => this.SUBRULE(this.noteStmt) },
      { ALT: () => this.SUBRULE(this.styleStmt) },
      { ALT: () => this.CONSUME(t.Newline) },
    ]);
  });

  private styleStmt = this.RULE('styleStmt', () => {
    this.OR([
      {
        ALT: () => {
          this.CONSUME(t.StyleClassDefKw);
          this.OPTION1(() => this.CONSUME1(t.LabelChunk));
        }
      },
      {
        ALT: () => {
          this.CONSUME(t.StyleClassKw);
          this.OPTION2(() => this.CONSUME2(t.LabelChunk));
        }
      }
    ]);
    this.OPTION3(() => this.CONSUME(t.Newline));
  });

  private directionStmt = this.RULE('directionStmt', () => {
    this.CONSUME(t.DirectionKw);
    this.CONSUME(t.Direction);
    this.OPTION(() => this.CONSUME(t.Newline));
  });

  private actorRef = this.RULE('actorRef', () => {
    this.OR([
      { ALT: () => this.CONSUME(t.Start) },
      { ALT: () => this.CONSUME(t.HistoryDeep) },
      { ALT: () => this.CONSUME(t.HistoryShallow) },
      {
        ALT: () => {
          this.OR2([
            { ALT: () => this.CONSUME(t.Identifier) },
            { ALT: () => this.CONSUME(t.QuotedString) },
          ]);
          // Optional marker like <<choice>> / <<fork>> / <<join>>
          this.OPTION(() => {
            this.CONSUME(t.AngleAngleOpen);
            this.CONSUME2(t.Identifier);
            this.CONSUME(t.AngleAngleClose);
          });
        }
      }
    ]);
  });

  private labelText = this.RULE('labelText', () => {
    this.OR([
      { ALT: () => this.CONSUME(t.QuotedString) },
      { ALT: () => this.CONSUME(t.Identifier) },
      { ALT: () => this.CONSUME(t.NumberLiteral) },
      { ALT: () => this.CONSUME(t.Hyphen) },
      { ALT: () => this.CONSUME(t.LabelChunk) },
    ]);
  });

  // A --> B [: label]
  private transitionStmt = this.RULE('transitionStmt', () => {
    this.SUBRULE(this.actorRef);
    this.CONSUME(t.Arrow);
    this.SUBRULE2(this.actorRef);
    this.OPTION(() => {
      this.CONSUME(t.Colon);
      this.AT_LEAST_ONE(() => {
        this.OR([
          { ALT: () => this.CONSUME(t.QuotedString) },
          { ALT: () => this.CONSUME(t.Identifier) },
          { ALT: () => this.CONSUME(t.NumberLiteral) },
          { ALT: () => this.CONSUME(t.LabelChunk) },
        ]);
      });
    });
    this.OPTION2(() => this.CONSUME(t.Newline));
  });

  // state "desc" as s2   |   s2 : description
  private stateDecl = this.RULE('stateDecl', () => {
    this.CONSUME(t.StateKw);
    this.OR([
      {
        GATE: () => this.LA(1).tokenType === t.QuotedString,
        ALT: () => {
          this.CONSUME(t.QuotedString);
          this.CONSUME(t.AsKw);
          this.CONSUME(t.Identifier);
        }
      },
      {
        ALT: () => {
          this.CONSUME2(t.Identifier);
          this.OPTION1(() => {
            this.CONSUME(t.AngleAngleOpen);
            this.CONSUME3(t.Identifier);
            this.CONSUME(t.AngleAngleClose);
          });
        }
      }
    ]);
    this.OPTION2(() => this.CONSUME(t.Newline));
  });

  // state Foo { ... }
  private stateBlock = this.RULE('stateBlock', () => {
    this.CONSUME(t.StateKw);
    this.OR([
      { ALT: () => this.CONSUME(t.Identifier) },
      { ALT: () => this.CONSUME(t.QuotedString) },
    ]);
    this.CONSUME(t.LCurly);
    this.MANY(() => this.SUBRULE(this.innerStatement));
    this.CONSUME(t.RCurly);
    this.OPTION(() => this.CONSUME(t.Newline));
  });

  // Statements allowed inside a composite state, including region separators '---'
  private innerStatement = this.RULE('innerStatement', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.directionStmt) },
      { ALT: () => this.SUBRULE(this.transitionStmt) },
      { ALT: () => this.SUBRULE(this.stateBlock) },
      { ALT: () => this.SUBRULE(this.stateDecl) },
      { ALT: () => this.CONSUME(t.Dashes) },
      { ALT: () => this.SUBRULE(this.stateDescriptionStmt) },
      { ALT: () => this.SUBRULE(this.noteStmt) },
      { ALT: () => this.SUBRULE(this.styleStmt) },
      { ALT: () => this.CONSUME(t.Newline) },
    ]);
  });

  private noteStmt = this.RULE('noteStmt', () => {
    this.CONSUME(t.NoteKw);
    this.OR([
      {
        ALT: () => {
          this.CONSUME(t.LeftKw);
          this.CONSUME(t.OfKw);
          this.SUBRULE(this.actorRef);
        }
      },
      {
        ALT: () => {
          this.CONSUME(t.RightKw);
          this.CONSUME2(t.OfKw);
          this.SUBRULE2(this.actorRef);
        }
      },
      {
        ALT: () => {
          // Support 'Note over X[: text]' (and optionally 'Note over X,Y') like sequence syntax.
          // Mermaid state diagrams may not render this, but we accept it and let semantics/autofix normalize.
          this.CONSUME(t.OverKw);
          this.SUBRULE3(this.actorRef);
          this.OPTION1(() => { this.CONSUME(t.Comma); this.SUBRULE4(this.actorRef); });
        }
      }
    ]);
    this.CONSUME(t.Colon);
    this.AT_LEAST_ONE(() => this.SUBRULE(this.labelText));
    this.OPTION2(() => this.CONSUME(t.Newline));
  });

  // S1 : description
  private stateDescriptionStmt = this.RULE('stateDescriptionStmt', () => {
    this.OR1([
      { ALT: () => this.CONSUME1(t.Identifier) },
      { ALT: () => this.CONSUME1(t.QuotedString) },
    ]);
    this.CONSUME(t.Colon);
    this.AT_LEAST_ONE(() => {
      this.OR2([
        { ALT: () => this.CONSUME2(t.QuotedString) },
        { ALT: () => this.CONSUME2(t.Identifier) },
        { ALT: () => this.CONSUME1(t.NumberLiteral) },
        { ALT: () => this.CONSUME1(t.LabelChunk) },
      ]);
    });
    this.OPTION(() => this.CONSUME(t.Newline));
  });
}

export const parserInstance = new StateParser();
export function parse(tokens: IToken[]) {
  parserInstance.input = tokens;
  const cst = parserInstance.diagram();
  return { cst, errors: parserInstance.errors };
}
