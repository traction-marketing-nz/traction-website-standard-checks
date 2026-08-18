/**
 * §8 — the SEO/AEO/GEO outputs, and whether they describe the site that shipped.
 *
 * All three are produced automatically from the model, which is exactly why
 * nobody looks at them: a sitemap listing URLs that 404, or a robots.txt still
 * disallowing the world from a staging run, is invisible until traffic is gone.
 *
 * ADVISORY. A site adopting the package mid-life may not have all of these yet.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const NAME = "seo-outputs";

const pageExists = (dist, urlPath) => {
  const clean = urlPath.replace(/^\//, "").replace(/\/$/, "");
  return existsSync(join(dist, clean, "index.html")) || existsSync(join(dist, `${clean}.html`)) || clean === "";
};

export function checkSeoOutputs(config, report) {
  if (!config.distDir) {
    report.warn(NAME, "No built output — this check runs AFTER the build.", { rule: "seo" });
    return;
  }
  const dist = join(config.root, config.distDir);
  let examined = 0;

  for (const f of ["sitemap.xml", "robots.txt", "llms.txt"]) {
    if (!existsSync(join(dist, f))) {
      report.warn(NAME, `No ${f} in the built output (§8).`, { rule: "seo" });
    } else {
      examined += 1;
    }
  }

  // A robots.txt that still disallows everything is how a launch quietly fails:
  // the site is live, looks perfect, and is invisible to search for as long as
  // nobody thinks to read a text file.
  const robotsPath = join(dist, "robots.txt");
  if (existsSync(robotsPath)) {
    const robots = readFileSync(robotsPath, "utf8");
    // Sites here gate indexing on SITE_LIVE, so a local or preview build
    // SHOULD disallow everything. Warning on that is crying wolf on the correct
    // behaviour; the case worth naming is a production build that still blocks.
    const looksProduction = Boolean(process.env.SITE_LIVE ?? process.env.VERCEL_ENV === "production");
    if (looksProduction && /^\s*Disallow:\s*\/\s*$/im.test(robots) && !/^\s*Allow:/im.test(robots)) {
      report.warn(
        NAME,
        `robots.txt disallows the whole site. Correct for a staging build, and a silent launch failure ` +
          `if this is production.`,
        { rule: "robots" },
      );
    }
    // Only when the site is OPEN. A pre-launch robots.txt is a blanket
    // Disallow, and pointing a crawler at a sitemap you are telling it not to
    // read is worse than omitting it — this fired on a site whose robots.txt
    // was exactly right for the stage it was at.
    const blanketDisallow = /^\s*Disallow:\s*\/\s*$/im.test(robots) && !/^\s*Allow:/im.test(robots);
    if (!blanketDisallow && !/sitemap:/i.test(robots) && existsSync(join(dist, "sitemap.xml"))) {
      report.warn(NAME, `robots.txt does not point at the sitemap.`, { rule: "seo" });
    }
  }

  // Every URL a sitemap advertises must be a page that exists — a sitemap of
  // 404s is worse than no sitemap, because it is a crawler's to-do list.
  const sitemapPath = join(dist, "sitemap.xml");
  if (existsSync(sitemapPath)) {
    const xml = readFileSync(sitemapPath, "utf8");
    const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1]);
    if (locs.length === 0) {
      report.warn(NAME, `sitemap.xml lists no URLs at all (§8).`, { rule: "seo" });
    }
    const dead = [];
    for (const loc of locs) {
      let path;
      try {
        path = new URL(loc).pathname;
      } catch {
        report.warn(NAME, `sitemap.xml contains "${loc}", which is not an absolute URL.`, { rule: "seo" });
        continue;
      }
      if (!pageExists(dist, path)) dead.push(path);
    }
    if (dead.length > 0) {
      report.warn(
        NAME,
        `sitemap.xml advertises ${dead.length} URL(s) with no page in the build — a crawler's to-do ` +
          `list of 404s: ${dead.slice(0, 4).join(", ")}${dead.length > 4 ? " …" : ""}`,
        { rule: "sitemap" },
      );
    }
    examined += locs.length;
  }

  report.examined(NAME, examined);
}

/**
 * §8 — structured data, per page.
 *
 * JSON-LD that parses can still be wrong in the one way that matters: two of
 * the same entity on a page, which makes a search engine pick one arbitrarily
 * or discard both. The launch checklist asks for "one of each entity per page,
 * no duplicates" — this is that, mechanically.
 */
export function checkStructuredData(config, report) {
  const SD = "structured-data";
  if (!config.distDir) return;
  const dist = join(config.root, config.distDir);

  const files = [];
  (function walk(dir) {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (e.endsWith(".html")) files.push(full);
    }
  })(dist);

  let withLd = 0;
  for (const file of files) {
    const html = readFileSync(file, "utf8");
    const types = [];
    for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      let parsed;
      try {
        parsed = JSON.parse(m[1]);
      } catch {
        continue; // builtHtml already fails on unparseable JSON-LD
      }
      // A @graph document carries its entities in an array; a bare document is
      // one entity. Both are valid, and a checker that knows only one of them
      // reports a correct site as type-less.
      const entities = Array.isArray(parsed?.["@graph"]) ? parsed["@graph"] : [parsed];
      for (const e of entities) if (e?.["@type"]) types.push(String(e["@type"]));
    }
    if (types.length === 0) continue;
    withLd += 1;
    // Only types that describe the SITE or the PAGE can be duplicated
    // meaningfully. A team page legitimately carries many Person entities and a
    // listing page many Product or RealEstateListing — flagging those reported
    // a correct page as broken, which was 1 of the 2 findings on first run.
    const SINGLETON = new Set(["Organization", "WebSite", "WebPage", "BreadcrumbList", "LocalBusiness"]);
    const dupes = types.filter((t, i) => types.indexOf(t) !== i && SINGLETON.has(t));
    if (dupes.length > 0) {
      report.warn(
        SD,
        `${file.split(/[\\/]/).slice(-2).join("/")}: duplicate JSON-LD entities (${[...new Set(dupes)].join(", ")}) — ` +
          `a search engine picks one arbitrarily or discards both.`,
        { rule: "structured-data" },
      );
    }
  }
  if (withLd > 0) report.examined(SD, withLd);
}
