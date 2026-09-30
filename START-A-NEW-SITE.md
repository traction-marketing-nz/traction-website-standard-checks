# Start a new website

This guide takes you from nothing to a launched site built to the
[Website Architecture Standard](./WEBSITE-ARCHITECTURE-STANDARD.md). Read it with
[RULES.md](./RULES.md) (what the automated gate enforces) and the standard itself
(the full architecture and the section numbers referenced below, e.g. §13).

There are **two paths**. Pick one:

| Path | Use when | Reference of truth | Visual gate | Standard section |
|------|----------|--------------------|-------------|------------------|
| **A — Clone** | You are replacing an existing live site and the new one must match it | The live site | Exact: < 10% pixel-diff per section | §13 |
| **B — Brand new** | There is no existing site; you are designing from scratch | An approved design artifact | Intent: ~15–20% | §14 |

The architecture, build pipeline, and gate machinery are **identical** for both.
Only the reference of truth and the visual threshold change.

---

## 0. Before you start (both paths)

1. **Install the toolchain.** Node 20+, git, and the framework you build in (this
   family of sites uses Astro + React shipped as Preact → static HTML).
2. **Create the repo.** One repo per site. Name it after the site
   (for example `traction-web`). Do **not** develop shared/generic code here — that
   belongs in `traction-website-standard-checks`.
3. **Install the checks and wire them into the build NOW, not at the end** (§11.0).
   Do not defer this step. If you add the gate last, you discover at launch what it
   would have told you in week one.

   ```jsonc
   // package.json
   "devDependencies": {
     "@traction/site-checks": "github:traction-marketing-nz/traction-website-standard-checks#vX.Y.Z"
   },
   "scripts": {
     "build": "astro build && traction-site check"
   }
   ```

   Pin a real release tag in place of `vX.Y.Z`. Take it from the package's
   releases, not from this example — a version written in a document goes stale.
   On pnpm use `pnpm add -D`; `npm install` silently adds nothing to a `github:` dep.

4. **Read the six intake questions (§13.0.1)** even for a brand-new site. The
   answers set scope, deployment target, and the mobile breakpoint you gate at.

---

## Path A — Clone an existing site (migration)

Follow the two-phase fidelity gate in §13. Fidelity is a **per-template gate, not a
final step**: each template must pass before it is "done".

### A1. Intake (Phase 0)
Answer the six questions once, before any code, and record them in
`migration-state.json` (§13.0):

1. **Source URL** — the exact live site and environment being replicated.
2. **Scope** — which pages/templates are in, which are explicitly out.
3. **Intentional deviations** — what should deliberately differ from the source.
4. **Known gaps** — what is already broken on the source and need not be reproduced.
5. **Deployment target** — host, domain, and whether this replaces a live site.
6. **Mobile breakpoint** — the width to gate at (375px default).

Every later session reads `migration-state.json` first and resumes from it. Never
re-ask an answered Phase 0 question.

### A2. Source audit (Phase 1, per template, before any code)
Produce `source-audit/<template>.json` for every template (§13.1). Capture:

- **Section inventory**, numbered top-to-bottom — this **is** the slot order.
- **Interactive widget type** — carousel vs grid vs tabs vs accordion, detected not assumed.
- **Heading style matrix** and per-element computed values (colour, font-size,
  weight, line-height, letter-spacing) via `getComputedStyle` — never eyeballed.
- **Element geometry** (bounding boxes) so layout and text wrapping match.
- **Global elements** — logo `href`, nav targets, footer links, social hrefs.

**Extract ground truth first, then build to it.** Do not build from a screenshot
and guess.

### A3. Tokens
Extract the source's design tokens (colour, type, spacing, radii, shadow, motion)
into `src/styles/tokens.css`. Every block references tokens, never raw values.

### A4. Blocks
Build the blocks each template needs, schema-first (§4.2.1): a framework component,
its typed props, and a `block-manifest.json` entry (generated, not hand-written).

### A5. Templates
Compose blocks into `src/content/templates/*.json`. The `slots` array order is the
**only** control over render order (§13.2). Verify it against the section inventory
from A2 **before** building the pages.

### A6. Build + content
Author each page as `template + slot data` in `src/content/pages/*.json`. Pages must
be **content-data, not code** (§4.4). Write `site.json` (§4.6) naming every path and
collection plus the `standardVersion` you build to.

### A7. Pass both gates, per template
- **Phase 1 — visual diff:** `compare.mjs <path> [breakpoint]` — per-section
  pixel-diff < 10% at every breakpoint. Review the **diff image**, not just the %.
