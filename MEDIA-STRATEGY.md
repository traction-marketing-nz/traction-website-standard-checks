# Media strategy — storage, delivery, and editing

**Status:** images **decided** · video still a proposal · revised 2026-08-20 · feeds Website
Architecture Standard §3.4, §3.4.1, §4.5.6, §6

> **What changed.** This document proposed Supabase Storage for images. **Standard 1.15 decided
> the other way**: media is committed content in the repo (§3.1), with a declared weight budget
> (§3.4.1) and the host's image optimization as the transform layer (§3.4). K2 Recruit has since
> shipped that pipeline end to end. The images half of this document has been rewritten to match
> what was decided and built; the reasoning for the rejected option is preserved below so the
> decision is not re-litigated from scratch. **Video is unchanged and still undecided.**

How images and video are stored, transformed, delivered, and — the part that actually
drives the design — **changed by a non-developer through the Pulse editor**.

---

## 1. Where we are, measured

| | Smith Architects | K2 Recruit |
|---|---|---|
| Media in repo | **598 MB** — 831 images + 8 videos | 1.4 MB |
| Largest single file | `kakapo-multiclips.mp4` — **103 MB** | — |
| Image markup | raw `<img>`, **0 `srcset`**, 11 × `loading="lazy"` | remote Unsplash URLs (placeholder) |
| Video | `<video>` with a local `.mp4` | none |
| Transform / CDN | **none** | none |

> ⚠️ **That table is the 2026-08-01 measurement and the K2 column is now history.** K2 committed
> its images, wired Vercel Image Optimization, and gates the result in CI: ~5.7 MB of media, every
> file inside the caps, every `<img>` carrying `srcset`, `width`/`height` and a `loading`
> annotation. It is the worked example of §3 below. **Smiths is unchanged** — every failure listed
> here is still live there.

Three concrete failures follow from this:

1. **GitHub rejected the large videos.** Files over 100 MB cannot be pushed, so the two
   biggest sit untracked on one machine. They are not backed up and not reproducible —
   if that laptop dies, the site's hero video is gone.
2. **Every visitor downloads the full-resolution original.** No `srcset`, no modern
   format negotiation, no resizing. A phone on 4G downloads a desktop-sized JPEG.
3. **A 598 MB repo** makes every clone, CI run and preview build slower, forever, and
   grows monotonically — git keeps every version of every binary ever committed.

And the one that matters most for what we are building: **an editor cannot upload into
this model.** Committing a 6 MB binary to git through a browser editor is possible but
wrong — it makes content edits and asset edits the same operation, bloats history
permanently, and forces a full rebuild to change a photo.

---

## 2. The three layers, kept separate

Most media confusion comes from conflating these. Decide each independently:

| Layer | Question | Our answer |
|---|---|---|
| **Storage** | Where does the original live? | **The repo** (images — §3.1), **Bunny Stream** (video — §4) |
| **Transform** | Who makes the responsive variants? | **Vercel Image Optimization** (images), the video platform (video) |
| **Delivery** | Who serves the bytes? | Vercel's CDN edge |

**The repo IS the storage layer for images, and is not one for video.** That split is the whole
decision. An image and the page referencing it are one reviewable change; a video is an order of
magnitude too large for git and needs an encoding ladder no static host provides.

---

## 3. Images

### Decision

**One original committed to the repo under `paths.media`; variants generated at request time by
the host's image optimization; the content JSON stores a repo path plus alt text and intrinsic
dimensions.**

That is Standard §3.1 (`image` props carry a repo path), §3.4 (host optimization), and §3.4.1
(the weight budget that makes repo storage safe). The caps are declared per site in `site.json`'s
`media` block, so a tool can state the limit *before* an upload rather than rejecting one after:

| Cap | Default | What it prevents |
|---|---|---|
| `maxSourceBytes` | 1 MB | A camera original becoming permanent git history |
| `maxSourceWidth` | 2400 px | Committing pixels no breakpoint will ever request |

An editor should **offer to downscale** rather than simply refuse. An author with a camera
original and no image editor is otherwise stuck, and that is how assets end up pasted into places
nobody governs.

### Why not object storage — the argument that was rejected

This document originally proposed **Supabase Storage**, on the grounds that Pulse already ran
buckets with an established upload path and RLS policies, and that §1.2/§6 require storage to be
independent of the host. Both points were true. They lost to three that mattered more:

1. **An image and the page that references it stop being one change.** With external storage the
   JSON moves in a PR and the binary does not, so review, deploy, revert and rollback no longer
   act on the same unit. The "rollback works" claim in §5 was only ever true of the reference,
   never of the asset.
2. **It buys a second permission model and a second failure mode** — a signed-URL or RLS mistake
   makes a public brochure site's images 403, and the site cannot serve its own content without a
   working credential to a service it does not otherwise need.
3. **The problem it solved was concentrated in one repo.** The 598 MB is Smiths, and it is video
   and un-resized originals, not the existence of committed images. Caps fix that directly.

**The independence requirement is still met**: a repo path is the most portable reference there
is, and moves hosts with the repo. What is *not* portable is the transform layer, which is
deliberately host-owned and produces no artefact to migrate.

