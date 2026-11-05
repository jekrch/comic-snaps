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
6. Replies in Telegram with a confirmation including the panel's numeric ID

The bot also handles text commands:

- `/delete {id}` — removes the panel entry from `gallery.json` and deletes the image file from the repo
- `/update {id} {field} {value}` — updates a single field on a panel (`title`, `issue`, `year`, `artist`, `notes`, `tags`). Setting `title` moves the panel to the series that title names.
- `/tag_series {ref} // {tags}`, `/tag_artist {ref} // {tags}` — add tags to a series or artist
- `/rename_series {ref} // {new name} [// {start year}]` — renames a whole series: every panel's title and the `series.json` name. The old name is kept as an alias, the slug stays the same, and the lookup markers (`sources`, `coverSources`) are cleared so the metadata job searches Metron and Comic Vine again under the new name.
- `/resolve metron:series // {name} // {id}` (or `metron:creator`) — picks the right candidate in `disambiguation.json`
- `/describe_series {ref}` or `/describe_artist {ref}`, with the description on the following lines (blank lines between paragraphs) and an optional `Sources:` block of `- {name} | {url} [| {article title}]` lines — replaces the entry's description and appends any sources not already in its references. The agent proposes these from web research (below); they can also be typed.
- `/rate`, `/rate_series` — ratings (see `/help`)
- `/help` — replies with usage instructions and examples

The edit commands (`/update`, `/tag_*`, `/rename_series`, `/resolve`, `/describe_*`) all run through `src/edits.ts`. It reads every file at one commit, applies the commands in memory, and lands all the changes as a single commit through the Git Data API. If `main` moved in the meantime, it re-applies against the newer files. When a commit doesn't touch `gallery.json` (the only path the metadata job watches), the Worker starts `compute-image-metadata.yml` itself.

## Agent

For the user ids in `ALLOWED_USER_IDS`, the bot runs a Gemini agent modelled on plantyJ's. These commands, and the restorations below, stay off until `WEBHOOK_SECRET` is set. Without it anyone can post an update to the Worker naming an allowlisted id, and those ids are public in `wrangler.toml`.

