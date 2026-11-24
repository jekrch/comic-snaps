/**
 * A small syntax highlighter for the explainer's code views: enough of
 * Python and TypeScript to colour code the way an editor would, and to
 * know each identifier's dotted chain (`np.linalg.norm`) so it can be
 * looked up for a hover explanation. Not a parser; it reads one line at a
 * time, carrying only multi-line strings and block comments across lines.
 */

export type Lang = "py" | "ts";

export type TokenType =
  | "keyword"
  | "literal" // True, None, self, this, null…
  | "builtin"
  | "string"
  | "docstring"
  | "number"
  | "comment"
  | "function" // a name being called
  | "definition" // the name after def / class / function
  | "type" // Capitalized names
  | "constant" // ALL_CAPS names
  | "property"
  | "decorator"
  | "punctuation"
  | "identifier"
  | "space";

export interface Token {
  type: TokenType;
  text: string;
  /** For names: the dotted chain ending at this name, e.g. "np.linalg.norm". */
  chain?: string;
  /** The name follows a dot: a field or method of something. */
  member?: boolean;
}

const KEYWORDS: Record<Lang, Set<string>> = {
  py: new Set(
    "def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda yield global nonlocal assert del async await".split(
      " "
    )
  ),
  ts: new Set(
    "const let var function return if else for while of in new typeof instanceof import export from as default class extends interface type async await try catch finally throw break continue switch case do void delete keyof readonly implements".split(
      " "
    )
  ),
};

const LITERALS: Record<Lang, Set<string>> = {
  py: new Set(["True", "False", "None", "self"]),
  ts: new Set(["true", "false", "null", "undefined", "this"]),
};

const BUILTINS: Record<Lang, Set<string>> = {
  py: new Set(
    "len print int float str dict list set tuple range enumerate sorted isinstance getattr hasattr super round min max sum abs zip map any all".split(
      " "
    )
  ),
  ts: new Set("Math Number String Array Object parseInt isFinite Infinity NaN Float32Array Int8Array Uint8Array Set Map".split(" ")),
};

const DEFINERS = new Set(["def", "class", "function", "interface", "type"]);

const IDENT = /^[A-Za-z_$][\w$]*/;
const NUMBER = /^(0[xX][\da-fA-F]+|\d[\d_]*(\.\d+)?([eE][+-]?\d+)?)/;

interface State {
  /** Inside a Python triple-quoted string, closed by this quote. */
  triple: string | null;
  /** Inside a /* … *\/ comment. */
  block: boolean;
}

function lineTokens(line: string, lang: Lang, state: State): Token[] {
  const out: Token[] = [];
  let i = 0;
  // Name chain being built across "a.b.c", and whether the next name follows def/class.
  let chain: string | null = null;
  let afterDot = false;
  let defining = false;

  const push = (type: TokenType, text: string, extra?: Partial<Token>) => {
    out.push({ type, text, ...extra });
  };

  while (i < line.length) {
    const rest = line.slice(i);

    if (state.triple) {
      const end = rest.indexOf(state.triple);
      const len = end < 0 ? rest.length : end + 3;
      push("docstring", rest.slice(0, len));
      if (end >= 0) state.triple = null;
      i += len;
      continue;
    }
    if (state.block) {
      const end = rest.indexOf("*/");
      const len = end < 0 ? rest.length : end + 2;
      push("comment", rest.slice(0, len));
      if (end >= 0) state.block = false;
      i += len;
      continue;
    }

    const ws = /^\s+/.exec(rest);
    if (ws) {
      push("space", ws[0]);
      i += ws[0].length;
      continue;
    }

    if ((lang === "py" && rest[0] === "#") || (lang === "ts" && rest.startsWith("//"))) {
      push("comment", rest);
      break;
    }
    if (lang === "ts" && rest.startsWith("/*")) {
      state.block = true;
      continue;
    }

    // Strings, with Python's r/b/f prefixes and triple quotes.
    const prefix = lang === "py" ? /^[rRbBfFuU]{0,2}(?=["'])/.exec(rest) : null;
    const q0 = prefix ? prefix[0].length : 0;
    const quote = rest[q0];
    if (quote === '"' || quote === "'" || (lang === "ts" && quote === "`")) {
      if (lang === "py" && rest.startsWith(quote.repeat(3), q0)) {
        state.triple = quote.repeat(3);
        push("docstring", rest.slice(0, q0 + 3));
        i += q0 + 3;
        continue;
      }
      let j = q0 + 1;
      while (j < rest.length && rest[j] !== quote) j += rest[j] === "\\" ? 2 : 1;
      push("string", rest.slice(0, j + 1));
      i += j + 1;
      chain = null;
      afterDot = false;
      continue;
    }

    if (lang === "py" && rest[0] === "@" && out.every((t) => t.type === "space")) {
      const name = /^@[\w.]+/.exec(rest)![0];
      push("decorator", name);
      i += name.length;
      continue;
    }

    const num = NUMBER.exec(rest);
    if (num && !(out.length && /[\w$]$/.test(out[out.length - 1].text))) {
      push("number", num[0]);
      i += num[0].length;
      continue;
    }

    const id = IDENT.exec(rest);
    if (id) {
      const name = id[0];
      const fullChain: string = afterDot && chain ? `${chain}.${name}` : name;
      const calls = /^\s*\(/.test(rest.slice(name.length));
      let type: TokenType;
      if (defining) type = "definition";
      else if (afterDot) type = calls ? "function" : "property";
      else if (KEYWORDS[lang].has(name)) type = "keyword";
      else if (LITERALS[lang].has(name)) type = "literal";
      else if (BUILTINS[lang].has(name)) type = "builtin";
      else if (/^[A-Z][A-Z0-9_]+$/.test(name)) type = "constant";
      else if (calls) type = "function";
      else if (/^[A-Z]/.test(name)) type = "type";
      else type = "identifier";

      const named = type !== "keyword" && type !== "literal";
      push(type, name, named ? { chain: fullChain, member: afterDot } : undefined);
      defining = type === "keyword" && DEFINERS.has(name);
      chain = named ? fullChain : null;
      afterDot = false;
      i += name.length;
      continue;
    }

    const ch = rest[0];
    if (ch === "." && chain) {
      afterDot = true;
    } else {
      chain = null;
      afterDot = false;
    }
    push("punctuation", ch);
    i += 1;
  }
  return out;
}

/** Tokens for each line of `code`. */
export function highlight(code: string, lang: Lang): Token[][] {
  const state: State = { triple: null, block: false };
  return code.split("\n").map((line) => lineTokens(line, lang, state));
}

export function langOf(file: string): Lang {
  return file.endsWith(".py") ? "py" : "ts";
}
