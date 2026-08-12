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
    report.fail(
      NAME,
      `A 404 page was built but ${config.vercelConfig} does not exist, so nothing could be shown to route to it. ` +
        `Do not read this build as proof the branded 404 is served.`,
    );
    return;
  }

  const routes = JSON.parse(readFileSync(configPath, "utf8")).routes ?? [];
  const errorAt = routes.findIndex((r) => r.handle === "error");
  if (errorAt === -1) {
    report.fail(
      NAME,
      `The branded 404 ships inside the deployment with NOTHING pointing at it — the route table has no ` +
        `\`error\` phase, so the host serves its own card instead.`,
    );
    return;
  }

  const served = routes.slice(errorAt).some((r) => typeof r.dest === "string" && r.dest.includes("404"));
  if (!served) {
    report.fail(
      NAME,
      `The route table has an \`error\` phase but nothing in it serves 404.html, so the branded page is ` +
        `built and unreachable.`,
    );
    return;
  }

  // A 404 that answers 200 is worse than the platform card: crawlers index it
  // as a real page and the site accumulates duplicate thin content.
  const wrongStatus = routes
    .slice(errorAt)
    .find((r) => typeof r.dest === "string" && r.dest.includes("404") && r.status && r.status !== 404);
  if (wrongStatus) {
    report.fail(
      NAME,
      `The branded 404 is served with status ${wrongStatus.status}. A 404 page that answers ${wrongStatus.status} ` +
        `gets indexed as a real page.`,
    );
  }

  report.examined(NAME, 1);
}
