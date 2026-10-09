# Website Architecture Standard

**Version 2.0** · 2026-10-09

The rules every Traction website follows. Build to them, and prove them with
[`@traction/site-checks`](./README.md).

- **Do not copy this document into a site repo.** Link to it.
- **Record the version a site is built to** in `site.json` → `standardVersion` (§4.6).
- **Automated rules live in [RULES.md](./RULES.md).** This document does not restate them.
- **Media storage, delivery and video playback live in [MEDIA-STRATEGY.md](./MEDIA-STRATEGY.md).**

## Definition of done

A site is done only when **all** of these hold:

1. It follows the principles (§1).
2. Every route is a `template` + slot content-data file (§3). No page content or layout lives in framework code.
3. It produces a generated `block-manifest.json`, a `templates/` directory and a root `site.json` (§4).
4. It emits the SEO / AEO / GEO outputs (§8).
5. It passes the editor-readiness gate (§4.4).
6. `traction-site check` runs in the `build` script and exits 0 (§11.0).

A pixel-perfect site with hand-coded pages is **not done**.

A green build does not prove these. Prove each one with the check its section names:

- the enquiry pipeline (§7.1.1)
- secrets kept out of globals and bundles (§3.8.1)
- usable array descriptors in the manifest (§4.2.2)
- redirects and the 404 on a real deployment (§3.7.2, §3.7.3)
- video playback on a real iPhone (MEDIA-STRATEGY §4.7)

The defaults (Astro, Vercel, Supabase, Mux) are recommendations. The site must stay portable (§1.6).

---

## 1. Core principles

1. **Content is data, not markup.** Pages are typed blocks, never hand-authored HTML.
2. **The repo is the site; the editor is removable.** The site builds and runs with no editing tool. The editor depends on the site's open contracts, never the reverse.
3. **Tight and small.** Each page ships the minimum HTML, CSS and JS for its design. Default to zero client JS.
4. **AEO / GEO / SEO are native.** Structured data, semantic HTML and machine-readable outputs come from the content model.
5. **Exact fidelity through tokens and components.** Design lives in design tokens and components. Content carries no raw style.
6. **Portable.** Host, database, media services and editor are independent and swappable.

A change that breaks one of these is the wrong change.

---

## 2. Architecture at a glance

```
┌──────────────────────────────────────────────────────────────────┐
│  EDITOR (Pulse) — composes templates · edits content · preview     │
└───────────────┬──────────────────────────────────────────────────┘
                │ writes open files (one-way dependency)
                ▼
┌──────────────────────────────────────────────────────────────────┐
│  GIT REPO = THE SITE (source of truth)                             │
│  /blocks · /templates · /content · /videos (Git LFS) · site.json   │
└───────┬───────────────────────────────────────────┬──────────────┘
        │ on push → build                            │ on push to videos/
        ▼                                            ▼
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ BUILD — static HTML, JSON-LD,│   │ GITHUB ACTION — uploads video │
│ sitemap, llms.txt, checks    │   │ masters to Mux, commits the   │
└───────────────┬──────────────┘   │ video manifest + posters      │
                │ deploy           └──────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────┐
│  HOST (Vercel edge CDN) + serverless functions                     │
│  DB + storage (independent) · video streaming (Mux, HLS)           │
└──────────────────────────────────────────────────────────────────┘
```

The editor edits typed content. Git stores it. The build renders static HTML. The host serves it from the edge. Serverless functions and an independent database handle the few dynamic features. Mux streams video.

---

## 3. The content model

Three tiers:

```
Blocks (code)  →  Templates (data)  →  Pages (data)
```

| Tier | What it is | Owned by |
|---|---|---|
| **Blocks** | Reusable section components (`Hero`, `FAQ`, `CTA`, …) | Developers |
| **Templates** | A fixed arrangement of blocks with named slots | Composed in the editor, saved as data |
| **Pages** | A template choice + the content for its slots | Editors and AI |

A page names its template and fills that template's slots. It cannot invent layout.

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

**Content props** (freely editable):

| Type | Meaning |
|---|---|
| `string` | Plain text |
| `richline` | One line, inline marks only (bold, italic, link) |
| `richtext` | Multi-paragraph prose stored as Markdown (§3.1.1). No images |
| `number` / `boolean` / `url` | Scalars |
| `image` | `{ src, alt, width, height }`. `src` is a repo path under `paths.media`. `alt` is required. `width`/`height` are the file's real intrinsic dimensions, read from the file, never typed. Rendered through the host's image optimization (§3.4). A hotlinked external `src` fails conformance |
| `video` | A string `videos/<name>.mp4` — a master committed to `paths.videos`. The block resolves it to a Mux playback ID and poster through the video manifest (§3.4.2). A `/media/*.mp4` path is legacy and is not allowed on a new site |
| `media` | `{ kind: image \| video \| lottie \| none, … }` |
| `cta` | `{ label, action, href?, target? }` |
| `array<T>` | Ordered, repeatable list |
| `object{…}` | Fixed-shape group |
| `ref<collection>` | Pointer to a collection item |

**Variant props** (presentational) are `enum` only, each `{ options, default }`. There is no raw-style prop type.

**A list drawn from a closed set** is an `array` whose item descriptor carries `options`:

- `options` on a list is advisory. A value outside the list stays valid, is kept on save, and renders nowhere until the thing it names exists.
- The editor shows an unlisted value as present but inert. It never drops it and never shows it as working.
- If a value must be refused, the field is an `enum`.
- The generator fills `options` from the site (for example from `paths.templates`). Never hand-type the list.

**Declare only what you render.** If a block interpolates a prop as plain text, the prop is a `string`, not `richline` or `richtext`. The §4.4 gate checks this.

#### 3.1.1 `richtext` — one Markdown grammar, one renderer

`richtext` is Markdown, rendered by a module the site owns (conventionally `src/lib/markdown.ts`). Treat the content as untrusted.

- **The grammar is an allowlist.** Build it from a zero preset and enable only: paragraphs, `-` and ordered lists, `**bold**`, `*italic*`, `[text](href)`, backslash escapes, entities, hard breaks.
- **Everything else is off.** Raw HTML renders as escaped literal text. Headings, code, blockquotes, tables, images and autolinks are off.
- **No images in prose.** `![](…)` emits no `<img>`. Images are `image` props.
- **Link schemes are an allowlist:** `https:`, `http:`, `mailto:`, `tel:`, site-relative `/…`, in-page `#…`. Reject protocol-relative `//host`. A rejected href renders as inert text.
- **The renderer never rewrites text.** `typographer` and `linkify` are off. Content round-trips byte-identical.
- **The editor previews through the same grammar.** The site and the editor share a committed fixture corpus of input → expected-HTML cases. Both test suites run it.
- **Pin the behaviour with a `test-markdown` script:** raw HTML escapes, image syntax emits no `<img>`, bad schemes render inert, allowed constructs render.

