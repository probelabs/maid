// Minimal frontmatter parser for Mermaid-style YAML blocks.
// Supports keys used in themes/config we care about without pulling a full YAML parser.

export interface Frontmatter {
  raw: string;
  body: string;
  bodyStartLine: number;
  config?: Record<string, any>;
  themeVariables?: Record<string, string>;
}

export function parseFrontmatter(input: string): Frontmatter | null {
  const text = input.startsWith('\ufeff') ? input.slice(1) : input; // strip BOM
  const lines = text.split(/\r?\n/);
  if (lines.length < 3 || lines[0].trim() !== '---') return null;

  let i = 1;
  const block: string[] = [];
  while (i < lines.length && lines[i].trim() !== '---') {
    block.push(lines[i]);
    i++;
  }
  if (i >= lines.length) return null; // no closing '---'

  const body = lines.slice(i + 1).join('\n');
  const bodyStartLine = i + 2; // 1-based line where diagram body starts
  const raw = block.join('\n');

  // Simple indentation-based parse for keys we care about
  const config: Record<string, any> = {};
  const themeVars: Record<string, string> = {};
  let themeUnderConfig = false;

  let ctx: 'root' | 'config' | 'config.pie' | 'theme' = 'root';

  for (const line of block) {
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const mKey = line.match(/^\s*([A-Za-z0-9_\-]+):\s*(.*)$/);
    if (!mKey) continue;
    const key = mKey[1];
    let value = mKey[2] || '';

    if (indent === 0) {
      if (key === 'config') { ctx = 'config'; continue; }
      if (key === 'themeVariables') { ctx = 'theme'; continue; }
      // unknown root key, ignore
      ctx = 'root';
      continue;
    }

    if (ctx === 'config') {
      if (indent <= 2 && key !== 'pie' && key !== 'themeVariables') continue;
      if (key === 'pie') { ctx = 'config.pie'; ensure(config, 'pie', {}); continue; }
      if (key === 'themeVariables') { ctx = 'theme'; themeUnderConfig = true; continue; }
      // ignore
      continue;
    }

    if (ctx === 'config.pie') {
      if (indent < 4) {
        // Treat as config-level line (same pass)
        if (key === 'pie') { ctx = 'config.pie'; ensure(config, 'pie', {}); continue; }
        if (key === 'themeVariables') { ctx = 'theme'; themeUnderConfig = true; continue; }
        ctx = 'config';
        continue;
      }
      setKV(config.pie, key, value);
      continue;
    }

    if (ctx === 'theme') {
      if (indent < 2) { ctx = 'root'; continue; }
      setKV(themeVars, key, value);
      continue;
    }
  }

  if (themeUnderConfig && Object.keys(themeVars).length) {
    ensure(config, 'themeVariables', {});
    Object.assign(config.themeVariables, themeVars);
  }
  return {
    raw,
    body,
    bodyStartLine,
    config: Object.keys(config).length ? config : undefined,
    themeVariables: Object.keys(themeVars).length ? themeVars : undefined
  };
}

function ensure(obj: Record<string, any>, key: string, def: any) {
  if (obj[key] == null) obj[key] = def;
}

function unquote(val: string): string {
  const v = val.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function setKV(target: Record<string, any>, key: string, rawValue: string) {
  const v = unquote(rawValue);
  if (v === '') { target[key] = ''; return; }
  // try number
  const num = Number(v);
  if (!Number.isNaN(num) && /^-?[0-9]+(\.[0-9]+)?$/.test(v)) { target[key] = num; return; }
  // boolean
  if (/^(true|false)$/i.test(v)) { target[key] = /^true$/i.test(v); return; }
  target[key] = v;
}
