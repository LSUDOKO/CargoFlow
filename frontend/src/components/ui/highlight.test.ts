import { describe, expect, it } from "vitest";
import { tokenize } from "./highlight";

const kinds = (code: string) => tokenize(code).filter((t) => t.kind !== "plain").map((t) => [t.kind, t.text.trim()]);

describe("tokenize", () => {
  it("round-trips the source exactly", () => {
    const src = `import { x } from "y"; // note\nconst n = 42;\n# shell comment\ncurl https://a.b/c`;
    expect(tokenize(src).map((t) => t.text).join("")).toBe(src);
  });

  it("finds keywords, strings, numbers and comments in TypeScript", () => {
    expect(kinds(`const fee = 1200; // three percent\nawait fetch("https://api")`)).toEqual([
      ["keyword", "const"],
      ["number", "1200"],
      ["comment", "// three percent"],
      ["keyword", "await"],
      ["string", '"https://api"'],
    ]);
  });

  it("never treats the // in a URL as a comment", () => {
    expect(kinds("claude mcp add --transport http cargoflow https://cargoflow.example/mcp")).toEqual([]);
  });

  it("marks JSON keys apart from string values", () => {
    expect(kinds(`{"command": "npx", "args": ["-y"]}`)).toEqual([
      ["key", '"command"'],
      ["string", '"npx"'],
      ["key", '"args"'],
      ["string", '"-y"'],
    ]);
  });

  it("treats # followed by a space after whitespace as a comment, never a # inside a word", () => {
    expect(kinds("pip install cargoflow  # analytics")).toEqual([["keyword", "pip"], ["comment", "# analytics"]]);
    expect(kinds("  # install\npip install x")).toEqual([["comment", "# install"], ["keyword", "pip"]]);
    expect(kinds("color=#fff a#b")).toEqual([]);
  });

  it("does not colour digits inside names like trip-0411.csv", () => {
    expect(kinds("cargoflow-gateway send trip-0411.csv v1.2")).toEqual([]);
    expect(kinds("x = -5")).toEqual([["number", "5"]]);
  });

  it("does not split identifiers that contain digits or keywords", () => {
    expect(kinds("const temperatureX100 = 420; const important = in1;")).toEqual([
      ["keyword", "const"],
      ["number", "420"],
      ["keyword", "const"],
    ]);
  });

  it("handles escapes, template strings and block comments", () => {
    expect(kinds('const s = "a\\"b"; /* c */ const t = `x\ny`;')).toEqual([
      ["keyword", "const"],
      ["string", '"a\\"b"'],
      ["comment", "/* c */"],
      ["keyword", "const"],
      ["string", "`x\ny`"],
    ]);
  });
});
