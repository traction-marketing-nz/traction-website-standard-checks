/**
 * The gate items that ask "does the thing the author wrote actually reach the
 * page?" — §8.1 per-page SEO, §7.2 the tag manager, and §15's global elements.
 *
 * All three share one failure shape, and it is the shape this whole package
 * exists for: the field is offered in the editor, the author fills it in, the
 * file changes, the build goes green, and the published page is unaffected. A
 * route that reads three of five `seo` keys renders perfectly from the three it
 * reads. A tag manager id sitting in globals with no snippet emitting it looks
 * exactly like one that works.
 *
 * ADVISORY.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

function htmlFiles(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) htmlFiles(full, acc);
    else if (e.endsWith(".html")) acc.push(full);
  }
  return acc;
}

function contentFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) contentFiles(full, acc);
    else if (e.endsWith(".json")) acc.push(full);
  }
  return acc;
}

/**
 * §8.1 — a page's declared `seo` reaches its `<head>`.
 *
 * Matched by VALUE across the whole built output rather than by mapping each
 * content file to its route: routes differ per site and per collection, and a
 * mapping that has to be right for every site is a mapping that will be wrong
 * for one. What matters is the claim — if a route ignores `seo`, the string an
 * author typed appears nowhere at all.
 */
export function checkSeoConsumed(config, report) {
  const NAME = "seo-consumed";
  if (!config.distDir) return;

  const site = existsSync(join(config.root, "site.json")) ? readJson(join(config.root, "site.json")) : {};
  const pagesDir = join(config.root, site.paths?.pages ?? "content/pages");
  const files = contentFiles(pagesDir);
  if (files.length === 0) {
    report.skip(NAME, `no content pages found under ${relative(config.root, pagesDir).split(sep).join("/")}`);
    return;
  }

  const heads = htmlFiles(join(config.root, config.distDir))
    .map((f) => readFileSync(f, "utf8"))
    .map((h) => h.slice(0, h.indexOf("</head>") + 7 || 4000));
  const allHeads = heads.join("\n");

  let examined = 0;
  for (const file of files) {
    let page;
    try {
      page = readJson(file);
    } catch {
      continue;
    }
    const seo = page.seo ?? page.extra?.seo;
    if (!seo) continue;
    const where = relative(config.root, file).split(sep).join("/");

    for (const key of ["title", "description"]) {
      const value = seo[key];
      if (typeof value !== "string" || value.trim() === "") continue;
      examined += 1;
      // Compared on the text a person reads, so entity-encoding and attribute
      // quoting do not turn a real match into a false alarm.
      const needle = value.trim().replace(/\s+/g, " ").slice(0, 60);
      const haystack = allHeads.replace(/&#39;|&rsquo;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
      if (!haystack.includes(needle)) {
        report.warn(
          NAME,
          `${where} declares seo.${key} — "${needle}" — and it appears in NO built page's <head>. ` +
            `The editor offers the field, the author fills it in, and the published page is unaffected (§8.1).`,
          { rule: "seo-consumed" },
        );
      }
    }
  }
  report.examined(NAME, examined);
}

/**
 * §7.2 — the tag manager, if this site declares one.
 *
 * Skipped entirely when no container id is declared, because most sites here do
 * not have one and a check that nags about an absent feature is noise.
 */
export function checkTagManager(config, report) {
  const NAME = "tag-manager";
  if (!config.distDir) return;

  const globalsPath = join(config.root, "content/globals.json");
  if (!existsSync(globalsPath)) return;

  let globals;
  try {
    globals = readJson(globalsPath);
  } catch {
    return;
  }
  const id = globals.analytics?.gtmContainerId ?? globals.analytics?.containerId;
  const files = htmlFiles(join(config.root, config.distDir));

  if (!id) {
    report.skip(NAME, "no tag-manager container id declared in globals — nothing to verify");
    // The inverse is worth naming: pages calling the tag manager with no id
    // declared means the id is hardcoded somewhere the editor cannot reach.
    const stray = files.filter((f) => /googletagmanager\.com/.test(readFileSync(f, "utf8")));
    if (stray.length > 0) {
      report.warn(
        NAME,
        `${stray.length} page(s) load googletagmanager.com but no container id is declared in globals — ` +
          `the id is hardcoded somewhere an author cannot change it (§7.2).`,
        { rule: "tag-manager" },
      );
    }
    return;
  }

  const missing = files.filter((f) => !readFileSync(f, "utf8").includes(id));
  if (missing.length > 0) {
    report.warn(
      NAME,
      `globals declares tag manager ${id}, but it appears on none of ${missing.length} of ${files.length} ` +
        `page(s) — e.g. ${relative(config.root, missing[0]).split(sep).join("/")} (§7.2).`,
      { rule: "tag-manager" },
    );
  }
  // The <noscript> half is the one that is routinely forgotten, and it is the
  // half that records a visitor who blocks scripts.
  const noNoscript = files.filter((f) => {
    const h = readFileSync(f, "utf8");
    return h.includes(id) && !/<noscript>[\s\S]{0,400}googletagmanager\.com/i.test(h);
  });
  if (noNoscript.length > 0) {
    report.warn(NAME, `the tag manager <noscript> snippet is missing from ${noNoscript.length} page(s) (§7.2).`, { rule: "tag-manager" });
  }
  report.examined(NAME, files.length);
}

/**
 * §15 — every internal link resolves.
 *
 * "Global elements verified: logo href navigates home, all nav links resolve"
 * is a checklist line somebody has to do by hand on every template. The build
 * knows the answer: a link to a page that was never built is a 404 a visitor
 * finds, and the most common cause is a slug rename that a redirect covered
 * while the link that pointed at it was left alone.
 */
export function checkInternalLinks(config, report) {
  const NAME = "internal-links";
  if (!config.distDir) return;
  const dist = join(config.root, config.distDir);
  const files = htmlFiles(dist);

  const resolves = (p) => {
    const clean = p.split(/[?#]/)[0].replace(/^\//, "").replace(/\/$/, "");
    if (clean === "") return true;
    return (
      existsSync(join(dist, clean, "index.html")) ||
      existsSync(join(dist, `${clean}.html`)) ||
      existsSync(join(dist, clean))
    );
  };

  // A link to a redirect SOURCE is not broken — it costs a hop, which is worth
  // knowing but is not a 404.
  const redirectSources = new Set();
  const rulesPath = join(config.root, config.redirectsFile);
  if (existsSync(rulesPath)) {
    try {
      const parsed = readJson(rulesPath);
      const rules = Array.isArray(parsed) ? parsed : parsed.redirects ?? [];
      for (const r of rules) if (typeof r?.from === "string") redirectSources.add(r.from.replace(/\/$/, ""));
    } catch { /* redirectList already reports a malformed file */ }
  }

  const dead = new Map();
  let examined = 0;
  for (const file of files) {
    const html = readFileSync(file, "utf8");
    for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)) {
      const href = m[1];
      if (/^(https?:|mailto:|tel:|#|data:|javascript:)/i.test(href)) continue;
      if (!href.startsWith("/")) continue; // relative links are rare here and need a base
      examined += 1;
      const bare = href.split(/[?#]/)[0].replace(/\/$/, "");
      if (resolves(href) || redirectSources.has(bare)) continue;
      const where = relative(config.root, file).split(sep).join("/");
      if (!dead.has(href)) dead.set(href, where);
    }
  }

  for (const [href, where] of [...dead].slice(0, 10)) {
    report.warn(NAME, `${where} links to ${href}, which is neither a built page nor a declared redirect — a 404 a visitor finds.`, { rule: "internal-links" });
  }
  if (dead.size > 10) {
    report.warn(NAME, `…and ${dead.size - 10} more dead internal link(s).`, { rule: "internal-links" });
  }
  report.examined(NAME, examined);
}