- **Phase 2 — structural audit:** `audit.mjs <path>` — assert section inventory,
  asset parity, component type, and slide/item counts against the source.

`compare.mjs` / `audit.mjs` are **reference tooling** (a Playwright + pixelmatch
harness and a DOM-manifest extractor). Any equivalent that produces section-isolated
visual diffs and a structural parity report satisfies the gate.

Known **pixel-diff floors** (photographic backgrounds, auto-advancing carousels,
Lottie/video) cannot reach the threshold by pixels alone (§13.4). Match them as
closely as the structure allows, then rely on the Phase-2 audit + a one-time visual
check.

A template is signed off only when **both fidelity phases AND editor-readiness
(§4.4)** pass at every breakpoint, including 375px.

### A8. Launch
Work the launch checklist in §15. The migration-only items — 301 map from a full
crawl, parallel data capture, DNS rollback — apply here.

---

## Path B — Brand new site (greenfield)

Follow the greenfield process in §14. The pipeline is the same; the reference is an
**approved design**, and the quality gates a migration inherits for free must be
**added explicitly**.

### B1. Design funnel (§14.1)
1. **Diverge** — generate several distinct directions with claude.ai/design (or the
   `frontend-design` plugin). Get **mobile and desktop** for key screens.
2. **Decide** — pick one direction with the stakeholder and lock it.

Do not pixel-chase an AI-generated mock to 100%. It bakes in the mock's flaws.

### B2. The handoff — design artifact → coding system (§14.2)
**Nothing enters the build until these three artifacts exist.** They are the
contract between design and code:

1. **Design tokens → `tokens.css`** — palette, type scale, spacing, radii, shadow,
   motion. Every block references tokens.
2. **Block + template decomposition** — map recurring sections to reusable blocks,
   and define the template set deliberately, up front.
3. **Reference renders** — the chosen mock as rendered HTML, per template, per
   breakpoint. These replace the live URL as the source of truth for `compare.mjs`.

Rule of thumb: if you cannot point to the tokens file, the block list, and the
per-breakpoint reference renders, design is not finished and coding should not start.

### B3. Build
Same blocks → templates → pages pipeline as Path A (steps A4–A6), token-driven,
static output.

### B4. The greenfield gate (§14.3)
- **Visual** (`compare.mjs`, reference = rendered mock): intent match at ~15–20%.
- **Quality gates**, made explicit:
  - **Token conformance** — no off-token colours/spacing.
  - **Accessibility** — contrast, semantic structure, keyboard paths, focus order.
  - **Responsive correctness** — every breakpoint designed and verified.
  - **Performance budget** — mobile and desktop.
  - **SEO / structured data** — template-declared schema, one entity per page.

### B5. Launch
Work the launch checklist in §15. Skip the migration-only items (301 maps, parallel
capture, DNS rollback); the greenfield gate (§14) governs sign-off instead.

---

## The common build sequence (§12)

Both paths share this sequence. For Path B, run it alongside the design → handoff →
gate process in §14. For Path A, the §13 fidelity gate governs sign-off.

1. **Scaffold** the generator project; add the host adapter and an independent
   database. **Install `@traction/site-checks` and wire it into `build` now** (§11.0).
2. **Establish tokens** up front.
3. **Build the core blocks** for the first template, then the rest.
4. **Define templates**; map every page to one.
5. **Author content** as `template + slot data`.
6. **Wire dynamic features** — the enquiry pipeline (§7.1) and tag manager (§7.2).
   Prove the enquiry loop with a real submission (§7.1.1).
7. **Generate SEO/AEO/GEO outputs** (schema, sitemap, `llms.txt`) from the model.
8. **Wire the error page and redirects** (§3.7); confirm `redirects.json` is read by
   the build.
9. **Write `site.json`** (§4.6) — the descriptor naming every path and collection.
10. **Prove the data-driven render tree-shakes** and the editor↔git↔preview loop on
    one page before scaling; then pass the editor-readiness gate (§4.4).

---

## What "done" means

- Every template passes its gate (Path A: both fidelity phases; Path B: the
  greenfield gate) at **every breakpoint**, including 375px.
- **Editor-readiness (§4.4) passes** — pages are content-data, `block-manifest.json`
  is generated, `site.json` is present, the editor↔git↔preview loop is proven.
- **`traction-site check` is in the `build` script and exits 0** (§11.0).
- The launch checklist (§15) is complete for the site's type.

Conforming the design is necessary but **not sufficient**: a site that renders
correctly but whose pages are hand-coded has failed the standard.
