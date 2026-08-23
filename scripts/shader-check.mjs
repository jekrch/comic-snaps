#!/usr/bin/env bun
/**
 * Structural check over every GLSL template in the engine.
 *
 *   bun scripts/shader-check.mjs
 *
 * ## Why this exists
 *
 * The shaders are template literals inside TypeScript, so nothing in the build
 * looks at them as GLSL. `tsc` sees a string; the bundler sees a string; the
 * first thing that reads them as a program is the driver, at run time, on a
 * machine with a GL context. A mistake in one therefore does not fail the
 * build — it compiles, ships, and shows a black screen.
 *
 * Two classes have actually happened here, and both are silent:
 *
 * - **A backtick in a comment.** It terminates the template, and the error TypeScript
 *   reports points hundreds of lines away at whatever punctuation it choked on next.
 * - **Calling a function defined further down the file.** GLSL has no hoisting:
 *   a call above its definition needs a prototype, or it is a compile error and
 *   the whole post chain goes dark.
 *
 * Neither is a matter of taste and both are cheap to see from here, which is
 * the whole argument for this file. What it cannot do is *type*-check, so a
 * clean run here still means "worth trying in a browser", not "correct".
 *
 * Also cross-checks the post shader's uniforms against the backend in both
 * directions: a declared uniform with no binding silently reads zero, which for
 * an amount uniform is indistinguishable from the effect working and being off.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SHADER_DIR = join(ROOT, "src/components/viz/engine/shaders");

/** Everything GLSL ES 3.00 provides, plus the keywords that take parentheses. */
const BUILTIN = new Set([
  "radians", "degrees", "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh",
  "asinh", "acosh", "atanh", "pow", "exp", "log", "exp2", "log2", "sqrt", "inversesqrt",
  "abs", "sign", "floor", "trunc", "round", "roundEven", "ceil", "fract", "mod", "modf",
  "min", "max", "clamp", "mix", "step", "smoothstep", "isnan", "isinf",
  "floatBitsToInt", "floatBitsToUint", "intBitsToFloat", "uintBitsToFloat",
  "packSnorm2x16", "unpackSnorm2x16", "packUnorm2x16", "unpackUnorm2x16",
  "packHalf2x16", "unpackHalf2x16",
  "length", "distance", "dot", "cross", "normalize", "faceforward", "reflect", "refract",
  "matrixCompMult", "outerProduct", "transpose", "determinant", "inverse",
  "lessThan", "lessThanEqual", "greaterThan", "greaterThanEqual", "equal", "notEqual",
  "any", "all", "not",
  "textureSize", "texture", "textureProj", "textureLod", "textureOffset", "texelFetch",
  "texelFetchOffset", "textureProjOffset", "textureLodOffset", "textureProjLod",
  "textureProjLodOffset", "textureGrad", "textureGradOffset", "textureProjGrad",
  "textureProjGradOffset", "texture2D", "textureCube",
  "dFdx", "dFdy", "fwidth",
  "vec2", "vec3", "vec4", "ivec2", "ivec3", "ivec4", "uvec2", "uvec3", "uvec4",
  "bvec2", "bvec3", "bvec4", "mat2", "mat3", "mat4", "mat2x2", "mat2x3", "mat2x4",
  "mat3x2", "mat3x3", "mat3x4", "mat4x2", "mat4x3", "mat4x4",
  "float", "int", "uint", "bool", "void",
  "if", "for", "while", "switch", "return", "discard",
]);

let failures = 0;
const fail = (file, message) => {
  console.log(`  FAIL  ${file}: ${message}`);
  failures++;
};

/** Strip comments so their contents cannot be read as code. */
function decomment(glsl) {
  return glsl.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
             .replace(/\/\/[^\n]*/g, "");
}

function checkGlsl(file, name, glsl) {
  for (const [open, close] of [["{", "}"], ["(", ")"], ["[", "]"]]) {
    const a = (glsl.match(new RegExp(`\\${open}`, "g")) ?? []).length;
    const b = (glsl.match(new RegExp(`\\${close}`, "g")) ?? []).length;
    if (a !== b) fail(file, `${name}: ${a} '${open}' against ${b} '${close}'`);
  }
  if (glsl.includes("`")) fail(file, `${name}: a backtick inside the template — it terminates the string`);

  const code = decomment(glsl);

  // Top-level definitions and prototypes: a return type and a name at column 0.
  const defined = new Map();
  const declared = new Set();
  const signature = /^(?:highp |mediump |lowp )?\w+(?:\s*\[\s*\d*\s*\])?\s+(\w+)\s*\(([^)]*)\)\s*(\{|;)/gm;
  for (let m; (m = signature.exec(code)); ) {
    if (m[3] === ";") declared.add(m[1]);
    else if (!defined.has(m[1])) defined.set(m[1], m.index);
  }

  // Every call site, and whether it can see what it is calling.
  const call = /\b(\w+)\s*\(/g;
  for (let m; (m = call.exec(code)); ) {
    const callee = m[1];
    if (BUILTIN.has(callee) || !defined.has(callee)) continue;
    if (declared.has(callee)) continue;
    if (m.index < defined.get(callee)) {
      const line = code.slice(0, m.index).split("\n").length;
      const at = code.slice(0, defined.get(callee)).split("\n").length;
      fail(file, `${name}: ${callee}() called at line ${line} but defined at line ${at} — GLSL has no hoisting`);
      break;
    }
  }
  return defined;
}

const files = readdirSync(SHADER_DIR).filter((f) => f.endsWith(".ts"));
let templates = 0;
for (const file of files) {
  const src = readFileSync(join(SHADER_DIR, file), "utf8");
  const decl = /export const (\w+)\s*=\s*`([\s\S]*?)\n`;/g;
  for (let m; (m = decl.exec(src)); ) {
    if (!/void main|#version|gl_Position|fragColor/.test(m[2])) continue;
    templates++;
    checkGlsl(file, m[1], m[2]);
  }
}

// The post program's uniforms, in both directions.
const post = readFileSync(join(SHADER_DIR, "post.ts"), "utf8");
const glsl = /export const POST_FRAGMENT = `([\s\S]*?)\n`;/.exec(post)[1];
const backend = readFileSync(join(ROOT, "src/components/viz/engine/backends/WebGLBackend.ts"), "utf8");
const program = backend.split("this.postProgram = new Program(")[1].split("this.postMesh")[0];
const declaredU = new Set([...glsl.matchAll(/^uniform \w+ (u\w+);/gm)].map((m) => m[1]));
const boundU = new Set([...program.matchAll(/^\s+(u\w+): \{ value:/gm)].map((m) => m[1]));
const assignedU = new Set([...backend.matchAll(/post\.(u\w+)\.value =/g)].map((m) => m[1]));
for (const u of declaredU) if (!boundU.has(u)) fail("post.ts", `${u} is declared but never bound — it will read zero`);
for (const u of boundU) if (!declaredU.has(u)) fail("WebGLBackend.ts", `${u} is bound but not declared in the shader`);
for (const u of boundU) if (!assignedU.has(u)) fail("WebGLBackend.ts", `${u} is initialised but never assigned per frame`);

console.log(
  failures === 0
    ? `pass: ${templates} shader templates, ${declaredU.size} post uniforms, nothing structurally wrong`
    : `\n${failures} problem(s) found`
);
process.exit(failures === 0 ? 0 : 1);
