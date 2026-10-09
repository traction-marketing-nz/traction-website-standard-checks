# Media strategy — storage, delivery and editing

**Version 2.0** · 2026-10-09 · Part of the [Website Architecture Standard](./WEBSITE-ARCHITECTURE-STANDARD.md) (§3.1, §3.4, §3.4.1, §3.4.2, §4.5, §4.6, §6).

How every Traction site stores, transforms, delivers and edits images and video.

**Reference implementation:** the `smitharchitects` repo. Copy its files rather than rewriting them:

| Job | File |
|---|---|
| Upload masters to Mux, write the manifest and posters | `scripts/sync-videos.mjs` |
| Shared helpers (LFS pointer hash, manifest I/O, site tag) | `scripts/lib/videos.mjs` |
| Build gate | `scripts/check-videos.mjs` |
| GitHub Action | `.github/workflows/sync-videos.yml` |
| Resolve `videos/<name>.mp4` to a playback ID | `src/lib/video-source.ts` |
| Poster + `<video>` markup | `blocks/AmbientVideo.tsx` |
| Stream loader (hls.js / native HLS) | the `<script>` at the end of `src/layouts/Base.astro` |
| Carousel play/pause logic | `blocks/Hero.tsx` |

---

## 1. The layers

| Layer | Images | Video |
|---|---|---|
| **Storage** (the original) | The repo, under `paths.media` | The repo, under `paths.videos`, in **Git LFS** |
| **Transform** (the variants) | Vercel Image Optimization, at request time | **Mux**, at upload (HLS ladder + thumbnails) |
| **Delivery** | Vercel's CDN | Mux's CDN (`stream.mux.com`) |
| **Content stores** | `{ src, alt, width, height }` | `"videos/<name>.mp4"` |

Never serve video as a file from `public/` or from object storage.

---

## 2. Rules for both

- **Content refers to media by repo path.** Never by a third-party URL.
- **One original per asset.** Never commit pre-sized copies.
- **Strip EXIF** (GPS and camera data) from every image at upload.
- **Only owned or licensed media** ships on a client site. Stock placeholders are replaced before launch.
- **The LCP element is a first-party image** — the hero image or the video poster — with `fetchpriority="high"`.

---

## 3. Images

### 3.1 Storage and caps

- Commit one original under `paths.media`.
- Caps are declared in `site.json` → `media`:

| Cap | Default |
|---|---|
| `maxSourceBytes` | 1 MB (1048576) |
| `maxSourceWidth` | 2400 px |

- An editor checks the caps **before** upload and **offers to downscale**.
- Photos are WebP (or AVIF), never PNG.

### 3.2 Rendering

Use Astro's `<Image>` with the Vercel adapter's image service:

```js
// astro.config.mjs
adapter: vercel({ imageService: true }),
// No remotePatterns: every source is a local file.
```

- **`imageService: true` is required.** Without it the build optimizes locally and emits no `/_vercel/image` URLs, with no error.
- **Set `quality` explicitly.** The service defaults to 100.
- **Keep the configured width list and the widths each block requests in step.** The service drops an unconfigured width, and the `<img>` ships with no `srcset`.
- **Use four breakpoints, not twelve.** Vercel bills per transformation on cache miss.
- Limits: output up to 10 MB; source up to 8192 px per side; JPEG, PNG, WebP or AVIF.

### 3.3 The image prop

- **`alt` is required** on every image prop. The publish gate checks it.
- **`width` and `height` are the file's intrinsic size**, read from the file when it is chosen.
- **One `image` prop type**, never a bare string URL.
- **Above the fold:** `fetchpriority="high"`, no `loading="lazy"`. **Below the fold:** `loading="lazy"`.

### 3.4 Verify in CI

Grep the built HTML. Every `<img>` has the transform URL, `srcset`, `width`, `height` and a `loading` value. No external source survives. `traction-site check` reports missing dimensions and hotlinks.

---

## 4. Video

### 4.1 Storage — Git LFS

