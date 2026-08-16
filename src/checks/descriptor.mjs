/**
 * §4.6 / §4.4 — the site describes itself, and the manifest describes blocks.
 *
 * These are the two artifacts every tool downstream reads: an editor that
 * cannot find `site.json` has to guess where content lives, and a manifest
 * describing zero blocks is the shape of a generator that ran, succeeded, and
 * produced nothing — the failure §4.4.1 exists for.
 *
 * ADVISORY. Two of the four sites predate the descriptor being required, so
 * these warn rather than block; a site promotes them once it conforms.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const NAME = "descriptor";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

export function checkDescriptor(config, report) {
  const sitePath = join(config.root, "site.json");
  if (!existsSync(sitePath)) {
    report.warn(NAME, `No site.json — every tool has to guess where content, templates and media live (§4.6).`, { rule: "descriptor" });
    return;
  }

  let site;
  try {
    site = readJson(sitePath);
  } catch (err) {
    report.fail(NAME, `site.json is not valid JSON — ${err.message}`);
    return;
  }

  if (!site.standardVersion) {
    report.warn(NAME, `site.json records no "standardVersion", so conformance cannot be checked as the standard moves (§4.6).`, { rule: "descriptor" });
  }
  for (const key of ["blockManifest", "templates", "pages", "media"]) {
    if (!site.paths?.[key]) {
      report.warn(NAME, `site.json declares no paths.${key} (§4.6).`, { rule: "descriptor" });
    }
  }

  // Every collection must resolve to something a tool can render or describe:
  // a routable collection names a template, a data-feed names an itemSchema.
  // Naming neither leaves its items editable nowhere; naming a template that
  // does not exist is worse, because a tool offers to author content it cannot
  // render (§3.6).
  for (const c of site.collections ?? []) {
    if (!c.template && !c.itemSchema) {
      report.warn(NAME, `site.json: collection "${c.name}" declares neither a template nor an itemSchema, so its items are describable by nothing (§3.6).`, { rule: "descriptor" });
    }
  }

  const manifestRel = site.paths?.blockManifest ?? "block-manifest.json";
  const manifestPath = join(config.root, manifestRel);
  if (!existsSync(manifestPath)) {
    report.warn(NAME, `No ${manifestRel} — the editor has no block definitions to work from (§4.2).`, { rule: "manifest" });
    return;
  }

  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch (err) {
    report.fail(NAME, `${manifestRel} is not valid JSON — ${err.message}`);
    return;
  }

  const blocks = Array.isArray(manifest) ? manifest : manifest.blocks ?? Object.values(manifest);
  const count = Array.isArray(blocks) ? blocks.length : Object.keys(blocks ?? {}).length;
  if (count === 0) {
    // §4.4.1: a generator that produced nothing and reported success. One site
    // shipped a manifest describing zero blocks and every check passed.
    report.fail(NAME, `${manifestRel} describes ZERO blocks. A generator that produces nothing and reports success is the failure §4.4.1 exists for.`);
    return;
  }

  report.examined(NAME, count);
}
