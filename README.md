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

A GitHub Action (`compute-image-metadata.yml`) runs whenever `gallery.json` is updated. It backfills missing metadata for each panel:

- `width` / `height` — pixel dimensions for layout and aspect-ratio placeholders
- `phash` — DCT-based perceptual hash for structural similarity
- `dominantColors` — three most prominent colors in CIELAB space via k-means clustering
- `colorfulness` — RMS of chromatic channel variance, used to separate B&W art from color panels
- CLIP embedding — a 512-dimensional vector from `openai/clip-vit-base-patch32`, stored in a separate `embeddings.json`

The action skips panels that already have all fields. Its own commit includes `[skip ci]` to avoid re-triggering the workflow.

## Sorting

The gallery supports several sort modes that explore different notions of visual ordering:

- **Newest / Oldest** — chronological by date added
- **pHash** — nearest-neighbor chain by Hamming distance on perceptual hashes. Groups panels with similar coarse luminance structure (roughly: "similar blurry thumbnails"). Good for spotting near-duplicates but insensitive to content or style.
- **Color** — hue-angle walk through dominant colors, with chromatic panels separated from achromatic ones. Produces a visible spectrum sweep.
- **Visual Chain** — nearest-neighbor chain by cosine distance on CLIP embeddings. Each panel is placed next to its closest match in a 512-dimensional feature space that encodes composition, subject matter, texture, and style holistically. More semantically meaningful than hash-based sorting, though it's a greedy path rather than a global clustering — adjacent panels will feel related, but similar panels elsewhere in the collection may not be nearby.

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