/**
 * Where a site keeps its things, and the exceptions it has earned.
 *
 * Sites genuinely differ, and a shared checker that pretends otherwise breaks
 * working sites — which is how a shared checker gets deleted. The one real
 * example so far: a site could not carry a trailing-slash twin for `/properties`
 * because a route directory of that name already occupies the URL, and emitting
 * the redirect anyway would have shadowed a live page. That is a legitimate
 * exception, so it is declarable — but it must be DECLARED, with a reason, in
 * the repo, rather than achieved by the check quietly not looking.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULTS = {
  /** Built HTML. Astro's Vercel adapter writes `dist/client`; a static build writes `dist`. */
  distDir: null,
  /** The host's emitted route table. */
  vercelConfig: ".vercel/output/config.json",
  /** Redirects as content (§3.7). */
  redirectsFile: "content/redirects.json",
  /** Turn a check off only with a reason recorded beside it. */
  checks: {
    redirectList: true,
    redirects: true,
    builtHtml: true,
    errorPage: true,
    descriptor: true,
    seoOutputs: true,
    structuredData: true,
    secrets: true,
  },
  /**
   * Warning rules a site has cleaned and wants to keep clean. Once "dimensions"
   * is in here it blocks like any other error — the ratchet that stops debt
   * coming back without demanding every site fix everything on day one.
   */
  promote: [],
  allow: {
    /**
     * Sources that must NOT get a trailing-slash twin, each with a reason.
     * `{ "from": "/properties", "reason": "…route directory occupies /properties/" }`
     */
    redirectSlashExceptions: [],
    /** Pages exempt from a rule, keyed by rule name, each with a reason. */
    pages: {},
  },
};

/** Astro writes one of these depending on whether an adapter is present. */
function detectDist(root) {
  for (const candidate of ["dist/client", "dist"]) {
    if (existsSync(join(root, candidate))) return candidate;
  }
  return null;
}

export function loadConfig(root) {
  const path = join(root, "site-checks.config.json");
  const fromFile = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};

  const config = {
    ...DEFAULTS,
    ...fromFile,
    checks: { ...DEFAULTS.checks, ...(fromFile.checks ?? {}) },
    promote: fromFile.promote ?? DEFAULTS.promote,
    allow: {
      ...DEFAULTS.allow,
      ...(fromFile.allow ?? {}),
      pages: { ...DEFAULTS.allow.pages, ...(fromFile.allow?.pages ?? {}) },
    },
    root,
    configPath: existsSync(path) ? path : null,
  };

  config.distDir ??= detectDist(root);

  // An exception without a reason is an exception nobody can review later.
  for (const e of config.allow.redirectSlashExceptions) {
    if (!e || typeof e.from !== "string" || !e.reason) {
      throw new Error(
        `site-checks.config.json: every entry in allow.redirectSlashExceptions needs a "from" and a "reason". ` +
          `The reason is the point — it is what a reviewer reads instead of re-deriving why the rule was waived.`,
      );
    }
  }
  return config;
}
