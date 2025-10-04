import { CstParser, EOF, type IToken } from 'chevrotain';
import * as t from './lexer.js';

export class SequenceParser extends CstParser {
  constructor() {
    super(t.allTokens);
    this.performSelfAnalysis();
  }

  public diagram = this.RULE('diagram', () => {
    this.CONSUME(t.SequenceKeyword);
    this.MANY(() => this.CONSUME(t.Newline));
    this.MANY2(() => {
      this.SUBRULE(this.line);
    });
    this.OPTION(() => this.CONSUME(EOF));
  });

  private line = this.RULE('line', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.metaStmt) },
      { ALT: () => this.SUBRULE(this.participantDecl) },
      { ALT: () => this.SUBRULE(this.autonumberStmt) },
      { ALT: () => this.SUBRULE(this.noteStmt) },
      { ALT: () => this.SUBRULE(this.activateStmt) },
      { ALT: () => this.SUBRULE(this.deactivateStmt) },
      { ALT: () => this.SUBRULE(this.createStmt) },
      { ALT: () => this.SUBRULE(this.destroyStmt) },
      { ALT: () => this.SUBRULE(this.linkStmt) },
      { ALT: () => this.SUBRULE(this.propertiesStmt) },
      { ALT: () => this.SUBRULE(this.detailsStmt) },
      { ALT: () => this.SUBRULE(this.altBlock) },
      { ALT: () => this.SUBRULE(this.optBlock) },
      { ALT: () => this.SUBRULE(this.loopBlock) },
      { ALT: () => this.SUBRULE(this.parBlock) },
      { ALT: () => this.SUBRULE(this.criticalBlock) },
      { ALT: () => this.SUBRULE(this.breakBlock) },
      { ALT: () => this.SUBRULE(this.rectBlock) },
      { ALT: () => this.SUBRULE(this.boxBlock) },
      { ALT: () => this.SUBRULE(this.messageStmt) },
      { ALT: () => this.SUBRULE(this.blankLine) },
    ]);
  });

  private metaStmt = this.RULE('metaStmt', () => {
    this.OR([
      { ALT: () => this.CONSUME(t.TitleKeyword) },
      { ALT: () => this.CONSUME(t.AccTitleKeyword) },
      { ALT: () => this.CONSUME(t.AccDescrKeyword) },
    ]);
    this.OPTION(() => this.SUBRULE(this.lineRemainder));
    this.OR2([
      { ALT: () => this.AT_LEAST_ONE(() => this.CONSUME(t.Newline)) },
      { ALT: () => this.CONSUME(EOF) }
    ]);
  });

  private blankLine = this.RULE('blankLine', () => {
    this.AT_LEAST_ONE(() => this.CONSUME(t.Newline));
  });

  private actorRef = this.RULE('actorRef', () => {
    // Accept a sequence of tokens that form the actor name until 'as' or newline/arrow/punct
    this.AT_LEAST_ONE(() => this.OR([
      { ALT: () => this.CONSUME(t.Identifier) },
      { ALT: () => this.CONSUME(t.QuotedString) },
      { ALT: () => this.CONSUME(t.NumberLiteral) },
      { ALT: () => this.CONSUME(t.Text) },
    ]));
  });

  private participantDecl = this.RULE('participantDecl', () => {
    this.OR([
      { ALT: () => this.CONSUME(t.ParticipantKeyword) },
      { ALT: () => this.CONSUME(t.ActorKeyword) },
    ]);
    this.SUBRULE(this.actorRef);
    this.OPTION(() => {
      this.CONSUME(t.AsKeyword);
      this.SUBRULE2(this.actorRef);
    });
    this.OR2([
      { ALT: () => this.AT_LEAST_ONE(() => this.CONSUME(t.Newline)) },
      { ALT: () => this.CONSUME(EOF) }
    ]);
  });

  private autonumberStmt = this.RULE('autonumberStmt', () => {
    this.CONSUME(t.AutonumberKeyword);
    this.OPTION(() => {
      this.OR([
        { ALT: () => this.CONSUME(t.OffKeyword) },
        { ALT: () => {
          this.CONSUME(t.NumberLiteral);
          this.OPTION2(() => this.CONSUME2(t.NumberLiteral));
        } },
      ]);
    });
    this.OR2([
      { ALT: () => this.AT_LEAST_ONE(() => this.CONSUME(t.Newline)) },
      { ALT: () => this.CONSUME(EOF) }
    ]);
  });

  private noteStmt = this.RULE('noteStmt', () => {
    this.CONSUME(t.NoteKeyword);
    this.OR([
      { ALT: () => {
        this.OR2([
          { ALT: () => this.CONSUME(t.LeftKeyword) },
          { ALT: () => this.CONSUME(t.RightKeyword) },
        ]);
        this.CONSUME(t.OfKeyword);
        this.SUBRULE(this.actorRef);
      } },
      { ALT: () => {
        this.CONSUME(t.OverKeyword);
        this.SUBRULE2(this.actorRef);
        this.OPTION(() => {
          this.CONSUME(t.Comma);
          this.SUBRULE3(this.actorRef);
        });
      } }
    ]);
    this.CONSUME(t.Colon);
    this.OPTION2(() => this.SUBRULE(this.lineRemainder));
    this.OR3([
      { ALT: () => this.AT_LEAST_ONE(() => this.CONSUME(t.Newline)) },
      { ALT: () => this.CONSUME(EOF) }
    ]);
  });

  private activateStmt = this.RULE('activateStmt', () => {
    this.CONSUME(t.ActivateKeyword);
    this.SUBRULE(this.actorRef);
    this.OR2([
      { ALT: () => this.AT_LEAST_ONE(() => this.CONSUME(t.Newline)) },
      { ALT: () => this.CONSUME(EOF) }
    ]);
  });

  private deactivateStmt = this.RULE('deactivateStmt', () => {
    this.CONSUME(t.DeactivateKeyword);
    this.SUBRULE(this.actorRef);
    this.OR2([
      { ALT: () => this.AT_LEAST_ONE(() => this.CONSUME(t.Newline)) },
      { ALT: () => this.CONSUME(EOF) }
    ]);
  });

  private createStmt = this.RULE('createStmt', () => {
    this.CONSUME(t.CreateKeyword);
    this.OR([
      { ALT: () => this.CONSUME(t.ParticipantKeyword) },
      { ALT: () => this.CONSUME(t.ActorKeyword) },
    ]);
    this.SUBRULE(this.actorRef);
    this.OPTION(() => {
      this.CONSUME(t.AsKeyword);
      this.OPTION2(() => this.SUBRULE(this.lineRemainder));
    });
    this.OR2([
      { ALT: () => this.AT_LEAST_ONE(() => this.CONSUME(t.Newline)) },
      { ALT: () => this.CONSUME(EOF) }
    ]);
  });

  private destroyStmt = this.RULE('destroyStmt', () => {
    this.CONSUME(t.DestroyKeyword);
    this.OPTION(() => {
      this.OR([
        { ALT: () => this.CONSUME(t.ParticipantKeyword) },
        { ALT: () => this.CONSUME(t.ActorKeyword) },
      ]);
    });
    this.SUBRULE(this.actorRef);
    this.OR2([
      { ALT: () => this.AT_LEAST_ONE(() => this.CONSUME(t.Newline)) },
      { ALT: () => this.CONSUME(EOF) }
    ]);
  });

  private linkStmt = this.RULE('linkStmt', () => {
    this.OR([
      { ALT: () => this.CONSUME(t.LinkKeyword) },
      { ALT: () => this.CONSUME(t.LinksKeyword) },
    ]);
    this.SUBRULE(this.actorRef);
    this.CONSUME(t.Colon);
    this.OPTION(() => this.SUBRULE(this.lineRemainder));
    this.OR2([
      { ALT: () => this.AT_LEAST_ONE(() => this.CONSUME(t.Newline)) },
      { ALT: () => this.CONSUME(EOF) }
    ]);
  });

  private propertiesStmt = this.RULE('propertiesStmt', () => {
    this.CONSUME(t.PropertiesKeyword);
    this.OPTION(() => this.CONSUME(t.Colon));
    this.OPTION1(() => this.SUBRULE(this.lineRemainder));
    this.OR2([
      { ALT: () => this.AT_LEAST_ONE(() => this.CONSUME(t.Newline)) },
      { ALT: () => this.CONSUME(EOF) }
    ]);
  });

  private detailsStmt = this.RULE('detailsStmt', () => {
    this.CONSUME(t.DetailsKeyword);
    this.OPTION(() => this.CONSUME(t.Colon));
    this.OPTION1(() => this.SUBRULE(this.lineRemainder));
    this.OR2([
      { ALT: () => this.AT_LEAST_ONE(() => this.CONSUME(t.Newline)) },
      { ALT: () => this.CONSUME(EOF) }
    ]);
  });

  private messageStmt = this.RULE('messageStmt', () => {
    this.SUBRULE(this.actorRef);
    this.SUBRULE(this.arrow);
    this.OPTION(() => this.OR([
      { ALT: () => this.CONSUME(t.Plus) },
      { ALT: () => this.CONSUME(t.Minus) }
    ]));
    this.SUBRULE2(this.actorRef);
    this.CONSUME(t.Colon);
    this.OPTION2(() => this.SUBRULE(this.lineRemainder));
    this.OR2([
      { ALT: () => this.AT_LEAST_ONE(() => this.CONSUME(t.Newline)) },
      { ALT: () => this.CONSUME(EOF) }
    ]);
  });

  private arrow = this.RULE('arrow', () => {
    this.OR([
      { ALT: () => this.CONSUME(t.BidirAsyncDotted) },
      { ALT: () => this.CONSUME(t.BidirAsync) },
      { ALT: () => this.CONSUME(t.DottedAsync) },
      { ALT: () => this.CONSUME(t.Async) },
      { ALT: () => this.CONSUME(t.Dotted) },
      { ALT: () => this.CONSUME(t.Solid) },
      { ALT: () => this.CONSUME(t.DottedCross) },
      { ALT: () => this.CONSUME(t.Cross) },
      { ALT: () => this.CONSUME(t.DottedOpen) },
      { ALT: () => this.CONSUME(t.Open) },
    ]);
  });

  // Blocks
  private altBlock = this.RULE('altBlock', () => {
    this.CONSUME(t.AltKeyword);
    this.OPTION(() => this.SUBRULE(this.lineRemainder));
    this.AT_LEAST_ONE(() => this.CONSUME(t.Newline));
    this.MANY(() => this.SUBRULE(this.line));
    this.MANY2(() => {
      this.CONSUME(t.ElseKeyword);
      this.OPTION2(() => this.SUBRULE2(this.lineRemainder));
      this.AT_LEAST_ONE2(() => this.CONSUME2(t.Newline));
      this.MANY3(() => this.SUBRULE2(this.line));
    });
    this.CONSUME(t.EndKeyword);
    this.OR3([
      { ALT: () => this.AT_LEAST_ONE3(() => this.CONSUME3(t.Newline)) },
      { ALT: () => this.CONSUME3(EOF) }
    ]);
  });

  private optBlock = this.RULE('optBlock', () => {
    this.CONSUME(t.OptKeyword);
    this.OPTION(() => this.SUBRULE(this.lineRemainder));
    this.AT_LEAST_ONE(() => this.CONSUME(t.Newline));
    this.MANY(() => this.SUBRULE(this.line));
    this.CONSUME(t.EndKeyword);
    this.OR2([
      { ALT: () => this.AT_LEAST_ONE2(() => this.CONSUME2(t.Newline)) },
      { ALT: () => this.CONSUME2(EOF) }
    ]);
  });

  private loopBlock = this.RULE('loopBlock', () => {
    this.CONSUME(t.LoopKeyword);
    this.OPTION(() => this.SUBRULE(this.lineRemainder));
    this.AT_LEAST_ONE(() => this.CONSUME(t.Newline));
    this.MANY(() => this.SUBRULE(this.line));
    this.CONSUME(t.EndKeyword);
    this.OR2([
      { ALT: () => this.AT_LEAST_ONE2(() => this.CONSUME2(t.Newline)) },
      { ALT: () => this.CONSUME2(EOF) }
    ]);
  });

  private parBlock = this.RULE('parBlock', () => {
    this.CONSUME(t.ParKeyword);
    this.OPTION(() => this.SUBRULE(this.parHeader));
    this.AT_LEAST_ONE(() => this.CONSUME(t.Newline));
    this.MANY(() => this.SUBRULE(this.line));
    this.MANY2(() => {
      this.CONSUME(t.AndKeyword);
      this.OPTION2(() => this.SUBRULE2(this.lineRemainder));
      this.AT_LEAST_ONE2(() => this.CONSUME2(t.Newline));
      this.MANY3(() => this.SUBRULE2(this.line));
    });
    this.CONSUME(t.EndKeyword);
    this.OR3([
      { ALT: () => this.AT_LEAST_ONE3(() => this.CONSUME3(t.Newline)) },
      { ALT: () => this.CONSUME3(EOF) }
    ]);
  });

  private parHeader = this.RULE('parHeader', () => {
    this.OR([
      {
        GATE: () => this.LA(1).tokenType === t.OverKeyword,
        ALT: () => {
          this.CONSUME(t.OverKeyword);
          this.SUBRULE(this.actorRef);
          this.OPTION(() => { this.CONSUME(t.Comma); this.SUBRULE2(this.actorRef); });
          this.OPTION1(() => this.SUBRULE(this.lineRemainder));
        }
      },
      { ALT: () => this.SUBRULE2(this.lineRemainder) }
    ]);
  });

  private criticalBlock = this.RULE('criticalBlock', () => {
    this.CONSUME(t.CriticalKeyword);
    this.OPTION(() => this.SUBRULE(this.lineRemainder));
    this.AT_LEAST_ONE(() => this.CONSUME(t.Newline));
    this.MANY(() => this.SUBRULE(this.line));
    this.MANY2(() => {
      this.CONSUME(t.OptionKeyword);
      this.OPTION2(() => this.SUBRULE2(this.lineRemainder));
      this.AT_LEAST_ONE2(() => this.CONSUME2(t.Newline));
      this.MANY3(() => this.SUBRULE2(this.line));
    });
    this.CONSUME(t.EndKeyword);
    this.AT_LEAST_ONE3(() => this.CONSUME3(t.Newline));
  });

  private breakBlock = this.RULE('breakBlock', () => {
    this.CONSUME(t.BreakKeyword);
    this.OPTION(() => this.SUBRULE(this.lineRemainder));
    this.AT_LEAST_ONE(() => this.CONSUME(t.Newline));
    this.MANY(() => this.SUBRULE(this.line));
    this.CONSUME(t.EndKeyword);
    this.OR2([
      { ALT: () => this.AT_LEAST_ONE2(() => this.CONSUME2(t.Newline)) },
      { ALT: () => this.CONSUME2(EOF) }
    ]);
  });

  private rectBlock = this.RULE('rectBlock', () => {
    this.CONSUME(t.RectKeyword);
    this.OPTION(() => this.SUBRULE(this.lineRemainder));
    this.AT_LEAST_ONE(() => this.CONSUME(t.Newline));
    this.MANY(() => this.SUBRULE(this.line));
    this.CONSUME(t.EndKeyword);
    this.OR2([
      { ALT: () => this.AT_LEAST_ONE2(() => this.CONSUME2(t.Newline)) },
      { ALT: () => this.CONSUME2(EOF) }
    ]);
  });

  private boxBlock = this.RULE('boxBlock', () => {
    this.CONSUME(t.BoxKeyword);
    this.OPTION(() => this.SUBRULE(this.lineRemainder));
    this.AT_LEAST_ONE(() => this.CONSUME(t.Newline));
    this.MANY(() => this.OR([
      { ALT: () => this.SUBRULE(this.participantDecl) },
      { ALT: () => this.SUBRULE(this.blankLine) },
    ]));
    this.CONSUME(t.EndKeyword);
    this.OR2([
      { ALT: () => this.AT_LEAST_ONE2(() => this.CONSUME2(t.Newline)) },
      { ALT: () => this.CONSUME2(EOF) }
    ]);
  });

  private lineRemainder = this.RULE('lineRemainder', () => {
    this.AT_LEAST_ONE(() => this.OR([
      { ALT: () => this.CONSUME(t.Identifier) },
      { ALT: () => this.CONSUME(t.NumberLiteral) },
      { ALT: () => this.CONSUME(t.QuotedString) },
      { ALT: () => this.CONSUME(t.Text) },
      { ALT: () => this.CONSUME(t.Plus) },
      { ALT: () => this.CONSUME(t.Minus) },
      { ALT: () => this.CONSUME(t.Comma) },
      { ALT: () => this.CONSUME(t.Colon) },
      { ALT: () => this.CONSUME(t.LParen) },
      { ALT: () => this.CONSUME(t.RParen) },
      // Allow any keywords if they happen to appear in text
      { ALT: () => this.CONSUME(t.AndKeyword) },
      { ALT: () => this.CONSUME(t.ElseKeyword) },
      { ALT: () => this.CONSUME(t.OptKeyword) },
      { ALT: () => this.CONSUME(t.OptionKeyword) },
      { ALT: () => this.CONSUME(t.LoopKeyword) },
      { ALT: () => this.CONSUME(t.ParKeyword) },
      { ALT: () => this.CONSUME(t.RectKeyword) },
      { ALT: () => this.CONSUME(t.CriticalKeyword) },
      { ALT: () => this.CONSUME(t.BreakKeyword) },
      { ALT: () => this.CONSUME(t.BoxKeyword) },
      { ALT: () => this.CONSUME(t.EndKeyword) },
      { ALT: () => this.CONSUME(t.TitleKeyword) },
      { ALT: () => this.CONSUME(t.AccTitleKeyword) },
      { ALT: () => this.CONSUME(t.AccDescrKeyword) },
      { ALT: () => this.CONSUME(t.NoteKeyword) },
      { ALT: () => this.CONSUME(t.LeftKeyword) },
      { ALT: () => this.CONSUME(t.RightKeyword) },
      { ALT: () => this.CONSUME(t.OverKeyword) },
      { ALT: () => this.CONSUME(t.OfKeyword) },
      { ALT: () => this.CONSUME(t.AutonumberKeyword) },
      { ALT: () => this.CONSUME(t.OffKeyword) },
      { ALT: () => this.CONSUME(t.LinkKeyword) },
      { ALT: () => this.CONSUME(t.LinksKeyword) },
      { ALT: () => this.CONSUME(t.CreateKeyword) },
      { ALT: () => this.CONSUME(t.DestroyKeyword) },
      { ALT: () => this.CONSUME(t.ParticipantKeyword) },
      { ALT: () => this.CONSUME(t.ActorKeyword) },
      { ALT: () => this.CONSUME(t.ActivateKeyword) },
      { ALT: () => this.CONSUME(t.DeactivateKeyword) },
    ]));
  });
}

export const parserInstance = new SequenceParser();

export function parse(tokens: IToken[]) {
  parserInstance.input = tokens as any;
  const cst = (parserInstance as any).diagram();
  return { cst, errors: parserInstance.errors };
}
