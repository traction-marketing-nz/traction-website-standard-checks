# The rules

**This file is the source of truth.** The Website Architecture Standard points here rather than restating any of it — a rule written in two places drifts, and it did: the standard's rule table said "two rules" while listing four, and its list and this package's list disagreed within hours of each other.

Each rule below says what it refuses, and **why** — the failure it was written after. The reason matters more than the rule. A rule with no recorded reason is one somebody deletes the first time it is inconvenient, and every one of these was inconvenient to somebody once.

---

## `redirectList` — is this a legal set of rules?

Reads `content/redirects.json` alone; needs no build.

| Refuses | Why |
|---|---|
| **A self-reference** (`from` = `to`) | An infinite redirect. The browser gives up with `ERR_TOO_MANY_REDIRECTS` and that URL is simply *gone*. One site's file contained exactly this against a real, working route — harmless only for as long as the file was unwired, and it would have taken that section down the moment the wiring landed. |
| **A chain or cycle** (one rule's `from` is another's `to`) | Search engines dilute ranking across hops, and a second rename closes a chain into a cycle. Easy to create by renaming the same page twice — exactly what an editor makes easy. |
| **A duplicate source** | Two destinations for one URL; which one wins depends on emission order, which no author can see. `/a` and `/a/` count as the same source, because they are the same URL. |
| **A source that is not site-relative**, or a destination that is neither site-relative nor `https://` | A redirect to `http://` downgrades the visitor's connection. A relative source silently never matches. |
| **A status outside 301/302/307/308** | A 301 is the only one that transfers ranking, which is usually the point; the others are legitimate but deliberate. Anything else is a typo. |
| **A control character in either field** | The destination becomes a `Location` header. A newline in a header is an injection vector, and never something an author meant. |
| **A protocol-relative destination** (`//evil.test/x`) | Starts with a slash, so a naive "is it site-relative" test passes it, while it sends the visitor to another origin entirely. An **open redirect** — the one rule here that is a security control rather than a quality one. |
| **A `$` in the destination** | The host reads it as a capture-group reference and rewrites the URL, so the visitor lands somewhere nobody wrote. |
| **A path traversal** (`..` or `%2e%2e` in the destination) | Escapes the site's own path space. Checked in both literal and encoded form, because checking one is checking neither. |
| **Malformed wildcard syntax** | A `from` must end in exactly one `/*`, and a `to` may carry at most one `*`. A `to` with a star whose `from` has none has nothing to expand into it. Malformed wildcards emit a route matching a literal asterisk and nothing else. |

## `redirects` — did they reach the host, and do they work?

Reads the emitted route table and the built output.

| Refuses | Why |
|---|---|
| **A rule that matches only one slash form** | A framework may compile the source with the trailing slash **stripped**: `/expertise/` becomes `^/expertise$`, which does not match a request for `/expertise/`. Sources are written *with* the slash, because that is the form the site serves and the form old links and the search index carry. On one site this meant **every redirect returned 404 in the only form anyone requests**, for weeks, while the build printed clean — and the un-slashed form worked perfectly in every spot check. |
| **A destination that was never built** | Worse than the broken link it replaced: the visitor still gets a 404, and the search engine is now told the old URL *permanently* moved there. Two rules on one site pointed at path prefixes that did not exist on it at all. A destination may be a file — a PDF is an ordinary redirect target — but it must exist. |
| **A redirect that shadows a page that exists** | Redirects run **before** the filesystem, so a rule sitting on a URL that has a real page makes that page unreachable, with no error anywhere. Checked against the built output rather than against a list of known exceptions, and that wording is the finding: on one site the emitter and its checker both read one exception list, and deleting the entry made the emitter emit the shadowing route *and* made the checker stop expecting one. The two halves agreed with each other while a whole section would have gone dark. **Where two halves of a rule can agree and still be wrong, only the artifact settles it.** |
| **A status that differs from the rule** | A 302 where a 301 was written silently forfeits the ranking transfer, which is the entire purpose of the file. |
| **A wildcard that does not do what it promises** | Sampled through the prefix and checked on where each path lands. An earlier version asked only whether a wildcard *shadowed* an exact carve-out, so a site whose redirects were entirely wildcards could emit **none of them** and still pass — the mirror of the failure this package was built after. |
| **A missing route table** (fails closed) | Nothing could be checked, which is not the same as nothing being wrong, and must never read as a pass. |