- Masters live in `videos/` (`paths.videos`), named `<page-or-topic>.mp4` in kebab-case.
- `.gitattributes` tracks them:

```
videos/*.mp4 filter=lfs diff=lfs merge=lfs -text
```

- The GitHub org plan provides the LFS storage (GitHub Team: 250 GB).
- **Vercel's Git LFS setting stays off** (`gitLFS: false`). Builds see pointer files only.
- **Never put an `.mp4` in `public/`.**
- A pointer file carries the master's SHA-256 (`oid sha256:…`). Tools read the hash from the pointer and download nothing.

### 4.2 Masters

**Ask the client's video editor for this, word for word:**

> For each website video, please send the original export from the edit project. Please do not send a copy that was downloaded, converted or compressed afterwards.
>
> - **Resolution:** the full resolution the footage was shot at. 4K (3840×2160) if possible, otherwise 1080p.
> - **Format:** H.264 High profile or H.265 (HEVC), 10-bit if available.
> - **Bitrate:** 50–80 Mbps for 4K, or 25–40 Mbps for 1080p.
> - **Cut:** the same edit as the site uses.
> - **Audio:** not needed.
>
> Please keep each file under 2 GB. ProRes is welcome too, but the files become very large, so please check with us first.

Before committing a master:

1. **Check it with `ffprobe`:** codec, profile, bit depth, bitrate, resolution, frame rate, and the encoder tag. A `Lavf` encoder tag on a "master" means someone re-compressed it. Ask for the original.
2. **Remove a silent audio track** with a stream copy. The video data stays bit-identical:

```bash
ffmpeg -nostdin -i in.mp4 -map 0:v -c copy -an out.mp4
```

3. **Do not re-encode it.** Mux encodes. A re-encode by us only loses quality.
4. **Keep the approved cut.** Do not trim originals to match a site cut. Ask the editor for an export of the cut.
5. **Prefer 16:9.** A 4:3 master crops about 25% of its height in a full-bleed hero.

### 4.3 Mux account, environments and secrets

- **Install Mux from the Vercel Marketplace** on the Traction Vercel team. Charges go on the Vercel invoice.
- **One Mux resource (= one Mux environment) per client site.** Name it after the client. Connect it to that site's Vercel project only.
- **Confirm the environment exists** at dashboard.mux.com after you create the resource.
- **Copy the resource's tokens into the site repo's GitHub Actions secrets:** `MUX_TOKEN_ID` and `MUX_TOKEN_SECRET`. Use repo secrets, not org secrets.
- **The site needs no token at runtime.** Playback IDs are public. Limit the Vercel connection to the Development environment, or delete the variables from Vercel.
- **A token rotation in Mux updates Vercel but not GitHub.** Update the GitHub secrets by hand.
- **Never paste token values into chat, code or commits.** The person with dashboard access copies them.
- **Agents connect through the Mux MCP** (OAuth, using the dashboard login):

```bash
claude mcp add --transport http mux https://mcp.mux.com
```

### 4.4 Publishing — the GitHub Action

`.github/workflows/sync-videos.yml` runs `scripts/sync-videos.mjs`.

**Triggers:** a push to any branch that changes `videos/**`, the sync script, its helpers or the workflow; manual dispatch; a weekly schedule.

**Settings:**

- `permissions: contents: write` (the Action commits).
- `GIT_LFS_SKIP_SMUDGE: '1'` and `lfs: false` on checkout. The script pulls only the masters it uploads (`git lfs pull --include`).
- `concurrency` per branch, `cancel-in-progress: false`.
- After the script, commit `src/data/video-manifest.json` and `public/media/video-posters/`, `git pull --rebase`, push. That commit is what Vercel deploys.

**What the script does:**

1. **Plans.** A master is uploaded when it is new, its SHA-256 changed, or its encoding settings changed. Nothing else is uploaded.
2. **Checks the bytes** LFS delivered against the pointer's SHA-256.
3. **Uploads** through a Mux direct upload with:

