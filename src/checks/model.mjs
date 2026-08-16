/**
 * §4.4 — the content model itself: templates are data, and the manifest is
 * author-complete.
 *
 * These are the gate items that decide whether an EDITOR can work on a site at
 * all, and they fail in the quietest way available: a page naming a template
 * that does not exist renders fine until someone opens it in the editor, and a
 * prop with no label reaches an author as a humanised key that means nothing.
 *
 * ADVISORY.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep, basename, extname } from "node:path";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

function jsonFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) jsonFiles(full, acc);
    else if (e.endsWith(".json")) acc.push(full);
  }
  return acc;
}

const siteOf = (config) => {
  const p = join(config.root, "site.json");
  return existsSync(p) ? readJson(p) : {};
};

/**
 * §4.4 — every page names a template that exists, and the set is declared.
 *
 * A page referencing a template nobody built is worse than one referencing
 * none: a tool reads the name verbatim and offers to author content it cannot
 * render (§3.6, §4.6).
 */
export function checkTemplates(config, report) {
  const NAME = "templates";
  const site = siteOf(config);
  const templatesDir = join(config.root, site.paths?.templates ?? "templates");
  if (!existsSync(templatesDir)) {
    report.skip(NAME, `no templates directory at ${relative(config.root, templatesDir).split(sep).join("/")}`);
    return;
  }

  const declared = new Set(
    readdirSync(templatesDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => basename(f, extname(f))),
  );
  if (declared.size === 0) {
    report.warn(NAME, `the templates directory holds no template files — "templates are data" cannot be true (§4.4).`, { rule: "templates" });
    return;
  }

  const pagesDir = join(config.root, site.paths?.pages ?? "content/pages");
  const pages = jsonFiles(pagesDir);
  let examined = 0;
  for (const file of pages) {
    let page;
    try {
      page = readJson(file);
    } catch {
      continue;
    }
    const name = page.template;
    const where = relative(config.root, file).split(sep).join("/");
    if (!name) {
      report.warn(NAME, `${where} names no template, so nothing decides what slots it has (§4.4).`, { rule: "templates" });
      continue;
    }
    examined += 1;
    if (!declared.has(String(name))) {
      report.warn(
        NAME,
        `${where} names template "${name}", which does not exist. A tool reads that verbatim and offers ` +
          `to author content it cannot render (§4.6).`,
        { rule: "templates" },
      );
    }
  }
  report.examined(NAME, examined);
}

/**
 * §4.4.1 / §4.5 — the manifest is author-complete.
 *
 * A prop with no label reaches an author as a humanised key. "It inherits from
 * the array" is a reasoning the generator can hold and no downstream reader
 * can, which is why an array's ITEM descriptor needs its own label too — one
 * site's generator skipped exactly that case and shipped nine repeaters whose
 * row headers were raw keys, while passing its own label check.
 */
export function checkAuthorComplete(config, report) {
  const NAME = "author-complete";
  const site = siteOf(config);
  const manifestPath = join(config.root, site.paths?.blockManifest ?? "block-manifest.json");
  if (!existsSync(manifestPath)) {
    report.skip(NAME, "no block manifest to check");
    return;
  }

  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch {
    return; // descriptor already reports a malformed manifest
  }

  const blocks = Array.isArray(manifest) ? manifest : manifest.blocks ?? [];
  const list = Array.isArray(blocks) ? blocks : Object.entries(blocks).map(([name, b]) => ({ name, ...b }));

  let examined = 0;
  const unlabelled = [];
  const walkProps = (props, block, path = "") => {
    for (const [key, spec] of Object.entries(props ?? {})) {
      examined += 1;
      const at = `${block}.${path}${key}`;
      if (!spec?.label) unlabelled.push(at);
      if (spec?.of) {
        // The array's ITEM descriptor, which is the case that gets skipped.
        if (!spec.of.label && !spec.of.props) unlabelled.push(`${at}[] (item)`);
        if (spec.of.props) walkProps(spec.of.props, block, `${path}${key}[].`);
      }
      if (spec?.props) walkProps(spec.props, block, `${path}${key}.`);
    }
  };

  for (const b of list) walkProps(b.props, b.name ?? "(unnamed block)");

  if (unlabelled.length > 0) {
    report.warn(
      NAME,
      `${unlabelled.length} prop(s) in the manifest declare no label, so an author sees a humanised key ` +
        `instead of a name: ${unlabelled.slice(0, 5).join(", ")}${unlabelled.length > 5 ? " …" : ""} (§4.4.1).`,
      { rule: "labels" },
    );
  }
  report.examined(NAME, examined);
}

/**
 * §4.4 — every route is content-data.
 *
 * Reported as a COUNT rather than a list of offenders, deliberately. Routes
 * come from pages, from routable collections, and from a handful of system
 * pages, and reconstructing each site's routing well enough to name a specific
 * offender is the kind of mapping that is right for one site and wrong for the
 * next. The number is still worth knowing: a site where built routes far
 * outnumber content files has pages living in framework code, which is the
 * failure §4.4 exists for.
 */
export function checkRoutesAreContent(config, report) {
  const NAME = "routes-are-content";
  if (!config.distDir) return;
  const site = siteOf(config);

  const pages = jsonFiles(join(config.root, site.paths?.pages ?? "content/pages")).length;
  let items = 0;
  for (const c of site.collections ?? []) {
    if (!c.path) continue;
    items += jsonFiles(join(config.root, c.path)).length;
  }

  const dist = join(config.root, config.distDir);
  const html = [];
  (function walk(dir) {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (e.endsWith(".html")) html.push(full);
    }
  })(dist);

  const authored = pages + items;
  if (authored === 0) {
    report.skip(NAME, "no content files found — nothing to compare routes against");
    return;
  }

  // A generous allowance for system routes (404, feeds, listing indexes a
  // collection legitimately generates). The signal being looked for is an
  // order-of-magnitude gap, not an exact match.
  if (html.length > authored * 1.5 + 10) {
    report.warn(
      NAME,
      `${html.length} built page(s) against ${authored} content file(s). A route with no content file is a ` +
        `page whose content or layout lives in framework code, which is what §4.4 refuses.`,
      { rule: "routes-are-content" },
    );
  }
  report.examined(NAME, html.length);
}
