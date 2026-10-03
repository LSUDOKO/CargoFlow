/**
 * A tiny, dependency-free highlighter for the snippets the site shows (TypeScript, JSON, shell, Python, HTTP).
 * It only recognises comments, strings, numbers, keywords and JSON-style keys; everything else stays ink. The
 * colours (CodeBlock) are restrained and each clears 4.5:1 on the light code background.
 */
export type TokenKind = "plain" | "comment" | "string" | "number" | "keyword" | "key";
export type Token = { kind: TokenKind; text: string };

const KEYWORDS = new Set([
  "import", "from", "export", "default", "const", "let", "var", "await", "async", "function", "return", "new", "if", "else",
  "for", "of", "in", "while", "true", "false", "null", "undefined", "type", "interface", "class", "extends", "throw", "try",
  "catch", "def", "as", "with", "None", "True", "False", "print", "pip", "pnpm", "npm", "npx", "curl", "POST", "GET",
]);

const isIdStart = (c: string) => /[A-Za-z_$]/.test(c);
const isId = (c: string) => /[A-Za-z0-9_$]/.test(c);

export function tokenize(code: string): Token[] {
  const out: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i]!;
    const prev = i > 0 ? code[i - 1]! : "\n";
    // line comments: `//` after whitespace or at a line start (never the `//` in a URL); `#` followed by a space
    // after whitespace (shell / Python), or `#!` at a line start
    if ((c === "/" && code[i + 1] === "/" && /\s/.test(prev)) || (c === "#" && /\s/.test(prev) && /[\s!]/.test(code[i + 1] ?? " "))) {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      push("comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      push("comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && code[j] !== c) {
        if (code[j] === "\\") j++;
        else if (code[j] === "\n" && c !== "`") break;
        j++;
      }
      const stop = Math.min(n, j + 1);
      const text = code.slice(i, stop);
      // a double-quoted string followed by a colon is an object key (JSON, headers objects)
      const after = code.slice(stop).match(/^\s*:/);
      push(c === '"' && after ? "key" : "string", text);
      i = stop;
      continue;
    }
    // a number, unless it is part of a word or a name like trip-0411 / v1.2
    if (/[0-9]/.test(c) && !isId(prev) && !((prev === "-" || prev === ".") && isId(code[i - 2] ?? " "))) {
      const m = code.slice(i).match(/^(0x[0-9a-fA-F]+|[0-9][0-9_]*(\.[0-9]+)?([eE][+-]?[0-9]+)?n?)/)!;
      if (!isId(code[i + m[0].length] ?? " ")) {
        push("number", m[0]);
        i += m[0].length;
        continue;
      }
    }
    if (isIdStart(c) && !isId(prev)) {
      let j = i + 1;
      while (j < n && isId(code[j]!)) j++;
      const word = code.slice(i, j);
      push(KEYWORDS.has(word) && prev !== "." && prev !== "-" ? "keyword" : "plain", word);
      i = j;
      continue;
    }
    push("plain", c);
    i++;
  }
  return out;
}
