import { CstParser, EOF, type IToken } from 'chevrotain';
import * as t from './lexer.js';

export class ClassParser extends CstParser {
  constructor() {
    super(t.allTokens);
    this.performSelfAnalysis();
  }

  public diagram = this.RULE('diagram', () => {
    this.CONSUME(t.ClassDiagramKeyword);
    this.OPTION(() => this.CONSUME(t.Newline));
    this.MANY(() => this.SUBRULE(this.statement));
  });

  private statement = this.RULE('statement', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.directionStmt) },
      { ALT: () => this.SUBRULE(this.classLine) },
      { ALT: () => this.SUBRULE(this.relationStmt) },
      { ALT: () => this.SUBRULE(this.noteStmt) },
      { ALT: () => this.SUBRULE(this.memberAssignStmt) },
      { ALT: () => this.CONSUME(t.Newline) },
    ]);
  });

  private directionStmt = this.RULE('directionStmt', () => {
    this.CONSUME(t.DirectionKw);
    this.CONSUME(t.Direction);
    this.OPTION(() => this.CONSUME(t.Newline));
  });

  // Unified class line: either a declaration with optional stereotype/alias or a block
  private classLine = this.RULE('classLine', () => {
    this.CONSUME(t.ClassKw);
    this.SUBRULE(this.classRef);
    this.OR([
      {
        ALT: () => {
          this.CONSUME(t.LCurly);
          this.MANY(() => {
            this.OR2([
              { ALT: () => this.CONSUME3(t.Newline) },
              { ALT: () => this.SUBRULE(this.memberLineStmt) },
            ]);
          });
          this.CONSUME(t.RCurly);
          this.OPTION(() => this.CONSUME(t.Newline));
        }
      },
      {
        ALT: () => {
          // Optional bracket label: class X ["Label"]
          this.OPTION1(() => {
            this.CONSUME(t.SquareOpen);
            this.CONSUME(t.QuotedString);
            this.CONSUME(t.SquareClose);
          });
          this.OPTION2(() => {
            this.CONSUME(t.LTlt);
            this.CONSUME2(t.Identifier);
            this.CONSUME(t.GTgt);
          });
          this.OPTION3(() => {
            this.CONSUME(t.AsKw);
            this.CONSUME3(t.Identifier);
          });
          this.OPTION4(() => this.CONSUME2(t.Newline));
        }
      }
    ]);
  });

  // Foo : +bar()
  private memberAssignStmt = this.RULE('memberAssignStmt', () => {
    this.SUBRULE(this.classRef);
    this.CONSUME(t.Colon);
    this.SUBRULE(this.memberLine);
    this.OPTION(() => this.CONSUME(t.Newline));
  });

  private memberLineStmt = this.RULE('memberLineStmt', () => {
    this.SUBRULE(this.memberLine);
  });

  private memberLine = this.RULE('memberLine', () => {
    this.OR([
      {
        GATE: () => this.LA(1).tokenType === t.LTlt,
        ALT: () => { this.CONSUME(t.LTlt); this.CONSUME(t.Identifier); this.CONSUME(t.GTgt); }
      },
      {
        ALT: () => {
          this.OPTION(() => this.CONSUME(t.Visibility));
          // Optional name before params unless next token is '('
          this.OPTION1({
            GATE: () => this.LA(1).tokenType !== t.LParen,
            DEF: () => this.SUBRULE(this.memberName)
          });
          this.OPTION2(() => {
            this.CONSUME(t.LParen);
            this.OPTION3(() => this.SUBRULE(this.argList));
            this.CONSUME(t.RParen);
          });
          this.OPTION4(() => {
            this.CONSUME(t.Colon);
            this.SUBRULE(this.typeRef);
          });
        }
      }
    ]);
  });

  private memberName = this.RULE('memberName', () => {
    this.OR([
      { ALT: () => this.CONSUME(t.Identifier) },
      { ALT: () => this.CONSUME(t.QuotedString) },
    ]);
  });

  private param = this.RULE('param', () => {
    this.OPTION(() => { this.CONSUME(t.Identifier); this.CONSUME(t.Colon); });
    this.SUBRULE(this.typeRef);
  });

  private argList = this.RULE('argList', () => {
    this.SUBRULE(this.param);
    this.MANY(() => {
      this.CONSUME(t.Comma);
      this.SUBRULE2(this.param);
    });
  });

  private typeRef = this.RULE('typeRef', () => {
    this.OR([
      { ALT: () => this.CONSUME(t.Identifier) },
      { ALT: () => this.CONSUME(t.NumberLiteral) },
      { ALT: () => this.CONSUME(t.QuotedString) },
    ]);
  });

  private noteStmt = this.RULE('noteStmt', () => {
    this.CONSUME(t.NoteKw);
    this.OPTION(() => this.CONSUME(t.ForKw));
    this.SUBRULE(this.classRef);
    this.OPTION1(() => this.CONSUME(t.Colon));
    this.OR([
      { ALT: () => this.CONSUME(t.QuotedString) },
      { ALT: () => this.CONSUME(t.Identifier) },
      { ALT: () => this.CONSUME(t.NumberLiteral) },
    ]);
    this.OPTION2(() => this.CONSUME(t.Newline));
  });

  private relationOp = this.RULE('relationOp', () => {
    this.OR([
      { ALT: () => this.CONSUME(t.RelCompToAgg) },
      { ALT: () => this.CONSUME(t.RelAggToComp) },
      { ALT: () => this.CONSUME(t.RelCompBoth) },
      { ALT: () => this.CONSUME(t.RelAggBoth) },
      { ALT: () => this.CONSUME(t.LollipopLeft) },
      { ALT: () => this.CONSUME(t.LollipopRight) },
      { ALT: () => this.CONSUME(t.RelExtends) },
      { ALT: () => this.CONSUME(t.RelExtendsRight) },
      { ALT: () => this.CONSUME(t.RelComposition) },
      { ALT: () => this.CONSUME(t.RelAggregation) },
      { ALT: () => this.CONSUME(t.RelRealization) },
      { ALT: () => this.CONSUME(t.RelDependency) },
      { ALT: () => this.CONSUME(t.RelRealizationLeft) },
      { ALT: () => this.CONSUME(t.RelDependencyLeft) },
      { ALT: () => this.CONSUME(t.RelAssociation) },
    ]);
  });

  private classRef = this.RULE('classRef', () => {
    this.OR([
      { ALT: () => { this.CONSUME(t.Identifier); this.OPTION(() => this.CONSUME(t.GenericAngle)); } },
      { ALT: () => this.CONSUME(t.QuotedString) },
      { ALT: () => this.CONSUME(t.BacktickName) },
    ]);
  });

  private labelText = this.RULE('labelText', () => {
    this.OR([
      { ALT: () => this.CONSUME(t.QuotedString) },
      { ALT: () => this.CONSUME(t.Identifier) },
      { ALT: () => this.CONSUME(t.NumberLiteral) },
      { ALT: () => this.CONSUME(t.GenericAngle) },
    ]);
  });

  // Foo ["1..*"] <op> ["0..1"] Bar [: Label]
  private relationStmt = this.RULE('relationStmt', () => {
    this.SUBRULE(this.classRef);
    this.OPTION1(() => this.CONSUME(t.QuotedString, { LABEL: 'leftCard' }));
    this.SUBRULE(this.relationOp);
    this.OPTION2(() => this.CONSUME2(t.QuotedString, { LABEL: 'rightCard' }));
    this.SUBRULE2(this.classRef);
    this.OPTION3(() => {
      this.CONSUME(t.Colon);
      this.AT_LEAST_ONE_SEP({
        SEP: t.Comma,
        DEF: () => this.SUBRULE(this.labelText),
      });
    });
    this.OPTION4(() => this.CONSUME(t.Newline));
  });
}

export const parserInstance = new ClassParser();
export function parse(tokens: IToken[]) {
  parserInstance.input = tokens;
  const cst = parserInstance.diagram();
  return { cst, errors: parserInstance.errors };
}
