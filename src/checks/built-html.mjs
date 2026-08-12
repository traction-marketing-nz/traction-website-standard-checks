/**
 * The pages a visitor actually receives.
 *
 * Everything here reads the BUILT HTML, not the source that produced it, and
 * that is the whole point. Each of these passed a compile, a typecheck and a
 * review on the site where it was found:
 *
 *   - A backtick inside a comment emptied a stylesheet expression, and the page
 *     shipped `<style></style>`. The site rendered unstyled and the build was
 *     green.
 *   - A template literal that was never interpolated shipped `${title}` as
 *     visible text on the page.
 *   - Pages went out with no <title>, no meta description, or two <h1>s.
 *   - JSON-LD that did not parse, so every rich result silently vanished.
 *   - <img> with no alt, or no width/height — the second shifts the layout as
 *     it loads and is a Core Web Vitals failure nobody sees locally.
 *   - Images hotlinked from another origin, which breaks the day that origin
 *     changes and is outside the site's own media budget.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const NAME = "built-html";

function htmlFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) htmlFiles(full, acc);
    else if (entry.endsWith(".html")) acc.push(full);
  }
  return acc;
}

/** Strip comments and script/style bodies before looking for stray syntax. */
const withoutInert = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

export function checkBuiltHtml(config, report) {
  if (!config.distDir) {
    report.fail(NAME, `No built output found (looked for dist/client and dist). This check runs AFTER the build.`);
    return;
  }
  const root = join(config.root, config.distDir);
  const files = htmlFiles(root);
  const rel = (f) => relative(config.root, f).split(sep).join("/");

  if (files.length === 0) {
    report.fail(NAME, `${config.distDir} contains no HTML at all — the build emitted nothing to check.`);
    return;
  }

  const exempt = (rule, file) => (config.allow.pages[rule] ?? []).some((p) => rel(file).includes(p));

  for (const file of files) {
    const html = readFileSync(file, "utf8");
    const body = withoutInert(html);

    // A stylesheet expression that collapsed. `<style></style>` and
    // `<style>true</style>` are both "the CSS is gone", and both render.
    for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
      const content = m[1].trim();
      if (content === "") {
        report.fail(NAME, `${rel(file)} ships an EMPTY <style></style> — the stylesheet expression collapsed.`);
      } else if (/^(true|false|undefined|null|NaN|\[object [A-Za-z]+\])$/.test(content)) {
        report.fail(NAME, `${rel(file)} has a <style> whose content is \`${content}\` — the expression collapsed.`);
      }
    }

    // An uninterpolated template literal, visible to a reader as `${…}`.
    const stray = body.match(/\$\{[^}\n]{1,60}\}/);
    if (stray) {
      report.fail(NAME, `${rel(file)} contains an uninterpolated template literal: ${stray[0]}`);
    }

    const is404 = /(^|\/)404\.html$/.test(rel(file));

    if (!/<title[^>]*>\s*\S/.test(html) && !exempt("title", file)) {
      report.fail(NAME, `${rel(file)} has no <title>.`);
    }
    if (!/<meta[^>]+name=["']description["'][^>]*content=["']\s*\S/i.test(html) && !is404 && !exempt("description", file)) {
      report.fail(NAME, `${rel(file)} has no meta description.`);
    }
    if (!/<link[^>]+rel=["']canonical["']/i.test(html) && !is404 && !exempt("canonical", file)) {
      report.fail(NAME, `${rel(file)} has no canonical link.`);
    }

    const h1s = html.match(/<h1\b/gi) ?? [];
    if (h1s.length !== 1 && !exempt("h1", file)) {
      report.fail(NAME, `${rel(file)} has ${h1s.length} <h1> element(s) — the outline needs exactly one.`);
    }

    for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        JSON.parse(m[1]);
      } catch (err) {
        report.fail(NAME, `${rel(file)}: JSON-LD is not valid JSON — ${err.message}. Every rich result from it is silently lost.`);
      }
    }

    for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0];
      if (!/\balt=/.test(tag) && !exempt("alt", file)) {
        report.fail(NAME, `${rel(file)}: an <img> has no alt attribute — ${tag.slice(0, 90)}`, { rule: "alt" });
      }
      // The rule is about LAYOUT SHIFT, so the check has to be about layout
      // shift — not about the presence of two attributes. An image that is
      // absolutely positioned, or told to fill its box, reserves no space in
      // the flow and cannot move anything when it loads. Flagging those was
      // most of the first run's output on a site with none of the defect, and
      // a check that cries wolf on correct code gets switched off.
      const style = /\bstyle=["']([^"']*)["']/.exec(tag)?.[1] ?? "";
      const sizedByCss =
        /position\s*:\s*absolute|position\s*:\s*fixed/.test(style) ||
        (/(^|;)\s*width\s*:/.test(style) && /(^|;)\s*height\s*:/.test(style));
      const hasIntrinsic = /\bwidth=/.test(tag) && /\bheight=/.test(tag);
      if (!hasIntrinsic && !sizedByCss && !exempt("dimensions", file)) {
        report.warn(NAME, `${rel(file)}: an <img> has no intrinsic width/height and no CSS size, so it shifts the layout as it loads — ${tag.slice(0, 90)}`, { rule: "dimensions" });
      }
      const src = /\bsrc=["']([^"']+)["']/.exec(tag)?.[1] ?? "";
      if (/^https?:\/\//i.test(src) && !exempt("hotlink", file)) {
        report.warn(NAME, `${rel(file)}: hotlinked external image ${src} — media is committed content (§3.4), not borrowed.`, { rule: "hotlink" });
      }
    }
  }

  report.examined(NAME, files.length);
}
