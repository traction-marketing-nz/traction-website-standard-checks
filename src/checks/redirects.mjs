/**
 * Redirects (§3.7) — emitted, matching, and landing somewhere real.
 *
 * THE FAILURE THIS EXISTS FOR. On a live site every redirect returned 404 and
 * had for weeks, while the build printed clean on every deploy. Astro compiles
 * an exact rule's source with the trailing slash STRIPPED — `/expertise/`
 * becomes `^/expertise$`, which does not match a request for `/expertise/` —
 * and every source is written WITH the slash, because that is the form the site
 * serves and the form inbound links and the search index carry. So the working
 * form was the one nobody requests, and every spot check landed on it.
 *
 * The assertion for exactly this already existed on that site. It sat inside a
 * loop over WILDCARD rules, written while chasing a wildcard bug; the site had
 * no wildcards, so it never ran. Nothing here is allowed to be scoped to the
 * feature that motivated it: the behaviour is "the URL redirects", so every
 * rule is checked, in both forms, every build.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isWildcard = (r) => String(r.from).includes("*") || String(r.to).includes("*");
const stripSlash = (p) => (p === "/" ? "/" : p.replace(/\/+$/, ""));

/** Rules may be a bare array, or an object with a `redirects` key and comments. */
function readRules(file) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.redirects)) return parsed.redirects;
  throw new Error(`${file}: expected an array of rules, or an object with a "redirects" array.`);
}

/**
 * Does a built page exist at this path — one the host would actually serve?
 *
 * A DIRECTORY is not a page. `dist/properties/` exists on a site whose only
 * pages are `properties/<slug>/index.html`, and counting it as a page reported
 * a correct site as shadowing something that was never there. The filesystem
 * handler serves `index.html`, so that is what has to be present.
 */
