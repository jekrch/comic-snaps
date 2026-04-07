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

## Telegram commands

Each panel is assigned a numeric ID on creation. The bot responds to:

- `/delete {id}` — remove a panel and its image from the gallery
- `/update {id} {field} {value}` — edit a field (`title`, `issue`, `year`, `artist`, `notes`, `tags`)
- `/help` — show usage instructions

## Image metadata

A GitHub Action (`compute-image-metadata.yml`) runs whenever `gallery.json` is updated. It backfills missing metadata for each panel:

- `width` / `height` — pixel dimensions for layout and aspect-ratio placeholders
- `phash` — DCT-based perceptual hash for structural similarity
- `dominantColors` — three most prominent colors in CIELAB space via k-means clustering
- `colorfulness` — RMS of chromatic channel variance, used to separate B&W art from color panels

After metadata, the action computes embeddings via three models, each stored in its own file:

- **SigLIP** (`embeddings.json`) — 768-dimensional vectors from `google/siglip-base-patch16-224`. Captures semantic and conceptual similarity.
- **DINOv2** (`embeddings-dino.json`) — 384-dimensional vectors from `facebook/dinov2-small`. Captures structural and perceptual similarity.
- **VGG-16 Gram** (`embeddings-gram.json`) — 256-dimensional vectors derived from Gram matrices at three convolutional layers of VGG-16 (relu1_2, relu2_2, relu3_3), reduced via PCA. Captures line style and texture similarity — hatching, stippling, inking approach — independent of composition or subject matter.

SigLIP and DINOv2 support incremental updates (only new panels are embedded). Gram embeddings are always fully recomputed because PCA is fit on the full corpus. Each file carries a version tag; a version bump triggers a full recompute automatically.

HuggingFace and torchvision model weights are cached across runs.

## Wiki integration

The metadata script also maintains `artists.json` and `series.json`, seeded from distinct artist names and series titles in the gallery. When an entry includes a Wikipedia reference but has no description, the script fetches the introductory section of the linked article via the MediaWiki API and fills it in automatically.

## Sorting

The gallery supports several sort modes exploring different notions of visual ordering:

- **Newest / Oldest** — chronological by date added
- **pHash** — nearest-neighbor chain by Hamming distance on perceptual hashes. Groups panels with similar coarse luminance structure. Good for spotting near-duplicates but insensitive to content or style.
- **Color** — hue-angle walk through dominant colors, with chromatic panels separated from achromatic ones. Produces a visible spectrum sweep.
- **SigLIP** — nearest-neighbor chain by cosine distance on SigLIP embeddings. Clusters by subject matter and conceptual content.
- **DINOv2** — nearest-neighbor chain by cosine distance on DINOv2 embeddings. Clusters by visual structure and composition.
- **VGG-16 Gram** — nearest-neighbor chain by cosine distance on Gram embeddings. Clusters by mark-making and rendering style, largely independent of what's depicted.

All embedding sorts are lazy-loaded on first use. They produce greedy nearest-neighbor paths rather than global clusterings — adjacent panels will feel related, but similar panels elsewhere in the collection may not be nearby.

## Similarity graph

From the panel viewer, the graph button opens a force-directed similarity graph centered on the current panel. It computes the nearest neighbors using any of the available distance metrics (SigLIP, DINOv2, VGG-16 Gram, color palette, or pHash), then positions them with a spring simulation where edge length reflects distance. Edge thickness and opacity encode neighbor rank. Double-clicking a neighbor recenters the graph on that panel, allowing freeform exploration across the collection.

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