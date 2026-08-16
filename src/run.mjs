/**
 * Run every enabled check and report once.
 *
 * The orchestrator does one thing the individual checks must not: it refuses to
 * report success when nothing was examined. A check that examines zero files
 * passes, and a suite of them prints a tick over a broken site — which is
 * exactly how twelve dead redirects survived weeks of green builds.
 */
import { loadConfig } from "./config.mjs";
import { Report } from "./report.mjs";
import { checkRedirectList } from "./checks/redirect-list.mjs";
import { checkRedirects } from "./checks/redirects.mjs";
import { checkBuiltHtml } from "./checks/built-html.mjs";
import { checkErrorPage } from "./checks/error-page.mjs";
import { checkDescriptor } from "./checks/descriptor.mjs";
import { checkSeoOutputs, checkStructuredData } from "./checks/seo-outputs.mjs";
import { checkSecrets } from "./checks/secrets.mjs";
import { checkSeoConsumed, checkTagManager, checkInternalLinks } from "./checks/consumed.mjs";

const REGISTRY = {
  // The list first: rules that are not legal cannot be usefully checked against
  // a route table, and a self-referential rule is an outage no table can rescue.
  redirectList: checkRedirectList,
  redirects: checkRedirects,
  builtHtml: checkBuiltHtml,
  errorPage: checkErrorPage,
  // Added as ADVISORY: everything below warns rather than blocks, so a site
  // adopting the package mid-life sees its whole gap at once instead of being
  // unable to deploy. Each is promoted per rule once it is clean.
  descriptor: checkDescriptor,
  seoOutputs: checkSeoOutputs,
  structuredData: checkStructuredData,
  secrets: checkSecrets,
  seoConsumed: checkSeoConsumed,
  tagManager: checkTagManager,
  internalLinks: checkInternalLinks,
};

export function run({ root = process.cwd(), only = null } = {}) {
  const config = loadConfig(root);
  const report = new Report({ promote: config.promote });

  for (const [name, fn] of Object.entries(REGISTRY)) {
    if (only && !only.includes(name)) continue;
    if (config.checks[name] === false) {
      report.skip(name, "disabled in site-checks.config.json");
      continue;
    }
    try {
      fn(config, report);
    } catch (err) {
      // A check that throws is a check that did not run. Never let that read
      // as a pass just because nothing called report.fail().
      report.fail(name, `the check itself failed to run: ${err.message}`);
    }
  }

  const examinedAnything = Object.values(report.counts).some((n) => n > 0);
  if (report.ok && !examinedAnything) {
    report.fail(
      "suite",
      `every check reported success having examined NOTHING. That is a green tick over an unknown site, ` +
        `not a passing one — check distDir and the paths in site-checks.config.json.`,
    );
  }

  return { report, config };
}
