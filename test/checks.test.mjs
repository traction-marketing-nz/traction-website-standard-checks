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

test("redirects: a redirect that shadows a real page fails", () => {
  // The failure mutation found: emitter and checker can agree with each other
  // and still be wrong. Only the built output settles it.
  const root = site({
    "content/redirects.json": [{ from: "/properties", to: "/", status: 301 }],
    ".vercel/output/config.json": routes([{ src: "^/properties/?$", headers: { Location: "/" }, status: 301 }]),
    "dist/client/index.html": PAGE,
    "dist/client/properties/a-street/index.html": PAGE,
    "dist/client/properties/index.html": PAGE,   // a real index page — this is what makes it shadowing
    "dist/client/404.html": PAGE,
  });
  const { report } = run({ root, only: ["redirects"] });
  assert.equal(report.ok, false);
  assert.match(messages(report), /a real page is built there/);
  rmSync(root, { recursive: true, force: true });
});

test("redirects: a DIRECTORY with no index.html is not a page, and is not shadowing", () => {
  // dist/properties/ exists on a site whose only pages are properties/<slug>/.
  // Counting the directory as a page reported a correct site as broken.
  const root = site({
    "content/redirects.json": [{ from: "/properties", to: "/", status: 301 }],
    ".vercel/output/config.json": routes([{ src: "^/properties/?$", headers: { Location: "/" }, status: 301 }]),
    "dist/client/index.html": PAGE,
    "dist/client/properties/a-street/index.html": PAGE,
    "dist/client/404.html": PAGE,
  });
  const { report } = run({ root, only: ["redirects"] });
  assert.equal(report.ok, true, messages(report));
  rmSync(root, { recursive: true, force: true });
});

test("redirects: a wildcard that was never emitted fails", () => {
  // The mirror of the failure this package was built after. An earlier version
  // only asked whether a wildcard SHADOWED an exact rule, so a site whose
  // redirects were entirely wildcards could emit none of them and pass.
  const root = site({
    "content/redirects.json": [{ from: "/portfolio/*", to: "/our-work/*", status: 301 }],
    ".vercel/output/config.json": routes(),
    "dist/client/index.html": PAGE,
    "dist/client/404.html": PAGE,
  });
  const { report } = run({ root, only: ["redirects"] });
  assert.equal(report.ok, false);
  assert.match(messages(report), /matches no redirect before the filesystem/);
  rmSync(root, { recursive: true, force: true });
});

test("redirects: a wildcard that expands to the wrong place fails", () => {
  const root = site({
    "content/redirects.json": [{ from: "/portfolio/*", to: "/our-work/*", status: 301 }],
    ".vercel/output/config.json": routes([
      { src: "^/portfolio(?:/(.*))?$", headers: { Location: "/our-work/" }, status: 301 },
    ]),
    "dist/client/404.html": PAGE,
  });
  const { report } = run({ root, only: ["redirects"] });
  assert.equal(report.ok, false);
  assert.match(messages(report), /the rule promises \/our-work\/zq7probe/);
  rmSync(root, { recursive: true, force: true });
});

test("redirects: a correctly emitted wildcard passes", () => {
  const root = site({
    "content/redirects.json": [{ from: "/portfolio/*", to: "/our-work/*", status: 301 }],
    ".vercel/output/config.json": routes([
      { src: "^/portfolio(?:/(.*))?$", headers: { Location: "/our-work/$1" }, status: 301 },
    ]),
    "dist/client/404.html": PAGE,
  });
  const { report } = run({ root, only: ["redirects"] });
  assert.equal(report.ok, true, messages(report));
  rmSync(root, { recursive: true, force: true });
});

test("redirects: a destination that is an ASSET, not a page, is accepted", () => {
  // /brochure/ -> /files/brochure.pdf is an ordinary redirect. Failing it
  // blocks a deploy over correct content.
  const root = site({
    "content/redirects.json": [{ from: "/brochure/", to: "/files/brochure.pdf", status: 301 }],
    ".vercel/output/config.json": routes([
      { src: "^/brochure/?$", headers: { Location: "/files/brochure.pdf" }, status: 301 },
    ]),
    "dist/client/files/brochure.pdf": "%PDF-1.4",
    "dist/client/404.html": PAGE,
  });
  const { report } = run({ root, only: ["redirects"] });
  assert.equal(report.ok, true, messages(report));
  rmSync(root, { recursive: true, force: true });
});

test("redirects: a DIRECTORY destination fails — only a file or a page counts", () => {
  // Widening targetExists to any path reopened, one commit later, the bug the
  // commit before it fixed: dist/properties/ exists wherever the pages are
  // properties/<slug>/index.html, and the live URL 404s.
  const root = site({
    "content/redirects.json": [{ from: "/old/", to: "/properties/", status: 301 }],
    ".vercel/output/config.json": routes([{ src: "^/old/?$", headers: { Location: "/properties/" }, status: 301 }]),
    "dist/client/properties/a-slug/index.html": PAGE,
    "dist/client/404.html": PAGE,
  });
  const { report } = run({ root, only: ["redirects"] });
  assert.equal(report.ok, false);
  assert.match(messages(report), /no page was built there/);
  rmSync(root, { recursive: true, force: true });
});

