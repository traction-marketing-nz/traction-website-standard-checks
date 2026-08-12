/**
 * Every check is tested the way it asks sites to test: reinstate the defect and
 * confirm the check goes red AND names the offender.
 *
 * A check that cannot fail reads as proof, which is the failure this package was
 * built after. So each case here asserts two things — that a clean fixture
 * passes, and that the broken one fails with a message a person could act on.
 * If a test only asserted `!ok`, a check that fails on everything would pass it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { run } from "../src/run.mjs";

/** Build a throwaway site on disk. `files` maps repo-relative path → contents. */
function site(files) {
  const root = mkdtempSync(join(tmpdir(), "site-checks-"));
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof body === "string" ? body : JSON.stringify(body, null, 2));
  }
  return root;
}

const PAGE = `<!doctype html><html><head><title>T</title>
<meta name="description" content="d"><link rel="canonical" href="https://x/"></head>
<body><h1>H</h1></body></html>`;

/** A route table with the two phases every check needs to reason about. */
const routes = (extra = []) => ({
  version: 3,
  routes: [...extra, { handle: "filesystem" }, { handle: "error" }, { src: "/.*", status: 404, dest: "/404.html" }],
});

const messages = (report) => report.findings.map((f) => f.message).join("\n");

test("redirects: a rule that matches only the un-slashed form fails, and says so", () => {
  const root = site({
    "content/redirects.json": [{ from: "/old/", to: "/new/", status: 301 }],
    ".vercel/output/config.json": routes([{ src: "^/old$", headers: { Location: "/new/" }, status: 301 }]),
    "dist/client/index.html": PAGE,
    "dist/client/new/index.html": PAGE,
    "dist/client/404.html": PAGE,
  });
  const { report } = run({ root, only: ["redirects"] });
  assert.equal(report.ok, false);
  assert.match(messages(report), /request for \/old\/ matches no redirect/);
  rmSync(root, { recursive: true, force: true });
});

test("redirects: both forms emitted passes", () => {
  const root = site({
    "content/redirects.json": [{ from: "/old/", to: "/new/", status: 301 }],
    ".vercel/output/config.json": routes([{ src: "^/old/?$", headers: { Location: "/new/" }, status: 301 }]),
    "dist/client/new/index.html": PAGE,
    "dist/client/404.html": PAGE,
  });
  const { report } = run({ root, only: ["redirects"] });
  assert.equal(report.ok, true, messages(report));
  rmSync(root, { recursive: true, force: true });
});

test("redirects: a destination that was never built fails", () => {
  const root = site({
    "content/redirects.json": [{ from: "/old/", to: "/nowhere/", status: 301 }],
    ".vercel/output/config.json": routes([{ src: "^/old/?$", headers: { Location: "/nowhere/" }, status: 301 }]),
    "dist/client/404.html": PAGE,
  });
  const { report } = run({ root, only: ["redirects"] });
  assert.equal(report.ok, false);
  assert.match(messages(report), /no page was built there/);
  rmSync(root, { recursive: true, force: true });
});

test("redirects: a 302 where a 301 was written fails", () => {
  const root = site({
    "content/redirects.json": [{ from: "/old/", to: "/new/", status: 301 }],
    ".vercel/output/config.json": routes([{ src: "^/old/?$", headers: { Location: "/new/" }, status: 302 }]),
    "dist/client/new/index.html": PAGE,
    "dist/client/404.html": PAGE,
  });
  const { report } = run({ root, only: ["redirects"] });
  assert.equal(report.ok, false);
  assert.match(messages(report), /forfeits the ranking transfer/);
  rmSync(root, { recursive: true, force: true });
});

