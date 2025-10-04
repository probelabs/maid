import type { CstNode, IToken } from 'chevrotain';

export function textFromTokens(tokens: IToken[] | undefined): string {
  if (!tokens || tokens.length === 0) return '';
  const parts: string[] = [];
  for (const t of tokens) {
    const img = t.image ?? '';
    const name = (t as any).tokenType?.name as string | undefined;
    if (name === 'QuotedString') {
      if (img.startsWith('"') && img.endsWith('"')) parts.push(img.slice(1, -1));
      else if (img.startsWith("'") && img.endsWith("'")) parts.push(img.slice(1, -1));
      else parts.push(img);
    } else {
      parts.push(img);
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function actorRefToText(refCst: CstNode | undefined): string {
  if (!refCst) return '';
  const ch = (refCst.children || {}) as any;
  const toks: IToken[] = [];
  ['Identifier','QuotedString','NumberLiteral','Text'].forEach((k) => {
    const a = ch[k] as IToken[] | undefined; a?.forEach(t => toks.push(t));
  });
  toks.sort((a,b) => (a.startOffset ?? 0) - (b.startOffset ?? 0));
  return textFromTokens(toks);
}

export function lineRemainderToText(lineRem: CstNode | undefined): string | undefined {
  if (!lineRem) return undefined;
  const ch = (lineRem.children || {}) as any;
  const toks: IToken[] = [];
  const order = [
    'Identifier','NumberLiteral','QuotedString','Text','Plus','Minus','Comma','Colon','LParen','RParen'
  ];
  for (const k of order) (ch[k] as IToken[] | undefined)?.forEach(t => toks.push(t));
  toks.sort((a,b) => (a.startOffset ?? 0) - (b.startOffset ?? 0));
  const txt = textFromTokens(toks);
  return txt || undefined;
}