test("redirects: an exact rule whose DESTINATION contains * is not a wildcard", () => {
  // Testing `to` for a star misclassified an ordinary rule, and the wildcard
  // checker then failed a correct site. Misclassification used to cost
  // coverage; once wildcards were checked properly it started blocking deploys.
  const root = site({
    "content/redirects.json": [{ from: "/search/", to: "/find/?q=*", status: 301 }],
    ".vercel/output/config.json": routes([{ src: "^/search/?$", headers: { Location: "/find/?q=*" }, status: 301 }]),
    "dist/client/find/index.html": PAGE,
    "dist/client/404.html": PAGE,
  });
  const { report } = run({ root, only: ["redirects"] });
  assert.equal(report.ok, true, messages(report));
  rmSync(root, { recursive: true, force: true });
});

test("built-html: an uninterpolated literal INSIDE a <style> block is caught", () => {
  // A block emitting CSS from a template literal is a real construct here, and
  // stripping style bodies before the scan lost exactly that case.
  const root = site({
    "dist/client/index.html": PAGE.replace("</head>", "<style>.a{color:${accent};}</style></head>"),
    "dist/client/404.html": PAGE,
    ".vercel/output/config.json": routes(),
  });
  const { report } = run({ root, only: ["builtHtml"] });
  assert.equal(report.ok, false);
  assert.match(messages(report), /uninterpolated template literal/);
  rmSync(root, { recursive: true, force: true });
});

test("built-html: an image sized by a CLASS is not reported", () => {
  // 184 of 184 findings from the first version were this: sized in a
  // stylesheet, which this check cannot read.
  const root = site({
    "dist/client/index.html": PAGE.replace("<h1>H</h1>", `<h1>H</h1><img class="tile__img" src="/a.png" alt="a">`),
    "dist/client/404.html": PAGE,
    ".vercel/output/config.json": routes(),
  });
  const { report } = run({ root, only: ["builtHtml"] });
  assert.equal(report.findings.length, 0, messages(report));
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

/**
 * The rule list itself. These two rules existed on two sites as two separate
 * hand-written implementations before they existed here — the exact forking
 * this package was built to end, still going on inside an area it already
 * covered.
 */
const listOnly = (rules, extra = {}) =>
  site({ "content/redirects.json": rules, "dist/client/404.html": PAGE, ...extra });

const LIST_CASES = [
  ["a self-reference", [{ from: "/a/", to: "/a/", status: 301 }], /redirects to itself/],
  ["a chain", [{ from: "/a/", to: "/b/", status: 301 }, { from: "/b/", to: "/c/", status: 301 }], /is a chain/],
  ["a duplicate source", [{ from: "/a/", to: "/b/", status: 301 }, { from: "/a/", to: "/c/", status: 301 }], /already redirected/],
  ["a relative source", [{ from: "a/", to: "/b/", status: 301 }], /must be a site-relative path/],
  ["an http destination", [{ from: "/a/", to: "http://x.test/", status: 301 }], /site-relative path or an https URL/],
  ["a bad status", [{ from: "/a/", to: "/b/", status: 418 }], /"status" must be one of/],
  ["a path traversal", [{ from: "/a/", to: "/b/../../etc/", status: 301 }], /path traversal/],
  ["an encoded traversal", [{ from: "/a/", to: "/b/%2e%2e/x/", status: 301 }], /path traversal/],
  ["a malformed wildcard", [{ from: "/a/*/b", to: "/c/", status: 301 }], /must end in exactly one/],
  ["two stars in a destination", [{ from: "/a/*", to: "/b/*/*", status: 301 }], /at most one/],
  ["a star with nothing to expand", [{ from: "/a/", to: "/b/*", status: 301 }], /nothing to expand/],
  ["a slashed twin of the same source", [{ from: "/a", to: "/b/", status: 301 }, { from: "/a/", to: "/c/", status: 301 }], /already redirected/],
];

for (const [label, rules, pattern] of LIST_CASES) {
  test(`redirect list: refuses ${label}`, () => {
    const root = listOnly(rules);
    const { report } = run({ root, only: ["redirectList"] });
    assert.equal(report.ok, false);
    assert.match(messages(report), pattern);
    rmSync(root, { recursive: true, force: true });
  });
}

test("redirect list: accepts a legal list", () => {
  const root = listOnly([
    { from: "/a/", to: "/b/", status: 301 },
    { from: "/old/*", to: "/new/*", status: 301 },
    { from: "/x/", to: "https://elsewhere.test/y", status: 308 },
  ]);
  const { report } = run({ root, only: ["redirectList"] });
  assert.equal(report.ok, true, messages(report));
  rmSync(root, { recursive: true, force: true });
});
