#!/usr/bin/env node
/**
 * traction-site — the Website Architecture Standard's gate items, as a command.
 *
 *   traction-site check                 run every enabled check
 *   traction-site check --only redirects,errorPage
 *   traction-site check --root ../site
 *
 * Exits non-zero on any failure, so it can sit in a build script and stop a
 * deploy. That is the entire design intent: the standard's rules only bind when
 * something refuses to ship.
 */
import { run } from "../src/run.mjs";

const argv = process.argv.slice(2);
const command = argv[0] ?? "check";

if (command === "--help" || command === "-h" || command === "help") {
  console.log(`traction-site check [--root <dir>] [--only <names>]

Checks:
  redirects   every rule reaches its destination, in BOTH slash forms, and the
              destination is a page that exists (§3.7)
  builtHtml   the pages a visitor receives: title, description, canonical, one
              <h1>, valid JSON-LD, img alt + dimensions, no collapsed stylesheet,
              no uninterpolated \${…} (§4.4, §8)
  errorPage   the branded 404 is built AND routed, with status 404 (§3.7.3)

Per-site exceptions go in site-checks.config.json, each with a reason.`);
  process.exit(0);
}

if (command !== "check") {
  console.error(`Unknown command "${command}". Try: traction-site check`);
  process.exit(2);
}

const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};

const root = flag("root") ?? process.cwd();
const only = flag("only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;

const { report } = run({ root, only });
process.exit(report.print());
