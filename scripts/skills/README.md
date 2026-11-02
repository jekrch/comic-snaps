# Claude Code skills

Claude Code only discovers project skills under `.claude/skills`, which is gitignored
here, so these live in the repo and are linked in. After a fresh clone, from the root:

```bash
mkdir -p .claude/skills
for s in scripts/skills/*/; do ln -s "../../$s" ".claude/skills/$(basename "$s")"; done
```
