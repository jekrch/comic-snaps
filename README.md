# Comic Snaps :bookmark:

A gallery for collecting and studying comic book art with friends. Snap a panel, send it to a Telegram group with a caption, and it shows up on the site.

[snaps.jacobkrch.com](https://snaps.jacobkrch.com)

## How it works

```
Telegram group → Cloudflare Worker → GitHub repo → GitHub Pages
```

Photos sent to the Telegram bot get parsed, committed to this repo, and served as a static gallery site. The site rebuilds automatically on each new panel.

## Caption format

```
Title // Issue # // Year // Artist 
```

Optional notes and tags can be appended:

```
Saga // 1 // 2012 // Fiona Staples // incredible double-page spread // sci-fi, space opera
```

A freeform fallback (`Saga #1 2012 Fiona Staples`) also works for quick entries.

## Image metadata

A GitHub Action (`compute-image-metadata.yml`) runs whenever `gallery.json` is updated. It scans for panels missing image dimensions or perceptual hashes and backfills them automatically. Each panel gets:

- `width` / `height` — pixel dimensions, used for layout and aspect-ratio placeholders
- `phash` — DCT-based perceptual hash (structural similarity)
- `ahash` — average hash (brightness distribution)
- `dhash` — difference hash (edge/gradient patterns)

Hashes are stored as hex strings in `gallery.json`. The action skips panels that already have all fields, so repeated runs are cheap no-ops. Its own commit includes `[skip ci]` to avoid re-triggering the workflow.

These hashes will power a similarity browsing feature in the gallery using Hamming distance on the hash values.

## Development

```bash
bun install
bun run dev
```

The worker has its own setup — see [worker/README.md](worker/README.md).

## Stack

- **Frontend:** React, TypeScript, Tailwind CSS, Vite, Bun
- **Backend:** Cloudflare Worker
- **Scripting:** Python
- **Hosting:** GitHub Pages
- **Storage:** Git (images + JSON committed via GitHub Contents API)