```js
{
  playback_policies: ['public'],
  video_quality: 'premium',
  max_resolution_tier: '1440p',   // '2160p' when the masters are 4K
  passthrough: '<site-tag>:videos/<name>.mp4',
}
```

4. **Waits** for the asset to be `ready` (30-minute limit).
5. **Saves the poster:** `https://image.mux.com/<playbackId>/thumbnail.webp?time=0&width=1920&height=1080&fit_mode=preserve`, re-encoded with sharp to WebP quality 72, written to `public/media/video-posters/<name>.webp`.
6. **Writes the manifest entry** after each video: `sha256`, `size`, `assetId`, `playbackId`, `duration`, `aspectRatio`, `resolutionTier`, `encoding`, `poster`, `syncedAt`.
7. **Retires** the asset it replaced. A later run deletes a retired asset once it is 24 hours old, and only if its passthrough starts with the site tag.
8. **Reports orphans** — assets with the site tag that no manifest records. It never deletes them.

Rules:

- **Never hand-edit the manifest.**
- **A change to the encoding settings re-encodes every master** on the next run. That is the intended way to upgrade quality.
- **`--dry-run`** prints the plan and needs no token.

### 4.5 Content and the build gate

- A video prop holds `"videos/<name>.mp4"`. `src/lib/video-source.ts` resolves it to `{ kind: 'mux', playbackId, poster }`.
- **`check-videos` runs in `build`** (`"build": "npm run check:videos && astro build && traction-site check"`). It fails when content uses a master that does not exist, is not in the manifest, has changed since upload, or has no poster file.
- **On a branch that adds a master, the first preview build fails the gate.** The Action's commit follows within minutes and that build deploys. This is expected.
- **The poster is the block's default.** An explicit `poster` on the block overrides it.

### 4.6 Playback

**Markup** (server-rendered, per video):

```html
<img src="/media/video-posters/<name>.webp" alt="" fetchpriority="high" …>   <!-- low on hidden slides -->
<video data-mux-playback-id="<id>" poster="/media/video-posters/<name>.webp"
       autoplay loop muted playsinline preload="none"></video>
```

**The loader** is one `<script>` in the base layout. It does this:

1. **Waits for `load`, then idle time** (`requestIdleCallback` with a 3 s timeout, or a 200 ms timeout).
2. **Does nothing** when `navigator.connection.saveData` is true or `prefers-reduced-motion: reduce` matches. The poster stays.
3. **Adds `<link rel="preconnect" href="https://stream.mux.com" crossorigin>`** at that point, not in the `<head>`.
4. **Attaches every `video[data-mux-playback-id]`,** and watches the DOM for videos added later.

**Native HLS only where there is no MediaSource** (iPhone Safari):