**Revisit this if** a site's media outgrows the caps by design — a real photography portfolio, or
editor uploads at a volume where per-commit review stops being meaningful.

### How it renders

Astro's `<Image>` with the Vercel adapter's `imageService: true` emits `/_vercel/image`
URLs, so transformation happens at the edge on request rather than at build. This
matters for editor-uploaded media: **a new image needs no rebuild to be optimised.**

```js
// astro.config.mjs
adapter: vercel({ imageService: true }),
// No `remotePatterns`: the sources are local files, so there is no remote host to allow.
```

Three non-obvious requirements, all confirmed on K2:

- **`imageService: true` is mandatory, and its absence is SILENT.** Without it Astro processes
  images at build time, the `/_vercel/image` URLs are never produced, and the pages look
  identical — just unoptimised.
- **Set `quality` explicitly.** The Vercel image service defaults it to **100** when absent.
- **The configured width list and the widths a block requests must stay in step.** The service
  silently *drops* a requested width that is not configured, leaving an `<img>` with no `srcset`
  at all. This is the single easiest way to ship a broken pipeline that looks fine.

Dropping remote storage removed a whole class of failure here: there is no `remotePatterns` to
get wrong, and no long-standing Astro issue about remote images versus the Vercel image service
to work around. It also makes the transform cache self-busting — Vercel keys it on the file's
content hash, so replacing a file in a commit invalidates its variants without a cache purge.

**Verify, don't assume.** A silent fallback to unoptimised delivery looks identical in the page,
so the check belongs in CI: grep the built HTML for the transform URL, `srcset`, `width`/`height`
and `loading` on every `<img>`, and fail on any surviving external source. K2 runs this as
`verify-images.mjs` in its build command.

### Cost shape

Vercel bills **per transformation on cache MISS or STALE**, from ~$0.05 per 1K
transformations, plus cache reads/writes and data transfer. The model changed from the
older per-source-image basis. Practical implication: cost tracks *distinct variants
actually requested*, so keep the `sizes` set deliberate — four breakpoints, not twelve —
and let the CDN cache do the work. Limits worth knowing: transformed output max 10 MB,
source max 8192 px per side, source must be JPEG/PNG/WebP/AVIF.

### Rules to enforce in the manifest

- **Alt text is required** on every image prop. It is an accessibility obligation, it is
  the field authors most reliably skip, and the standard already requires the publish
  gate to check it (§4.5.3). Smiths currently ships empty `alt` on every image — that is
  a live defect, not a hypothetical.
- **Store intrinsic width/height** alongside the URL so the rendered `<img>` can reserve
  space. Without it every image causes layout shift as it loads, which is a Core Web
  Vitals penalty on a site whose whole proposition is photography.
- **One `image` prop type** (§3.1), never a bare string URL, so the editor renders a real
  media control rather than a text box.

---

## 4. Video — do not put it in the image pipeline, or the repo

Video is categorically different: too large for git, not servable usefully as a single
file, and needs adaptive bitrate so a phone on a poor connection gets a lower rendition
rather than a stall.

**Recommendation: Bunny Stream.** Roughly $0.01/GB storage and $0.005–0.01/GB delivery,
with encoding and a player included — around half of Cloudflare Stream for equivalent
basic use, and materially cheaper than Mux, whose advantages (live streaming, deep
analytics) we do not need for brochure sites. Cloudflare Stream at $1/1000 minutes
delivered is the sensible alternative if per-minute billing is easier to explain to a
client than per-GB.

**Self-hosting `.mp4` from object storage is the option to avoid.** It is what we are
doing today by accident: no adaptive bitrate, no encoding ladder, and a single
103 MB file that a mobile visitor must buffer before anything plays.

The content JSON stores a **playback ID and a poster image**, not a file path. The poster
goes through the image pipeline above, so the first paint is a fast optimised still while
the player loads.

---

## 5. The editor upload flow

This is the part that has to work for a non-developer, and the reason for every choice above.

```
Author picks a file in Pulse
        │
        ├─ image → checked against site.json's media caps BEFORE a byte moves
        │            ├─ over maxSourceBytes / maxSourceWidth → offer to downscale
        │            └─ committed to paths.media, in the SAME PR as the JSON
        │                 └─ Pulse reads intrinsic dimensions, demands alt text,
        │                    writes { src, alt, width, height } into the page JSON
        │
        └─ video → Bunny Stream (direct upload, returns a playback ID)
                     └─ Pulse writes { playbackId, poster: {…image…} }
                        and blocks save until a poster exists

So: an image and its reference are ONE reviewable change.
    Video never touches git.
```

⚠️ **This is the step that inverted when the decision changed.** The original flow's headline was
*"the BINARY never touches git"*. For images it now does, deliberately — and everything below
follows from that, including the caps, which are the price of the property in the first bullet.

Consequences worth stating plainly:

- **An asset swap is one change, not two.** The image and the page that uses it review together,
  deploy together and revert together. Under external storage the JSON moved in the PR and the
  binary did not.