test("redirects: a declared slash exception is honoured and reported, not silent", () => {
  // A real route can occupy the slashed form; emitting the redirect anyway
  // would shadow a live page. Allowed — but it has to be visible in the output.
  const root = site({
    "content/redirects.json": [{ from: "/properties", to: "/", status: 301 }],
    "site-checks.config.json": {
      allow: { redirectSlashExceptions: [{ from: "/properties", reason: "properties/[slug] occupies /properties/" }] },
    },
    ".vercel/output/config.json": routes([{ src: "^/properties$", headers: { Location: "/" }, status: 301 }]),
    "dist/client/index.html": PAGE,
    "dist/client/404.html": PAGE,
  });
  const { report } = run({ root, only: ["redirects"] });
  assert.equal(report.ok, true, messages(report));
  assert.match(report.skips.map((s) => s.reason).join("\n"), /occupies \/properties\//);
  rmSync(root, { recursive: true, force: true });
});

test("redirects: an exception without a reason is refused", () => {
  const root = site({
    "content/redirects.json": [{ from: "/a", to: "/b", status: 301 }],
    "site-checks.config.json": { allow: { redirectSlashExceptions: [{ from: "/a" }] } },
    "dist/client/404.html": PAGE,
  });
  assert.throws(() => run({ root, only: ["redirects"] }), /needs a "from" and a "reason"/);
  rmSync(root, { recursive: true, force: true });
});

test("redirects: no route table at all fails closed, rather than passing quietly", () => {
  const root = site({
    "content/redirects.json": [{ from: "/old/", to: "/new/", status: 301 }],
    "dist/client/404.html": PAGE,
  });
  const { report } = run({ root, only: ["redirects"] });
  assert.equal(report.ok, false);
  assert.match(messages(report), /Do not read this build as proof/);
  rmSync(root, { recursive: true, force: true });
});

test("built-html: a collapsed stylesheet fails", () => {
  const root = site({
    "dist/client/index.html": PAGE.replace("<body>", "<style></style><body>"),
    "dist/client/404.html": PAGE,
    ".vercel/output/config.json": routes(),
  });
  const { report } = run({ root, only: ["builtHtml"] });
  assert.equal(report.ok, false);
  assert.match(messages(report), /EMPTY <style><\/style>/);
  rmSync(root, { recursive: true, force: true });
});

test("built-html: an uninterpolated template literal fails", () => {
  const root = site({
    "dist/client/index.html": PAGE.replace("<h1>H</h1>", "<h1>${title}</h1>"),
    "dist/client/404.html": PAGE,
    ".vercel/output/config.json": routes(),
  });
  const { report } = run({ root, only: ["builtHtml"] });
  assert.equal(report.ok, false);
  assert.match(messages(report), /uninterpolated template literal/);
  rmSync(root, { recursive: true, force: true });
});

test("built-html: a CSS-sized image is NOT reported — the rule is about layout shift", () => {
  const root = site({
    "dist/client/index.html": PAGE.replace(
      "<h1>H</h1>",
      `<h1>H</h1><img src="/a.png" alt="a" style="position:absolute;inset:0">`,
    ),
    "dist/client/404.html": PAGE,
    ".vercel/output/config.json": routes(),
  });
  const { report } = run({ root, only: ["builtHtml"] });
  assert.equal(report.findings.length, 0, messages(report));
  rmSync(root, { recursive: true, force: true });
});

test("built-html: an unsized image warns but does not block, until promoted", () => {
  const files = {
    "dist/client/index.html": PAGE.replace("<h1>H</h1>", `<h1>H</h1><img src="/a.png" alt="a">`),
    "dist/client/404.html": PAGE,
    ".vercel/output/config.json": routes(),
  };
  const lenient = site(files);
  const a = run({ root: lenient, only: ["builtHtml"] }).report;
  assert.equal(a.ok, true);
  assert.equal(a.warnings.length, 1);

  const strict = site({ ...files, "site-checks.config.json": { promote: ["dimensions"] } });
  const b = run({ root: strict, only: ["builtHtml"] }).report;
  assert.equal(b.ok, false, "promoting the rule must make it block");
  rmSync(lenient, { recursive: true, force: true });
  rmSync(strict, { recursive: true, force: true });
});

test("error-page: a catch-all AFTER filesystem is accepted — the outcome, not the phase", () => {
  // A site that serves its branded 404 from a catch-all rather than an `error`
  // phase reaches the same outcome. An earlier version demanded the phase and
  // reported a correct site as broken.
  const root = site({
    "dist/client/404.html": PAGE,
    ".vercel/output/config.json": {
      version: 3,
      routes: [{ handle: "filesystem" }, { src: "^/.*$", dest: "/404.html", status: 404 }],
    },
  });
  const { report } = run({ root, only: ["errorPage"] });
  assert.equal(report.ok, true, messages(report));
  rmSync(root, { recursive: true, force: true });
});

test("error-page: a 404 that is built but unrouted fails", () => {
  const root = site({
    "dist/client/index.html": PAGE,
    "dist/client/404.html": PAGE,
    ".vercel/output/config.json": { version: 3, routes: [{ handle: "filesystem" }] },
  });
  const { report } = run({ root, only: ["errorPage"] });
  assert.equal(report.ok, false);
  assert.match(messages(report), /NOTHING pointing at it/);
  rmSync(root, { recursive: true, force: true });
});

test("error-page: a branded 404 served as 200 fails", () => {
  const root = site({
    "dist/client/404.html": PAGE,
    ".vercel/output/config.json": {
      version: 3,
      routes: [{ handle: "filesystem" }, { handle: "error" }, { src: "/.*", status: 200, dest: "/404.html" }],
    },
  });
  const { report } = run({ root, only: ["errorPage"] });
  assert.equal(report.ok, false);
  assert.match(messages(report), /indexed as a real page/);
  rmSync(root, { recursive: true, force: true });
});

test("a site with no build at all fails loudly rather than quietly", () => {
  const root = site({ "README.md": "no site here" });
  const { report } = run({ root });
  assert.equal(report.ok, false);
  assert.match(messages(report), /No built output found/);
  rmSync(root, { recursive: true, force: true });
});

test("the suite refuses to pass having examined nothing", () => {
  // The floor, and the reason it exists: every check reporting success while
  // looking at zero files is a green tick over an unknown site. Reached here by
  // disabling everything — the same state a bad path or a moved directory
  // produces, which is how twelve dead redirects survived weeks of green builds.
  const root = site({
    "README.md": "no site here",
    "site-checks.config.json": { checks: { redirects: false, builtHtml: false, errorPage: false } },
  });
  const { report } = run({ root });
  assert.equal(report.ok, false);
  assert.match(messages(report), /examined NOTHING/);
  rmSync(root, { recursive: true, force: true });
});
