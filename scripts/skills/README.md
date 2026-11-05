# Claude Code skills

Claude Code only discovers project skills under `.claude/skills`, which is gitignored
here, so these live in the repo and are linked in. After a fresh clone, from the root:

```bash
mkdir -p .claude/skills
for s in scripts/skills/*/; do ln -s "../../$s" ".claude/skills/$(basename "$s")"; done
```

The skills need OpenCV and the image-metadata packages, listed in `requirements.txt` here
(`pip install -r scripts/skills/requirements.txt`).

`restore-panel` is the entry point for panel restorations: it finds the panel, recovers
its original photo from git, checks for color, and hands off to `restore-bw-panel` or
`restore-color-panel`.

The Telegram bot's `/restore` runs the same skills unattended in GitHub Actions
(`.github/workflows/restore.yml`) with Gemini CLI, which finds workspace skills under
`.agents/skills`; the workflow links them there the same way. See `worker/README.md`.
