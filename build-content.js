#!/usr/bin/env node
// build-content.js — turns content-src/<course>/NN.html into content/<course>.js
//
//   node build-content.js                 build every course
//   node build-content.js --check ams101  validate + build one course
//   node build-content.js --lint file.html  lint a single session file
//
// Authoring is plain HTML in content-src/. This script validates it and bundles it,
// so the app can load it with a normal <script> tag (works offline, no fetch needed).

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = __dirname;
const srcDir = path.join(root, "content-src");
const outDir = path.join(root, "content");

const VOID = new Set(["line", "rect", "circle", "ellipse", "path", "polygon", "polyline", "br", "hr", "stop", "use"]);
const BANNED = /<script|<style|<iframe|<img|<link|<object|<embed|\son[a-z]+\s*=|javascript:|\shref\s*=|\ssrc\s*=/i;

function textOf(html) {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function checkBalance(html) {
  const errs = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  const stack = [];
  let m;
  while ((m = re.exec(html))) {
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const selfClosed = m[3] === "/" || VOID.has(name);
    if (closing) {
      const top = stack.pop();
      if (top !== name) {
        errs.push(`unbalanced tag: found </${name}> but expected </${top || "nothing"}> near "${html.slice(Math.max(0, m.index - 40), m.index + 20).replace(/\s+/g, " ")}"`);
        return errs;
      }
    } else if (!selfClosed) {
      stack.push(name);
    }
  }
  if (stack.length) errs.push(`unclosed tags: ${stack.join(", ")}`);
  return errs;
}

function lintSession(html, { strictLength = true } = {}) {
  const errors = [];
  const warnings = [];
  const words = textOf(html).split(" ").filter(Boolean).length;
  const figs = (html.match(/<figure\b/g) || []).length;
  const checks = (html.match(/<details class="check"/g) || []).length;
  const callouts = (html.match(/class="callout /g) || []).length;

  if (BANNED.test(html)) errors.push("contains a banned construct (script/style/img/link/on*=/href/src)");
  errors.push(...checkBalance(html));
  if (!/<ul class="objectives"/.test(html)) errors.push('missing <ul class="objectives">');
  if (!/<h4[ >]/.test(html)) errors.push("missing <h4> section headings");
  if (!/<dl class="terms"/.test(html)) errors.push('missing <dl class="terms"> key terms');
  if (checks < 3) errors.push(`needs at least 3 <details class="check"> self-check questions (has ${checks})`);
  if (/<figure/.test(html) && !/<svg[^>]*viewBox=/.test(html)) errors.push("figure without an <svg viewBox=...>");
  if (/<svg[^>]*\s(width|height)=/.test(html)) warnings.push("svg has width/height attributes; use viewBox only");
  if (/<svg[\s\S]*?(fill|stroke)="#/.test(html)) warnings.push("svg uses hard-coded colours; prefer the dg-* classes");
  if (/[`]|\$\{/.test(html)) warnings.push("contains a backtick or ${ (harmless here, but check)");
  if (strictLength) {
    if (words < 600) errors.push(`too short: ${words} words (need 900+)`);
    else if (words < 900) warnings.push(`short: ${words} words (target 900-1600)`);
  }
  return { words, figs, checks, callouts, errors, warnings };
}

function loadCourse(id) {
  const file = path.join(root, "courses", id + ".js");
  const sandbox = { window: { COURSES: [] } };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox);
  return sandbox.window.COURSES.find((c) => c.id === id);
}

function buildCourse(id, verbose) {
  const course = loadCourse(id);
  const dir = path.join(srcDir, id);
  if (!course) throw new Error("no course data for " + id);
  if (!fs.existsSync(dir)) return { id, skipped: true };

  const sessions = {};
  let totalWords = 0, totalFigs = 0, failed = 0;
  const report = [];

  for (const s of course.sessions) {
    const f = path.join(dir, String(s.n).padStart(2, "0") + ".html");
    if (!fs.existsSync(f)) {
      report.push(`  session ${s.n}: MISSING ${path.basename(f)}`);
      failed++;
      continue;
    }
    const html = fs.readFileSync(f, "utf8").trim();
    const r = lintSession(html);
    totalWords += r.words;
    totalFigs += r.figs;
    const flag = r.errors.length ? "ERROR" : r.warnings.length ? "warn " : "ok   ";
    report.push(`  session ${String(s.n).padStart(2)}: ${flag} ${r.words}w, ${r.figs} fig, ${r.checks} checks, ${r.callouts} callouts`);
    r.errors.forEach((e) => report.push("      ERROR: " + e));
    r.warnings.forEach((w) => report.push("      warn:  " + w));
    if (r.errors.length) failed++;
    sessions[s.n] = html;
  }

  // sessions on disk that the course data does not list
  fs.readdirSync(dir).filter((n) => /^\d+\.html$/.test(n)).forEach((n) => {
    if (!course.sessions.some((s) => s.n === parseInt(n, 10))) report.push(`  note: ${n} has no matching session in courses/${id}.js`);
  });

  let note = "";
  const noteFile = path.join(dir, "_note.txt");
  if (fs.existsSync(noteFile)) note = fs.readFileSync(noteFile, "utf8").trim();

  fs.mkdirSync(outDir, { recursive: true });
  const js = `(window.CONTENT = window.CONTENT || {})[${JSON.stringify(id)}] = ${JSON.stringify({ note, sessions })};\n`;
  fs.writeFileSync(path.join(outDir, id + ".js"), js);

  return { id, failed, totalWords, totalFigs, report };
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--lint") {
    const html = fs.readFileSync(args[1], "utf8");
    const r = lintSession(html, { strictLength: false });
    console.log(`${r.words} words, ${r.figs} figures, ${r.checks} checks, ${r.callouts} callouts`);
    r.errors.forEach((e) => console.log("ERROR:", e));
    r.warnings.forEach((w) => console.log("warn:", w));
    process.exit(r.errors.length ? 1 : 0);
  }

  let ids;
  if (args[0] === "--check") ids = [args[1]];
  else ids = fs.readdirSync(path.join(root, "courses")).filter((n) => n.endsWith(".js")).map((n) => n.replace(/\.js$/, ""));

  let anyFailed = false;
  for (const id of ids) {
    const r = buildCourse(id);
    if (r.skipped) { console.log(`${id}: no content-src folder, skipped`); continue; }
    console.log(`${id}: ${r.totalWords} words, ${r.totalFigs} figures, ${r.failed} session(s) with problems`);
    r.report.forEach((l) => console.log(l));
    if (r.failed) anyFailed = true;
  }
  process.exit(anyFailed ? 1 : 0);
}

main();