```js
if (!('MediaSource' in window) && video.canPlayType('application/vnd.apple.mpegurl')) {
  video.preload = 'auto';
  if (!video.paused) video.pause();          // never give a playing element a new source
  video.src = `https://stream.mux.com/${id}.m3u8?rendition_order=desc`;
}
```

Chromium and Edge report HLS as playable but fail on Mux streams. Use hls.js there.

**hls.js everywhere else:**

- Import the **light build** (`hls.js/dist/hls.light.mjs`) dynamically, after `load`.
- Pass the **worker** explicitly: `import hlsWorkerPath from 'hls.js/dist/hls.worker.js?url'` → `workerPath: hlsWorkerPath`. The ESM build does not bundle it.
- Config:

```js
new Hls({
  maxBufferLength: 12,
  maxMaxBufferLength: 12,          // the real cap; maxBufferLength alone is a floor
  workerPath: hlsWorkerPath,
  abrEwmaDefaultEstimate: estimate, // bits/s; see below
  abrBandWidthUpFactor: 0.9,
});
```

- `estimate`: from `navigator.connection.downlink` (Mbps). Below 10 → `downlink × 0.8` Mbps. Otherwise, or when unknown, 12 Mbps.
- **Do not cap the rendition** (`capLevelToPlayerSize`, height caps). Phones on fast links get the full ladder.
- **Do not use `<mux-video>` or Mux Player** for ambient video. Use Mux Player only behind a click, for a "watch the film" control.

**After attaching:** dispatch a `mux:attached` event on the video. If the video has `autoplay`, call `play()` and ignore the rejection.

**Hidden tab:** on `visibilitychange` to hidden, remember whether it was playing, `pause()`, and `hls.stopLoad()`. On visible, `hls.startLoad()` and resume if it was playing.

**Carousels:**

- **Never call `play()` on a video that has no source.** Check `video.getAttribute('src') || video.currentSrc` first. On iPhone, a `play()` before the source makes the video play invisibly behind its poster for the rest of the page's life.
- The active slide plays on `mux:attached` or `canplay`, whichever comes first, with both listeners added before the attempt.
- An inactive slide pauses after its fade-out (about 900 ms).
- Arm the next slide 5 s before the auto-advance (Architecture §3.4 rule 3).

**Single-video heroes** render the same `<img>` + `<video>` pair with `autoplay`.

### 4.7 Testing

- **Quality:** score the Mux rendition against the master with ffmpeg `libvmaf`. 93 or more is indistinguishable from the source. Below 80 is visible loss. Fix a low score with better encoding settings (§4.4) or a better master (§4.2).
- **Desktop playback:** Playwright with `channel: 'msedge'` (bundled Chromium has no H.264).
- **iPhone playback:** test on a real iPhone, on first load, on every carousel slide. Edge with `delete window.MediaSource` exercises the native code path but cannot show iPhone paint bugs.
- **On-device diagnosis:** a small, quiet panel that counts `requestVideoFrameCallback` frames and logs media events. Never an overlay that redraws every frame. Remove it before merge.
- **Page speed:** measure against the base branch (Architecture §8.2). The poster stays the LCP element.

### 4.8 Cost and data

- **Delivery:** Mux includes 100,000 delivery minutes a month free, at any resolution. Encoding costs cents per minute. Storage is negligible.
- **Data per visitor:** about 80 MB per minute at the top premium rendition on a fast line. Report it to the client as the trade-off of full-resolution video.
- Mux caches segments for 7 days. Manifests are not cached.

---

## 5. The editor upload flow

```
Author picks a file in Pulse
        │
        ├─ image → checked against site.json media caps BEFORE upload
        │            ├─ over a cap → offer to downscale
        │            └─ committed to paths.media in the SAME PR as the JSON
        │                 └─ Pulse reads width/height, requires alt,
        │                    writes { src, alt, width, height }
        │
        └─ video → committed through Git LFS to paths.videos in the SAME PR
                     └─ Pulse writes "videos/<name>.mp4" into the page JSON
                        └─ the Action uploads it and commits the manifest + poster
                           └─ the preview build deploys once that commit lands
```

Rules:

- **`paths.media` and `paths.videos` are the only directories** an editor may write binaries into.
- **Pulse commits video through LFS.** It never commits a video as a normal git blob.
- **Pulse rejects non-image MIME types for images and non-MP4 files for video.**
- **Pulse strips EXIF** from images before commit.
- **Prove both loops on one real block before launch** (Architecture §4.5 items 6 and 7).

> **Status:** Pulse does not yet commit video through LFS. Until it does, a developer commits masters to `videos/` and the rest of the flow runs as above.

---

## Sources

- [Vercel — Image Optimization limits and pricing](https://vercel.com/docs/image-optimization/limits-and-pricing)
- [Astro — @astrojs/vercel adapter](https://docs.astro.build/en/guides/integrations-guide/vercel/)
- [Mux on the Vercel Marketplace](https://vercel.com/marketplace/mux)
- [Mux — video pricing](https://www.mux.com/docs/pricing/video)
- [Mux — direct uploads](https://www.mux.com/docs/guides/upload-files-directly)
- [hls.js — API and config](https://github.com/video-dev/hls.js/blob/master/docs/API.md)
