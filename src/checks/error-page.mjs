/**
 * The branded 404 (§3.7.3) — built AND wired.
 *
 * Two halves, and the second is the one everyone misses. A site can ship a
 * beautiful 404 page inside the deployment with nothing pointing at it: the
 * host never routes to it, so an unknown URL gets the platform's own card, and
 * the only way to notice is to request a path that cannot exist. Building the
 * page is not serving it — the same distinction as §3.7's "emitting a redirect
 * is not serving one".
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const NAME = "error-page";

export function checkErrorPage(config, report) {
  if (!config.distDir) {
    report.fail(NAME, "No built output found — this check runs AFTER the build.");
    return;
  }

  const page = join(config.root, config.distDir, "404.html");
  if (!existsSync(page)) {
    report.fail(
      NAME,
      `No 404.html in ${config.distDir} — an unknown URL gets the platform's error card, not the site's page.`,
    );
    return;
  }

  const configPath = join(config.root, config.vercelConfig);
  if (!existsSync(configPath)) {
    // Two deployment styles, and only one of them needs a route. A Build Output
    // API v3 deployment must route to 404.html explicitly; a CLASSIC static
    // deployment (a repo `vercel.json`, no `.vercel/output`) has the host serve
    // 404.html by convention. Demanding the route table failed a site that was
    // correct, in the way that platform serves it.
    if (existsSync(join(config.root, "vercel.json"))) {
      report.skip(
        NAME,
        `classic static deployment (vercel.json, no ${config.vercelConfig}) — the host serves 404.html by ` +
          `convention, so there is no route table to check. Verified by requesting a path that cannot exist.`,
      );
      report.examined(NAME, 1);
      return;
    }
    report.fail(
      NAME,
      `A 404 page was built but ${config.vercelConfig} does not exist, so nothing could be shown to route to it. ` +
        `Do not read this build as proof the branded 404 is served.`,
    );
    return;
  }

  const routes = JSON.parse(readFileSync(configPath, "utf8")).routes ?? [];

  // Check the BEHAVIOUR, not the mechanism. An earlier version of this demanded
  // an `error` phase, and reported a perfectly good site as broken: it served
  // its branded 404 from a catch-all placed after `filesystem`, which reaches
  // exactly the same outcome. Insisting on one spelling of a correct answer is
  // how a shared check earns a reputation for crying wolf and gets switched off.
  //
  // What has to be true is only this: a path that matches no real file ends up
  // at 404.html, with status 404.
  const filesystemAt = routes.findIndex((r) => r.handle === "filesystem");
  if (filesystemAt === -1) {
    report.fail(
      NAME,
      `${config.vercelConfig} has no \`filesystem\` phase, so where the branded 404 sits relative to real ` +
        `files could not be determined. Do not read this build as proof it is served.`,
    );
    return;
  }

  const catchAll = routes
    .slice(filesystemAt)
    .find((r) => typeof r.dest === "string" && /404/.test(r.dest) && (!r.src || new RegExp(r.src).test("/no-such-page-xyz")));

  if (!catchAll) {
    report.fail(
      NAME,
      `The branded 404 ships inside the deployment with NOTHING pointing at it — no route after the ` +
        `filesystem sends an unmatched path to 404.html, so the host serves its own card instead.`,
    );
    return;
  }

  // A 404 that answers 200 is worse than the platform card: crawlers index it
  // as a real page and the site accumulates duplicate thin content.
  if ((catchAll.status ?? 200) !== 404) {
    report.fail(
      NAME,
      `The branded 404 is served with status ${catchAll.status ?? 200}. A 404 page that answers ` +
        `${catchAll.status ?? 200} gets indexed as a real page.`,
    );
  }

  report.examined(NAME, 1);
}
