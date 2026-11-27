#!/usr/bin/env node
// Re-pin @jekrch/dimensional-docs to the tip of its GitHub main branch.
//
//   bun run dimdoc:update            # pin to origin/main
//   bun run dimdoc:update <ref>      # pin to a branch, tag or sha on GitHub
//
// The dependency is pinned to a commit sha, so `bun update` never moves it.
// This resolves the ref on GitHub (not the local checkout), because CI installs
// over SSH from GitHub and a sha that only exists locally would break the
// deploy. It warns if the local checkout has work that hasn't been pushed.
//
// The spec stays git+ssh (CI's deploy key is SSH-only), but locally GitHub is
// reached over HTTPS, so git and bun get a per-process insteadOf rewrite
// (GIT_CONFIG_* env vars). Global git config is untouched.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PKG = "@jekrch/dimensional-docs";
const REMOTE = "git@github.com:jekrch/dimensional-docs.git";
const SPEC = "git+ssh://git@github.com/jekrch/dimensional-docs.git";
const LOCAL = process.env.DIMENSIONAL_DOCS_DIR ?? join(homedir(), "projects", "dimensional-docs");

const env = {
  ...process.env,
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "url.https://github.com/.insteadOf",
  GIT_CONFIG_VALUE_0: "git@github.com:",
  GIT_CONFIG_KEY_1: "url.https://github.com/.insteadOf",
  GIT_CONFIG_VALUE_1: "ssh://git@github.com/",
};
const git = (...args) => execFileSync("git", args, { encoding: "utf8", env }).trim();

const ref = process.argv[2] ?? "main";
let sha;
if (/^[0-9a-f]{40}$/.test(ref)) {
  sha = ref;
} else {
  const out = git("ls-remote", REMOTE, ref, `refs/heads/${ref}`, `refs/tags/${ref}`);
  sha = out.split("\n").find(Boolean)?.split("\t")[0];
  if (!sha) {
    console.error(`No ref "${ref}" on ${REMOTE}`);
    process.exit(1);
  }
}

if (existsSync(join(LOCAL, ".git"))) {
  const head = git("-C", LOCAL, "rev-parse", "HEAD");
  const dirty = git("-C", LOCAL, "status", "--porcelain");
  if (head !== sha) console.warn(`warning: local ${LOCAL} is at ${head.slice(0, 7)}, not ${sha.slice(0, 7)} — unpushed commits?`);
  if (dirty) console.warn(`warning: local ${LOCAL} has uncommitted changes`);
}

const raw = readFileSync("package.json", "utf8");
const current = JSON.parse(raw).dependencies?.[PKG]?.split("#")[1];
if (current === sha) {
  console.log(`${PKG} already at ${sha.slice(0, 7)}`);
  process.exit(0);
}

console.log(`${PKG}: ${current?.slice(0, 7) ?? "?"} -> ${sha.slice(0, 7)}`);
// Edit the pin in place and `bun install`: `bun add` over an existing git dep
// fails with a bogus DependencyLoop error (bun 1.3).
const pinRe = /("@jekrch\/dimensional-docs":\s*")[^"]*(")/;
if (!pinRe.test(raw)) {
  console.error(`${PKG} not found in package.json dependencies`);
  process.exit(1);
}
writeFileSync("package.json", raw.replace(pinRe, `$1${SPEC}#${sha}$2`));
execFileSync("bun", ["install"], { stdio: "inherit", env });
if (current) console.log(`\nchanges: https://github.com/jekrch/dimensional-docs/compare/${current}...${sha}`);
