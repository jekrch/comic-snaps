# Comic Snaps Bot — Cloudflare Worker

Telegram webhook handler that receives photos with captions, parses comic metadata, and commits images + gallery data to a GitHub repo.

## How it works

```
Phone (Telegram) → Cloudflare Worker → GitHub Contents API → GitHub Pages
```

When a photo is sent to the Telegram group with a structured caption, the Worker:

1. Verifies the request originated from Telegram and from the allowed chat
2. Parses the caption into metadata (title, issue, year, artist, optional notes)
3. Downloads the photo via the Telegram Bot API
4. Commits the image to `public/images/{series-slug}/` via the GitHub Contents API
5. Appends an entry to `public/data/gallery.json` with the metadata and contributor info
6. Replies in Telegram with a confirmation

## Caption format

```
Title // Issue # // Year // Artist // optional notes // tag1, tag2, tag3
```

A freeform fallback (`Saga #1 2012 Fiona Staples`) is also supported.

## Deployment

The Worker deploys automatically via GitHub Actions on pushes to `main` that touch `worker/`. Cloudflare credentials and the Telegram/GitHub secrets are managed entirely through GitHub repo secrets and Cloudflare Worker secrets — nothing sensitive lives in the codebase.