**Anchor the emitted route** — `^/old/?$`, not `^/old`. This is not a check; it is how a site avoids the shadowing rule rather than merely detecting it. An unanchored route swallows every child path: `^/properties` takes `/properties/6-main-road/` with it. Anchored, the same redirect sits safely beside a dynamic route directory of the same name.

## `builtHtml` — the pages a visitor receives

Each of these passed a compile, a typecheck and a review on the site where it was found.

| Refuses | Why |
|---|---|
| **A collapsed `<style></style>`** | A backtick inside a comment emptied a stylesheet expression and the page shipped unstyled, with a green build. `<style>true</style>` is the same failure wearing a different hat. |
| **An uninterpolated `${…}`** | Shipped as visible text on the page. Style bodies are scanned too — a block emitting CSS from a template literal is a real construct, and the collapsed-stylesheet rule does not cover it, because the block is not empty, it is wrong. |
| **A missing title, meta description or canonical; not exactly one `<h1>`** | Each is silently absent rather than broken, so nothing but a reader notices. |
| **JSON-LD that does not parse** | Every rich result from it vanishes, with no error anywhere. |
| **An `<img>` with no `alt`** | Inaccessible, and invisible to a build. |

Warnings, which do not block: an image sized by nothing at all (layout shift), and a hotlinked external image (media is committed content, and someone else's URL is someone else's to break).

## `errorPage` — the branded 404

| Refuses | Why |
|---|---|
| **A 404 page that is built but not routed** | The page ships inside the deployment with nothing pointing at it, so unknown URLs get the platform's bare card. Building the page is not serving it — the same distinction as emitting a redirect and serving one. Checked on the outcome, not on which routing phase does it. |
| **A branded 404 served with any status but 404** | A 404 that answers 200 gets indexed as a real page, and the site accumulates duplicate thin content. |

## Advisory gates

Everything below **warns** rather than blocks. They were added to close the gap between the standard's gate list (§4.4) and launch checklist (§15) and what the package enforced — a site adopting them mid-life should see its whole gap at once, not be unable to deploy. Promote each per rule once it is clean.

### `descriptor` — §4.4, §4.6

| Warns / refuses | Why |
|---|---|
| **No `site.json`, or no `standardVersion`, or a missing `paths.*`** | Every tool downstream has to guess where content, templates and media live, and the guess is also what bounds an editor's path-safety check. |
| **A collection describing its items by neither a `template` nor an `itemSchema`** | Its items are editable nowhere (§3.6). |
| **A manifest describing ZERO blocks** — this one *fails* | A generator that ran, reported success and produced nothing. §4.4.1 exists for exactly this, and one site shipped it with every check passing. |

### `seoOutputs` — §8, §15

| Warns | Why |
|---|---|
| **No `sitemap.xml`, `robots.txt` or `llms.txt`** | Produced automatically from the model, which is precisely why nobody looks at them. |
| **A sitemap URL with no page in the build** | A crawler's to-do list of 404s — worse than no sitemap. |
| **`robots.txt` disallowing everything on a production build** | The site is live, looks perfect, and is invisible to search until somebody thinks to read a text file. Only fires when the build looks like production, because a local or preview build *should* disallow. |
| **`robots.txt` not pointing at the sitemap** | |

### `structuredData` — §8, §15

| Warns | Why |
|---|---|
| **Two of the same SINGLETON entity on a page** (`Organization`, `WebSite`, `WebPage`, `BreadcrumbList`, `LocalBusiness`) | A search engine picks one arbitrarily or discards both. Only singletons: a team page legitimately carries many `Person` and a listing page many `Product`, and flagging those reported a correct page as broken on the first real run. |

