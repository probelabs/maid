#!/usr/bin/env node
/* eslint-disable no-console */
import assert from 'assert';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outRoot = path.resolve(__dirname, '..', 'out');
const router = await import(path.join(outRoot, 'core', 'router.js'));
const fixes = await import(path.join(outRoot, 'core', 'fixes.js'));
const edits = await import(path.join(outRoot, 'core', 'edits.js'));

function validate(text, opts = {}) { return router.validate(text, opts).errors; }
function applyFixes(text, level = 'safe', opts = {}) {
  let current = text;
  for (let i = 0; i < 3; i++) {
    const res = router.validate(current, opts);
    const es = fixes.computeFixes(current, res.errors, level);
    if (!es.length) return current;
    const next = edits.applyEdits(current, es);
    if (next === current) return current;
    current = next;
  }
  return current;
}

function expectValid(text, opts = {}) {
  const errs = validate(text, opts);
  assert.strictEqual(errs.filter(e => e.severity === 'error').length, 0, 'Expected no errors');
}

const cases = [
  {
    name: 'FL-ARROW-INVALID',
    before: 'flowchart TD\nA -> B\n',
    after:  'flowchart TD\nA --> B\n'
  },
  {
    name: 'FL-LABEL-ESCAPED-QUOTE',
    before: 'flowchart TD\nA["He said \\"Hi\\""]\n'
  },
  {
    name: 'FL-LABEL-DOUBLE-IN-SINGLE',
    before: "flowchart TD\nA['He said \"Hi\"']\n",
    after:  "flowchart TD\nA['He said &quot;Hi&quot;']\n"
  },
  {
    name: 'FL-DIR-KW-INVALID',
    before: 'flowchart TD\nsubgraph S\n  foo TB\nend\n',
    after:  'flowchart TD\nsubgraph S\n  direction TB\nend\n'
  },
  {
    name: 'FL-DIR-MISSING',
    before: 'flowchart\n',
    after:  'flowchart TD\n'
  },
  {
    name: 'FL-LABEL-DOUBLE-IN-SINGLE (whole-label)',
    before: "flowchart LR\n  A['She said \"Hello\"'] --> B\n",
    after:  "flowchart LR\n  A['She said &quot;Hello&quot;'] --> B\n"
  },
  {
    name: 'FL-LABEL-DOUBLE-IN-DOUBLE (decision)',
    before: 'flowchart TD\n  A[Start] --> B{Custom Auth Enabled?}\n  B -- Yes --> C{"Is "Driver" configured?"}\n',
    // We only assert validity after fixes; exact text may vary by heuristic
  },
  {
    name: 'FL-LABEL-ESCAPED-QUOTE (decision full-span)',
    before: 'flowchart TD\n  B -- Yes --> D{"Is \\\"Driver\\\" AND \\\"AuthCheck.Path\\\" configured?"}\n'
  },
  {
    name: 'FL-LABEL-PARENS-UNQUOTED (wrap in quotes when parentheses present)',
    before: 'flowchart TD\n  E[Component e.g., CheckExecutionEngine] --> F[Calls logger.debug("message", data)];\n',
    after:  'flowchart TD\n  E[Component e.g., CheckExecutionEngine] --> F["Calls logger.debug(&quot;message&quot;, data)"];\n'
  },
  {
    name: 'FL-LABEL-PARENS-UNQUOTED (decision, issue #60)',
    before: 'flowchart TD\n  D1{Tics cause functional impairment (pain)?}\n  D1 --> B1[Offer therapy (CBIT)]\n',
    after:  'flowchart TD\n  D1{"Tics cause functional impairment (pain)?"}\n  D1 --> B1["Offer therapy (CBIT)"]\n'
  },
  {
    name: 'FL-QUOTE-UNCLOSED (all)',
    before: 'flowchart TD\n  A["Unclosed label]\n  A --> B\n',
    after:  'flowchart TD\n  A["Unclosed label"]\n  A --> B\n',
    afterLevel: 'all'
  },
  {
    name: 'FL-LINK-MISSING (all)',
    before: 'flowchart TD\nA[Foo] B[Bar]\n',
    after:  'flowchart TD\nA[Foo]  --> B[Bar]\n',
    afterLevel: 'all'
  },
  {
    name: 'FL-NODE-UNCLOSED-BRACKET',
    before: 'flowchart TD\nA[Label\n',
    afterLevel: 'all', // we treat as insertion; still valid
  },
  {
    name: 'FL-NODE-UNCLOSED-BRACKET (double-circle all)',
    before: 'flowchart TD\nA(( --> B\n',
    after:  'flowchart TD\nA((A))--> B\n',
    afterLevel: 'all'
  },
  {
    name: 'FL-NODE-EMPTY (strip brackets)',
    before: 'flowchart TD\n    A["\"] --> B[" "]\n    B --> C[]\n',
    after:  'flowchart TD\n    A --> B\n    B --> C\n'
  },
  // Note: Flowchart quote-wrapping heuristics are intentionally not auto-fixed.
  // Pie
  { name: 'PI-LABEL-REQUIRES-QUOTES', before: 'pie\nDogs : 10\n', after: 'pie\n"Dogs" : 10\n' },
  { name: 'PI-MISSING-COLON', before: 'pie\n"Dogs" 10\n', after: 'pie\n"Dogs"  : 10\n' },
  { name: 'PI-LABEL-ESCAPED-QUOTE', before: 'pie\n"He \\"said\\"" : 1\n' },
  {
    name: 'FL-NODE-MIXED-BRACKETS (safe)',
    before: 'flowchart LR\n  A[Text] --> B(Text]\n  B --> C\n',
    after:  'flowchart LR\n  A[Text] --> B[Text]\n  B --> C\n'
  },
  {
    name: 'FL-NODE-UNCLOSED-BRACKET (complex closers)',
    before: 'flowchart LR\n  X{{Hexagon]\n  S([Stadium})\n  Y[(Cylinder))\n',
    after:  'flowchart LR\n  X{{Hexagon}}\n  S([Stadium])\n  Y[(Cylinder)]\n'
  },
  {
    name: 'FL-LABEL-ESCAPED-QUOTE (full-span)',
    before: 'flowchart LR\n  A["Node with quotes"] --> B["Another \\"quoted\\" node"]\n',
    after:  'flowchart LR\n  A["Node with quotes"] --> B["Another &quot;quoted&quot; node"]\n'
  },
  {
    name: 'FL-LABEL-ESCAPED-QUOTE (stadium)',
    before: 'flowchart LR\n  A(["quoted\\" text"])\n',
    after:  'flowchart LR\n  A(["quoted&quot; text"])\n'
  },
  {
    name: 'FL-LABEL-PARENS-UNQUOTED (wrap in quotes)',
    before: 'flowchart TD\n  D[Mark Parent as Failed (Fatal)]\n',
    after:  'flowchart TD\n  D["Mark Parent as Failed (Fatal)"]\n'
  },
  {
    name: 'FL-LABEL-QUOTE-IN-UNQUOTED (emoji tip)',
    before: 'flowchart TD\n  F --> G[Print: "💡 Tip: Try using synonyms..."]\n',
    after:  'flowchart TD\n  F --> G[Print: &quot;💡 Tip: Try using synonyms...&quot;]\n'
  },
  {
    name: 'FL-LABEL-AT-IN-UNQUOTED (wrap in quotes)',
    before: 'flowchart TD\n  A[package.json] --> B[@probelabs/probe v0.6.0-rc149]\n',
    after:  'flowchart TD\n  A[package.json] --> B["@probelabs/probe v0.6.0-rc149"]\n'
  },
  {
    name: 'FL-LABEL-SLASH-UNQUOTED (wrap in quotes)',
    before: 'flowchart TD\n  A[/dev/tty unavailable]\n',
    after:  'flowchart TD\n  A["/dev/tty unavailable"]\n'
  },
  {
    name: 'FL-LABEL-CURLY-IN-UNQUOTED (encode braces)',
    before: 'flowchart TD\n  C[Substitute {params}]\n',
    after:  'flowchart TD\n  C[Substitute &#123;params&#125;]\n'
  },
  {
    name: 'FL-LABEL-BRACKET-IN-UNQUOTED (encode brackets)',
    before: 'flowchart TD\n  A[bind_paths[]]\n',
    after:  'flowchart TD\n  A[bind_paths&#91;&#93;]\n'
  },
  {
    name: 'FL-LABEL-BRACKET-IN-UNQUOTED (mixed hazards fall back to quoting)',
    before: 'flowchart TD\n  A[foo(bar[])]\n',
    after:  'flowchart TD\n  A["foo(bar[])"]\n'
  },
  {
    name: 'FL-EDGE-LABEL-BACKTICK (inline edge label to pipe)',
    before: 'flowchart TD\nA --> B -- Detects `tip` --> C\n',
    after:  'flowchart TD\nA --> B --|Detects tip|--> C\n'
  },
  {
    name: 'FL-EDGE-LABEL-QUOTED (quotes to pipes)',
    before: 'flowchart LR\n  A -- \"renders cards via\" --> B\n',
    after:  'flowchart LR\n  A --|renders cards via|--> B\n'
  },

  {
    name: 'FL-EDGE-LABEL-BRACKET (encode square brackets)',
    before: 'flowchart TD\nA -->|run: [aggregate]| B\n',
    after:  'flowchart TD\nA -->|run: &#91;aggregate&#93;| B\n'
  },
  {
    name: 'FL-EDGE-LABEL-BRACKET (multiple labels, encoded braces inside)',
    before: 'graph TD\nA -->|ai.tool_calls: [&#123;name, args&#125;]| B\nA -->|ai.tool_calls: [&#123;name, args&#125;]| C\n',
    after:  'graph TD\nA -->|ai.tool_calls: &#91;&#123;name, args&#125;&#93;| B\nA -->|ai.tool_calls: &#91;&#123;name, args&#125;&#93;| C\n'
  },
  {
    name: 'FL-EDGE-LABEL-CURLY-IN-PIPES (encode braces)',
    before: 'flowchart TD\nA -->|Resolve ${VAR}| B\n',
    after:  'flowchart TD\nA -->|Resolve $&#123;VAR&#125;| B\n'
  },
  {
    name: 'FL-EDGE-LABEL-QUOTE-IN-PIPES (encode quotes)',
    before: 'graph TD\nA -->|e.g. \"navigate to example.com\"| B\n',
    after:  'graph TD\nA -->|e.g. &quot;navigate to example.com&quot;| B\n'
  },
  // FL-LABEL-CURLY-IN-QUOTED is not auto-fixable because:
  // 1. Curly braces work perfectly in quoted labels
  // 2. Mermaid doesn't decode numeric HTML entities (&#123;/&#125;)
  // 3. There's no viable workaround
  // Parallelogram/trapezoid shapes: encode both parentheses and quotes
  // (After stricter parser, FL-LABEL-PARENS-UNQUOTED is detected first)
  {
    name: 'FL-LABEL-PARENS-UNQUOTED (parallelogram with quotes)',
    before: 'flowchart LR\n  P[/Calls logger.debug("msg")/]\n',
    after:  'flowchart LR\n  P[/Calls logger.debug&#40;&quot;msg&quot;&#41;/]\n'
  },
  {
    name: 'FL-LABEL-PARENS-UNQUOTED (trapezoid with quotes)',
    before: 'flowchart LR\n  T[\\Calls logger.debug("msg")/]\n',
    after:  'flowchart LR\n  T[\\Calls logger.debug&#40;&quot;msg&quot;&#41;/]\n'
  },

  {
    name: 'FL-LABEL-PARENS-UNQUOTED (method call)',
    before: 'flowchart TD\n  X --> E[Convert error to string via .Error()]\n',
    after:  'flowchart TD\n  X --> E[\"Convert error to string via .Error()\"]\n'
  },
  // Double-in-double auto-fix is intentionally disabled (unsafe). We still validate escaped-quote cases.
  { name: 'PI-QUOTE-UNCLOSED (all)', before: 'pie\n"Dogs : 10\n', afterLevel: 'all' },
  {
    name: 'FL-END-WITHOUT-SUBGRAPH (all)',
    before: 'flowchart TD\n    A-->B\nend\n',
    after:  'flowchart TD\n    A-->B\n',
    afterLevel: 'all'
  },
  {
    name: 'FL-SUBGRAPH-ID-COLLISION (all)',
    before: 'flowchart TD\n  subgraph S1["Container"]\n    A --> S1["Node"]\n  end\n',
    after:  'flowchart TD\n  subgraph S1["Container"]\n    A --> S1_node["Node"]\n  end\n',
    afterLevel: 'all'
  },
  // Sequence
  { name: 'SE-MSG-COLON-MISSING', before: 'sequenceDiagram\nA->B hi\n', after: 'sequenceDiagram\nA->B : hi\n' },
  { name: 'SE-NOTE-MALFORMED', before: 'sequenceDiagram\nNote right of A Hello\n', after: 'sequenceDiagram\nNote right of A : Hello\n' },
  { name: 'SE-NOTE-MALFORMED (multiline header)', before: 'sequenceDiagram\nNote right of A\n  body\nend note\n', after: 'sequenceDiagram\nNote right of A : body\n' },
  {
    name: 'SE-NOTE-MALFORMED (multiline over with hyphen alias)',
    before: 'sequenceDiagram\nparticipant engineer as engineer.yaml\nparticipant prepare as prepare-projects\nNote over engineer\n  OR: Standalone mode\nend note\n',
    after: 'sequenceDiagram\nparticipant engineer as engineer.yaml\nparticipant prepare as prepare-projects\nNote over engineer : OR: Standalone mode\n'
  },
  { name: 'SE-ELSE-IN-CRITICAL', before: 'sequenceDiagram\ncritical Do\n  else Not allowed\nend\n', after: 'sequenceDiagram\ncritical Do\n  option Not allowed\nend\n' },
  { name: 'SE-BLOCK-MISSING-END', before: 'sequenceDiagram\npar Do work\n  A->B: hi\n', afterLevel: 'safe' },
  { name: 'SE-LABEL-DOUBLE-IN-DOUBLE', before: 'sequenceDiagram\n  participant "Logger "debug"" as L\n  L->>L: hi\n', after: 'sequenceDiagram\n  participant "Logger &quot;debug&quot;" as L\n  L->>L: hi\n' },
  {
    name: 'SE-BLOCK-MISSING-END (box/insert before outdented)',
    before: 'sequenceDiagram\n  box Aqua Group\n    participant A\n    participant B\n  A->B: hi\n',
    after:  'sequenceDiagram\n  box Aqua Group\n    participant A\n    participant B\n  end\n  A->B: hi\n'
  },
  { name: 'SE-AUTONUMBER-EXTRANEOUS', before: 'sequenceDiagram\nautonumber 10 10 participant A\n', after: 'sequenceDiagram\nautonumber 10 10\nparticipant A\n' },
  { name: 'SE-AUTONUMBER-MALFORMED (all)', before: 'sequenceDiagram\nautonumber foo bar baz\nA->B: ok\n', afterLevel: 'all' },
  { name: 'SE-QUOTE-UNCLOSED (all)', before: 'sequenceDiagram\nparticipant "Bob\n', afterLevel: 'all' },
  { name: 'SE-LABEL-ESCAPED-QUOTE', before: 'sequenceDiagram\nparticipant "Logger \\"debug\\"" as L\n' },
  // SE-LABEL-DOUBLE-IN-DOUBLE is intentionally not auto-fixed (unsafe single-char rewrite).
  // State (safe)
  { name: 'ST-ARROW-INVALID', before: 'stateDiagram-v2\nA -> B : go\n', after: 'stateDiagram-v2\nA --> B : go\n' },
  { name: 'ST-NOTE-MALFORMED', before: 'stateDiagram-v2\nNote right of A Hello\n', after: 'stateDiagram-v2\nNote right of A : Hello\n' },
  { name: 'ST-BLOCK-MISSING-RBRACE', before: 'stateDiagram-v2\nstate Foo {\n  A --> B\n', afterLevel: 'safe' },
  // Class (safe)
  { name: 'CL-REL-INVALID', before: 'classDiagram\nA -> B : rel\n', after: 'classDiagram\nA -- B : rel\n' },
  { name: 'CL-BLOCK-MISSING-RBRACE', before: 'classDiagram\nclass Foo {\n  +bar()\n', afterLevel: 'safe' },
  { name: 'CL-NAME-DOUBLE-QUOTED', before: 'classDiagram\nclass "Logger "core"" as L\n', after: 'classDiagram\nclass L["Logger &quot;core&quot;"]\n' },
];

let passed = 0;
for (const c of cases) {
  const level = c.afterLevel || 'safe';
  const opts = c.opts || {};
  const fixed = applyFixes(c.before, level, opts);
  if (c.after) {
    assert.strictEqual(fixed, c.after, `Fix output mismatch for ${c.name}`);
  }
  // Validate fixed content
  expectValid(fixed, opts);
  passed++;
}

console.log(`OK test-fixes: ${passed} cases passed.`);
