#!/usr/bin/env node
// Rewrites the Version and Modified date in the footer of
// src/web_control/www/index.html (the spans #appVersion and #appModified).
//
//   node tools/stamp_version.mjs                set Modified to today, keep Version
//   node tools/stamp_version.mjs --bump         patch bump (x.y.Z) + Modified = today
//   node tools/stamp_version.mjs --bump=minor   minor bump (x.Y.0) + Modified = today
//   node tools/stamp_version.mjs --bump=major   major bump (X.0.0) + Modified = today
//   node tools/stamp_version.mjs --set=1.2.0    set Version exactly + Modified = today
//   node tools/stamp_version.mjs --auto       what the pre-commit hook runs: if the page differs
//                                               from HEAD (ignoring the footer stamp), patch bump +
//                                               today; if not, change nothing. A Version you
//                                               already changed by hand is kept (date still updated).
//
// Dates are local, YYYY-MM-DD. Only the text inside the two spans is touched.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/web_control/www/index.html';
const FILE = resolve(root, REL);

const RE_VER = /(<span id="appVersion">)([^<]*)(<\/span>)/;
const RE_DATE = /(<span id="appModified">)([^<]*)(<\/span>)/;

const today = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function bump(ver, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(ver);
  if (!m) throw new Error(`Version "${ver}" is not MAJOR.MINOR.PATCH`);
  let [maj, min, pat] = m.slice(1).map(Number);
  if (kind === 'major') { maj++; min = 0; pat = 0; }
  else if (kind === 'minor') { min++; pat = 0; }
  else pat++;
  return `${maj}.${min}.${pat}`;
}

// Line endings are normalised: on Windows (autocrlf) the working file is CRLF, git show gives LF.
const strip = html => html.replace(/\r\n/g, '\n').replace(RE_VER, '$1$3').replace(RE_DATE, '$1$3');
const get = (html, re) => (re.exec(html) || [])[2];

const arg = process.argv[2] || '';
let html = readFileSync(FILE, 'utf8');
if (!RE_VER.test(html) || !RE_DATE.test(html)) {
  console.error('stamp_version: footer spans #appVersion / #appModified not found in ' + REL);
  process.exit(1);
}

let version = get(html, RE_VER);
if (arg.startsWith('--set=')) {
  version = arg.slice(6);
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`stamp_version: "${version}" is not MAJOR.MINOR.PATCH`);
    process.exit(2);
  }
} else if (arg === '--bump' || arg.startsWith('--bump=')) {
  version = bump(version, arg.split('=')[1] || 'patch');
} else if (arg === '--auto') {
  let head = null;
  try {
    head = execFileSync('git', ['show', `HEAD:${REL}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { /* first commit of the file */ }
  if (head !== null) {
    if (strip(head) === strip(html)) process.exit(0);            // only the stamp differs: nothing to do
    if (get(head, RE_VER) === version) version = bump(version);  // version not touched by hand: patch bump
  }
} else if (arg !== '') {
  console.error('stamp_version: unknown argument ' + arg);
  process.exit(2);
}

const out = html
  .replace(RE_VER, `$1${version}$3`)
  .replace(RE_DATE, `$1${today()}$3`);
if (out !== html) writeFileSync(FILE, out);
console.log(`stamp_version: ${version}, ${today()}`);
