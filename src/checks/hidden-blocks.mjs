/**
 * A block an author hid must be ABSENT from the built page.
 *
 * The editor writes two hide scopes: `hidden: true` on a template slot (every
 * page using that template) and `hiddenSlots: ["name"]` on a page (that page
 * only). Neither touches content — which is exactly what makes a forgetful
 * renderer invisible: the flag is saved, the build is green, and the "hidden"
 * block renders anyway. The editor offers the field, the author fills it in,
 * the published page is unaffected — the §8.1 failure shape, for hiding.
 *
 * Checked by VALUE, like seoConsumed: distinctive strings from the hidden
 * block's content must appear in no built page. Mapping each content file to
 * its route would be right for one site and wrong for the next; a string the
 * author wrote either shipped or it did not.
 *
 * And checked against each page's OWN template, resolved from the page's
 * `template` field — not a template someone assumes. The first hand-proof of a
 * renderer honouring these flags failed falsely because a human edited
 * `philosophy.json` while the page used `video-hero.json`. A check that walks
 * the declared reference cannot make that mistake, which is why this exists.
 *
 * AN ERROR, not advisory. A rendered "hidden" block is something a visitor
 * receives. It blocks nothing today — no site content carries the flags yet —
 * and bites at exactly the moment a site's renderer forgets.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep, basename, extname } from "node:path";

const NAME = "hidden-blocks";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

function files(dir, ext, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) files(full, ext, acc);
    else if (e.endsWith(ext)) acc.push(full);
  }
  return acc;
}

/** Long strings from a value tree — distinctive enough to identify a block. */
function needlesOf(value, acc = []) {
  if (typeof value === "string") {
    const t = value.trim().replace(/\s+/g, " ");
    if (t.length >= 25 && !/^[/#]|^https?:/.test(t)) acc.push(t.slice(0, 80));
  } else if (Array.isArray(value)) {
    for (const v of value) needlesOf(v, acc);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) needlesOf(v, acc);
  }
  return acc;
}

export function checkHiddenBlocks(config, report) {
  const sitePath = join(config.root, "site.json");
  const site = existsSync(sitePath) ? readJson(sitePath) : {};
  const templatesDir = join(config.root, site.paths?.templates ?? "templates");
  const pagesDir = join(config.root, site.paths?.pages ?? "content/pages");

  const templates = new Map();
  for (const f of files(templatesDir, ".json")) {
    try {
      templates.set(basename(f, extname(f)), readJson(f));
    } catch {
      /* descriptor/templates report malformed files */
    }
  }

  const pages = [];
  for (const f of files(pagesDir, ".json")) {
    try {
      pages.push({ file: f, json: readJson(f) });
    } catch {
      /* not this check's report */
    }
  }
  if (pages.length === 0 || templates.size === 0) {
    report.skip(NAME, "no pages or templates to check");
    return;
  }

  // Every hidden (page, slot) pair, each with the content that must not ship.
  const hidden = [];
  // Every string a VISIBLE slot legitimately puts on some page. A needle that
  // also appears here proves nothing either way — duplicated content (backup
  // pages, repeated CTAs) would turn a correct site into a false red.
  const visible = new Set();

  for (const { file, json } of pages) {
    const template = templates.get(String(json.template ?? ""));
    const slots = Array.isArray(template?.slots) ? template.slots : [];
    const pageHidden = new Set(Array.isArray(json.hiddenSlots) ? json.hiddenSlots : []);
    const content = json.content && typeof json.content === "object" ? json.content : {};

    for (const slot of slots) {
      if (!slot || typeof slot.name !== "string") continue;
      const isHidden = slot.hidden === true || pageHidden.has(slot.name);
      const slotContent = content[slot.name];
      if (isHidden) {
        if (slotContent !== undefined) hidden.push({ file, slot: slot.name, content: slotContent });
      } else {
        for (const n of needlesOf(slotContent)) visible.add(n);
      }
    }
    // Content keys no slot declares (orphans of a deleted block) never render
    // regardless, and a hiddenSlots entry for a deleted slot has nothing to
    // check — both are covered by the loop reading the template's slots only.
  }

  if (hidden.length === 0) {
    report.skip(NAME, "no hidden blocks declared — nothing to prove");
    return;
  }

  if (!config.distDir) {
    report.fail(NAME, `hidden blocks are declared but there is no built output to check them against.`);
    return;
  }
  const html = files(join(config.root, config.distDir), ".html")
    .map((f) => readFileSync(f, "utf8"))
    .join("\n")
    .replace(/&#39;|&rsquo;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");

  let examined = 0;
  for (const { file, slot, content } of hidden) {
    const needles = needlesOf(content).filter((n) => !visible.has(n));
    if (needles.length === 0) continue; // nothing distinctive to look for
    examined += 1;
    const leaked = needles.find((n) => html.includes(n));
    if (leaked) {
      report.fail(
        NAME,
        `${relative(config.root, file).split(sep).join("/")}: slot "${slot}" is HIDDEN, but its content ` +
          `("${leaked.slice(0, 50)}…") is in the built output. The renderer is not honouring the hide — ` +
          `the author was told this block is off, and every visitor sees it.`,
      );
    }
  }
  report.examined(NAME, examined);
}