function pageExists(distRoot, urlPath) {
  const clean = urlPath.split(/[?#]/)[0].replace(/^\//, "").replace(/\/$/, "");
  return existsSync(join(distRoot, clean, "index.html")) || existsSync(join(distRoot, `${clean}.html`));
}

/**
 * Does the build produce ANYTHING at this path — a page, or a file?
 *
 * A destination is allowed to be an asset. `/brochure/ → /files/brochure.pdf`
 * is an ordinary redirect, and an earlier version failed the build on it
 * because it looked only for HTML: a false failure that blocks a deploy, which
 * is how a shared checker gets deleted. Shadowing still asks the narrower
 * question, because only a PAGE can be shadowed by a redirect.
 */
function targetExists(distRoot, urlPath) {
  const clean = urlPath.split(/[?#]/)[0].replace(/^\//, "").replace(/\/$/, "");
  return pageExists(distRoot, urlPath) || (clean !== "" && existsSync(join(distRoot, clean)));
}

export function checkRedirects(config, report) {
  const NAME = "redirects";
  const rulesPath = join(config.root, config.redirectsFile);

  if (!existsSync(rulesPath)) {
    report.skip(NAME, `${config.redirectsFile} does not exist — this site declares no redirects.`);
    return;
  }

  const rules = readRules(rulesPath);
  if (rules.length === 0) {
    report.skip(NAME, `${config.redirectsFile} is empty.`);
    return;
  }

  const configPath = join(config.root, config.vercelConfig);
  // Fail CLOSED, for any rule. A missing route table means nothing could be
  // checked — which is not the same as nothing being wrong, and must never
  // read as a pass.
  if (!existsSync(configPath)) {
    report.fail(
      NAME,
      `${rules.length} redirect(s) are configured but ${config.vercelConfig} does not exist, so none of ` +
        `them could be checked. Do not read this build as proof they work.`,
    );
    return;
  }

  const routes = JSON.parse(readFileSync(configPath, "utf8")).routes ?? [];
  const filesystemAt = routes.findIndex((r) => r.handle === "filesystem");
  if (filesystemAt === -1) {
    report.fail(
      NAME,
      `${config.vercelConfig} has no \`filesystem\` phase, so no redirect's position could be checked ` +
        `against it. Do not read this build as proof any of them work.`,
    );
    return;
  }

  /** The first redirecting route that wins for `path`, before the filesystem serves a file. */
  const resolve = (path) => {
    const at = routes.findIndex(
      (r, i) => i < filesystemAt && r.src && r.headers?.Location && new RegExp(r.src).test(path),
    );
    if (at === -1) return null;
    const tail = new RegExp(routes[at].src).exec(path)?.[1] ?? "";
    return {
      to: routes[at].headers.Location.replace("$1", () => tail),
      status: routes[at].status ?? 301,
      at,
    };
  };

  const exempt = new Map(
    config.allow.redirectSlashExceptions.map((e) => [stripSlash(e.from), e.reason]),
  );
  const exact = rules.filter((r) => !isWildcard(r));
  let examined = 0;

  for (const rule of exact) {
    const bare = stripSlash(rule.from);
    const forms = bare === "/" ? ["/"] : [bare, `${bare}/`];

    for (const form of forms) {
      // A declared exception, because a real route can legitimately occupy one
      // form: a site with a `properties/[slug]` directory cannot also redirect
      // `/properties/`, and a redirect emitted ahead of the filesystem would
      // SHADOW that live page. The exception is per-source and carries a
      // reason, so waiving it stays a decision somebody made rather than a gap.
      const skipSlashed = form.endsWith("/") && form !== "/" && exempt.has(bare);

      // A redirect must never shadow a page that EXISTS. Routes sit ahead of
      // the filesystem, so if a real page lives at this URL the redirect wins
      // and the page becomes unreachable.
      //
      // Found by mutation, and it is the reason this check is here rather than
      // trusted to the exception list: deleting a site's declared exception
      // made the emitter produce the shadowing route AND made the checker stop
      // expecting the exception, so the two agreed with each other and the
      // suite passed while every property page went dark. Two halves of one
      // rule can agree and still be wrong; only the built output settles it.
      if (config.distDir) {
        const shadowed = pageExists(join(config.root, config.distDir), form);
        const hit = resolve(form);
        if (shadowed && hit) {
          report.fail(
            NAME,
            `"${rule.from}" emits a redirect for ${form}, but a real page is built there. Redirects run ` +
              `BEFORE the filesystem, so that page is now unreachable — every visitor and crawler is sent ` +
              `to ${hit.to} instead. Declare the exception in site-checks.config.json if the redirect is ` +
              `wanted for the other slash form only.`,
          );
          continue;
        }
      }

      if (skipSlashed) continue;

      examined += 1;
      const hit = resolve(form);

      if (!hit) {
        report.fail(
          NAME,
          `"${rule.from}" is in ${config.redirectsFile}, but a request for ${form} matches no redirect ` +
            `before the filesystem — it falls through and 404s. Sources are written with a trailing ` +
            `slash and the framework compiles them without one, so BOTH forms have to be emitted.`,
        );
        continue;
      }
      if (hit.to !== rule.to) {
        report.fail(
          NAME,
          `"${rule.from}": a request for ${form} lands on ${hit.to} instead of ${rule.to}.`,
        );
        continue;
      }
      if (hit.status !== (rule.status ?? 301)) {
        report.fail(
          NAME,
          `"${rule.from}" is written as a ${rule.status ?? 301} but ${form} is emitted as a ` +
            `${hit.status}. A 302 where a 301 was written forfeits the ranking transfer, which is ` +
            `the whole point of the file.`,
        );
      }
    }

    // The destination has to be a page someone can read. A rule that redirects
    // correctly INTO a 404 is worse than the broken link it replaced: the
    // visitor still gets nothing, and the search engine is now told the old URL
    // permanently moved there.
    if (!isWildcard(rule) && !/^[a-z]+:/i.test(rule.to) && config.distDir) {
      const distRoot = join(config.root, config.distDir);
      if (!targetExists(distRoot, rule.to)) {
        report.fail(
          NAME,
          `"${rule.from}" redirects to ${rule.to}, but no page was built there. The redirect works ` +
            `and sends every visitor and crawler to a 404.`,
        );
      }
    }
  }

  // WILDCARDS get checked in their own right, not merely as a hazard to exact
  // rules. An earlier version only asked whether a wildcard shadowed a
  // carve-out, so a site whose redirects were ENTIRELY wildcards could emit
  // none of them and still get a green tick — the exact mirror of the failure
  // this package was built after, and the anti-vacuous-pass floor did not
  // notice because the HTML check had examined plenty.
  for (const w of rules.filter(isWildcard)) {
    const prefix = stripSlash(String(w.from).replace(/\/\*$/, ""));
    // Three shapes of the same journey, so a rule is checked on what it
    // promises the author rather than on the one path someone thought of.
    const samples = [`${prefix}/a`, `${prefix}/a/b`, `${prefix}/a-b-c/`];
    const expected = (path) => {
      const tail = path.slice(prefix.length).replace(/^\//, "");
      return String(w.to).includes("*") ? String(w.to).replace("*", () => tail) : String(w.to);
    };

    for (const path of samples) {
      examined += 1;
      const hit = resolve(path);
      if (!hit) {
        report.fail(
          NAME,
          `"${w.from}" is in ${config.redirectsFile}, but a request for ${path} matches no redirect ` +
            `before the filesystem — the wildcard reached the route table not at all, or too late to run.`,
        );
        break;
      }
      if (hit.to !== expected(path)) {
        report.fail(
          NAME,
          `"${w.from}": ${path} lands on ${hit.to}, but the rule promises ${expected(path)}. ` +
            `The editor offers this expansion to an author, so it has to be the one that happens.`,
        );
        break;
      }
      if (hit.status !== (w.status ?? 301)) {
        report.fail(
          NAME,
          `"${w.from}" is written as a ${w.status ?? 301} but ${path} is emitted as a ${hit.status}.`,
        );
        break;
      }
    }
  }

  // A wildcard must not shadow an exact rule inside its prefix, in either form.
  for (const w of rules.filter(isWildcard)) {
    const prefix = stripSlash(String(w.from).replace(/\/\*$/, ""));
    for (const e of exact) {
      const bare = stripSlash(e.from);
      if (!(bare === prefix || bare.startsWith(`${prefix}/`))) continue;
      for (const form of [bare, `${bare}/`]) {
        if (form.endsWith("/") && form !== "/" && exempt.has(bare)) continue;
        const hit = resolve(form);
        if (hit && hit.to !== e.to) {
          report.fail(
            NAME,
            `"${e.from}" is a specific redirect inside "${w.from}", but ${form} lands on ${hit.to} ` +
              `instead of ${e.to} — the wildcard shadows it, so the carve-out only works for ` +
              `whichever slash form you do not type.`,
          );
        }
      }
    }
  }

  report.examined(NAME, examined);
  for (const [from, reason] of exempt) {
    report.skip(NAME, `${from}/ exempt from the both-forms rule — ${reason}`);
  }
}

export const _internals = { isWildcard, stripSlash, pageExists, targetExists };