### 3.2 Content, layout and style are separate

| Layer | What it is | Lives in | Who edits |
|---|---|---|---|
| **Content** | Words, images, links | Block JSON props | Editors and AI |
| **Layout** | Arrangement and responsive behaviour | Component + template | Developers |
| **Style** | Colours, type scale, spacing, radii | Design tokens + component CSS | Developers |

- Content never carries a hex code, font size or pixel value.
- A presentational choice is a constrained variant (`theme: light | dark`, `columns: 2 | 3`) that the component maps to tokens.
- Design tokens are one file of CSS custom properties, the only place visual design is defined:

```css
:root {
  --color-accent: …; --color-ink: …; --color-body: …; --color-surface: …;
  --font-heading: …; --font-body: …; --text-body: …;
  --gutter: …; --maxw: …; --maxw-prose: …;
  --radius-pill: …; --radius-card: …;
}
```

### 3.3 Templates

A small fixed set of page designs (typically 6–12). Each is an ordered list of slots (`block`, `optional`, `repeatable`) plus the structured data it emits.

```jsonc
// templates/service-page.json
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

The `slots` order is the only control over render order (§13.2).

### 3.4 Tight and small — what each page ships

- **Per-template CSS** — only the styles for that template's blocks.
- **Per-template JS** — only the islands the template declares. Most pages ship close to zero JS.
- **No dead components** — a page cannot reference a block its template does not declare.
- **Images** go through the host's image optimization: responsive `srcset`, modern formats, explicit `width`/`height`, and `loading="lazy"` below the fold (MEDIA-STRATEGY §3).

Performance rules for every block:

1. **The LCP image is never lazy.** Give the visible hero image (or video poster) `fetchpriority="high"`.
2. **Hidden carousel slides get `fetchpriority="low"`.** Only the visible slide competes with the LCP.
3. **Carousels mount media on demand.** The server HTML carries the first slide's media only. The next slide arms 5 s before the auto-advance. Manual navigation arms its target at once, with the poster covering the gap. An armed slide stays mounted.
4. **Heavy embeds sit behind a facade.** A YouTube or similar player renders as its thumbnail plus a play button. The click swaps in the real iframe with autoplay.
5. **Hydrate only stateful blocks.** A block that needs a small behaviour (a gallery, a form handler, a facade) stays static and attaches it with an inline `<script>`. Use `client:load` only where the block holds state across interactions (a carousel, a filterable grid).
6. **Heavy third-party scripts load after `load`.** Video players, chat and booking widgets start after the window `load` event, in idle time.
7. **Images are WebP or AVIF at display size.** A PNG photo or a source image larger than its largest rendered size is a defect.

#### 3.4.1 Media in the repo has a weight budget

Images are committed content. The budget is declared in `site.json` → `media` (§4.6):

- **Cap the single file** (`maxSourceBytes`, default 1 MB) and the **source width** (`maxSourceWidth`, default 2400 px). An editor offers to downscale an oversized upload. It does not only refuse.
- **Commit one source per picture.** The host's image optimization makes the sizes. Never commit pre-sized copies.
- **Video masters never go in normal git or `public/`.** They go in `videos/` under Git LFS (§3.4.2).
- **Deleting a file reclaims nothing.** Enforce the caps at upload.
- **Do not rewrite git history** to reclaim space.

#### 3.4.2 Video

Video works like images: the master is in the repo, content refers to it by path, and a pipeline publishes it. MEDIA-STRATEGY §4 holds the full rules. The contract:

- **Masters** live in `videos/` (declared as `paths.videos`) and are tracked by Git LFS.
- **Content** refers to a master as `"videos/<name>.mp4"`.
- **A GitHub Action** uploads new or changed masters to Mux. It commits the playback IDs to the video manifest (`paths.videoManifest`) and a first-frame poster to `public/media/video-posters/`.
- **The build gate** (`check-videos`) runs in `build`. It fails when content uses a master that is not on Mux in its current version, or whose poster is missing.
- **The page** paints the poster first and attaches the stream after `load` (MEDIA-STRATEGY §4.6).
- **The host never fetches LFS content.** Vercel's Git LFS setting stays off.

### 3.5 Navigation and menus — derived, not hand-authored

> **Status:** not implemented on any site. Header links are a globals list today. Implement `buildNav` on the next site that needs a menu change, to this section.

A menu is derived from data:

1. **Menu skeleton (globals).** `content/globals.json` → `nav` holds the ordered groups, their labels, any second-level sub-groups (mega-menu columns), any group that is a direct link, and any static or external links. It defines shape, not contents.
2. **Membership (per page, opt-in).** A page joins a menu only by declaring a `nav` entry naming its `group` and, for a mega-menu, its `subgroup`. No entry means no menu.

```jsonc
// content/pages/<slug>.json
{
  "template": "service-page",
  "slug": "seo",
  "status": "published",
  "nav": { "group": "disciplines", "subgroup": "seo", "label": "SEO", "order": 10 },
  "seo": { … }, "content": { … }
}
```

Rules:

- **Two levels.** A group is flat by default. A group with sub-groups is a mega-menu. A leaf with no `subgroup` in such a group renders in an unheaded leading column.
- **Static links** for content outside the build are declared in the skeleton and render ahead of page-derived leaves.
- **Href** comes from the page's `slug`. A `nav.href` overrides it.
- **Sort:** groups in skeleton order. Within a group, by numeric `order` (use sparse values: 10, 20, 30), then by `label`.
- **Empty groups and sub-groups are omitted.**
- **The sort is a pure function** of globals + pages, so the preview matches the build.

| Switch | Field | Off-state |
|---|---|---|
| **Opt-in** | `nav` present? | Not in any menu; still a reachable page |
| **Draft** | `status: "draft"` | Excluded from the production build and from every menu |

Editor requirements:

- `nav` is a typed field. `group` and `subgroup` are enums sourced from the skeleton.
- The skeleton is editable globals.
- A pure `buildNav(globals, pages)` lives with the renderer, so build and editor agree.
- Navigation contributes `SiteNavigationElement` / `BreadcrumbList` where appropriate. Nav labels are not headings.

### 3.6 Collections — repeated content

| Kind | An item is | Declares (§4.6) | Typical |
|---|---|---|---|
| **Routable** | a page that is one of many | `template` **and** `route` | case studies, projects, team members |
| **Data-feed** | a typed record aggregated into another page's slot | `itemSchema` | FAQ answers, testimonials, download cards |

- A collection lives in `/content/collections/<name>/*.json`.
- A routable item is `template` + slot content, exactly like a page.
- A data-feed item is a flat typed record described by an `itemSchema`, emitted into the manifest under `collections`.
- Listings and "related items" rows are computed from the collection. They are never hand-authored slots.
- Every item, of either kind, is described by a schema that reaches the manifest.
- **Never name a template that does not exist.** A collection whose page design is not built yet is data-feed until the template lands.
- **Items are JSON, not MDX.** MDX is only for genuine long-form prose bodies.

### 3.7 Redirects — content, not hosting

- Redirects live in `/content/redirects.json` as `{ from, to, status? }`. The default status is 301. Use 308 where the method must be preserved.
- Write `from` with the trailing slash, in the form the site serves.
- `from` may end in `/*` (a wildcard). `to` may carry one `*` for the captured tail.
- The build emits them as host redirects.
- The editor writes this file. A slug rename offers to create the redirect at that moment.
- **If a site has no redirects file, the editor blocks slug renames** (§4.6).
- **Wiring is a gate item** (§4.4). Prove it on a deployment (§3.7.2).

**On Astro + Vercel:**

1. Pass exact rules to Astro's `redirects` option.
2. In one `astro:build:done` hook, add a companion route `^/<path>/?$` for every exact rule, so both slash forms match.
3. In the same hook, add each wildcard as `^/<prefix>(?:/(.*))?$` with `Location` built from `to` (`*` → `$1`). Astro cannot emit wildcards in a static build.
4. Splice the companions and wildcards before the first `handle` entry: exact rules first, then wildcards.
5. Append the 404 error route (§3.7.3) in the same hook.
6. Read and write `.vercel/output/config.json` once. Two hooks that each rewrite it can discard each other's routes.

#### 3.7.1 The rules live in the checks package

Every rule a redirect list obeys is in [RULES.md](./RULES.md) and runs in `traction-site check`. Do not re-implement them in a site.

#### 3.7.2 Prove one redirect on a real deployment

Request an old path on the deployed site. Confirm a **301 to the new path**.

- Preview URLs sit behind Vercel's access protection, which 302s anonymous requests to a login page. Test through an authenticated session, or on production straight after the deploy.

#### 3.7.3 The 404 page

1. **The page.** An ordinary content page: `content/pages/404.json` + a small template. The generator emits top-level `404.html`.
2. **`seo.noIndex: true`** on the 404 page, so it stays out of the sitemap and carries a robots `noindex`.
3. **The host route.** Vercel does not serve `404.html` by itself. Append the error phase in the build hook:

```jsonc
// .vercel/output/config.json
{ "handle": "error" },
{ "src": "/.*", "status": 404, "dest": "/404.html" }
```

- **Keep the status 404.** Never redirect unknown URLs to the home page.
- **Verify on a deployment.** Request a path that cannot exist. Confirm the branded page and status 404.

### 3.8 Globals — site-wide singletons

Values that are identical on every page live once in `content/globals.json`. Blocks read them from globals. They are never copied into a page's content.

Globals hold:

- site name, site URL, legal entity, default locale
- contact details (phone, email, address) and social profiles (`sameAs`)
- brand assets: logo, **favicon** (`brand.favicon`), default OG image
- the nav and footer skeleton (§3.5)
- analytics IDs (§7.2)
- enquiry recipient and sender, and the enquiry confirmation copy (§7.1)

Rules:

- **If changing it should change it everywhere, it is a global.** If it varies per page, it is content.
- **No block has a content prop that duplicates a global.** A page copy silently overrides the global.
- **A deliberate per-page override** is an explicit, documented page field.
- **Derived values are computed in code** from the single global: a `tel:` href from the phone, an absolute logo URL for JSON-LD, the hostnames in `security.allowedDomains` (§7.1).
- **Copy with placeholders** (`{email}`, `{phone}`, `{phoneDisplay}`) is rendered as parts, so the placeholders become real `mailto:` / `tel:` links.
- **The favicon** renders from `brand.favicon` in the base layout. Empty renders no `<link rel="icon">`. An SVG favicon gets `type="image/svg+xml"`.
- **Audit components for hardcoded site-wide literals** (site name, phone, `og:site_name`) and point them at globals.

#### 3.8.1 Globals are public — never put a secret in them

Globals are committed, editable by anyone with content access, and reach the browser when a hydrated island imports them.

| Kind of value | Example | Lives in |
|---|---|---|
| Editable, public | notify address, sender address, phone, social URLs | `globals.json` |
| Editable, private | none — a secret is not editable content | — |
| Secret | API keys, tokens, webhook secrets, DB URLs | Host environment variables |

- An enquiry pipeline keeps recipient and sender in globals and the API key in the environment. Put a one-line comment saying so at the point of use.
- **`import.meta.env.X` is inlined at build time.** Gate dev-only reads behind `import.meta.env.DEV`.
- **Grep the build for every secret's value** before launch, client and server:

```bash
npm run build && grep -rl "$SECRET_VALUE" dist/ .vercel/ && echo "LEAKED" || echo "clean"
```

### 3.9 Hidden blocks

The editor hides a block without deleting its content:

- `hidden: true` on a **template slot** hides it on every page that uses the template.
- `hiddenSlots: ["<slot>"]` on a **page** hides it on that page only.

Rules:

- **One render path honours both.** `renderPage` takes the whole page, not only its content.
- **Structured data honours both.** A hidden slot contributes nothing to JSON-LD.
- **The `hiddenBlocks` check** in `traction-site check` proves it on the built output.

---

## 4. The build stack and the contracts

### 4.1 Stack

- **Astro** (static output, islands) for the build. Add the Vercel adapter for on-demand routes.
- **Blocks are React components**, aliased to Preact at build time where it keeps islands small.
- **Styling:** design tokens + per-component CSS. No inline styles in content.
- **Interactivity:** static blocks attach small behaviours with an inline `<script>` (§3.4 rule 5). Only stateful blocks hydrate.

### 4.2 The three contracts

1. **Block manifest.** A machine-readable description of every block: slots, content props, variant enums. Each block declares one Zod schema. The manifest entry, the TypeScript prop types and runtime validation are all derived from it.
2. **File format.** Open JSON for templates, pages, collection items and globals. MDX only for genuine long-form prose.
3. **Renderer package.** `renderPage(page)` with a block registry. Optional for the editor (§5).

#### 4.2.1 Schema-first generation

A script generates `block-manifest.json` from the schemas. Never edit it by hand. The script fails loudly when it produces nothing useful (§4.4.1).

#### 4.2.2 Manifest field rules

The manifest is read by a tool that has only the manifest.

1. **Emit `required: true|false` on every prop.** One dialect only. (A reader still normalises `optional === true || required === false || "default" in spec`.)
2. **Every array declares a complete, usable `of`, recursively.** An object item names its own `props`. Every item descriptor has a `type` the editor renders. Nested arrays are validated the same way. `of: { type: "object" }` with no `props` fails.
3. **Bounds are real.** `min`/`max` come from what the layout requires, never from the seed content. State `max` only for a fixed layout (a 4-tile grid: `min: 4, max: 4`).
4. **Every prop has a human `label`**, including nested props and array item descriptors.
5. **Defaults survive generation.** Every `.default()` in a schema appears as `default` in the manifest.

**Editor corollary:** a blocked save names the field and the reason.

### 4.3 The data-driven render path

```
blocks = template.slots
  .filter(slot => !slot.hidden && !page.hiddenSlots?.includes(slot.name))
  .map(slot => ({ type: slot.block, props: page.content[slot.name] }))
renderPage → registry[block.type] → component → static HTML
```

Confirm on each new site that this still splits to minimal per-page bundles.

### 4.4 Editor-readiness gate

A build is editor-ready only when **all** of these hold:

- **`traction-site check` runs in `build` and passes** (§11.0).
- **The block manifest exists, is generated** (§4.2.1), and lists every block a template can use.
- **The generator fails loudly** on the conditions in §4.4.1, and does not write on failure.
- **Every route is content-data.** Each page is a `template` + slot `content` file under `paths.pages`, or a routable collection item. No route renders content or layout from framework code.
- **Every collection item is described** — a `template` if routable, an `itemSchema` if data-feed — and that description reaches the manifest.
- **Templates are data** in `paths.templates`.
- **One render path** turns a page into HTML.
- **`site.json` exists** (§4.6), records `standardVersion`, and names every path and collection.
- **The loop is proven:** edit → commit → build → live on one real page, and the editor's readiness check is green.
- **Redirects are wired and proven** (§3.7, §3.7.2).
- **The 404 is branded, editable, noindexed and served** (§3.7.3).
- **Rich props render as declared** (§3.1, §3.1.1), and `test-markdown` passes.
- **The per-page `seo` object is consumed** (§8.1).
- **Hidden blocks are honoured** (§3.9).
- **Video masters are on Mux** — `check-videos` runs in `build` and passes (§3.4.2). Required when the site has video.
- **Author-complete** (§4.5).

Run this gate per template, alongside the fidelity gate (§13, §14). A pixel-perfect hand-coded template fails.

#### 4.4.1 The generator must not fail silently

The manifest generator checks its own output before writing. It exits non-zero on any of these:

| Check | Catches |
|---|---|
| Zero blocks described | A scan that matched nothing (wrong directory, extension or glob) |
| Any block file skipped | A load or parse failure |
| A template slot's block undescribed | A page the editor cannot edit |
| A template slot's block not in the block registry | A section dropped from a live page |
| A file in `/templates` not in the template registry | A page that renders header and footer and nothing between |
| An array prop whose `of` is missing or unusable | An editor that guesses and destroys data, or shows the list read-only (§4.2.2) |
| A prop without a `label`, including an array item descriptor | Raw keys shown to the author |
| A collection declaring neither `template` nor `itemSchema`, or one that does not resolve | Items editable nowhere |

- Name the offending blocks or props in the message.
- **Never write the output file on failure.**
- **Exit non-zero on any thrown error.** `main().catch(console.error)` exits 0. Use `main().catch(e => { console.error(e); process.exit(1); })`.
- **Test the checks.** Mutate the input, confirm a non-zero exit that names the offender, and confirm no file was written.

### 4.5 Authoring robustness

Build every block and route for the content the editor will create, not the seed content.

1. **The editor can add pages.** A generic catch-all route turns any `content/pages/*.json` into a page.
2. **Array cardinality is declared and handled.** Every array or repeatable slot declares real bounds, and the block renders any count in range. A fixed layout sets `min == max` and still guards against bad data.
3. **Every block renders any schema-valid content.** Cleared optionals, empty arrays and missing images give a sensible empty state, never a broken tag or a crash.
4. **The manifest carries editor affordances:** label, help text, default, order/group, required.
5. **One field, not per-breakpoint variants.** A `*Mobile` content variant is a justified exception.
6. **The image upload loop is proven** on one real block before launch: editor upload → committed under `paths.media` → host optimization → responsive image on the page.
7. **The video loop is proven** on one real block before launch: master committed to `paths.videos` → Action uploads to Mux → manifest and poster committed → stream plays on the page (MEDIA-STRATEGY §5).

### 4.6 The site descriptor — `site.json`

Every site ships `site.json` at the repo root. It names the site's own structure. Tools read it first and use it verbatim.

```jsonc
// site.json
{
  "standardVersion": "2.0",
  "name": "Example Site",
  "paths": {
    "blockManifest": "block-manifest.json",
    "templates": "templates",
    "pages": "content/pages",
    "globals": "content/globals.json",
    "redirects": "content/redirects.json",
    "media": "public/images",
    "videos": "videos",
    "videoManifest": "src/data/video-manifest.json",
    "tokens": "styles/tokens.css"
  },
  "media": {
    "storage": "repo",
    "transform": "host-image-optimization",
    "maxSourceBytes": 1048576,
    "maxSourceWidth": 2400,
    "video": { "storage": "repo-lfs", "delivery": "mux" }
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

That example is §9's canonical layout. Copy it.

A site deviates only where a real constraint forces it, per path. For example, an Astro project whose pages must sit under `src/content/` for the content-collections loader:

```jsonc
"paths": {
  "pages": "src/content/pages",
  "globals": "src/content/globals.json",
  "redirects": "content/redirects.json",   // NOT moved — no loader reads it
  "tokens": "src/styles/tokens.css"
}
```

Rules:

- **Every path is repo-relative and required if the feature exists.**
- **Omit `redirects` only if the site has no redirects file.** Slug renames are then blocked (§3.7).
- **`paths.media` is required.** It is the only directory an editor may write images into, and it bounds the editor's path-safety check.
- **`paths.videos` and `paths.videoManifest` are required when the site has video.** `paths.videos` is the only directory an editor may write video masters into.
- **The `media` block** declares how media is handled: `storage`, `transform`, `maxSourceBytes`, `maxSourceWidth`, and `video`. An editor states the limits before an upload.
- **Collections are declared explicitly**, with `template` + `route` (routable) or `itemSchema` (data-feed).
- **A declared `template` exists in `paths.templates`; a declared `itemSchema` is exported by the site's schema module.**
- **`standardVersion` is recorded here.**
- **A tool reads the descriptor; it does not hardcode defaults.** A declared path missing on disk is an error. Only an undeclared path is an absent feature.
- **Deviation is per path and needs a constraint, not a preference.**

---

## 5. Editor integration

The reference editor is **Pulse**. The site never depends on the editor.

- **Git is the source of truth.** The editor publishes content as files to the repo.
- **The editor reads the block manifest** and `site.json`, edits content against the typed schema, and saves open files.
- **Preview is the site's own branch build.** Saving opens a branch and PR. The host builds it. That deployment is the preview.
- **A shared renderer is optional.** Without it the editor shows a structural preview from the manifest and uses the branch build for sign-off.
- **Preview builds include drafts** through a build flag (for example `INCLUDE_DRAFTS`). Production excludes them. Otherwise preview output equals production.
- **The editor writes git through a small backend** holding a git-provider token (a GitHub App).
- **The editor writes video masters through Git LFS** into `paths.videos` (MEDIA-STRATEGY §5).

The AI editing loop:

```
1. The user asks the editor for a change.
2. The editor AI loads the page's typed block data.
3. The AI proposes block-level changes.
4. The schema validates them; the editor shows a diff and preview.
5. A human approves.
6. The editor commits to git → build → live.
```

Composing templates from existing blocks is an editor task. A new block type is a code change: a component plus a schema, which then appears in the editor.

---

## 6. Infrastructure

| Layer | Default | Role |
|---|---|---|
| Static hosting + CDN | **Vercel** | Edge HTML; a preview deployment per PR |
| Serverless functions | **Vercel Functions** | Forms, data capture |
| Database | **Postgres** (Supabase or Neon) | Submissions, experiments, events |
| Object store | **Vercel Blob** (private, per site) | Enquiry records (§7.1) |
| Images | **The repo** + Vercel Image Optimization | MEDIA-STRATEGY §3 |
| Video masters | **The repo, under Git LFS** | MEDIA-STRATEGY §4 |
| Video delivery | **Mux** (via the Vercel Marketplace) | HLS streaming, posters |
| Video publishing | **GitHub Actions** | Uploads masters to Mux |
| Build / CI | **Vercel, git-connected** | Build on push; promote on merge |

Rules:

- **The database is an independent service.** Leaving the host moves a connection string, not data.
- **One CDN.** Do not put a second proxy in front of the host. Keep DNS in DNS-only mode.
- **The host adapter is swappable** by config.
- **The repo is the whole site.** Every master, image and content file needed to rebuild the site is in it.
- **The GitHub org plan covers LFS storage** for the video masters (GitHub Team: 250 GB).

---

## 7. Dynamic features

Anything stateful is **a serverless function + a database table or store**.

| Feature | Pattern |
|---|---|
| **Forms** | Native form → function → store (+ CRM server-side), or a hosted form (§7.1.2) |
| **Attribution capture** | Client captures → posts to a function → DB |
| **A/B testing** | Client-side deterministic bucketing on a visitor cookie; a function records events; a scheduled job decides |
| **Third-party tags** | Through the tag manager only (§7.2) |
| **Booking / chat embeds** | Loaded on interaction or idle |
| **Sliders, animation** | CSS or a small island; no heavy libraries |

**Consent:** non-essential tags fire only after consent where the jurisdiction requires it. Record each site's consent decision.

### 7.1 Forms and enquiries — native pipeline

A native `<form method="POST">` posts to an on-demand route (`prerender = false`; needs the host adapter):

```
form POST → route
              ├─ notify the studio  (transactional email, HTTP API)
              └─ append a record    (private object store)
            → 303 → /contact/success/   (either path succeeded)
            → 303 → /contact/problem/   (both failed)
```

Rules:

1. **Run both paths concurrently. Success is either path succeeding.**
2. **Never trust an HTTP 200 from an email provider.** Parse the body (SMTP2GO: `data.succeeded`, `data.failed`, `data.failures[]`). Anything but a confirmed success is a failure.
3. **Use the provider's HTTP send API, not SMTP.**
4. **Give every outbound call a timeout** (about 10 s).
5. **Send from a domain we control and have verified.** Set `reply_to` to the enquirer.
6. **Ship a real failure page** with the studio's phone and email. Never redirect to `?error=1`.
7. **Recipient and sender live in globals; the API key lives in the environment** (§3.8.1).
8. **One private store per site, connected to that site's project only.** Path prefixes are not a security boundary.
9. **Stamp the site into every record.**
10. **Create the store private and in the nearest region.** Access mode and region cannot change later.
11. **One immutable JSON per submission**, named `<ISO-timestamp>-<random>.json`. A duplicate name throws.
12. **Add a honeypot field.** A filled honeypot gets the normal success redirect, and nothing is sent or stored.
13. **Attribution is real or absent.** Use a hidden field or the `Referer` header, never the endpoint's own URL.
14. **Pin the store SDK major** to the version the sister sites run.
15. **List every serving hostname in Astro's `security.allowedDomains`:** the production host and its `www.` variant (derived from `globals.site.url`), and `**.vercel.app` for previews. Otherwise every POST answers 403 "Cross-site POST form submissions are forbidden" on Vercel. A domain change in globals needs a redeploy.
16. **Answer in place, with progressive enhancement.** An inline script submits with `fetch` and `Accept: application/json`. The endpoint returns JSON for that header and the 303 otherwise. On success the form is replaced by the confirmation copy from globals. On failure the form keeps the visitor's input and shows the error in place. Without JavaScript the native POST and redirects still work.

#### 7.1.1 Proving it

Before launch, for each site:

- [ ] **POST a real enquiry** and confirm the success response (303 or in-place message).
- [ ] **Read the record back** from the store and check every field, including `site` and the timestamp.
- [ ] **Delete the test record.** Confirm the store is empty again.
- [ ] **Send one live email** with the production key. Confirm it arrives.
- [ ] **Exercise the failure paths:** an invalid submission and a honeypot submission store nothing; with the email provider misconfigured, a submission still succeeds and still lands in the store.

A test against a deployed site writes to the production store. Use the honeypot field for smoke tests, or delete the record afterwards.

#### 7.1.2 Hosted forms (HubSpot)

A site can use a hosted CRM form instead of §7.1. Rules:

- **Render the embed markup in the server HTML**, so the loader runs on page load and mounts the form.
- **The form ID is a content prop** on the block (with a sensible default). Portal ID and region are shared settings.
- **Each form posts to its own thank-you page.** Thank-you pages are ordinary content pages with `seo.noIndex: true`.
- **Configure the post-submit redirect in the HubSpot form settings.** Do not add a site-side submission listener.
- **HubSpot's inline thank-you message is the fallback.**
- **Prove it:** submit once on a deployment and confirm the redirect and the record in HubSpot.

### 7.2 Tag manager

Every site gets a tag manager. It is the only route for third-party tags.

```jsonc
// content/globals.json
"analytics": {
  "gtmContainerId": "",      // e.g. "GTM-XXXXXXX"; empty renders nothing
  "serverContainerUrl": ""   // optional first-party transport; §7.2.1
}
```

Rules:

1. **Globals hold the container ID, never tag code.**
2. **Validate the ID** against `/^GTM-[A-Z0-9]{4,12}$/`. Reject and warn on anything else.
3. **Two positions:** the loader as high in `<head>` as possible; the `<noscript>` iframe as the first element in `<body>`. Render both from one component.
4. **Inject in the shared layout only.** Prove coverage by counting: build with a test ID and confirm it is in every HTML file.
5. **Empty renders nothing.**
6. **Consent** is enforced in the tag manager's consent mode where required.
7. **One analytics property per measurement need.** The container never loads a duplicate or legacy GA4 property. Every extra tag adds blocking time.

#### 7.2.1 First-party transport

- Build in `serverContainerUrl` from day one and leave it empty.
- A value must be an `https` origin with no path. On anything else, warn and use the vendor endpoint.
- Adopt it only with evidence: a material Safari share and attribution that is measurably lost. Do one site first and compare.
- Do not adopt it to evade ad blockers.

---

## 8. SEO / AEO / GEO

- **JSON-LD from the content model.** Each template declares its schema types. Each block contributes its part. Exactly one of each singleton entity per page. `BreadcrumbList` on every page. `Organization` has a stable `@id` that other entities reference.
- **Semantic HTML.** Exactly one `<h1>` per page. A page with no visible heading (a full-bleed listing) gets a visually hidden (`sr-only`) `<h1>`. Nav labels are not headings. Use `<main>`, `<article>`, `<nav>`.
- **`llms.txt`** at the root, generated at build.
- **Per-page metadata, canonical, OpenGraph/Twitter, XML sitemap, RSS** from the `seo` object (§8.1).
- **The sitemap lists indexable pages only.** Pages with `seo.noIndex: true` (404, thank-you pages, backups) are excluded.
- **Titles follow one pattern per collection** (for example `Project name, location | Brand`) and stay within 60 characters.
- **Descriptions are unique per page**, 110–160 characters. No shared boilerplate across collection items.
- **Performance budget** (§8.2).

### 8.1 The per-page `seo` object

Every page and collection item carries its metadata at the page root, beside `content`:

```jsonc
{
  "template": "case-study",
  "seo": {
    "title": "…",          // <title> + og:title. Required to publish.
    "description": "…",    // meta description + og:description. Required to publish.
    "ogImage": { "src": "…", "alt": "…", "width": 1200, "height": 630 },  // optional
    "canonical": "…",      // optional
    "noIndex": false        // optional
  },
  "content": { … }
}
```

- **The base layout consumes every key.** A site that does not support a key does not declare it.
- **Declare the `seo` type once** (for example `src/lib/seo.ts`). Every route imports it and passes every key to the layout. No route re-spells the shape inline.
- **`noIndex` acts in both places:** the page's robots meta and the sitemap.
- **`title` and `description` block publish. Length limits only warn.**
- **Editors preserve unknown `seo` keys** on save.
- **`ogImage` is a full `image` prop**, dimensions included.
- **`seo.description` also feeds the page's structured data** where the entity has a description.

### 8.2 Performance budget and measurement

Budget, enforced in CI: Lighthouse mobile ≥ 95, LCP < 1.5 s, TBT < 150 ms, CLS < 0.1.

Measure like this:

- **Compare against the base branch on the same machine,** in the same session. A single absolute score is not evidence.
- **Run Lighthouse as a library through Playwright with `channel: 'msedge'`** (or Chrome). Playwright's bundled Chromium has no H.264 and cannot play MP4 or HLS video.
- **Read observed LCP, not only the simulated value.** Mobile LCP in Lighthouse is a Lantern estimate.
- **GTmetrix does not throttle the CPU.** Use it for page weight and waterfall, not for TBT on phones.
- **Report data cost for video pages:** bytes transferred over a fixed watch time.

---

## 9. Canonical repository structure

```
/repo
  site.json                  # the site's own layout + standardVersion (§4.6)
  site-checks.config.json    # declared exceptions for traction-site check (§11.0)
  /blocks                    # React components — the block vocabulary
  block-manifest.json        # generated from the block schemas
  /templates                 # template definitions (data)
  /content
    globals.json             # site details, brand, nav skeleton, analytics, enquiry copy (§3.8)
    redirects.json           # { from, to, status } (§3.7)
    /pages/*.json            # template + slot content (+ nav, seo, hiddenSlots)
    /collections/<name>/*.json
  /videos/*.mp4              # video masters, Git LFS (§3.4.2)
  /src/data/video-manifest.json   # generated by the video Action — never hand-edit
  /public/media/video-posters/    # generated first-frame posters
  /renderer                  # renderPage + block registry
  /styles/tokens.css         # design tokens — the only place style is defined
  /scripts                   # generators and checks (manifest, check-videos, sync-videos)
  /.github/workflows/sync-videos.yml
  .gitattributes             # videos/*.mp4 filter=lfs diff=lfs merge=lfs -text
  astro.config.mjs + build
```

The editor appears nowhere in it.

---

## 10. Extending the system

- **Add a block:** a React component + its Zod schema. Regenerate the manifest. It appears in the editor.
- **Add a template:** compose existing blocks in the editor. It saves to `/templates`.
- **Add a page:** pick a template and fill its slots.
- **Add a video:** commit the master to `videos/`, push, wait for the Action's commit, then point content at `videos/<name>.mp4` (MEDIA-STRATEGY §4).
- **Rebrand:** change tokens or one component.

---

## 11. Conventions and validation

### 11.0 Install the checks; do not re-derive them

`@traction/site-checks` runs this document's gate items. [RULES.md](./RULES.md) is the source of truth for them.

```jsonc
// package.json
"devDependencies": { "@traction/site-checks": "github:traction-marketing-nz/traction-website-standard-checks#vX.Y.Z" },
"scripts": { "build": "astro build && traction-site check" }
```

- **Pin a release tag** from the package's releases. On pnpm use `pnpm add -D`.
- **It exits non-zero and stops the deploy.** It reads the built output.
- **Declare per-site exceptions in `site-checks.config.json`, each with a reason.** The loader refuses an exception without one and prints every exception on every run.
- **Errors block; warnings do not.** Clean a warning rule up, then promote it so it blocks.
- **An emitter and its checker never share one copy of a rule.** The checker reads the built output.
- **Site-specific gates chain into `build` too** (for example `check-videos`, `test-markdown`, `test-seo`).

### 11.1 Everything else

- **Validation:** Zod schemas validate content in the editor and in the build.
- **No inline styles in content.**
- **Accessibility:**
  - every input has a `<label>`; visible focus states; semantic landmarks; ARIA labels on icon-only controls; mobile-first layout.
  - **Every auto-advancing carousel has a pause/play control.** It flips its icon and accessible name, and works with Tab, Enter and Space.
  - **Content sliders advance no faster than every 7 s.**
  - Ambient video honours `prefers-reduced-motion` (MEDIA-STRATEGY §4.6).
- **Localisation is configuration** — language, spelling, currency, date format per site.
- **Small components; pure functions in `lib`.**
- **Record architectural decisions** in the site's README or an ADR.

---

## 12. New-site quick start

For a migration, run this with the §13 gate. For a new design, run it with §14.

1. **Scaffold** the Astro project with the Vercel adapter and an independent database. **Install `@traction/site-checks` and wire it into `build` now** (§11.0).
2. **Establish tokens.**
3. **Build the core blocks** for the first template, then the rest.
4. **Define templates.** Map every page to one.
5. **Author content** as template + slot data.
6. **Wire dynamic features:** the enquiry pipeline (§7.1 or §7.1.2) with `security.allowedDomains`, and the tag manager (§7.2). Create the private, in-region store now.
7. **Set up video** if the site has any (MEDIA-STRATEGY §4): LFS, the Mux environment, the GitHub secrets, the Action and the build gate.
8. **Generate SEO/AEO/GEO outputs** from the model.
9. **Wire the 404 page and redirects** (§3.7, §3.7.3).
10. **Write `site.json`** (§4.6).
11. **Prove the render splits per page and the editor ↔ git ↔ preview loop** on one page. Then pass the editor-readiness gate (§4.4).

---

## 13. Migration — the two-phase fidelity gate

Use this when a new site must match an existing live site. Fidelity is a per-template gate.

**A template is done only when it passes both phases at every breakpoint, and the editor-readiness gate (§4.4).**

- **Phase 1 — visual diff (`compare.mjs`):** per-section pixel-diff < 10% at every breakpoint.
- **Phase 2 — structural audit (`audit.mjs`):** a manifest extracted from the source, asserted against the rebuild.

`compare.mjs` and `audit.mjs` are reference names. Any Playwright + pixelmatch harness and DOM-manifest extractor that does the same satisfies the gate.

- **Extract the source's structure first, build to it, then diff.** Do not build from a screenshot.
- **Fidelity is not conformance.** A matching site with hand-coded pages fails.
- **Prove a supposedly inert change by diffing the built CSS/HTML** against the base branch. Tailwind v4 scans `.mjs` and `.astro` content, so a class name inside a comment emits CSS.

### 13.0 Migration protocol

| # | Phase | Enters when | Leaves when |
|---|---|---|---|
| 0 | **Intake** | The job starts | The six questions are answered and recorded |
| 1 | **Source audit** (§13.1) | Intake done | `source-audit/<template>.json` exists per template |
| 2 | **Tokens** | Audit done | `tokens.css` extracted and approved |
| 3 | **Blocks** | Tokens done | The template's blocks exist, schema-first |
| 4 | **Templates** | Blocks done | `templates/*.json` with slot order verified (§13.2) |
| 5 | **Build + content** | Templates done | Pages are content-data; both gates pass per template |
| 6 | **Launch gate** | All templates signed off | Every §15 item done |

**`migration-state.json`** holds the `standardVersion`, the source URL, the intake answers and each template's phase. Every session reads it first. Never re-ask an answered Phase 0 question.

#### 13.0.1 Phase 0 — the six intake questions

1. **Source URL** — the exact live site and environment.
2. **Scope** — templates in and explicitly out.
3. **Intentional deviations** from the source.
4. **Known gaps** on the source that need not be reproduced.
5. **Deployment target** — host, domain, and whether it replaces a live site.
6. **Mobile breakpoint** — default 375 px.

### 13.1 Phase 1 — source audit

Produce `source-audit/<template>.json` per template before building it:

- **Section inventory**, numbered top to bottom. This is the slot order.
- **Widget type** — carousel, grid, tabs or accordion — detected, not assumed. Count the slides of a carousel after it finishes loading.
- **Heading style matrix** from `getComputedStyle`.
- **Mobile notes** at the agreed breakpoint.
- **Global elements** — logo `href`, nav targets, footer links, social hrefs.
- **Source media** — the original files for every image and video (ask the client for video masters at this point, MEDIA-STRATEGY §4.2).

#### 13.1.1 Extract ground truth — never eyeball

Pull the source's computed values and match them exactly:

- colour, `font-size`, `font-weight`, `line-height`, `letter-spacing` per element
- element geometry (bounding boxes)
- section padding, container max-width, column gaps, full-bleed or contained

Before marking a section done, run `getComputedStyle` on the same element on source and rebuild, and compare the values.

### 13.2 Template slot order

The `slots` array order is the only control over render order. Page JSON key order is irrelevant. Verify slot order against the section inventory before building.

### 13.3 The visual harness (`compare.mjs`)

For each breakpoint (mobile, tablet, desktop, wide):

- Render source and rebuild at the real viewport. Load the source directly, not in an iframe.
- **Isolate each section:** align on the section's top edge and clip the capture to the section's height.
- Produce a diff image and a % per section.

Loop: build the section → compare → read the diff image (concentrated red is a defect, scattered red is noise) → extract the source's computed values → fix tokens or the component → repeat until < 10%.

### 13.4 Known visual-diff floors

These cannot reliably reach the threshold. Match them as closely as the structure allows, check them once by eye, and rely on Phase 2:

- **Photographic backgrounds** (about 10–15% floor).
- **Auto-advancing carousels** — the captured slide is arbitrary.
- **Lottie and video** — hide them on both sides for the static diff. Verify motion separately.

### 13.5 Phase 2 — the structural audit (`audit.mjs`)

Locate each section on both sites by a shared text anchor (the most specific element). Assert:

| Check | Catches |
|---|---|
| **Section inventory** (count, order, headings) | A missing section |
| **Asset parity** (every source image basename is referenced) | Swapped or missing assets |
| **Background colour** per section | A wrong surface colour |
| **Component type** (static, carousel, tabs) | A carousel built as a grid, or the reverse |
| **Slide / item count** | Wrong counts |
| **Element counts** (informational) | Content gaps |

Record intentional improvements in an allowlist. They report as notes. Everything else is a failure.

### 13.6 Acceptance criteria

- **Every breakpoint passes**, including a 375 px pass of the hero, the first section below it and the nav collapse.
- **Phase 1:** each section < 10%, except documented floors, which are visually signed off.
- **Phase 2:** no structural issues.
- **Slot order verified** before build.
- **Global elements verified** against `globals.json` and in the browser.
- **Side-by-side, diff images and the audit report kept** per template.
- **Editor-ready (§4.4).**

---

## 14. New design — the greenfield process

Use this when there is no existing site. The pipeline and gates are the same. The reference is an approved design.

| | Migration (§13) | Greenfield (§14) |
|---|---|---|
| Source of truth | the live site | an approved design artifact |
| Visual gate | < 10% pixel-diff | about 15–20% (intent) |
| Quality gates | inherited | added explicitly |

Do not pixel-chase an AI-generated mock to 100%.

### 14.1 The design funnel

1. **Diverge** — several directions with claude.ai/design (or the `frontend-design` plugin), mobile and desktop for key screens.
2. **Decide** — lock one direction with the stakeholder.
3. **Hand off** (§14.2).
4. **Build** — blocks → templates → pages, token-driven.
5. **Gate** (§14.3).

### 14.2 The handoff — design artifact to coding system

Nothing enters the build until these three exist:

1. **Design tokens → `tokens.css`** — palette, type scale, spacing, radii, shadow, motion.
2. **Block and template decomposition** — reusable blocks and a deliberate template set.
3. **Reference renders** — the chosen mock as rendered HTML, per template, per breakpoint. `compare.mjs` diffs against these.

### 14.3 The greenfield gate

- **Visual** against the reference renders: about 15–20%.
- **Quality:**
  - token conformance — no off-token colours or spacing
  - accessibility — contrast, structure, keyboard paths, focus order
  - responsive correctness at every breakpoint
  - performance budget (§8.2), mobile and desktop
  - SEO and structured data — one entity per page

### 14.4 Acceptance criteria

- Tokens, block list and reference renders approved before build.
- Visual diff within threshold at every breakpoint.
- All quality gates pass.
- Editor-readiness (§4.4) passes.
- Records kept per template.

---

## 15. Launch checklist

A new-design site skips the migration-only items: the 301 map, parallel data capture and DNS rollback.

**Fidelity and editing**

- [ ] Every template passed both fidelity phases (§13) or the greenfield gate (§14) at every breakpoint, including 375 px.
- [ ] Slot order verified against the source inventory (§13.2).
- [ ] Global elements verified: logo `href`, nav links, footer links, social hrefs.
- [ ] Editor-readiness gate passes (§4.4).
- [ ] `compare.mjs` and `audit.mjs` records kept per template.

**Build gates**

- [ ] `traction-site check` is in the `build` script and exits 0 (§11.0).
- [ ] Rich text proven (§3.1.1): `test-markdown` passes; bold, a list and a link render on a deployment.
- [ ] Per-page SEO consumed (§8.1): a page's `seo.title` and `description` appear in the built `<head>`.
- [ ] No secret in `globals.json` or in the built output (§3.8.1).

**On a deployment**

- [ ] Redirects proven (§3.7.2): a real old path returns a 301 to the right place, in both slash forms.
- [ ] Every old URL has a 301, built from a full crawl of the old site (sitemap plus link-following).
- [ ] Branded 404 served with status 404, and absent from the sitemap (§3.7.3).
- [ ] Enquiry pipeline proven (§7.1.1), or the hosted form proven (§7.1.2).
- [ ] Enquiry store is private, in-region and dedicated to this site.
- [ ] `security.allowedDomains` lists the production host, its `www.` variant and `**.vercel.app` (§7.1 rule 15).
- [ ] Tag manager wired (§7.2): the container ID is in every built HTML file; no duplicate GA4 property; consent decision recorded.
- [ ] Favicon set in `brand.favicon` and served (§3.8).
- [ ] Structured data validates; one of each singleton entity per page.
- [ ] Sitemap submitted; canonicals correct; noindexed pages absent from the sitemap.
- [ ] Performance budget measured against the base branch (§8.2), mobile and desktop.

**Video** (when the site has video — MEDIA-STRATEGY §4)

- [ ] Masters committed to `videos/` under LFS; Vercel Git LFS off.
- [ ] The sync Action has run green on `main`/`master`; every master is in the manifest with a poster.
- [ ] `check-videos` is in the `build` script.
- [ ] Hero videos play on a real iPhone, on first load, on every slide.
- [ ] No `/media/*.mp4` file is still referenced by content.

**Cutover** (replacement sites)

- [ ] Forms run in parallel with the old system during cutover.
- [ ] DNS points at the host in single-CDN mode; SSL valid.
- [ ] Rollback path (DNS flip) confirmed until the old site is decommissioned.
