# Website Architecture Standard

**A reusable reference architecture for building fast, AI-editable, AEO/GEO/SEO-native websites.**

This is the standard for *all* our websites. Any new site project — whether built by a person or an AI agent — follows this document to know how to structure and build. It is intentionally generic: it defines the principles, the content model, the stack, the editor integration, the infrastructure, and the conventions, with sensible defaults that are portable by design.

> **For an AI agent reading this:** build to the **contracts** in §4 and the **principles** in §1. A site is "done right" **only when all of**: (a) it satisfies the principles (§1); (b) it conforms to the content model (§3) — **every route is a `template` + slot content-data file; no page's content or layout lives in framework code**; (c) it produces the §4 contracts — a **generated `block-manifest.json`, `templates/`, and a root `site.json` descriptor (§4.6)**; (d) it emits the SEO/AEO/GEO outputs (§8); and (e) it **passes the editor-readiness gate (§4.4)**. A pixel-perfect site whose pages are hand-coded is **not done** — it fails (b), (c) and (e). Defaults (Astro, Vercel, Supabase) are recommendations; the architecture must remain portable per §1.2.
>
> **And note what a build cannot tell you.** Several requirements here — the enquiry pipeline (§7.1), the no-secrets-in-globals boundary (§3.8.1), the manifest's array descriptors (§4.2.2) — pass every compile, lint and typecheck while being completely broken. Where this document specifies a *check that runs*, run it; do not substitute a green build or your own reading of the code.