- `/ask {question or request}` answers from a rollup of the whole collection, with Metron and Comic Vine lookup tools. When the answer implies changes, it proposes a numbered list of the edit commands above. `/ask1`, `/ask2` and `/ask3` pick the model tier (bare `/ask` is the strongest).
- `/resp {follow-up}` continues the thread, `/confirm` runs every proposal (or `/confirm 1 3` runs some) as one commit, `/cancel` drops them, and `/cost` reports spend.
- `/ask write a new description for {artist or series}` researches one on the web, in plain English with any directions: a URL to work from, a point to focus on, what to fix. See below.
- Post a photo captioned `/ask {description}` (or any caption that isn't in the caption format) and the agent writes the canonical caption, looking up the series name the databases use. `/confirm` posts it the same way a typed caption is posted, and `/resp` corrects it.

The agent never writes anything itself. It proposes `/update`, `/tag_*`, `/rename_series`, `/resolve` and (only through research) `/describe_*`, and never `/delete` or `/rate`. Model calls run inline for up to 10s, then move to the `comic-snaps-jobs` queue.

### Researched descriptions

`/ask` has a `research_description` tool (`src/research.ts`) for any request to write, rewrite or source an artist's or series' description. It always runs on the strongest model tier, whatever `/ask1`-`/ask3` picked, and goes like this:

1. **Search.** A Gemini call with Google Search grounding finds pages about the subject. Only the links are kept, not its summary.
2. **Read.** The Worker fetches the pages itself as plain text (`src/sources.ts`, Wikipedia through its plain-text extract API): links the user gave first, then the entry's existing article references, then the search results, then its Metron/Comic Vine pages. It reads at most 8 and keeps up to 6. It skips shops, social media and fan wikis, and drops any page that never names the subject. A link the user gave is always read, and is reported if it can't be.
3. **Write.** The model drafts one to three paragraphs in the house style from those texts alone. Each sentence comes with the source number and a verbatim quote backing it.
4. **Check.** Every quote has to appear in its source word for word, ignoring case, punctuation and accents. A separate fact-check call then reads each sentence against its quotes and the text around them, and fails anything that says more than they do (an added date, a stronger claim, a namesake).
5. **Repair once.** Failed sentences go back to the writer with the reason. Anything that still fails is dropped and listed.

The proposal shows the draft with `[n]` marks, the numbered sources, anything left out and any link that couldn't be read. On `/confirm` the description is stored without the marks, and the cited sources are added to the entry's references, named the way the data files already name them ("Wikipedia", "Comiclopedia", "The Comics Journal" plus the article title). `/resp make it shorter` or `/resp also use {url}` runs the research again with the new directions. Each run is about 4 to 6 model calls; the cost line covers them, but Google Search grounding is billed per search query on top of tokens, and that isn't counted. Pages that need JavaScript, or that block bots (comics.org, Bédéthèque, IMDb), can't be read.

## Restorations

Also for allowlisted users, `/restore {id} [directions]` cleans up a panel's photo with the `restore-panel` skill (`scripts/skills/`). The skills need OpenCV and a look-and-adjust loop, so they run in GitHub Actions, not here: the Worker dispatches `.github/workflows/restore.yml`. `scripts/restore_judge.py` runs the skill's scripts in a job with a read-only token and no secret but its Gemini key, and asks Gemini only to judge each result, in at most four calls; the model picks flags from a checked list and never runs anything itself, since it reads text anyone in the chat can write. A second job takes only the restored image from it, installs that with the repo's own install command, checks that only that panel's image and metadata changed (`scripts/restore_ci.py`), commits to a `restore/{id}` branch, and posts a before/after to the chat. Each person can start 10 restorations a day.

- `/redo {id} {what to change}` runs it again, showing the model the previous attempt's summary along with the directions.
- `/approve {id}` puts it on the site. It writes only a new image beside the panel's old one, and refuses a branch whose gallery points anywhere else. It doesn't merge the branch, whose one-line embeddings files would conflict with any metadata run since. `src/restore.ts` replays the install onto current `main` in one commit instead: the branch's image blob, that panel's image fields, the old image's removal, and the panel's embedding entries dropped so the metadata job re-embeds it. The push comes from the Worker's token, so it starts that job, which a push from the workflow's own token wouldn't.
- `/reject {id}` deletes the branch.

## Caption format

```
Title // Issue # // Year // optional artist // optional notes // tag1, tag2, tag3
```

A title that names an existing series (by slug, name or alias) joins that series under its canonical name, so posting under a series' corrected name doesn't start a second one.

The artist can be dropped (or left empty, to reach the later segments) when the series already has a panel in `gallery.json` — the bot reuses the artist from that series' most recently added panel and says so in its reply. Titles are matched on their slug, so casing and punctuation don't have to line up. If the series is new and no artist is given, the post is rejected before anything is committed.

A freeform fallback (`Saga #1 2012 Fiona Staples`, or `Saga #1 2012`) is also supported.

## Deployment

The Worker deploys automatically via GitHub Actions on pushes to `main` that touch `worker/`. Cloudflare credentials and the Telegram/GitHub secrets are managed entirely through GitHub repo secrets and Cloudflare Worker secrets — nothing sensitive lives in the codebase.

One-time setup for the agent, from `worker/`:

```bash
bunx wrangler kv namespace create BOT_STATE            # id → wrangler.toml
bunx wrangler kv namespace create BOT_STATE --preview  # preview_id → wrangler.toml
bunx wrangler queues create comic-snaps-jobs
bunx wrangler secret put GEMINI_API_KEY
bunx wrangler secret put METRON_USERNAME
bunx wrangler secret put METRON_PASSWORD
bunx wrangler secret put COMIC_VINE_API_KEY            # optional
```

Deploys fail until the KV ids are filled in. To start the metadata job itself, the Worker's `GITHUB_TOKEN` needs Actions read/write as well as Contents read/write. Without it, edits still land, and the reply says the job will run with the next post.

Restorations also need these GitHub repo secrets, used by `restore.yml`: `GEMINI_API_KEY`, and `TELEGRAM_BOT_TOKEN` for the reply. That `GEMINI_API_KEY` is a separate copy from the Worker's Cloudflare secret, which GitHub can't read; a key of its own makes it easy to revoke alone. The repo variable `RESTORE_MODEL` overrides the model (default `gemini-4-argon`). Dispatching the workflow uses the same Actions write access.
