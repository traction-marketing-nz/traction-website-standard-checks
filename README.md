# @traction/site-checks

The [Website Architecture Standard](https://github.com/traction-marketing-nz/traction-web/blob/main/WEBSITE-ARCHITECTURE-STANDARD.md)'s gate items, as **checks that run**.

## Why this exists

The standard is ~29,000 words. Each site read it and wrote its own checkers, so four sites now carry four forks: `test-built-output.mjs` is 320 lines on one and 416 on another, same name, different behaviour. Two of the four have no redirect checking at all.

That is not an academic problem. On 2026-08-12 every redirect on a production site returned 404, and had for weeks, while its build printed `✓ Built output clean` on every deploy. The assertion for that exact defect **already existed on that site** — written while chasing a wildcard bug, and placed inside the loop over wildcard rules. The site had no wildcards, so it never ran.

A fix to one site's fork reaches one site. A fix here reaches all of them.

## Use

```jsonc
// package.json
"scripts": {
  "build": "astro build && traction-site check"
}
```

Exits non-zero on any error, so it stops a deploy. That is the design intent: the standard's rules only bind when something refuses to ship.

```sh
traction-site check                        # everything
traction-site check --only redirects       # one check
traction-site check --root ../other-site   # somewhere else
```

## What it checks

| Check | Reads |
|---|---|
| `redirectList` | `content/redirects.json` alone — is this a legal set of rules? |
| `redirects` | the emitted route table and the built output — did they reach the host, and do they work? |
| `builtHtml` | the pages a visitor receives |
| `errorPage` | the branded 404 — built *and* routed |
| `descriptor` | `site.json` and the block manifest — does the site describe itself? |
| `seoOutputs` | sitemap, robots and llms.txt — do they describe the site that shipped? |
| `structuredData` | JSON-LD entities, per page |
| `secrets` | editable content and the built output, client *and* server |

The last four are **advisory** — they warn and block nothing, so a site adopting them sees its whole gap at once. Promote each once it is clean.

**[RULES.md](RULES.md) is the source of truth for every rule and the failure it was written after.** It is not summarised here, and it is not restated in the Website Architecture Standard, which points at it. A rule written in two places drifts — and did, within hours, between exactly those two documents.

Everything reads the **built output**, not the source that produced it.

## Errors vs warnings

An **error** is something a visitor receives — a dead redirect, an unstyled page, a 404 nobody routes to. It blocks.

A **warning** is debt — an image without dimensions, a hotlinked asset. It prints in full and blocks nothing.

The split is what makes this adoptable. The first run against an existing site produced 185 findings, all of them debt; a gate that refuses today's change over last year's debt is one people learn to route around. Clean a rule up, then promote it so it cannot come back:

```jsonc
// site-checks.config.json
{ "promote": ["dimensions"] }
```

## Per-site configuration

Sites genuinely differ, and a shared checker that pretends otherwise breaks working sites — which is how a shared checker gets deleted. Everything is optional:

```jsonc
{
  "distDir": "dist/client",              // auto-detected: dist/client, then dist
  "vercelConfig": ".vercel/output/config.json",
  "redirectsFile": "content/redirects.json",
  "checks": { "redirectList": true, "redirects": true, "builtHtml": true, "errorPage": true },
  "promote": ["dimensions"],
  "allow": {
    // A real route can legitimately occupy the slashed form — emitting the
    // redirect anyway would SHADOW a live page. Allowed, but declared.
    "redirectSlashExceptions": [
      { "from": "/properties", "reason": "properties/[slug] occupies /properties/" }
    ],
    "pages": { "h1": ["/styleguide/"] }
  }
}
```

**Every exception needs a reason, and the loader refuses one without.** The reason is the point — it is what a reviewer reads instead of re-deriving why the rule was waived. Exceptions are printed on every run, so a waiver stays visible rather than becoming the silence it was meant to avoid.

## The rule this package is built on

A check that examines nothing must never print a tick. Individual checks say when they were skipped and why; the suite fails outright if every check reported success having looked at zero files. That state — a moved directory, a bad path, a loop that never entered — is what every failure behind this package looked like from the outside.

## Development

```sh
npm test
```

Fifty cases, each asserting **both** that a clean fixture passes and that the broken one fails *with a message naming the offender*. A test that only asserted failure would be satisfied by a check that fails on everything.