- **Rollback genuinely works.** Reverting the commit restores the file itself, not just a
  reference to a file someone may since have replaced or deleted.
- **The repo grows, and only forward.** Git keeps every version of every binary; deleting a file
  reclaims nothing. The caps are prevention, not something to tidy up later (§3.4.1).
- **`paths.media` is the only directory an editor may write binaries into** (§4.6), and that
  declaration is also what bounds the editor's path-safety check. An image referenced from
  outside it is a file the editor cannot replace — usually the logo and the founder portrait,
  which are exactly the assets a client asks to change.
- **Uploads must still be constrained at the point of upload** — enforce the declared caps,
  reject non-image MIME types, and strip EXIF (it carries GPS coordinates from phone cameras,
  which is a privacy problem on a client's public site).

### §4.5.6 already demands we prove this

The standard requires the upload → storage → transform → rendered responsive image loop
to be **demonstrated on one real block before launch**, precisely because seeded stock
URLs hide a broken upload path.

**K2 has now proven the render half of that loop** — committed sources, host transform,
responsive output, gated in CI — and one editor upload has been through it end to end. **Smiths
has proven none of it.** The half still unproven on both sites is an editor upload that gets
*rejected or downscaled* by the caps, which is the path an author will actually hit first with a
camera original. That remains the acceptance criterion.

---

## 6. Migrating Smiths off 598 MB

Not urgent, but it gets harder every commit, and it should happen before the site goes
live on the client's domain.

The images are no longer the thing to move — they are already where the standard wants them. The
problem is that they are the wrong *size*, and that the videos should never have been there.

1. **Move the 8 videos to Bunny Stream** and capture poster frames. This is the whole of the
   100 MB+ problem, including the two files GitHub refused, which exist on one laptop and are
   not backed up. Do this first: it is the only irreversible loss in the list.
2. **Downscale the 831 images to the caps** (`maxSourceWidth` 2400, `maxSourceBytes` 1 MB) in
   place, keeping paths and filenames. Verifiable by diffing the rendered HTML for identical
   dimensions.
3. **Declare `paths.media` and the `media` block** in Smiths' `site.json` (§4.6), so the caps are
   machine-readable and the editor can enforce them on the next upload.
4. **Wire the host's image optimization** and add the CI check, so `srcset` and dimensions are
   proven rather than assumed.
5. **Leave git history alone.** Rewriting it with `filter-repo` to reclaim the space invalidates
   every existing clone and PR reference. The repo stops *growing*, which is what matters;
   598 MB of history is survivable, an unbounded trajectory is not.

Do this on one section first (the projects collection) and confirm the visual gate still passes
before touching the rest.

⚠️ **Steps 2 to 4 make the repo bigger before they make it smaller** — the downscaled copies are
new objects and the originals stay in history. That is the correct trade and it is worth saying
out loud, because a size check run mid-migration will look like the work made things worse.

---

## 7. Open questions for the owner

1. **Bunny Stream account** — do we open one at agency level and bill through, or per
   client? Affects who owns the asset if a client leaves. **Still open; video is the half of
   this document that was never decided.**
2. **Does a client ever upload directly**, or does media always go through us? This
   decides whether the upload control appears in the client portal (§M5) or stays staff-only.
   Now sharper than it was: a direct client upload is a **commit to their repo**, so the caps
   and the `paths.media` boundary are the only things standing between an author and permanent
   history.
3. **EXIF/GPS stripping** — confirm we strip by default. I would; a residential
   architecture practice publishing photos with client home coordinates embedded is a
   real privacy exposure. **Unchanged by the storage decision, and now unavoidable** — a
   committed file carries its EXIF into history, where stripping it later achieves nothing.
4. **Existing asset licensing** — K2's placeholders are **committed Unsplash downloads**, not
   remote URLs as originally written. Free for commercial use, no attribution required, but they
   are not owned assets and must not be presented as the client's own. Replacing them with owned
   photography is still the pre-launch item.
5. **Do the caps hold?** 1 MB and 2400 px are asserted defaults, not measured ones. K2's set
   fits comfortably; Smiths will be the real test, and a photography-led site may justify a
   declared exception rather than a silent one.

---

## Sources

- [Vercel — Limits and Pricing for Image Optimization](https://vercel.com/docs/image-optimization/limits-and-pricing)
- [Vercel — Image Optimization](https://vercel.com/docs/image-optimization)
- [Vercel changelog — Faster transformations and reduced pricing](https://vercel.com/changelog/faster-transformations-and-reduced-pricing-for-image-optimization)
- [Astro — @astrojs/vercel adapter](https://docs.astro.build/en/guides/integrations-guide/vercel/)
- [Astro — Image Service API](https://docs.astro.build/en/reference/image-service-reference/)
- [Mux vs Cloudflare Stream vs Bunny Stream (2026)](https://www.pkgpulse.com/guides/mux-vs-cloudflare-stream-vs-bunny-stream-video-cdn-2026)
- [Bunny Stream review — pricing and limits (2026)](https://swarmify.com/blog/bunny-stream-review/)