### `secrets` — §3.8.1, §15

| Warns | Why |
|---|---|
| **A credential in `globals.json` or `site.json`** | Editable content is visible to anyone who can open the editor, and anything rendered from it is visible to the world. |
| **A credential anywhere in the built output, client or server** | It has shipped. Treat the key as disclosed and rotate it. |

Deliberately narrow: it matches key *shapes* with a recognisable provider prefix, not "anything that looks random", and it skips `node_modules`. The first version flagged a library's PEM-parsing source and told a site to rotate a key that does not exist — and a security check that cries wolf is one people stop reading, which is the worst outcome available.

### `seoConsumed` — §8.1, §15

| Warns | Why |
|---|---|
| **A declared `seo.title` or `seo.description` that appears in no built page's head** | The exact shape this package exists for: the editor offers the field, the author fills it in, the file changes, the build goes green, and the published page is unaffected. A route that reads three of five `seo` keys renders perfectly from the three it reads. |

### `tagManager` — §7.2

| Warns | Why |
|---|---|
| **A container id in globals that reaches no page** | An id sitting in globals with no snippet emitting it looks exactly like one that works. |
| **The `<noscript>` half missing** | The half routinely forgotten, and the half that records a visitor who blocks scripts. |
| **Pages loading the tag manager with no id declared** | The id is hardcoded somewhere an author cannot change it. |

### `internalLinks` — §15

| Warns | Why |
|---|---|
| **A link to a page that was never built** | "All nav links resolve" is a checklist line somebody does by hand per template; the build knows the answer. The usual cause is a slug rename that a redirect covered while the link pointing at it was left alone. A link to a declared redirect source is not counted — it costs a hop, not a 404. |

### `templates`, `authorComplete`, `routesAreContent` — §4.4, §4.4.1, §4.5

| Warns | Why |
|---|---|
| **A page naming a template that does not exist** | Worse than naming none: a tool reads the name verbatim and offers to author content it cannot render (§4.6). |
| **A page naming no template**, or a templates directory with no templates | Nothing decides what slots the page has, so "templates are data" is not true. |
| **A prop with no label**, including an array's ITEM descriptor | An author sees a humanised key instead of a name. "It inherits from the array" is a reasoning the generator can hold and no downstream reader can — one site shipped nine repeaters with raw-key row headers while passing its own label check (§4.4.1). |
| **Far more built routes than content files** | A route with no content file is a page whose content or layout lives in framework code, which is what §4.4 refuses. Reported as a count, not a list: reconstructing each site's routing well enough to name a specific offender is a mapping that is right for one site and wrong for the next. |

---

## What this package cannot check

**Prove one real redirect on a real deployment.** Everything here reads the build. That a host honours the table it was given is a separate claim, and the only way to settle it is to request the old path and read the status. Note that preview URLs often sit behind access protection that 302s anonymous requests to a login — an automated check sees *that*, not your redirect.

**That a page looks right.** These checks catch a page that is broken, not one that is ugly.

**The gate items that are human acts.** From §4.4 and §15: the editor↔git↔preview loop proven on a real page; the enquiry pipeline proven with a real submission and a real email that *arrives*; the fidelity gate at every breakpoint; the performance budget; the enquiry store being private and in-region; DNS and rollback. Each is listed here so the gap is visible rather than assumed covered.

## Errors, warnings, and exceptions

An **error** is something a visitor receives, and blocks. A **warning** is debt, prints in full, and blocks nothing — until a site cleans a rule up and *promotes* it. The first run against an existing site produced 185 findings, all debt, and a gate that refuses today's change over last year's debt is one people learn to route around.

**Every exception is declared with a reason** in `site-checks.config.json`, and printed on every run. The loader refuses one without a reason. The reason is the point: it is what a reviewer reads instead of re-deriving why the rule was waived — and on one site an exception whose stated reason was *wrong* survived precisely because it read as considered.