**Standard version 1.15** · last updated 2026-08-19. Each site records which version it was built to (e.g. in its repo README, and in `site.json` per §4.6) so conformance is checkable as the standard evolves. See the [changelog](#17-changelog).

---

## 1. Core principles (non-negotiable)

1. **Content is data, not markup.** Pages are structured data (typed blocks), never hand-authored HTML. This is what makes AI editing safe, validation possible, and design consistent.
2. **The repo is the site; the editor is removable (the Decoupling Rule).** The site must build and run with zero dependency on any editing tool. The editor depends on the site's open contracts — never the reverse. Any host, DB, or editor can be swapped.
3. **Tight & small.** Every page ships the *minimum* HTML + CSS + JS for its design. Default to zero client JS; opt into interactivity only where needed.
4. **AEO / GEO / SEO are native, not bolted on.** Structured data, semantic HTML, and machine-readability are produced automatically from the content model.
5. **Exact fidelity through tokens + components.** Design lives in versioned code (design tokens + components). Content carries no raw style. A design change happens in one place and propagates everywhere.
6. **Portable.** Hosting, database, media, and editor are independent, swappable services. Committing to a vendor today must not lock the site to it.

If a proposed change violates one of these, it is the wrong change.

---

## 2. Architecture at a glance

```
┌──────────────────────────────────────────────────────────────────┐
│  EDITOR (e.g. Pulse) — AI-first editing UI                         │
│  composes templates · edits content · live preview · approve       │
└───────────────┬──────────────────────────────────────────────────┘
                │ writes open files (one-way dependency)
                ▼
┌──────────────────────────────────────────────────────────────────┐
│  GIT REPO = THE SITE (source of truth)                             │
│  /blocks (code) · /templates (data) · /content (data) · /renderer  │
└───────────────┬──────────────────────────────────────────────────┘
                │ on push → build
                ▼
┌──────────────────────────────────────────────────────────────────┐
│  BUILD — static-site generator + framework components               │
│  data-driven render → static HTML · JSON-LD · sitemap · llms.txt    │
└───────────────┬──────────────────────────────────────────────────┘
                │ deploy
                ▼
┌──────────────────────────────────────────────────────────────────┐
│  HOST (edge CDN) + serverless functions  ·  DB + storage (indep.)  │
└──────────────────────────────────────────────────────────────────┘
```

**One line:** the editor edits typed content → committed to git → the build renders static HTML → served from an edge CDN, with small serverless functions + an independent database for the few dynamic features.

---

## 3. The content model — the linchpin

Pages do not freely compose layout. The model is **three tiers**:

```
Blocks (materials, code)  →  Templates (page designs, data)  →  Pages (instances, data)
```

| Tier | What it is | Owned by |
|---|---|---|
| **Blocks** | Reusable section components (`Hero`, `FeatureGrid`, `FAQ`, `CTA`, …) | Developers (code) |
| **Templates** | A *fixed* arrangement of blocks with **named content slots** | Composed in the editor, saved as data |
| **Pages** | A template choice + the content that fills its slots | Editors + AI |

A page declares **which template** it uses and **fills that template's slots** — it cannot invent layout:

```jsonc
// content/pages/<slug>.json
{
  "template": "service-page",
  "slug": "example",
  "seo": { "title": "…", "description": "…" },
  "content": {
    "hero":    { "eyebrow": "…", "headline": "…", "body": "…", "ctas": [ … ] },
    "features":[ { "title": "…", "body": "…" }, … ],
    "faq":     { "source": { "category": "example" } },
    "cta":     { "heading": "…", "cta": { "label": "…", "action": "booking" } }
  }
}
```

### 3.1 Prop type system

Every block prop is one of two kinds.

**Content props** (the data — freely editable):

| Type | Meaning |
|---|---|
| `string` | Plain text |
| `richline` | One line, inline marks only (bold, italic, link) |
| `richtext` | Multi-paragraph prose, stored as **Markdown** (§3.1.1) — paragraphs, lists, links, bold/italic. **No images** (images travel through `image` props and the media pipeline, never inside prose) |
| `number` / `boolean` / `url` | Scalars |
| `image` | `{ src, alt, width, height }` — `src` is a **repo path** under the site's media directory (media is committed content, not an external store), `alt` is required, and `width`/`height` are the file's real intrinsic dimensions, recorded when the image is chosen, never typed. The block renders through the host's image optimization (§3.4); a hotlinked external `src` is a conformance failure |
| `media` | `{ kind: image \| video \| lottie \| none, … }` |
| `cta` | `{ label, action, href?, target? }` |
| `array<T>` | Ordered, repeatable list |
| `object{…}` | Fixed-shape group |
| `ref<collection>` | Pointer to a content collection item (e.g. `team-member`, `faq-category`) |

**Variant props** (presentational — constrained): **`enum` only**, each `{ options, default }`. The editor picks from a menu; it cannot type a raw value. There is deliberately **no "raw style" prop type**.

#### Closed sets that are lists (added in 1.10)

`enum` covers one value from a set. A **list** drawn from a set — "which surfaces does this record appear on", "which categories apply" — is an `array` whose **item descriptor carries `options`**. Same idea, one level down; an editor renders it as a set of choices rather than a free-text repeater.

**`options` on a list is advisory, not a constraint.** A value outside the list stays valid, is preserved on save, and simply renders nowhere until whatever it names exists. This is deliberate, and the reason is a real one: a site staged four download cards against surfaces (`fees`, `nutrition`, `centre`) for pages that were designed but not yet built. A closed `enum` would have failed the build on content whose only fault was being ready early — so the author would have deleted the notes and tried to remember them later, which is exactly the "editable nowhere" failure this standard exists to prevent, wearing a different hat.

The trade is stated rather than hidden: a typo is accepted where an `enum` would refuse it. The editor must therefore **show an unlisted value as present-but-inert** — never silently drop it, and never quietly accept it as though it worked. If a site genuinely needs the value refused, that field is an `enum` and its content must be correct before it ships.

**Fill the list from the site, not by hand.** A hardcoded vocabulary rots the day someone adds a template. The generator resolves it — e.g. from the directory `site.json` already names in `paths.templates` — so the manifest and the site cannot disagree.

**Declare only what you render.** A prop typed `richline` or `richtext` whose block interpolates it as plain text (`{value}`) is a contract lie: the editor offers formatting, the author uses it, and the site publishes literal asterisks. One site shipped 13 `richline` headings rendered as plain text. If the block doesn't render marks, the prop is a `string` — and the §4.4 gate checks the claim, because the manifest and the component are two files that drift.

#### 3.1.1 `richtext` — Markdown, one grammar, one renderer

`richtext` is stored as **Markdown** and rendered by a module the site owns (conventionally `src/lib/markdown.ts`). The rules exist because the content is authored in an editor, hand-edited, and AI-written — treat it as **untrusted**, and because an editor preview and a site renderer that disagree make the preview lie.

- **The grammar is a fixed allowlist**, not "Markdown": paragraphs (blank-line separated), `-` bullet and ordered lists, `**bold**`, `*italic*`, `[text](href)`, backslash escapes, entities, hard breaks. **Everything else is off** — raw HTML (parsed as literal text and emitted escaped, never sanitised downstream), headings, code, blockquotes, tables, images, autolinks. Build it from a zero preset *enabling* the list above; a denylist silently regains constructs as the parser library grows.
- **No images in prose.** `![](…)` must not emit an `<img>` — a prose image bypasses the entire image pipeline (no dimensions, no srcset, no enforced alt). Images are `image` props.
- **Link schemes are an allowlist**: `https:`/`http:`/`mailto:`/`tel:`, site-relative `/…`, in-page `#…`. Protocol-relative `//host` is rejected explicitly — it is off-site wearing a local-looking href. A rejected href renders as inert text, not a link.
- **The renderer never rewrites the author's text**: `typographer` and `linkify` off. What round-trips through the editor must come back byte-identical.
- **The editor previews through the same grammar.** If the two deviate, the preview lies about what will publish. "Change them together" is a sentence that is read, not a check that runs — so the site and the editor must **share a committed fixture corpus**: a file of input→expected-HTML cases that the site's `test-markdown` and the editor's preview tests both execute. Without it nothing catches drift, and both sides stay green while disagreeing.
- **Pin the behaviour with a check that runs** (a `test-markdown` script): raw HTML escapes, image syntax emits no `<img>`, bad schemes render inert, and the constructs the grammar grants render. CommonMark has sharp edges the author will hit (`**20%**off` refuses to close and publishes literal asterisks) — the honest response is a preview that shows exactly that, which the textarea-plus-preview editing model provides and a WYSIWYG cannot.

### 3.2 Separating content, layout & style

The rule that makes AI/non-technical editing safe — three layers, three owners:

| Layer | What it is | Lives in | Who edits |
|---|---|---|---|
| **Content** | Words, images, links — *information only* | Block JSON `props` | Editors + AI |
| **Layout** | How content is arranged (columns, responsive behaviour) | The component + template | Developers |
| **Style** | Colours, type scale, spacing, radii | Design tokens (CSS vars) + component CSS | Developers (once) |

**Content carries data only — never a hex code, font size, or pixel value.**

```jsonc
// CONTENT — just the words
{ "type": "RichText", "props": { "body": "…" } }
```
```css
/* STYLE — defined once in the component, applied everywhere */
.richtext p { font-size: var(--text-body); color: var(--color-body); max-width: var(--maxw-prose); }
```

When an editor needs a presentational choice, it's a **constrained variant** (`theme: light | dark`, `columns: 2 | 3`), mapped to tokens by the component. The schema rejects anything outside the options.

**Design tokens** are a single file of CSS custom properties — the only place visual design is defined:

```css
:root {
  --color-accent: …; --color-ink: …; --color-body: …; --color-surface: …;
  --font-heading: …; --font-body: …; --text-body: …;
  --gutter: …; --maxw: …; --maxw-prose: …;
  --radius-pill: …; --radius-card: …;
}
```

### 3.3 Templates

A small, fixed set of page designs (typically ~6–12). Each = ordered **slots** (`block`, `required`/`optional`/`repeatable`) + the structured data it emits.

```jsonc
// templates/service-page.json — composed in the editor, saved as data
{
  "name": "service-page",
  "schema": ["Service", "FAQPage"],
  "slots": [
    { "name": "hero",     "block": "Hero" },
    { "name": "intro",    "block": "RichText" },
    { "name": "features", "block": "FeatureGrid", "repeatable": true },
    { "name": "faq",      "block": "FAQ", "optional": true },
    { "name": "cta",      "block": "CTA" }
  ]
}
```

### 3.4 Compile-time → "tight and small"

Because every page conforms to a *known* template, the build knows exactly what each page needs and ships nothing more:

- **Per-template CSS** — only the styles for that template's blocks.
- **Per-template JS** — only the interactive islands that template declares (most ship ~0 JS).
- **No dead components** — a page can't reference a block its template doesn't declare → total tree-shaking.
- **Media optimised at build** — responsive `srcset`, modern formats, lazy-loaded below the fold.

Result: each page is the minimum HTML + CSS + (rarely) JS for its design.

#### 3.4.1 Media lives in the repo — which means the repo has a weight budget

Media is committed content (§3.1): an image and the page referencing it arrive in the same commit, review together, deploy together and revert together. That is the right trade for photographs, and it has a cost the earlier drafts never stated — **git keeps every version of every binary forever.** A 5 MB hero replaced monthly is 60 MB a year that no `git gc` will reclaim, and the pain arrives late, as slow clones and rejected pushes, long after the decision that caused it.

So the budget is part of the contract, declared in `site.json`'s `media` block (§4.6):

- **Cap the single file** (`maxSourceBytes`, 1 MB is a sound default) and **the source width** (`maxSourceWidth`, ~2400px). Anything larger is a source file that should have been resized before it was content. An editor should offer to downscale rather than simply refuse — an author with a camera original and no image editor is otherwise stuck.
- **The host's image optimization does the rest** (§3.4): one committed source at a sensible size, many rendered sizes at request time. Committing multiple pre-sized copies of the same picture is the anti-pattern this replaces.
- **Video does not belong in the repo.** It defeats every cap above by an order of magnitude, and it is the one asset type a static host serves worse than a video service does. Reference it from a video host, or keep it out of git via the host's own asset pipeline. *(This is the concrete lesson: a 102 MB video committed to a site repo had its push rejected by the git host outright — twice.)*
- **Deleting a file does not reclaim its space.** Treat the caps as prevention, not something to clean up later; a repo that has already taken on weight needs history rewriting, which is a far worse day than declining the upload was.

### 3.5 Navigation & menus — derived, not hand-authored

Navigation follows the same **content-is-data** rule as pages: a menu is **derived deterministically** from structured data, never a hand-maintained list of links and never hand-written markup. This is what lets the menu stay correct as pages come and go, and lets the editor manage it through the normal typed-content contract.

**Two-part model — skeleton × membership:**

1. **Menu skeleton (globals).** The curated structure — the ordered groups, their labels, any **second-level sub-groups** (column headings for a mega-menu), any group that is a *direct link*, and any **static/external links** for content outside the build (e.g. a blog) — lives in the site **globals** (`content/globals.json` → `nav`). It is small, stable, and editor-curated. It defines *shape*, not *contents*.
2. **Membership (per-page, opt-in).** A page joins a menu **only** by declaring a typed `nav` entry in its own page data, naming its top-level `group` and (for a mega-menu) its second-level `subgroup`. No declaration ⇒ the page is in no menu. A page is **never auto-linked just by existing** — opt-in is the safe default, so legal pages, profile pages, and campaign landers stay off-menu by doing nothing.

```jsonc
// content/pages/<slug>.json — the page opts itself into a menu
{
  "template": "service-page",
  "slug": "seo",
  "status": "published",                       // or "draft" (see switches below)
  "nav": { "group": "disciplines", "subgroup": "seo", "label": "SEO", "order": 10 },
  "seo": { … }, "content": { … }
}
```

**Two levels (flat dropdowns and mega-menus).** A group is flat by default — its leaves render as one list. A group that declares ordered **sub-groups** becomes a mega-menu: leaves are placed into the sub-group their page names, under that sub-group's heading, in skeleton order. A leaf with no `subgroup` (in a group that has them) renders in an unheaded leading column. Sub-groups follow the same rules as groups: a sub-group with no leaves is omitted, and the sort within it is the uniform `order`-then-label rule.

**Content outside the build.** Some menu entries point at pages this build doesn't own (an external blog, a third-party app). These are declared as **static links in the skeleton**, not derived from pages — they have a fixed `href`, open external where appropriate, and are merged ahead of any page-derived leaves. This keeps the menu faithful to the source even when whole sections live elsewhere.

**Href.** A leaf's link is derived from the page's `slug` by default. A `nav` entry may carry an explicit `href` to override it — for a page whose route differs from its slug (e.g. a nested route with a flat slug) or one that should link to a specific anchor.

**Uniform sort order (the rule that makes every menu consistent):**
- **Groups** render in the order the skeleton defines them.
- **Within a group**, members sort by an explicit numeric **`order`** (sparse values — 10, 20, 30 — so items can be inserted without renumbering), then by `label` as a stable tiebreak.
- **Empty groups** (no members and no direct `href`) are omitted automatically.
- The sort is a **pure function of the data** — same globals + pages ⇒ identical menu — so the editor's live preview matches the build byte-for-byte (§4.3).

**Two orthogonal visibility switches:**

| Switch | Field | Controls | Off-state behaviour |
|---|---|---|---|
| **Opt-in** | `nav` present? | Menu membership | No `nav` ⇒ not in any menu (still a normal, reachable page) |
| **Draft** | `status: "draft"` | Publication | Excluded from the build (route 404s in production, viewable in dev) **and** never in any menu, even with a `nav` block |

The switches are independent: *published-but-unlinked* and *draft-and-hidden* are both first-class states. A work-in-progress or parked page therefore never leaks into the menu — membership is added only once a page is finished.

**What this shape asks of an editor** — requirements on *any* editor, not a description of one:
- `nav` is a **typed field** the editor edits through the same validated-schema path as any content (§3.1, §11) — *never* by editing markup. `group` and `subgroup` are enums sourced from the skeleton, so an author cannot file a page under a group that does not exist.
- The **skeleton** is editable globals: reordering, renaming or adding a top-level group is a globals edit through a constrained UI, not a code change.
- The editor's mental model is **"this page belongs in this menu,"** set on the page itself. There is no separate, hand-synced link list to fall out of date; the menu self-assembles from the pages.
- Because the menu is a **pure builder** over (globals + pages), the preview build renders the live menu exactly — including a just-toggled `draft` or a reordered group.

> ⚠️ **Unimplemented as of 1.8.** This section is the most specified in the document and the least built. On both live sites the header is a hand-typed leaf list in globals; one site has sixteen pages declaring `nav` entries that **nothing reads** — editing them changes nothing — and one has a footer link list hardcoded in a layout that has already drifted from globals. No site has a `buildNav`. Treat §3.5 as a design to implement, not a description of what exists, and do not cite it as precedent until a site actually derives its menu.

**Build / render & SEO:**
- A pure `buildNav(globals, pages)` returns the ordered tree; the header/footer components render it. It lives in the **renderer package** (§4.2) so build and editor agree.
- Navigation contributes `SiteNavigationElement` / `BreadcrumbList` where appropriate (§8), and **nav labels are not headings** (§8) — the derived menu must preserve the clean heading outline.

### 3.6 Collections — repeated content

Some content is **many of the same thing**: case studies, blog posts, team members, services, testimonials, FAQ answers, download cards. These are a **collection**, not a pile of one-off pages.

**There are two kinds, and the difference is whether the item has a page of its own.**

| Kind | An item is | Declares (§4.6) | Typical |
|---|---|---|---|
| **Routable** | a page that happens to be one of many | `template` **and** `route` | case studies at `/past-work/:slug`, team members, locations |
| **Data-feed** | a typed record that is only ever aggregated into someone else's slot | `itemSchema` | FAQ answers, testimonials, download cards |

- A collection lives in its own directory of item files: `/content/collections/<name>/*.json`.
- **A routable item is `template` + slot content**, exactly like a page (§3.3). It is *not* a special format — it is a page that happens to be one of many, which is what lets the same editor, the same manifest and the same render path handle it.
- **A data-feed item is a flat typed record**, declared by an `itemSchema` (§4.2.1, same schema-first machinery as a block) and emitted into the manifest under `collections` so an editor can build a form for it. It has no template and no route, because it has no page.
- **Listings are derived, never hand-authored.** A "related items" row or an index page is computed from the collection itself; it is not a template slot the editor has to keep in sync.

> **Why the second kind exists** (added in 1.10). Until 1.9 this section said flatly that *every* item is `template` + slot content — while §3.3's own worked example sourced FAQ content into a slot with `"faq": { "source": { "category": "example" } }`, which is the data-feed pattern under another name. The document required one thing and demonstrated another.
>
> The cost of that landed on a real site with four collections. Three of them — FAQ answers, testimonials, download cards — are aggregated into `FaqAccordion`, `TestimonialTrio` and `ResourcesGrid` on pages that already exist. They will never have a route. Forced to name a template, the build had exactly three options, and all three were bad: name a template that does not exist (which is what shipped, and which an editor reading the descriptor verbatim cannot act on); invent a per-item block and template so a PDF download link can pretend to be a page; or declare nothing, and have every item be editable nowhere. The fourth collection — the three centres — *is* routable and genuinely was waiting on a page design, which is the case the routable kind already covered.
>
> **The rule the two kinds share is the one that matters:** every item, of either kind, is described by a schema that reaches the manifest. What changes is whether that description is a template of slots or an item schema. Nothing is allowed to be editable nowhere.

> ⚠️ **Never name a template an item does not have.** A `template` key pointing at a file that is not in `paths.templates` is worse than no key: a tool reads the descriptor verbatim (§4.6) and offers to author an item it cannot render. If the page type is designed but not built, the collection is data-feed until it is built, and gains `template` + `route` on the day the template lands. The generator must fail on the mismatch (§4.4.1) so the two cannot drift.

> ⚠️ **Items are JSON, not MDX** (changed in 1.5). MDX is for genuine long-form prose bodies and nothing else. A site shipped its case studies as `.mdx` files with **empty bodies** and every field in YAML frontmatter: uneditable through the block editor, and YAML silently parsed a comma-containing paragraph into a list, publishing sentence fragments on a live page. If an item's content is structured — headings, stats, quotes, images — it is slots, and slots are JSON.

### 3.7 Redirects — content, not a one-off

Renaming a page breaks every existing link to it, so the redirect that repairs that is **part of the content model**, not a hosting detail someone remembers to add.

- Redirects live in `/content/redirects.json` as `old path → new path` with a status (301 permanent by default, 308 where the method must be preserved).
- The build **emits them as host redirects** (Astro config / host redirect rules), so they work at the edge without a request reaching the app. **Emitting a rule is not the same as matching a request** — see §3.7.1, because the form you write and the form the framework compiles are not always the same URL.
- The editor writes this file, which means a slug rename can *offer* to create the redirect at the moment the rename happens — the only moment anyone has the old path to hand.
- **If a site has no redirects file, slug renames must be blocked** (§4.6). Silently breaking inbound links is worse than refusing the rename.

> ⚠️ **A redirects file that nothing reads is the default state, not an edge case.** On one site the file existed, `site.json` declared it, the editor wrote to it — and `astro.config.mjs` never imported it. Every rule was inert: added, saved, merged, ignored. Nobody could tell from the repo, because *every artifact was present*. **Wiring is a gate item (§4.4), and the check is a real redirect on a real deployment** — see §3.7.2.

#### 3.7.1 The rules live in the checks package, not here

**Every rule a redirect list must obey — and the failure each was written after — is in [`@traction/site-checks`](https://github.com/traction-marketing-nz/traction-website-standard-checks), in [RULES.md](https://github.com/traction-marketing-nz/traction-website-standard-checks/blob/main/RULES.md).** This document does not restate them, and a site does not re-derive them: it installs the package and passes it (§11.0).

That is a deliberate reversal. This section used to carry the rules in a table, and within a single day it said "two rules" above a list of four, disagreed with the package's own list, and left two rules implemented nowhere but in two hand-written per-site copies. A rule kept in two places drifts, and the copy nobody runs is the one that rots — so the rules live where they execute, and the reasons live beside them.

What stays here is what a checker cannot hold: redirects are **content** (§3.7), not a hosting detail, and the site must be able to add one at the moment a slug is renamed.

#### 3.7.2 Prove one redirect on a real deployment

The package reads the build. That a host honours the table it was given is a separate claim, and the only way to settle it is to request the old path on the deployed site and read the status — a **301 to the new path**, not a green build and not a reading of the config.

Note that preview URLs often sit behind the host's access protection, which 302s anonymous requests to a login page; an automated check sees *that*, not your redirect. Test through an authenticated session, or on production straight after the deploy.

### 3.7.3 The 404 page — a content page, and a host route to serve it

Every site ships a **branded 404**, and it is built the same way as everything else: an ordinary content page (`content/pages/404.json` + a small template), so its copy is editable in the CMS by whoever notices it reads badly. A hand-coded error page is the same conformance failure as a hand-coded home page (§4.4).

**Two halves, and the second is the one everyone misses:**

1. **The page.** The generator emits it as top-level `404.html` from the `/404` route.
2. **The host route that serves it.** Vercel's Build Output API v3 does **not** serve a static `404.html` automatically, and the Astro adapter emits no error route. So the branded page ships inside every deployment with *nothing pointing at it*, and unknown URLs get the platform's bare `404: NOT_FOUND` card. Append the error phase explicitly:

```jsonc
// .vercel/output/config.json — appended in an astro:build:done hook
{ "handle": "error" },
{ "src": "/.*", "status": 404, "dest": "/404.html" }
```

The `error` phase runs only after filesystem and every earlier route has failed to match, so it cannot shadow a real page.

> **Both live sites had this wrong simultaneously.** Both served the platform 404 in production. Neither build failed, nothing in either repo looked missing, and the branded page was present in the deployment the whole time.

**Keep the status 404.** The tempting "catch-all redirect to the homepage" is a **soft 404**: search engines read the 200 as "this URL exists", keep dead URLs in the index, and can suppress the target page too. Unknown URLs should say they are unknown; URLs that genuinely *moved* get a real 301 in `redirects.json` (§3.7).

**Verify on a deployment** (§3.7.2), not from the build output — request a path that cannot exist and read the page you actually get.

### 3.8 Globals — site-wide singletons (never duplicate them into a page)

Some values are **the same on every page**: the site name, contact details (phone, email, address), social profiles (`sameAs`), the brand logo, the legal entity, the default OG image, the default locale — plus the nav/footer skeleton (§3.5) and redirects (§3.7). These live **once** in the site globals (`content/globals.json`), never in any page.

**The rule:** a value that is identical site-wide lives in globals **once**; blocks and templates **read it from globals**; it is **never copied into a page's content.** A global is **not** a block content-prop — it does not appear in `content/pages/*.json` or in a page's editing surface; it is edited in the **globals editor**.

> ⚠️ **The duplication trap (a real, observed bug).** If a site-wide value is *also* stored as a block prop in page content, the **page copy silently wins** — editing the global has no effect, because the block renders its page-content copy. The contact phone in a CTA block is the textbook case: keep it in `globals.contact`, have the CTA read it from there; do **not** give the CTA a `phone` content-prop. Symptom reported by editors: *"I changed the global and nothing updated."* The fix is always the same — delete the page-content copy and the block's prop, and read from globals.

**The test:** *if changing it should change it everywhere, it's a global; if it legitimately varies per page, it's content.* A page may still **override** a global where that is genuinely intended (e.g. a campaign lander with a dedicated number) — but that is an **explicit, documented** per-page field, not an accidental duplicate.

**How blocks consume globals.** The renderer makes globals available to every block (passed in, or imported from the globals module); the build and the editor preview read the **same** globals, so a globals edit propagates everywhere identically — the same property that makes the derived menu consistent (§3.5). **Derived values** (e.g. a `tel:` href computed from the displayed number, or an absolute logo URL for JSON-LD computed from a relative asset path) are computed **in code from the single global field**, so the editor has exactly **one** field to edit and nothing can fall out of sync.

**Auditing for stragglers.** Any literal in component code that is really a site-wide value — the site name in the header/footer, a hardcoded phone, an `og:site_name` string — is a latent version of this bug. When adding globals to an existing build, grep the components for such literals and repoint them at globals.

#### 3.8.1 Globals are public — never put a secret in them

Globals feel like configuration, and configuration is where people put API keys. **They must not.** `globals.json` is committed to the repo, editable by anyone with content access — and, decisively, **it reaches the browser**: the moment one hydrated island imports the globals module, the bundler pulls the values it references into that island's client chunk. There is no warning; the file simply appears, in part, on the public internet.

> **Verified, not assumed.** On a live site the studio's phone number — a legitimate global — was found in a client bundle at `_astro/Hero.<hash>.js`. That is correct and harmless for a phone number. It is catastrophic for a key.

The line is **who the value is for**, not how it feels to edit:

| Kind of value | Example | Lives in | Why |
|---|---|---|---|
| Editable, public | notify address, sender address, phone, address, social URLs | `globals.json` | The client should change these without a deploy; they're published anyway |
| Editable, private | *(none — this cell is deliberately empty)* | — | If it must stay secret it isn't editable content |
| Secret | API keys, tokens, webhook signing secrets, DB URLs | Host environment variables | Never committed, never bundled, rotated without a content edit |

So a form pipeline splits: **recipient and sender in globals** (the client changes who gets enquiries themselves), **the API key in the environment** — always. Put a one-line comment saying so at the point of use, because the next person will be tempted to "tidy" the last env var into globals for consistency.

**A second trap in the same area: build-time inlining.** A bundler replaces `import.meta.env.SOME_KEY` with its **build-time value**, which turns an apparently-runtime lookup into a string literal in the artifact and makes any `process.env` fallback dead code. Gate dev-only reads behind a statically-false condition (`import.meta.env.DEV`) so the branch is eliminated in production builds.

**The check (run it once per site, before launch):** build the site, then grep the built output — client *and* server — for each secret's value. Nothing should match.

```bash
npm run build && grep -rl "$SECRET_VALUE" dist/ .vercel/ && echo "LEAKED" || echo "clean"
```

Run the same grep for any value you *moved* into globals, to confirm you understood which side of the line it landed on.

---

## 4. The build stack & the contracts

### 4.1 Recommended stack
- **Static-site generator with an islands model** (default: **Astro**) for the build/orchestration layer. Ships ~zero JS by default; opt into interactivity per island; per-island code-splitting; first-class adapters for serverless hosts; full control of `<head>` for SEO/AEO.
- **Blocks authored as standard framework components** (React or Preact) — **not** generator-proprietary templates. This is essential: the same components must be importable by the editor for live preview (§5). Author in the framework your editor uses; alias to a smaller runtime (e.g. `react → preact/compat`) at build time to keep hydrated islands tiny.
- **Styling:** design tokens (CSS custom properties) + per-component CSS. No utility-framework lock-in required; no inline styles in content.

> Rejected alternatives and why: app frameworks that ship a client runtime by default (heavier — hurts "tight & small"); template-language generators whose components can't be imported by a JS editor (breaks the shared-renderer/live-preview contract).

### 4.2 The three contracts (what everything negotiates through)
1. **Block manifest** — a machine-readable description of every block (its slots, content props, variant enums). **Schema-first:** each block declares **one** typed schema (a Zod / Standard-Schema object) as its single source of truth; the manifest entry, the component's TS prop types (via inference), and runtime validation (§11) are all *derived* from that one declaration — never hand-kept in parallel. That is what makes "can't drift" literal: one definition, generated three ways. The editor reads the manifest to know the vocabulary.
2. **File format** — open JSON for templates, pages and collection items (and a globals file for header/footer/nav/site details); MDX only for genuine long-form prose (§3.6). Navigation is **derived, not a hand-kept link list** (§3.5): a curated menu skeleton in globals × per-page opt-in `nav` entries.
3. **Renderer package** — a `renderPage(template, content)` function (block registry + components). **Optional, not required** — see §5: preview is the site's own branch build.

#### 4.2.1 Schema-first generation

The manifest is **generated by a script**, never edited by hand. One schema per block; the generator walks the schemas and emits `block-manifest.json`. Hand-editing it guarantees drift, and drift here is silent — the editor believes the manifest, the build believes the code.

Because the manifest is produced by a script, the script must fail loudly when it produces nothing useful — see §4.4.1, which exists because a generator lied for months.

#### 4.2.2 Manifest field rules — it is read by a machine that has never seen your code

The manifest is consumed by a tool that has **only** the manifest. Anything it has to infer, it will infer wrongly on some site, and the failure is silent — a form field that doesn't appear, or one that appears and destroys data. Four rules, each from an observed bug:

1. **State optionality explicitly, one way.** Emit `required: true|false` on **every** prop. Do not encode it as absence, and do not mix dialects. Two sister sites expressed the same fact three ways — `optional: true`, `required: false`, and "has a `default`" — and a reader that understood only the first marked every optional prop on the second site as required, so the editor refused to save a page for a legitimately empty field. A reader must still normalise defensively (`optional === true || required === false || "default" in spec`), but the generator should never make it guess.
2. **Every array declares a *complete* `of` — its item descriptor, recursively.** Without one the editor cannot know whether an entry is a string or an object, and the sensible-looking fallback (`{type: "string"}`) is the dangerous one: **objects render as a single empty textarea, and the first keystroke overwrites the whole entry.** One site's lists were each one edit away from silent data loss for exactly this reason.
   **`of: {type: "object"}` with no `props` does not satisfy this** — it is the same failure wearing a descriptor. An object item must name its own fields, or the editor still cannot build a form for an entry. Check for the *usable* descriptor, not the presence of the key: 26 arrays on one site passed a naive "has `of`" test while remaining read-only in the editor. An item descriptor must also carry a `type` the editor actually renders — a missing or misspelled type is as uneditable as a missing descriptor — and a nested array must be validated the same way, recursively. If the generator cannot determine an item's fields, it must fail (§4.4.1), not emit an empty shell.
3. **Bounds must be real.** `min`/`max` (§4.5.2) come from what the block's layout genuinely requires, never from what the seed content happens to contain. An invented `max: 10` on a prose array — no such limit existed in the block — blocked a legitimate 12-paragraph case study from saving at all. State a `max` only for a genuinely fixed layout (a 4-tile grid: `min: 4, max: 4`); otherwise state `min` alone.
4. **Every prop carries a human label** (§4.5.4), including nested object props and array-item props — the walk must recurse through `props` and `of.props`, or nested fields silently show raw keys.
5. **Defaults must survive generation.** A `.default()` in the schema means the editor should pre-fill that value. Verify the generator actually emits them — on one site **0 of 268 props** carried a default against ~80 `.default()` calls, because the unwrapping logic treated a defaulted field as merely optional and discarded the wrapper. The symptom was an editor placing a fresh block and getting an unselected theme and an empty dropdown.

> **Corollary for the editor:** when a save is blocked, the UI must **say which field and why**. A greyed-out button is unactionable, and it hides bugs in the manifest itself — the invented-`max` bug above was invisible until the blocking reason was displayed, at which point it was obvious in seconds.

### 4.3 The data-driven render path
The build composes a page by mapping each template slot to a block type and resolving it via the registry:

```
blocks = template.slots.map(slot => ({ type: slot.block, props: content[slot.name] }))
renderPage → registry[block.type] → component → static HTML
```

**Verify per project:** that this dynamic registry render still tree-shakes to minimal per-page bundles (it does with Astro's per-island splitting — a page only ships JS for islands it actually renders — but confirm it in a spike before scaling).

### 4.4 Editor-readiness gate (the contracts are a *gate*, not aspiration)

Design fidelity is gated (§13/§14); **editor-readiness must be gated too**, or a faithful but hand-coded site passes every other check while being un-editable. This was a real failure mode: a site can render the design perfectly as framework pages, pass the fidelity gate, emit all the SEO — and still not be editable, because the §3 content model and the §4 contracts were treated as optional. They are not. A build is editor-ready only when **all** of these hold:

- **Block manifest exists and validates** — `block-manifest.json` is *generated* from the block schemas (§4.2.1) and lists every block a template can use.
- **The generator fails loudly when it produces nothing useful (§4.4.1)** — it exits non-zero, and does not overwrite the manifest, if it described zero blocks, skipped a block file, left a block a template can place undescribed, or left a prop without a label. A generator that quietly emits nothing is indistinguishable from one that works.
- **Every route is content-data** — each page is a `template` + slot `content` file under `/content/pages` (or a routable collection item, §3.6). **No route renders content or layout baked into framework code.** Grep test: a page file holds almost no copy — the copy lives in `/content`. If you ported a hand-coded page and "it looks right," that is *not* enough; it must be decomposed into blocks + content-data.
- **Every collection item is described by something** (§3.6) — a `template` of slots if the item is routable, an `itemSchema` if it is a data feed, and that description reaches the manifest. "Editable nowhere" is the failure; which of the two kinds describes it is a property of the content, not a loophole.
- **Templates are data** — every page references a template in `/templates`; the template set is finite and declared.
- **One render path** — a single data-driven render (§4.3) turns a page into HTML. Preview is the site's own branch build of the change (§5); a renderer package shared with the editor is optional, not required.
- **The site describes itself (§4.6)** — `site.json` exists, records `standardVersion`, and names every path and collection a tool needs. No tool should have to infer the layout.
- **The loop is proven** — edit content → commit → build → live, demonstrated on at least one real page; and the editor's own readiness check (e.g. Pulse's) reports green.
- **`traction-site check` runs in the build and passes** (§11.0) — the gate items below are enforced by it, not by reading this list. A site that has not installed it has not been checked, however green its build.
- **Redirects are WIRED and proven** (§3.7, §3.7.2) — the build reads `redirects.json`, `traction-site check` passes, and one real rule 301s correctly on a deployment. A declared-but-unread file is the default failure; a rule that matches only the un-slashed form is the second.
- **The 404 is branded, editable, and actually served** (§3.7.3) — a content page, plus the host error route, verified by requesting a path that cannot exist.
- **Rich props render as declared** (§3.1, §3.1.1) — every `richtext` prop renders through the site's allowlist Markdown module and its pinned `test-markdown` checks pass; no prop is typed `richline`/`richtext` while its block interpolates plain text. The manifest and the component are two files; the gate is what stops them lying about each other.
- **The per-page `seo` object is consumed** (§8.1) — the base layout reads every declared key, and one page proves it: set a title/description, build, see them in the emitted `<head>`.
- **Author-complete (§4.5)** — the editor can *add* a page (a generic page route exists), every block survives any schema-valid content (cleared optionals, array min/max), and the manifest carries editor affordances (labels, help, defaults).

Run this gate **per template**, *alongside* the fidelity gate (§13/§14): a template is "done" only when it is both pixel-faithful **and** editor-ready. A pixel-perfect hand-coded template is a **failed** template.

#### 4.4.1 The generator must not fail silently

The contracts are produced by scripts, and **a script that produces nothing looks exactly like a script that works**: it prints, it exits 0, it writes a file. Specification does not protect against this — the site had a generator precisely *because* the standard demanded one.

> **Observed failure.** A site's manifest generator filtered `extname(f) === '.ts'` while every block was a `.tsx` file, so the loop matched **nothing**. It exited 0 on every run. The stale, hand-edited manifest it left behind was accepted as generated output for months, describing 14 of the 29 blocks its templates actually used — and every page built from the other 15 was uneditable, with good schemas sitting unread in the repo.
>
> Nobody was careless. The script lied, and no check called it.

The generator therefore asserts its own output before writing, and exits non-zero on any of:

| Check | What it catches |
|---|---|
| Zero blocks described | The scan matched nothing — wrong directory, wrong extension, wrong glob |
| Any block file skipped | A load/parse failure downgraded to a warning nobody reads |
| A template slot's block undescribed | The editor cannot build a form, so that page is uneditable |
| A template slot's block **not in the block registry** | Both render paths do `Block ? <Block/> : null`, so a typo in a slot name **drops an entire section from a live page** with a green build and a green typecheck. The manifest check cannot catch this: the manifest and the registry are two separate lists |
| A file in `/templates` **not in the template registry** | The same failure one level up, and worse: the route looks the name up, gets `undefined`, and renders a page with header and footer and **nothing in between**. Observed shipping a live 404 page that was completely blank — right title, right chrome, no content, green build. If the site keeps a hand-maintained registry (`templates.ts`), adding a template file without registering it must fail here rather than at a customer |
| Any array prop whose `of` is missing **or unusable** | An object item with no `props`, a missing or unknown `type`, or an unvalidated nested array: the editor cannot build a form for an entry, so it either guesses and destroys data on the first edit or shows the list read-only (§4.2.2). Assert the descriptor is *usable*, not merely present |
| Any prop without a `label`, **including an array's item descriptor** | The author sees the raw key (§4.5.4). The item descriptor is the row header of a repeater, and "it inherits from the array" is a reasoning a generator can hold and no downstream reader can — one site skipped exactly that case and shipped nine unlabelled repeaters |
| A collection declaring **neither** `template` nor `itemSchema`, or declaring one that does not resolve | Undescribed items are editable nowhere (§3.6, §4.6); a dangling reference offers the author content that cannot be rendered or validated |

Keep the failure message specific enough to act on — name the blocks or props, not just a count. And **never write the output file on failure**: overwriting a good manifest with an empty one turns a loud error into a silent regression.

**Exit non-zero on *any* failure, not just the deliberate checks.** `main().catch(console.error)` prints the error and exits 0, so a malformed template JSON, a missing directory or a transpile fault all report success and `generate && next-step` sails on. That is the same failure this section exists to prevent, merely relocated to the paths that throw.

**And test the checks themselves.** A check that cannot fail is worth nothing, and it is easy to write one — the array-descriptor check above passed `of: {}` and a misspelled `type` on its first implementation, the exact shapes it existed to catch. Mutate the input deliberately, confirm the generator exits non-zero and names the offending prop, and confirm it did **not** write the file.

> **The general rule this is an instance of:** the standard reliably produces what it can state *declaratively* — where content lives, what shape an item is, which prop types exist. It cannot, by itself, produce things that require the artifact to actually **work**, because someone can truthfully believe they have done it while it is false. Those need a check that runs, not a sentence that is read.

### 4.5 Authoring robustness — design for editing, not just building

The contracts *existing* (§4.4) is necessary but not sufficient: a site can pass every gate and still **break or confuse the moment a human edits it**. Editing is continuous and adversarial — assume the editor *will* clear a field, add a tenth item, reorder a list, create a brand-new page, and upload a 6 MB photo. A block or build that only works for the exact content the developer happened to seed is **not done**. Build to these (and check them in §4.4):

1. **The editor can *add* pages, not just edit them.** The build turns **any** `content/pages/*.json` into a route via a **generic page route** (a catch-all that loads the page data, resolves its template, and renders it) — not a hand-wired page module per file. If adding a page needs a developer to add a route, the site is *edit-only*, not author-complete.
2. **Array cardinality is declared and handled.** Every `array<T>` / `repeatable` slot declares `min`/`max` in the manifest, and the block renders correctly for **any** count in range. A block that assumes a fixed number of items (e.g. destructures "the 4 tiles") is a crash waiting for the editor to add a fifth. A genuinely fixed-layout block sets `min == max` so the editor enforces it — *and the block still guards against malformed data*. Declare only bounds that are real (§4.2.2 rule 3).
3. **Every block renders for any schema-valid content.** Cleared optional fields, empty arrays, missing images → a sensible empty state or omission, never a broken tag or a crash. The editor shows a placeholder for empties; the build ships nothing for them.
4. **The manifest carries editor affordances.** Each prop has a human **label**, optional **help text**, a **default**, a sensible **order/group**, and required/optional — so the editing UI is usable, not a wall of raw keys. These live alongside the type in the schema-first descriptor (§4.2.1).
5. **Prefer one field over per-breakpoint variants.** Responsive *layout* is the block's job (§3.2); responsive *content* (a shorter mobile headline) is an editor-UX tax — two fields to keep in sync. Use a single field by default; a `*Mobile` variant is an explicit, justified exception (e.g. a hero line that must wrap differently), not a habit.
6. **The media-upload loop is proven, not assumed.** Demonstrate editor upload → object storage → transform/CDN → rendered responsive image (§3.4, §6) on one real block before launch. Seeded stock URLs hide a broken upload path.

> **Mindset:** the developer seeds *example* content; the editor will replace, empty, multiply, and extend it. Build every block — and the routing — for the content that *will* exist, not the content that *happens to* exist today.

### 4.6 The site descriptor — the site says where its own contracts live

The three contracts (§4.2) tell a tool *what the vocabulary is*. They do not say **where anything lives**, and §9's canonical layout is the answer unless a real constraint forces otherwise (an Astro project that keeps its **pages and collections** under `src/content/` so the content-collections loader picks them up, for instance — see the per-path rule below). An editor that pattern-matches paths to find content is guessing, and a wrong guess is silent: it reports a collection with zero items rather than an error.

> **Observed failure.** One site's case studies sat at `src/content/case-studies/`; the editor looked for `content/collections/**`. It found the collection's *name* and none of its five items, and said so without complaint. Nobody noticed until the content was audited by hand.

So a conformant site ships a **`site.json` at the repo root** that names its own structure. It is a *site* contract, not editor configuration — the site describes itself; any tool may read it; the site still builds if every tool is deleted (§1.2).

```jsonc
// site.json — the site describes its own layout
{
  "standardVersion": "1.15",
  "name": "Example Site",
  "paths": {
    "blockManifest": "block-manifest.json",
    "templates": "templates",
    "pages": "content/pages",
    "globals": "content/globals.json",
    "redirects": "content/redirects.json",
    "media": "public/images",
    "tokens": "styles/tokens.css"
  },
  "media": {
    "storage": "repo",
    "transform": "host-image-optimization",
    "maxSourceBytes": 1048576,
    "maxSourceWidth": 2400
  },
  "collections": [
    {
      "name": "case-studies",
      "path": "content/collections/case-studies",
      "template": "case-study",
      "route": "/past-work/:slug"
    },
    {
      "name": "faqs",
      "path": "content/collections/faqs",
      "itemSchema": "faq"
    }
  ]
}
```

**That example is §9's canonical layout, and it is the one to copy.** A site deviates only where a real constraint forces it — an Astro project whose *pages and collections* must sit under `src/content/` for the content-collections loader to see them:

```jsonc
// site.json — a deviating site. Legal, because it is DECLARED.
"paths": {
  "pages": "src/content/pages",
  "globals": "src/content/globals.json",
  "redirects": "content/redirects.json",   // NOT moved — no loader reads it
  "tokens": "src/styles/tokens.css"
}
```

> ⚠️ **Deviate per path, not per directory, and only where the constraint actually bites.** The loader reason reaches pages and collections. It does **not** reach `redirects.json`, which no loader reads — the build config imports it directly — so §3.7's location stands and there is nothing to declare around.
>
> **Observed cost.** Four sites split two-and-two on that one file, because this example showed `src/content/redirects.json` while §3.7 (three sections earlier) said `/content/redirects.json`. §11.0's checks look in the canonical place, so on half the estate both redirect checks reported *"this site declares no redirects"* and passed — a green tick over a live rule that had made a real page unreachable. **A contradiction between a rule and its own worked example is not cosmetic: the example is what gets copied.**

**Rules:**
- **Every path is repo-relative and required if the feature exists.** Omit `redirects` only if the site genuinely has no redirects file — and note that omitting it means slug renames must be blocked (§3.7).
- **`paths.media` is required, and is the ONLY directory an editor may write binaries into.** Undeclared, an editor has to guess — and the guess is also what bounds its path-safety check, so an undeclared media directory silently widens the editor's write scope on a site whose media lives somewhere else. Declare it even when it happens to match the conventional `public/images`.
- **The `media` block declares how images are handled**, not where they live: `storage` (`repo` — media is committed content, §3.1), `transform` (the host's image optimization, §3.4), `maxSourceBytes` and `maxSourceWidth` (what an editor may upload, and what it should offer to downscale to). An editor reads these to state the limits *before* a byte is sent, rather than returning an opaque rejection afterwards.
- **Collections are declared explicitly**, each with its directory and — depending on its kind (§3.6) — either `template` **and** `route` (routable), or `itemSchema` (data-feed). A collection that isn't declared does not exist as far as any tool is concerned, and one that declares *neither* is undescribed content: its items are editable nowhere, so the generator fails (§4.4.1).
- **A declared `template` must exist in `paths.templates`, and a declared `itemSchema` must be exported by the site's schema module.** Both are read verbatim by tools that cannot check them against anything else, so a dangling reference is silent — it produces an offer to author content that cannot be rendered or cannot be validated.
- **`standardVersion` is recorded here**, not in prose in a README — so conformance is machine-checkable as the standard evolves.
- **The descriptor is the resolution order.** A tool reads `site.json` first and uses it verbatim; falling back to guessing paths is a compatibility shim for pre-1.5 sites, not the contract. **A tool that hardcodes a default instead of reading the descriptor is not conformant**, and the failure is silent — a path it cannot find is indistinguishable from a feature the site does not have. **A declared path that is missing on disk is an error; only an *undeclared* one is an absent feature.**
- **Deviation is per path, and needs a constraint rather than a preference.** Where no constraint applies, §9's layout is the answer. Two sites choosing differently for the same file is how an estate stops being checkable — and the divergence is invisible until something looks in the wrong place and says nothing.

---

## 5. Editor integration (editor-agnostic; the editor is *removable*)

The architecture works with any editor; the reference editor is **Pulse**. The contract is one-directional: **the site never depends on the editor; the editor depends on the site's open contracts.**

- **Source of truth = git.** The editor owns the *editing experience* but **publishes content as versioned files to the git repo**. Versioning, rollback, and AI-diffable change review come for free. The live site is static and never depends on the editor being up.
- **The editor reads the block manifest** to know what it can compose, edits content against the typed schema, and **saves templates + content as open files**.
- **Preview = the site's own build of the change.** Saving opens a branch + PR, the host builds it, and that deployment *is* the preview. It is byte-accurate by construction — it is the real build of the real commit — and it needs no code shared between the site and the editor. This is the required mechanism.
- **A shared renderer package is optional.** Where the editor *can* import the site's blocks, `renderPage(template, content)` gives instant in-editor WYSIWYG and is a nice-to-have. It is **not** a conformance requirement: it obliges the editor to execute each client site's components, which does not generalise across sites with different block vocabularies, and a per-site render service is infrastructure most sites should not have to run. Editors that lack it show a **structural preview** derived from the manifest (block order, slot shape, cardinality) for instant feedback, and use the branch build for sign-off.

> **Why this changed (1.5).** The shared-renderer mandate was written for a world with one block library. In practice two sites had entirely disjoint vocabularies — `Hero/CaseLedger/StatBand` vs `Hero/ExpertiseList/ProjectGrid` — so there was nothing to share, and neither site ever shipped a render service. The branch build was already there, already accurate, and already free.

- **Sign-off preview** = staged changes open a PR → the host builds a **preview deployment** → human approves → merge → production build. Preview/branch builds **include `draft` pages** (via a build-mode flag, e.g. `INCLUDE_DRAFTS`) so unpublished work is reviewable on the preview URL; the **production** build excludes them (§3.5). Apart from drafts, preview output is byte-identical to production.
- **How the editor writes git:** a browser editor can't commit directly; it calls a small backend function holding a git-provider token (e.g. a GitHub App) that commits the files.

**The AI editing loop:**
```
1. User asks the editor: "Add an FAQ and tighten the hero subhead."
2. Editor AI loads the page's block data (typed, validated).
3. AI proposes block-level changes (append FAQ item, edit hero body).
4. Schema validates → visual diff + instant preview.
5. Human reviews, approves.
6. Editor commits to git → build → live.
```

**The line:** the editor composes *templates* freely from the block vocabulary; adding a new *block type* is a code change (developer adds a component + manifest entry → it appears in the editor). This preserves "tight & small" and exact fidelity while giving the editor real authoring power.

---

## 6. Infrastructure (defaults are portable)

| Layer | Default | Role |
|---|---|---|
| Static hosting + CDN | **Vercel** | Global edge HTML; automatic preview deployments per push/PR |
| Serverless / edge functions | **Vercel Functions** *or* the DB's edge functions | Forms, data capture, preview-mode render |
| Database | **Postgres** (independent — e.g. **Supabase** / Neon) | Runtime data: submissions, experiments, events |
| Storage | **Supabase Storage / object store** | Media; editor uploads here, referenced by URL |
| Cron | host cron / scheduled function | Scheduled jobs |
| Build/CI | **host, git-connected** | Build on push; preview per branch; promote on merge |

**Rules that keep it portable:**
- The **database is an independent managed service**, never a host-branded lock-in. Leaving the host moves a connection string, not the data.
- **One CDN.** Do not stack a second proxy/CDN in front of the host's edge (double-caching/SSL conflicts). Keep DNS in "DNS-only" mode if your DNS provider also offers a proxy.
- **The generator's host adapter is swappable** (a config change), because blocks are framework components + a portable renderer.
- **The repo is still the whole site.** The host is "where we deploy today," not "what the site is."

---

## 7. Dynamic features pattern

Anything stateful (after a page is served) follows one pattern: **a serverless function + a database table.**

| Feature | Pattern |
|---|---|
| **Forms / submissions** | Native form → function → DB table (+ any CRM API server-side) |
| **Lead/attribution capture** | Client captures attribution → posts to a function → DB |
| **A/B / split testing** | **Client-side deterministic bucketing** (hash a visitor cookie → variant, survives CDN cache); a function records participation/conversion events; a scheduled job decides winners |
| **Third-party tags** (analytics, pixels) | Via a tag manager, **deferred** (fire after load) so they never block the critical path |
| **Booking / chat embeds** | Embed, **deferred** (load on interaction/idle) |
| **Rich media** (sliders, animations) | Native CSS / a tiny island — avoid heavy libraries |

Keep the data layer minimal — one database covers most sites; add a fast KV/cache only for genuine high-throughput needs.

**Consent** (analytics/pixels): a consent gate (CMP) records the visitor's choice; **non-essential tags fire only after consent**. Essential/first-party measurement may run where lawful. Jurisdiction (NZ Privacy Act / GDPR) is set per §11 localisation. Whether a site has a consent gate is a deliberate decision to record, not a default to drift into.

### 7.1 Forms & enquiries — the reference implementation

Every brochure site has exactly one dynamic feature that matters commercially: **the enquiry form.** A lost enquiry is a lost client, and the failure is silent by nature — nobody reports the email they never received. This is the one pattern worth specifying end-to-end rather than leaving to each build.

**Shape.** A native `<form method="POST">` posts to a server route (`prerender = false`, which requires a host adapter even on an otherwise fully static site) that does two **independent** things and then redirects:

```
form POST → route
              ├─ notify the studio  (transactional email)
              └─ append a durable record (object store / DB)
            → 303 → /contact/success/     (either path succeeded)
            → 303 → /contact/problem/     (BOTH failed)
```

**The two paths are independent on purpose.** Run them concurrently and treat the submission as successful if **either** survives. The email is the working channel; the store is the audit trail for when a mailbox rule eats one. Coupling them means a transient provider outage loses an enquiry that the other path would have caught — and the visitor, who did nothing wrong, is told to try again.

**Rules:**

1. **Never trust an HTTP 200 from an email provider.** SMTP2GO returns **200 even when the send fails** — the real outcome is `data.succeeded` / `data.failed` / `data.failures[]` in the body. Code that checks only `res.ok` reports success for every rejected message. That is exactly how one site ran with an unverified sender domain and **delivered no enquiry email at all**, with a green log the whole time. Parse the body and treat anything but a confirmed success as a throw. Assume the same of any provider until proven otherwise.
2. **HTTP send API, not SMTP.** A serverless function can be frozen between any two steps of SMTP's stateful handshake, leaving a half-sent message. One HTTPS request either completes or it doesn't.
3. **Both external calls need a deadline.** "Either path surviving is a success" holds for a provider that *fails*, not one that *hangs*. Without a timeout, a degraded email API holds the request open until the function hits its limit and the platform returns a 504 — so the visitor sees an error for an enquiry that was already safely stored. Set an explicit timeout (~10s) on every outbound call.
4. **Send from a domain you control and have verified**, and set `reply_to` to the enquirer. Sending as the client's own domain means adding DKIM/SPF records to the DNS zone that carries their real mail — a genuine risk for no benefit, since `reply_to` already routes replies correctly.
5. **The failure page must exist and must say something.** Redirecting to `/contact/?error=1` is a trap on a static site: a prerendered, never-hydrated page cannot read that parameter, so the visitor lands on a pristine empty form with their typing gone and no indication anything failed. Ship a real failure page carrying the studio's phone and email — if our pipeline is down, the visitor still needs a way to reach the client.
6. **Recipient and sender live in globals; the API key lives in the environment** (§3.8.1). The client changes who receives enquiries without a deploy; the key never touches the repo or a bundle.
7. **Isolation between sites is enforced by the store, not by the path.** A store token grants read **and write** to the *entire* store — there is no per-prefix policy. So: **one private store per site, connected to that site's project only.** Path prefixes (`enquiries/<site>/…`) and a `site` field inside each record are organisational and forensic; they are not a security boundary, and must never be described as one.
8. **Stamp the site into every record.** An exported or forwarded record is then self-identifying — the path alone is lost the moment a file is downloaded.
9. **Access mode and region are permanent.** A private store cannot be converted to public or back; the region is fixed at creation too. Personal data ⇒ create it **private**, in the nearest region, first time. Getting this wrong means migrating records, not flipping a setting.
10. **Immutable records, chronological names.** One JSON per submission, `<ISO-timestamp>.json` — listings return lexicographic order, which then reads chronologically — plus a random suffix so two same-instant submissions can't collide (a duplicate name should throw, never overwrite). Note that changing the path scheme later breaks that ordering across the boundary: digits sort before letters, so old records precede new ones regardless of date.
11. **The endpoint is unauthenticated — add a honeypot.** A hidden field that people never see and naive bots fill in, rejected server-side. Answer with the same redirect a real submission gets so the bot has no signal to adapt, but send and store nothing. Every accepted POST costs a send against a sender reputation shared with our other sites.
12. **Attribution must be real or absent.** Deriving the submitting page from the request URL yields the *endpoint's own* path (`/api/enquiry`) on every record — worse than an empty field, because it looks like data. Use a hidden field or the `Referer` header.

> **Pin and verify the SDK version.** Private-store support is recent; an older major of the same client rejects every write with `access must be "public"`. A version recalled from memory rather than checked cost a full debug cycle here. Check what the sister site already runs and match it.

#### 7.1.1 Proving it — the only acceptable evidence

A green build proves nothing about this pipeline: the route compiles, the client is imported, the store exists, and **not one byte has been written.** Both real defects found in this pattern — the wrong SDK major and the 200-on-failure — were invisible to every static check and appeared within seconds of an actual submission.

Before launch, for each site:

- [ ] **POST a real enquiry** at the running site (dev is fine for the store path) and confirm the **303 to the success page**.
- [ ] **Read the record back out of the store** and check the fields — including the `site` stamp and the timestamp. Listing it is not enough; read the body.
- [ ] **Delete the test record**, and confirm the store is empty again.
- [ ] **Send one live email** with the production key and confirm it *arrives*. This is the only check that catches an unverified sender domain, because the API reports success either way.
- [ ] **Exercise the failure paths**: an invalid submission and a honeypot submission each land where they should and store nothing; and with the email provider deliberately misconfigured, a submission **still** reaches the success page and **still** lands in the store.

That last item is worth running deliberately — it is the difference between "the two paths are independent" as a design intention and as a verified fact.

### 7.2 Tag manager — one field, two positions, every page

Every site gets a tag manager, wired the same way. It is the only sanctioned route for third-party tags: analytics, pixels, remarketing, heatmaps. Tags added any other way bypass every control below.

**The contract is a single globals field, holding an ID — never tag code:**

```jsonc
// content/globals.json
"analytics": {
  "gtmContainerId": "",      // e.g. "GTM-XXXXXXX"; empty renders nothing
  "serverContainerUrl": ""   // optional first-party transport; see §7.2.1
}
```

**Rules:**

1. **The container ID, not the code.** It is tempting to offer a "paste your tag code here" box, and it must be resisted: globals is committed to the repo, editable through the CMS by anyone with content access, and its contents would be injected as unescaped HTML into *every page*. That is a stored-XSS primitive one bad paste away from production. The ID gives the same power — everything else is configured in the tag manager's own UI, with **no deploy** — which is the entire reason to have a tag manager.
2. **Validate the ID anyway** (`/^GTM-[A-Z0-9]{4,12}$/`). It is interpolated into a script body, so it is untrusted input regardless of where it came from. Reject and warn loudly; never emit a partially-formed script.
3. **Two positions, and they are not interchangeable.** The loader goes as high in `<head>` as possible; the `<noscript>` iframe must be the **first element inside `<body>`**. Render them from one component that takes the position as a prop, so the pair cannot drift apart.
4. **Inject in the shared layout, never per page.** Every built page must pass through one layout that owns both `<head>` and `<body>`. That is what makes coverage automatic — a new page cannot forget the tag. **Verify by counting**, not by reading: build with a test ID and assert it appears in *every* HTML file the build emits.
5. **Empty is a supported state.** A site with no container yet renders nothing at all — not a broken script, not a console error. Most sites start here.
6. **Consent is a per-site decision, recorded.** Where the jurisdiction requires it, non-essential tags fire only after consent, which the tag manager's own consent mode can enforce without touching the site.

#### 7.2.1 First-party transport — keep the door open, don't walk through it early

`serverContainerUrl` switches a site from the vendor's endpoint to a **server container on our own subdomain**. Empty means the vendor endpoint. Because both the loader and the `<noscript>` fallback hang off this single origin, moving a site to a first-party transport is a globals edit plus a DNS record — no rebuild, no code change.

**Build the field in from day one; leave it empty.** It costs nothing now and turns a later migration into a config change.

**Be clear-eyed about what it buys**, because two different motivations get conflated:

| Motivation | Verdict |
|---|---|
| **Attribution on Safari/Firefox** | **The real case.** ITP caps JS-set cookies at ~7 days, so a visitor who converts after a longer consideration window is counted as brand new and the channel that earned them gets no credit. A server container sets that cookie over HTTP from our own domain, which survives the cap. For clients with month-long sales cycles this is a genuine distortion — and it biases *against* exactly the long-payback channels we usually argue for. |
| **Evading ad blockers** | **Weak, and think before pursuing it.** Blocklists are not domain-only: they carry path patterns, maintain filters for known first-party proxy paths, and uncloak CNAMEs. It is an arms race with recurring maintenance across every site. It also works against a user's explicit choice, and moving collection onto our own infrastructure *increases* our obligations under the NZ Privacy Act / GDPR — we become the controller rather than someone who embedded a script. |

**Validate the URL** to an `https` origin with no path, since it is concatenated into a script `src`; on anything else, warn and fall back to the vendor endpoint rather than emitting a broken or plaintext transport.

**The trigger to actually adopt it** is evidence, not enthusiasm: a material Safari share *and* attribution you can show is being lost. Then do one site, and compare against the old numbers.

---

## 8. SEO / AEO / GEO standard (produced automatically)

- **Structured data (JSON-LD) generated from the content model.** Each template declares its schema types; each block contributes its part (an `FAQ` block → `FAQPage`; a service block → `Service`; etc.). **Exactly one** of each entity per page — the model prevents duplicates. Common types: `Organization`, `LocalBusiness`, `ProfessionalService`, `Service`, `FAQPage`, `Article`, `HowTo`, `BreadcrumbList`, `Person`/`ProfilePage`.
- **Semantic, crawlable HTML** — one `H1`, clean heading outline (navigation labels are **not** headings), `<main>`, `<article>`, `<nav>`. Static output = fully parseable by search and AI answer engines.
- **`llms.txt`** at the root — a curated plain-text map of the site for LLMs (emerging AEO/GEO standard), generated at build.
- **Per-page metadata, canonical, OpenGraph/Twitter, XML sitemap, RSS** — all from the content model, via the pinned `seo` object (§8.1).
- **Performance budget enforced in CI** — e.g. Lighthouse mobile ≥ 95, LCP < 1.5s, TBT < 150ms. Builds fail on regression.
- **Content depth** — the block model encourages substantive, extractable sections, which is what answer engines cite.

### 8.1 The per-page `seo` object — one shape, page root, fully consumed

Every page and collection item carries its metadata in a **standard-owned object at the page root, beside `content`** — not inside any block, and not described by the block manifest (the manifest describes the block vocabulary; page-root keys — `template`, `slug`/route, `status`, `nav`, `seo` — are defined here):

```jsonc
{
  "template": "case-study",
  "seo": {
    "title": "…",          // <title> + og:title. Required to publish.
    "description": "…",    // meta description + og:description. Required to publish.
    "ogImage": { "src": "…", "alt": "…", "width": 1200, "height": 630 },  // optional; falls back to a site default
    "canonical": "…",      // optional; only when the page is a deliberate duplicate
    "noIndex": false        // optional; default false
  },
  "content": { … }
}
```

- **The base layout consumes every key.** A key the layout ignores is the §4.4 "present but unwired" failure in miniature: the editor offers the field, the author fills it, nothing publishes. If a site doesn't support a key, it doesn't declare it.
- **`title` and `description` are publish blockers; lengths are advice.** The editor warns outside ~50–60 / ~150–160 characters but never refuses — search engines truncate, they don't reject.
- **Unknown keys survive.** An editor that round-trips a page it doesn't fully model must preserve `seo` keys it doesn't render controls for — dropping them on save is data loss.
- **`ogImage` is an `image` prop (§3.1) — the same four keys as every other image, dimensions included.** It is not a bare path and not a two-key object. This was ambiguous in 1.8 and three shapes resulted across two sites: one typed it as the full image and validated it, one as a plain string, and the standard showed two keys. An editor writing the two-key form against a site that validates the four-key form has its write **rejected**, which is the worst outcome — the author sees a failure they cannot act on. Social crawlers are also the one consumer that genuinely needs declared dimensions, since they do not lay the page out to discover them.
- Why this is pinned: `seo` sits beside `content`, so it appears in **no block manifest** — an editor building forms only from the manifest renders it read-only or not at all. Both live sites had editable-nowhere meta titles until the shape was standardised and the editor taught the page-root contract.

---

## 9. Canonical repository structure

```
/repo
  site.json             # the site describes its own layout + standardVersion; §4.6
  /blocks               # framework components — the block vocabulary (code)
  block-manifest.json   # generated: every block's slots/props/variants
  /templates            # template definitions (data; authored in the editor)
  /content
    globals.json        # header/footer/site details + nav/footer skeleton + analytics; §3.5, §3.8, §7.2
    redirects.json      # old path → new path (301/308); emitted as host redirects; §3.7
    /pages/*.json        # pages: template choice + slot content + opt-in `nav` entry (data)
    /collections/<name>/*.json   # repeated items: case studies, posts, team; §3.6
  /renderer             # optional shared package: (template + content) → HTML; §5
  /styles
    tokens.css          # design tokens (the only place style is defined)
  /scripts              # tiny progressive-enhancement islands (optional)
  <generator config> + build
```

`build` turns this into the live site. The editor appears nowhere in it.

---

## 10. Extending the system

- **Add a block:** create the framework component + its typed props + a manifest entry. It appears in the editor automatically. Build it to match the design using tokens; mark whether it's an island and what schema it contributes.
- **Add a template:** compose existing blocks in the editor → saved to `/templates`. No code needed.
- **Add a page:** pick a template, fill its slots in the editor.
- **Rebrand:** change tokens / a component once → every page updates.

---

## 11. Conventions & validation

### 11.0 Install the checks; do not re-derive them

**`@traction/site-checks` is this document's gate items as code, and [RULES.md](https://github.com/traction-marketing-nz/traction-website-standard-checks/blob/main/RULES.md) is the source of truth for what they are and why.** This document states principles and architecture; it does not keep a second copy of the rules. A site installs it and runs it in the build:

```jsonc
// package.json
"devDependencies": { "@traction/site-checks": "github:traction-marketing-nz/traction-website-standard-checks#vX.Y.Z" },
"scripts": { "build": "astro build && traction-site check" }
```

**Pin a tag, and take the tag from the package's releases** — not from this
example. A version written here is a version that goes stale: this line said
`v0.1.3` for five releases, which is the same rot §4.6's example had when it sat
at `1.8` for two revisions. A document cannot hold a number that changes without
it. (A site on pnpm uses `pnpm add -D` — `npm install` silently adds nothing.)

It exits non-zero, so it stops a deploy. Everything it reads is the **built output** — the pages a visitor receives, not the source that produced them.

> ⚠️ **This section exists because prose does not run.** Four sites read this document and each wrote its own checkers: the same-named built-output checker was 320 lines on one site and 416 on another, and two of the four checked redirects not at all. So a redirect fix reached exactly one site, and the site next to it had the identical defect, live, for weeks. **A rule in this document binds nothing until something refuses to ship.**

**Per-site exceptions are declared, with a reason, in `site-checks.config.json`.** Sites genuinely differ — one cannot carry a trailing-slash redirect twin because a route directory occupies that URL — and a shared checker that pretends otherwise breaks working sites, which is how a shared checker gets deleted. The loader refuses an exception with no reason, and prints every exception on every run, so a waiver stays visible instead of becoming the silence it was meant to avoid.

**Errors block; warnings do not.** An error is something a visitor receives. A warning is debt — an image with no dimensions, a hotlinked asset. The first run against an existing site produced 185 findings, every one of them debt, and a gate that refuses today's change over last year's debt is one people learn to route around. A site cleans a rule up and then **promotes** it, after which it blocks.

**What the emitter and the checker must never do is keep separate copies of one rule.** On one site the redirect emitter and its check both consulted an exception list — and deleting the exception made the emitter emit a shadowing route *and* made the check stop expecting one. They agreed with each other while every page under that path would have gone dark. Where two halves can agree and still be wrong, the check has to ask the **built output**, which is the only thing that settles it.

### 11.1 Everything else

- **Validation:** generate **Zod** schemas from the manifest; the editor and the build both validate. Invalid content (wrong type, value outside an enum, missing required prop) is rejected at edit time.
- **No inline styles in content** — ever. Style lives in tokens + components.
- **Accessibility:** every input has a `<label>`; visible focus states; semantic landmarks; ARIA labels on icon-only controls; mobile-first responsive.
- **Localisation as configuration** — language/spelling, currency, date format set per site, not hard-coded.
- **Small, focused components**; pure functions in a `lib`; types colocated or in `types`.
- **Document decisions** (ADRs) when making architectural choices.

---

## 12. New-site quick start

*This is the build **sequence**. For a net-new (greenfield) site, run it alongside the design → handoff → gate process in §14, which governs how the design becomes tokens + blocks + reference renders **before** step 3 here. For a migration, the fidelity gate in §13 governs sign-off.*

1. **Scaffold** the generator project with the framework integration; add the host adapter and an independent database. **Install `@traction/site-checks` and wire it into `build` now** (§11.0), not at the end — it is what turns the rest of this list from advice into a gate, and adding it last means discovering at launch what it would have told you in week one.
2. **Establish tokens** — extract/define the design tokens (colours, type, spacing) up front.
3. **Build the core blocks** for the first template (`Hero`, `RichText`, `CTA`, `FAQ`), then the rest.
4. **Define templates** for the site's page types; map every page to one.
5. **Author content** as `template + slot data`.
6. **Wire dynamic features** — the enquiry pipeline to the reference implementation in **§7.1**, and the tag manager per **§7.2**. Prove the enquiry loop with a real submission (§7.1.1) rather than a green build; create the private, in-region enquiry store at this point, since its access mode and region are permanent.
7. **Generate SEO/AEO/GEO outputs** (schema, sitemap, `llms.txt`) from the model.
8. **Wire the error page and redirects** (§3.7.2, §3.7.3) — the 404 content page plus the host error route, and confirm `redirects.json` is actually read by the build. `traction-site check` enforces the rest; see its RULES.md. All of it is invisible when missing.
9. **Write `site.json`** (§4.6) — the descriptor naming every path and collection, and the `standardVersion` built to.
10. **Prove the data-driven render tree-shakes** and the **editor↔git↔preview** loop on one page before scaling — then **pass the editor-readiness gate (§4.4)** before calling the site done. Conforming the design is necessary but **not sufficient**: pages must be content-data, not code.

---

## 13. Site duplication — the two-phase fidelity gate

*Two ways to build a site under this standard: **migrate** an existing one (this section) or design a **brand-new** one (§14 — greenfield). Pick the matching gate.*

Used when **duplicating an existing site** (migrating from an old CMS/theme to this architecture) where the new site must match the source exactly. Fidelity is a **per-template gate, not a final step:** as each template is built it must pass *before it is considered done.*

> **Principle: a template isn't "done" until it passes BOTH the visual gate and the structural audit at every breakpoint.**

A single pixel-diff percentage is **necessary but not sufficient**. It cannot tell a real defect from noise: a low % routinely *hides* a missing section, a swapped asset, or a wrong element count (the matching content drowns out the small/structural difference), while photographic and carousel sections never pixel-match even when visually identical. So the gate has two phases — run them in order:

- **Phase 1 — Visual diff (`compare.mjs`):** per-section pixel-diff < 10% at every breakpoint. Catches typography, colour, spacing, and layout drift.
- **Phase 2 — Structural manifest audit (`audit.mjs`):** extract a manifest from the source and assert parity against the rebuild. Catches what pixels and the eye miss — missing sections, swapped/absent assets, wrong counts, grid-vs-carousel.

> `compare.mjs` / `audit.mjs` are **reference tooling** — the names are illustrative of a Playwright + pixelmatch harness and a DOM-manifest extractor. Any equivalent implementation that produces section-isolated visual diffs and a structural parity report satisfies the gate.

> **Mindset: extract the source's structure into a manifest FIRST, build to the manifest, then diff.** Don't build from a screenshot and guess — you'll keep re-querying the source. Pull ground truth up front.

> ⚠️ **Fidelity ≠ conformance.** A migrated site that looks identical but whose pages are hand-coded has **failed** (§4.4). Run the editor-readiness gate per template alongside this one.

> ⚠️ **Prose can be a build input.** When a change is supposed to be visually inert (a refactor, a manifest regeneration), prove it by diffing the **built output**, not by reasoning about which files you touched. Utility-CSS frameworks that scan source files by content — Tailwind v4 scans `.mjs` and `.astro` — will happily emit a rule for a class name that appears **inside a comment**. Writing the word *invisible* in an explanatory comment added `.invisible{visibility:hidden}` to the stylesheet and changed its content hash. The correct evidence is a byte-for-byte comparison of the built CSS/HTML against the baseline branch; the correct fix is usually to reword the comment.

### 13.0 Migration protocol — phases and session resumption

A migration runs across many sessions. Without a written protocol each session re-discovers the source instead of building, and Phase 0 questions get asked twice.

| # | Phase | Enters when | Leaves when |
|---|---|---|---|
| 0 | **Intake** | The job starts | The six questions below are answered and recorded |
| 1 | **Source audit** (§13.1) | Intake done | `source-audit/<template>.json` exists per template |
| 2 | **Tokens** | Audit done | `tokens.css` extracted and approved |
| 3 | **Blocks** | Tokens done | The template's blocks exist, schema-first (§4.2.1) |
| 4 | **Templates** | Blocks done | `templates/*.json` with slot order verified (§13.2) |
| 5 | **Build + content** | Templates done | Pages are content-data; both gates pass per template |
| 6 | **Launch gate** | All templates signed off | Every §15 checklist item done |

**State file — `migration-state.json`**, written at Phase 0 and updated throughout: the `standardVersion` being built to, the source URL, the intake answers, and which phase each template has reached. **Any session reads this first** and resumes from it. **Never re-ask a Phase 0 question that is already answered there.**

#### 13.0.1 Phase 0 — the six intake questions

Asked once, before any code:

1. **Source URL** — the exact live site being replicated, including which environment.
2. **Scope** — which pages/templates are in scope, and which are explicitly out.
3. **Intentional deviations** — what should deliberately *differ* from the source (free text; this is what stops the fidelity gate flagging a wanted change as a defect).
4. **Known gaps** — what is already broken or missing on the source that we are not obliged to reproduce.
5. **Deployment target** — host, domain, and whether this replaces a live site (which decides the §15 cutover items).
6. **Mobile breakpoint** — the width to gate at, because 375px is the default and divergence hides there.

### 13.1 Phase 1 — source audit (per template, before any code)

Produce `source-audit/<template>.json` for every template **before building it**. It captures:

- **Section inventory**, numbered top-to-bottom — **this IS the slot order** (§13.2).
- **Interactive widget classification** — carousel vs grid vs tabs vs accordion, detected rather than assumed, because they pixel-diff identically while behaving differently.
- **Heading style matrix**, measured via `getComputedStyle` rather than eyeballed.
- **Mobile viewport notes** at the agreed breakpoint.
- **Global elements** — logo `href`, nav targets, footer links, social hrefs.

#### 13.1.1 Extract ground truth — never eyeball
Pull the source's **computed values** and match them exactly:
- colours, `font-size` / `font-weight` / `line-height` / `letter-spacing` per element;
- element **geometry** (bounding boxes — position, width, height) to match layout and text wrapping;
- section padding, container max-widths, column gaps, and whether sections are **full-bleed or contained** (a 1280 vs 1220 container scales a `background-size:100%` image differently and offsets everything inside).
Matching measured values is faster and exact. Most fidelity bugs are a single cause: a too-dark colour, a wrong font-weight, a wrong container width, or a line-height that changes where text wraps.

### 13.2 Template slot order rule

The `slots` array order in `template.json` is the **only** control over render order. Page JSON key order is irrelevant — it is a map, not a sequence. Verify slot order against the source audit's section inventory **before building**, not after someone notices the page is in the wrong order.

### 13.3 Phase 1 — the visual harness (`compare.mjs`)
An automated visual-regression tool (e.g. Playwright + pixelmatch) that, for a fixed set of breakpoints (mobile / tablet / desktop / wide):
- renders **both** the source and the rebuilt page at the *real* viewport (true mobile rendering, not a locked desktop width), loading the source directly (no iframe — `X-Frame-Options` is irrelevant);
- **isolates each section**: aligns on the *section's top edge* (not a heading — which may sit low in the section) and **clips the capture to the section's own height**. This is critical — a fixed-viewport capture of a 400px section is half neighbour-bleed and inflates the number; clipping to the section measures *that section*;
- produces a **pixel-diff image** (mismatches highlighted) and a **% difference** per section per breakpoint.

The per-section loop:
```
build section → harness aligns source vs rebuild on the section top, clips to section height
   → review the DIFF IMAGE, not just the %: concentrated red = a real structured defect
     (offset, overlap, swap); scattered red = anti-aliasing/compression noise
   → extract the source's exact computed values → fix tokens/components → rebuild → re-run
   → repeat until < 10%
```

### 13.4 Known visual-diff floors (route these to Phase 2)
Some sections **cannot** reliably reach the threshold by pixel-diff — not a fidelity gap, an inherent property of the metric. Recognise them, get them as close as the structure allows, then **rely on the manifest audit + a one-time visual check** rather than chasing the number:
- **Photographic backgrounds** — the source's image is often re-encoded/resized by its CDN, so the bytes differ from the asset you load; high-frequency texture + overlaid text anti-aliasing leaves a ~10–15% floor even when the crop, scale and position match exactly. Match width/scale/position precisely, then accept the floor.
- **Auto-advancing carousels / sliders** — the source lands on an arbitrary slide at capture time, so the diff is non-deterministic (and pausing via the slider's API often lands mid-transition or on the wrong slide). Freeze/pause best-effort, **verify the design once by eye**, and let Phase 2 assert the slide count and content.
- **Lottie / video** — hide on both sides for the static diff; verify motion separately.

### 13.5 Phase 2 — the structural manifest audit (`audit.mjs`)
For each section (located on both sites by a shared text anchor — resolved to the **most specific** element so `closest()` returns the section, not a page-level wrapper), extract a manifest and assert parity:

| Check | Catches |
|---|---|
| **Section inventory** (count + order + headings) | A whole section missing from the rebuild |
| **Asset parity** (every source `<img>`/`data-lazyload`/background-image basename is referenced) | Swapped or missing logos, globes, separators, avatars, thumbnails |
| **Background colour** (per section, transparent-normalised) | A panel/band built on the wrong surface colour |
| **Component type** (static / carousel / tabs) | A carousel rebuilt as a static grid (or vice-versa) |
| **Slide / item count** | "3 testimonials vs 5", "5 logos vs 8" |
| **Element counts** (imgs, links) — *informational* | Content gaps (noisy for carousels: clones inflate it) |

**Accepted deviations.** Where the rebuild *intentionally* improves on the source — e.g. a CSS chevron instead of an `arrow-left.png`, or a CSS ring instead of a decorative shape SVG — record it in an allowlist so the audit surfaces it as a **note**, not a failure. Everything not on the allowlist is a hard issue.

The audit is deterministic, needs no human to read screenshots, and is the **real gate for the Phase-1 floors** (photographic + carousel sections): it confirms the right assets, counts, and component types are present even when pixels can't.

### 13.6 Acceptance criteria
- **Every breakpoint passes**, not just desktop — mobile/tablet are where divergence hides. Explicitly required: a screenshot pass at 375px for every template, covering the hero, the first section below it, and the navigation collapse.
- **Phase 1:** each section's static, section-isolated diff is **< 10%**, *except* documented floors (§13.4), which must be as close as structure allows + visually signed off.
- **Phase 2:** `audit.mjs` reports **no structural issues** (notes for accepted deviations are fine).
- **Template slot order verified** against the source audit section inventory (§13.1, §13.2) before build starts, not after a mismatch is noticed.
- **Global elements verified:** logo `href` navigates home, all nav links resolve, footer links and social icon hrefs are correct (checked against `globals.json` and confirmed in browser).
- Keep the side-by-side + diff images and the audit report as a **record per template**.
- **Editor-ready (§4.4):** the template's page(s) are content-data (not code), and the block manifest covers its blocks. Fidelity alone does not sign off a template.
- A template is signed off only when **fidelity (both phases) *and* editor-readiness (§4.4)** pass at all breakpoints; these per-template sign-offs feed the launch checklist (§15).

---

## 14. Net-new sites — the greenfield design process

Used when building a **brand-new site with no existing version to replicate**, rather than migrating one (§13). The architecture, build pipeline and gate machinery are identical — but the **reference flips**, and that cascades:

| | Migration (§13) | Greenfield (§14) |
|---|---|---|
| Source of truth | the live site | an **approved design artifact** |
| Visual gate | exact — < 10% pixel-diff | **intent — ~15–20%** (the mock guides, it isn't gospel) |
| Quality gates | inherited from the old site | **must be added** (a11y, responsive, perf, SEO) |

> **Don't pixel-chase an AI-generated mock to 100%** — it wastes effort and bakes in the mock's flaws (poor contrast, desktop-only thinking). Loosen the visual gate; tighten the quality gates.

### 14.1 The design funnel
1. **Diverge** — generate **several distinct directions** with claude.ai/design (or the `frontend-design` plugin in-IDE). Get **mobile *and* desktop** for key screens; AI mocks default to desktop, and responsive logic is where greenfield quality lives.
2. **Decide** — pick one direction with the stakeholder and lock it.
3. **Hand off to the coding system (§14.2)** — the step that makes or breaks the build.
4. **Build** — the same blocks → templates → pages pipeline, token-driven, static output.
5. **Gate** — the greenfield gate (§14.3).

### 14.2 ⭐ The handoff: design artifact → coding system
**This is the crux of the whole process. The deliverable of "design" is a *system*, not a set of screens.** A mock dropped straight into code as pixels-to-copy yields a beautiful home page and inconsistent inner pages. The mock is **direction**; the *system* is what crosses the boundary into the repo.

**Nothing enters the build until these three artifacts exist** — they are the contract between design and code:

1. **Design tokens → `tokens.css`.** Extract palette, type scale, spacing, radii, shadow and motion from the chosen mock into tokens. *Every* block references tokens, never raw values — this is the single contract that keeps all pages consistent, makes the site themeable, and lets the editor change content without touching design.
2. **Block + template decomposition.** Map the design's recurring sections to **reusable blocks**, and define the **template set deliberately, up front** (a recruitment site, say: home, job-listing, job-detail, apply, about, contact). Greenfield's edge over migration is exactly this: you *design to a clean block system* instead of reverse-engineering someone's markup. Do it on purpose.
3. **Reference renders.** The chosen mock as **rendered HTML, per template, per breakpoint** (claude.ai/design emits real HTML, so serve it). These become the new "source of truth" — what `compare.mjs` diffs the build against, replacing the live URL.

> **Handoff rule of thumb:** if you can't point to the tokens file, the block list, and the per-breakpoint reference renders, design isn't finished and coding shouldn't start. The mock is an *input* to the handoff, not the output of it.

### 14.3 The greenfield gate
Same two phases as §13, re-pointed at the reference renders:
- **Visual (`compare.mjs`, reference = rendered mock):** intent match at **~15–20%** — confirm the build *realises* the design, not that it photocopies an imperfect mock.
- **Quality (what a migration inherits for free, here made explicit):**
  - **Token conformance** — no off-token colours/spacing (the audit's "asset parity" becomes "token parity").
  - **Accessibility** — contrast ratios, semantic structure, keyboard paths, focus order.
  - **Responsive correctness** — every breakpoint designed and verified (no fixed-px traps).
  - **Performance budget** — mobile + desktop.
  - **SEO / structured data** — template-declared schema, one entity per page.

### 14.4 Acceptance criteria
- Tokens, block list, and per-breakpoint reference renders exist and are approved **before** build (§14.2).
- Visual diff within the greenfield threshold at **every breakpoint**.
- All quality gates pass (a11y, responsive, performance, SEO, token conformance).
- **Editor-readiness gate (§4.4) passes** — pages are content-data, the block manifest is generated, `site.json` exists, the editor↔git↔preview loop is proven. A greenfield site that renders the mock as hand-coded pages is **not** done.
- Records kept per template, same as §13.

---

## 15. Launch / migration checklist

*(Applies to replacement sites. A net-new site skips the migration-only items — 301 maps, parallel data capture, DNS rollback — and is gated by §14 instead.)*

- [ ] Every template passed **both** phases of the fidelity gate (§13) at all breakpoints including 375px mobile: Phase 1 visual diff < 10% per section (bar documented floors), Phase 2 structural manifest audit clean.
- [ ] **Template slot order** verified against source audit section inventory for every template (§13.1, §13.2).
- [ ] **Global elements verified:** logo `href` navigates home, all nav links resolve, footer links and social icon hrefs correct in `globals.json` and confirmed live in browser.
- [ ] **Editor-readiness gate (§4.4) passes** — `block-manifest.json` generated, `site.json` present and accurate, every page is content-data (no content/layout in code), editor↔git↔preview loop proven, editor readiness check green.
- [ ] `compare.mjs` (visual) and `audit.mjs` (structural) records kept per template.
- [ ] Performance budget passes (mobile + desktop).
- [ ] Structured data validates; one of each entity per page; no duplicates.
- [ ] Every old URL has a 301 map **built from a full crawl of the old site** — a crawler that reads the sitemap where there is one and follows links where there isn't, producing the inventory and the redirect plan. Not from memory, and not from the old sitemap alone: a sitemap lists what the old CMS chose to declare, which is rarely everything that has inbound links. Sitemap submitted; canonical tags correct.
- [ ] **Rich text proven (§3.1.1)** — the site's Markdown module passes its pinned checks, and one page with bold, a list and a link renders correctly on a deployment.
- [ ] **Per-page SEO consumed (§8.1)** — a page's `seo.title`/`description` appear in the built `<head>`; no declared key is ignored by the layout.
- [ ] **Redirects proven on a deployment (§3.7.2)** — a real old path requested, real 301 to the right place. Not "it's in the config".
- [ ] **`traction-site check` passes (§11.0)** — every redirect rule is checked by it, in both slash forms, with its destination confirmed to exist. A pass on one form and a spot check on one rule is how twelve dead redirects shipped.
- [ ] **`traction-site check` is in the build script and exits 0 (§11.0)** — not run by hand once. If it is not in `build`, nothing stops the next deploy.
- [ ] **Branded 404 served (§3.7.3)** — request a path that cannot exist; confirm the site's own page, status 404, not the platform's card.
- [ ] **Enquiry pipeline proven end-to-end (§7.1.1)** — a real submission redirected to success, the record read back out of the store and then deleted, **one live email received** (not merely accepted by the API), and the failure paths exercised.
- [ ] **Enquiry store is private, in-region, and dedicated to this site** — not shared with another site's records (§7.1 rule 7).
- [ ] **Tag manager wired (§7.2)** — `analytics.gtmContainerId` in globals, both snippets rendered from the shared layout, and coverage proven by **counting**: the container ID appears in every HTML file the build emits. Consent decision recorded either way.
- [ ] **No secret is in `globals.json`, and no secret appears in the built output** (client *or* server) — `grep` the build for each secret's value (§3.8.1).
- [ ] Forms/data capture run in parallel with the old system during cutover (no data loss).
- [ ] DNS points at the host in single-CDN mode; SSL valid.
- [ ] Rollback path confirmed (DNS flip) until the old site is decommissioned.

---

## 16. Why this architecture (rationale)

Traditional CMS/theme stacks store content as rendered markup, mix content with style, ship large undifferentiated JS/CSS to every page, and couple the site tightly to the editing tool and host. That produces slow pages, fragile edits, duplicated/ broken structured data, and painful maintenance.

This standard inverts all of that: **content is structured data, design is versioned code, output is minimal static HTML, structured data is automatic, and the site is decoupled from both the editor and the host.** The result is fast, AI-editable, answer-engine-ready websites that are cheap to run and easy to evolve — and a single way of building that every future site inherits.

---

## 17. Changelog

The standard is versioned so each site can record which version it was built to (§4.6).

- **1.15** (2026-08-19) — **A rule and its own worked example disagreed, and the example won.** §3.7 says redirects live at `/content/redirects.json`; §4.6's `site.json` example showed `src/content/redirects.json`. Four sites split two-and-two on that file, and because §11.0's checks look in the canonical place, both redirect checks silently reported *"this site declares no redirects"* on half the estate — passing green over a live rule that had made a real page unreachable. §4.6's example now uses §9's canonical layout throughout, with the deviation shown separately and labelled. Two rules added: **deviation is per path and needs a constraint, not a preference** (the loader reason reaches pages and collections, not `redirects.json`, which no loader reads), and **a tool that hardcodes a default instead of reading the descriptor is not conformant** — a declared path missing on disk is an error, only an undeclared one is an absent feature.

- **1.14** (2026-08-19) — **Numbers this document cannot keep current, and a copy of it that rotted.**
  - **§11.0 no longer pins a package version.** The install example carried `#v0.1.3` for five releases. A document cannot hold a number that changes without it, so the example says `vX.Y.Z` and tells you to take the tag from the package's releases — the same rot §4.6's example had at `1.8`, now avoided rather than corrected again.
  - **§11.0 notes the pnpm case.** One of the four sites uses pnpm, where `npm install --save-dev` silently adds nothing at all and the check then never runs.
  - **A full copy of this document was found committed inside a client repo**, pinned at 1.10 and still carrying the §3.7.1 rule table whose contents moved to the package at 1.13. Anyone reading it there would have re-implemented rules that already run on every build of that site. Replaced with a pointer. Worth stating as a rule and not just an incident: **this document is not copied into site repos.** A copy is a fork, and the fork nobody updates is the one somebody reads.

- **1.13** (2026-08-12) — **One place for a rule, and it is the place that runs.** 1.12 said install the checks rather than re-derive them, and then this document went on holding its own copy of the rules. Within a day §3.7.1's heading said "two rules" above a table of four, its list and the package's list disagreed, and two of the rules — no self-reference, no chains — were implemented in neither, surviving only as two hand-written per-site copies that each caught a slightly different subset.
  - **§3.7.1 no longer states rules.** Every rule, and the failure each was written after, is in the package's `RULES.md`. The reasons moved with them, deliberately: a rule with no recorded reason is one somebody deletes the first time it is inconvenient, so the reason has to travel with the thing that executes.
  - **§3.7.2 keeps only what a checker cannot do** — request an old path on a real deployment and read the status.
  - What remains in §3.7 is the part that is architecture rather than enforcement: redirects are content, and a slug rename must be able to create one.
  - The package absorbed the two orphaned rules in v0.2.0, so nothing is now checked in a per-site copy.

- **1.13** (2026-08-12) — **The rules the package learned, written back into the document.** Everything here came from building §11.0's checks and adopting them on two sites; each was enforced in code before it was stated here, which is the wrong way round.
  - **§3.7.1: a redirect must not shadow a page that exists.** Redirects run before the filesystem, so a rule sitting on a URL that has a real page makes that page unreachable, with no error anywhere. Stated as a rule, and stated as *check the built output* — because the site where this surfaced had an emitter and a checker reading one exception list, and deleting the entry made the emitter emit the shadowing route while the checker stopped expecting one. Two halves of a rule agreed with each other and a whole section would have gone dark.
  - **§3.7.1: anchor the emitted route.** The counterpart, and the reason the rule above is mostly avoidable rather than merely detectable. `^/properties` swallows `/properties/6-main-road/`; `^/properties/?$` sits safely beside a dynamic route directory of the same name.
  - **§3.7.2: wildcards are checked on what they promise the author.** A checker that only asks whether a wildcard shadows a carve-out passes a site whose redirects are entirely wildcards and which emitted none of them — the exact mirror of the failure that prompted 1.11.
  - **§3.7.1's heading said "Two rules" while the table listed four**, for two revisions, because 1.11 added rows and left the heading alone. That is the stale-claim failure this section warns about, sitting in the section that warns about it — and it was found by re-reading the document rather than by anything that runs. Worth noting as the limit of §11.0: a package can enforce the rules, and nothing enforces the prose.

- **1.12** (2026-08-12) — **The gate items are a package now, because prose does not run.**
  - **§11.0 added: install `@traction/site-checks`, do not re-derive it.** Four sites read this document and each wrote its own checkers — the same-named built-output checker was 320 lines on one and 416 on another, and two of the four checked redirects not at all. So 1.11's redirect fix reached exactly one site, and the site beside it had the identical defect live. A rule here binds nothing until something refuses to ship; the package exits non-zero in the build, and reads the pages a visitor receives rather than the source that produced them.
  - **Exceptions are declared with a reason, and printed every run.** Sites genuinely differ — one cannot carry a trailing-slash redirect twin because a route directory occupies that URL — and a shared checker that pretends otherwise breaks working sites, which is how a shared checker gets deleted.
  - **Errors block, warnings do not.** The first run against an existing site produced 185 findings, every one debt rather than breakage. A gate that refuses today's change over last year's debt is one people learn to route around, so a site cleans a rule up and then *promotes* it.
  - **Two halves of one rule can agree with each other and still be wrong** (§11.0). A site's redirect emitter and its check both read the same exception list, and deleting the exception made the emitter emit a shadowing route *and* made the check stop expecting one — they agreed, the build passed, and every page under that path would have gone dark. Where that is possible the check must ask the built output, which is the only thing that settles it. The package now refuses any redirect that shadows a real page.
  - §12's quick start installs the checks at **step 1** rather than at the end, and §4.4's gate leads with "it runs and passes" — a site that has not installed it has not been checked, however green its build.

- **1.11** (2026-08-12) — **Emitting a redirect is not the same as serving one.** Found by a live outage: every redirect on a production site returned 404, and had done for weeks, while its build printed clean on every deploy.
  - **§3.7.1 gains two build-enforced rules.** **Both slash forms must match** — the framework compiled `/expertise/` as `^/expertise$`, and sources are written *with* the slash because that is the form the site serves and the form inbound links carry. The un-slashed form worked perfectly, so every spot check passed. **The destination must resolve** — two rules on the same site pointed at path prefixes that did not exist on it, so fixing the slash bug alone would have turned a 404 into a *confident 301 into a 404*, which tells a search engine the old URL permanently moved somewhere empty.
  - **§3.7.2 now says every rule, not one.** One rule proves the wiring exists and nothing else; a spot check lands on whichever form you happened to type. The build check is what makes checking the whole list affordable, and it runs on every deploy rather than the one day someone remembers.
  - **A check scoped to the feature that motivated it is not a check on the behaviour** (§3.7.2). Both the both-forms assertion *and* the emitter's fix for it already existed on that site — written while chasing a wildcard bug, and both placed inside the loop over wildcard rules. The site had no wildcards, so neither ran. This is §4.4.1's "a check that runs, not a sentence that is read" one level up: the check ran, and examined nothing.
  - §4.4's gate item and §16's checklist state both-forms and destination-exists directly, rather than leaving them implied by "proven on a deployment".
  - **§4.6's example was pinned at 1.8**, two versions behind, despite 1.9's changelog recording that it now pins the current version. The example is the thing sites copy, so every site scaffolded since has been declaring conformance to a standard three revisions old. Pinned to 1.11 — and worth noting as the same shape as the finding above: a rule stated in prose, with nothing that checks it.

- **1.10** (2026-08-06) — **Collections that are not pages, and the label a generator talked itself out of.** Both found by conforming a third site to 1.9 and then running the editor's own readiness check against the result — the two disagreed, and the standard was the one that was wrong.
  - **§3.6 now has two kinds of collection.** 1.9 said flatly that *every* item is `template` + slot content, while §3.3's own worked example sourced FAQ content into a slot — the document required one thing and demonstrated another. A **routable** collection declares `template` + `route`; a **data-feed** collection declares an `itemSchema` and has neither, because its items are only ever aggregated into someone else's slot. The site that surfaced this had three data-feed collections (FAQ answers, testimonials, download cards) whose only conforming options were to name a template that did not exist, invent a per-item block so a PDF link could pretend to be a page, or leave fifteen items editable nowhere. The rule both kinds share is unchanged and is the one that matters: **every item is described by a schema that reaches the manifest.**
  - **Never name a template an item does not have** (§3.6, §4.6, §4.4.1). A dangling `template` is worse than an absent one — a tool reads the descriptor verbatim and offers to author content it cannot render. A collection whose page type is designed but not built is data-feed *until it is built*. The generator fails on a `template` or `itemSchema` that does not resolve, and on a collection declaring neither.
  - **§3.1: a closed set that is a list.** `enum` covered one value from a set; nothing covered *many* from a set, so a field meaning "which surfaces does this record appear on" had nowhere to say so and fell back to free strings — which an editor then rendered as prose, complete with an "Add paragraph" button under a template name. It is an `array` whose item descriptor carries `options`. **Advisory, not a constraint:** a site had four downloads staged against surfaces for pages designed but not yet built, and an `enum` would have failed the build on content whose only fault was being ready early. Unlisted values are kept and shown as inert, never dropped; the generator fills the list from the site's own templates so it cannot rot.
  - **§4.4.1: an array's item descriptor needs its own label.** "It inherits from the array" is a reasoning the generator can hold and no downstream reader can. One site's generator skipped exactly that case and shipped nine repeaters whose row headers were humanised raw keys, while passing its own label check.
  - §4.6's example now shows both collection kinds, and §4.4's gate states the describe-every-item rule directly rather than leaving it implied by "every route is content-data".

- **1.9** (2026-08-04) — **The gaps a new site would fall into.** Found by auditing the document against the two sites built from it, then asking what would happen to a *third* site built from the text alone. Each of these would have bitten in the first week.
  - **`paths.media` added to §4.6, and made required.** The editor's only writable binary directory — undeclared, a tool must guess, and the guess is also what bounds its path-safety check. A site keeping media anywhere but the conventional location would have had uploads land in the wrong place and previews fail. Also adds the `media` block (`storage`, `transform`, `maxSourceBytes`, `maxSourceWidth`) so limits can be stated before an upload rather than after.
  - **`ogImage` disambiguated (§8.1).** 1.8 showed two keys while §3.1 required four; two sites produced three shapes between them, and an editor writing the two-key form against a site validating the four-key form has its write **rejected**. It is an `image` prop, dimensions included — social crawlers are the one consumer that genuinely needs declared dimensions.
  - **Added §3.4.1 — media in the repo has a weight budget.** 1.8 made media committed content and said nothing about consequences. Git keeps every version of every binary forever; the pain arrives late as slow clones and rejected pushes. States the caps, that the host's optimization replaces committing pre-sized copies, that video does not belong in git (a 102 MB video had its push rejected outright, twice), and that deleting a file reclaims nothing.
  - §4.6's example now pins the **current** version rather than trailing it — the example is the thing sites copy.

- **1.8** (2026-08-03) — **The prose contract, the media contract, and the page's own metadata.** Driven by the editor's rich-text and SEO work landing against both live sites.
  - Added **§3.1.1 `richtext` — Markdown, one grammar, one renderer**: a fixed allowlist grammar (zero preset + explicit enables, never a denylist), no images in prose (they bypass the image pipeline), link-scheme allowlist with protocol-relative rejected, no typographer/linkify rewrites, editor preview mirroring the same config, and a pinned `test-markdown` check. Context: a bidirectional WYSIWYG serialiser corrupted content across three review rounds and was replaced by textarea-as-source-of-truth + preview; the grammar the two ends share is now standard, not convention.
  - Added the **"declare only what you render"** rule to §3.1 and the §4.4 gate — one site shipped 13 `richline` headings interpolated as plain text; the type promised formatting the page would never show.
  - **`image` props re-specified** (§3.1): `src` is a repo path (media is committed content — the git-in-repo decision), `alt` required, real intrinsic `width`/`height` recorded from the file, rendered via host image optimization; hotlinked external sources fail conformance.
  - Added **§8.1 the per-page `seo` object** — pinned shape (`title`, `description`, `ogImage?`, `canonical?`, `noIndex?`) at the page root beside `content`; base layout must consume every declared key; title/description block publish, lengths only advise; editors must preserve unknown keys. Context: `seo` lives beside `content` so no block manifest describes it — two live sites had meta titles editable **nowhere** until the editor was taught the page-root contract this section now pins.
  - §15: the 301 map must come from a **full crawl of the old site**, plus launch checks for the rich-text module and consumed SEO keys.

- **1.7** (2026-08-02) — **Present but unwired.** Both live sites shipped artifacts that existed, validated, and did nothing — with green builds and repos that looked complete. Every item here was found by requesting a URL on a real deployment.
  - **§3.7.1 Redirect rules enforced at build** — no self-reference, no chains or cycles. One site's file held a self-redirect against a real route: an `ERR_TOO_MANY_REDIRECTS` outage waiting for the day someone wired the file up.
  - **§3.7.2 Prove redirects on a deployment** — a site's `redirects.json` was declared in `site.json`, written by the editor, and never imported by the build. Every rule inert, nothing in the repo missing. Also notes that preview access-protection 302s anonymous checks to a login page, so an automated test sees that instead of the redirect.
  - **§3.7.3 The 404 page** — new requirement: a branded 404 as an ordinary **content page**, plus the **host error route** that serves it. Build Output API v3 does not serve static `404.html` automatically and the adapter emits none, so **both sites served the platform's bare 404 in production** while the branded page sat unused inside the deployment. Keep the 404 status — a catch-all redirect to home is a soft 404 that keeps dead URLs indexed.
  - Extended **§4.4.1** with the **template registry** check, the sibling of the block-registry one: an unregistered template resolves to `undefined` and renders header, footer and nothing between. Observed shipping a live 404 page that was entirely blank.
  - Added both to the **§4.4 gate**, the **§12 quick start** and the **§15 launch checklist**.

- **1.6** (2026-08-01) — **The parts a green build can't prove.** Conforming two sites to 1.5 and wiring both enquiry pipelines surfaced a class of defect that every static check passed: the code compiled, the manifest generated, the build went green, and the feature did nothing. Each addition is an observed failure, not a precaution.
  - Added **§3.8.1 Globals are public** — globals reach the *browser* (a hydrated island importing them pulls values into its client chunk; a site's phone number was found in `_astro/Hero.<hash>.js`). Recipient and sender addresses belong in globals so the client can change them without a deploy; **API keys must stay in the environment**. Includes the build-time-inlining trap (`import.meta.env.X` is replaced with the build-time value, making the `process.env` fallback dead code — a real read+write token for a store of personal data was baked into a server bundle) and the grep-the-build check, now a launch item.
  - Added **§7.1 Forms & enquiries** as a full reference implementation — independent notify/store paths where **either** surviving counts as success; **never trust a 200** from an email provider (SMTP2GO returns 200 on failure, which is how one site sent no enquiry email at all while logging success); timeouts on both calls, because independence holds for a provider that fails but not one that hangs; a **real failure page**, because `?error=1` on a prerendered page is unreadable and silently loses the visitor's typing; isolation enforced **per store, not per path prefix**; permanent access mode and region; the `site` stamp; a honeypot on an unauthenticated endpoint; attribution that is real or absent; and pin the SDK major.
  - Added **§7.1.1 Proving it** — a build cannot demonstrate this pipeline; both real defects appeared within seconds of an actual submission. Submit, read the record back, delete it, receive one live email, and exercise the failure paths.
  - Added **§4.2.2 Manifest field rules** — state `required` explicitly (three dialects across two sites made a reader mark every optional prop required, blocking saves); **every array declares a complete, usable `of`** — missing (entries become one textarea and a keystroke destroys them), or present-but-empty as `{type:"object"}` with no `props` (26 such arrays sat read-only while passing any naive "has `of`" check), or carrying an unknown type, or a nested array left unvalidated; **bounds must be real** (an invented `max: 10` blocked a legitimate 12-paragraph case study); labels recurse; and **defaults must survive generation** (0 of 268 props carried one against ~80 `.default()` calls). Plus the editor corollary: a blocked save must **name the field and reason** — that display is what exposed the invented-max bug.
  - Extended **§4.4.1** with the registry check (a template slot naming a block absent from the registry silently drops a whole section from a live page), the array-descriptor check, **exit non-zero on any failure** (`main().catch(console.error)` exits 0, so a malformed template JSON reports success), and **test the checks themselves** — the array check passed the exact shapes it existed to catch on its first implementation.
  - Added **§7.2 Tag manager** and **§7.2.1 first-party transport** — one globals field holding a **container ID, never tag code**; two positions rendered from the shared layout; coverage proven by counting HTML files. `serverContainerUrl` built in from day one and left empty: the honest case for adopting it is Safari's ~7-day cap on JS-set cookies distorting attribution for long sales cycles, **not** ad-block evasion.
  - Added the **prose-is-a-build-input** warning to §13 — Tailwind v4 scans `.mjs`/`.astro` by content, so the word *invisible* in a comment emitted a CSS rule and changed the bundle hash. Prove visual inertness by diffing built output.

- **1.5** (2026-07-31) — **The site describes itself; preview is the site's own build.** Two conformant-on-paper sites were partly uneditable, for reasons the standard couldn't catch:
  - Added **§4.6 The site descriptor** — a required root `site.json` naming every path and collection, and recording `standardVersion`. Editors previously pattern-matched paths; one site's five case studies were silently invisible because they sat at `src/content/case-studies/` rather than `content/collections/`. Added to the §4.4 gate and the §9 structure.
  - **Preview is the site's branch build** (§5). The shared-renderer package is now explicitly **optional**. The mandate assumed one block library; in practice two sites had disjoint vocabularies with nothing to share, and neither shipped a render service — while the host was already building every PR byte-accurately for free.
  - **Collection items are JSON** `template` + slots (§3.6); MDX only for genuine long-form prose bodies. A site shipped case studies as `.mdx` with empty bodies and everything in YAML frontmatter — uneditable, and YAML parsed a comma'd paragraph into a list, publishing sentence fragments.
  - Added **§4.4.1 The generator must not fail silently** — the manifest generator asserts its own output and never writes on failure. One site's generator matched zero files for months while exiting 0; the standard had already required a generator, which is the point — specification alone cannot catch a script that lies.

- **1.4** (2026-06-28) — **Migration protocol and source audit.** Multi-session builds were losing context between sessions and re-discovering source behaviour mid-build instead of upfront.
  - Added **§13.0 Migration protocol** — a numbered phase sequence, a `migration-state.json` state file any session reads at start, and a session resumption rule (never re-ask Phase 0 questions already answered).
  - Added **§13.0.1 Phase 0 questions** — six intake questions asked once before any code.
  - Rewrote **§13.1** as *Phase 1 — source audit*: `source-audit/<template>.json` per template before build, capturing section inventory (which IS the slot order), widget classification, a measured heading style matrix, mobile notes, and global elements.
  - Added **§13.2 Template slot order rule**; renumbered the following subsections.
  - Added 375px mobile pass, slot-order verification and global-element checks to §13.6 and §15.

- **1.3** (2026-06-23) — **Authoring robustness.** Added **§4.5** (assume the editor will clear fields, add items, create pages, upload media): generic page-creation route, array cardinality, empty-state handling, manifest editor affordances, a steer away from per-breakpoint content variants, and a proven media-upload loop. Folded an *author-complete* item into the §4.4 gate.

- **1.2** (2026-06-23) — **Closed the editor-readiness gap.** A pixel-perfect but hand-coded site could previously pass "done".
  - Rewrote the **definition of done** to require §3 pages-as-data and the §4 contracts explicitly.
  - Added **§4.4 Editor-readiness gate**, run per template alongside the fidelity gate.
  - Added the **fidelity ≠ conformance** trap warning (§13) and editor-readiness acceptance items to §13.6, §14.4, §15 and §12.
  - Added **§3.8 Globals**, codifying the *duplication trap*: a site-wide value duplicated into page content silently overrides the global.

- **1.1** (2026-06-20)
  - Added **derived navigation & menus** (§3.5) and footer derivation.
  - Added **Collections** (§3.6) and **Redirects as content** (§3.7); reflected both in §9.
  - Added the two-phase **migration fidelity gate** (§13) and the **greenfield design process** (§14); reworked §15 around them.
  - Pinned **schema-first** manifest generation (§4.2.1, §11), the media transform/CDN pipeline (§3.4, §6), draft-preview build mode (§3.5, §5), and consent handling (§7).
