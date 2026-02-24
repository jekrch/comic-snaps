# Comic Snaps :bookmark:

A gallery for collecting and studying comic book art with friends. Snap a panel, send it to a Telegram group with a caption, and it shows up on the site.

(snaps.jacobkrch.com)[snaps.jacobkrch.com]

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

## Development

```bash
bun install
bun run dev
```

The worker has its own setup — see [worker/README.md](worker/README.md).

## Stack

- **Frontend:** React, TypeScript, Tailwind CSS, Vite, Bun
- **Backend:** Cloudflare Worker
- **Hosting:** GitHub Pages
- **Storage:** Git (images + JSON committed via GitHub Contents API)