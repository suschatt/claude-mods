# claude-mods

My Claude Code mods: the `suschatt-flow` plugin, the `code-documenter` skill and a status line script.

## Set up a Linux machine

Install Claude Code and log in, then run:

```bash
curl -fsSL https://raw.githubusercontent.com/suschatt/claude-mods/main/bootstrap.sh | bash
```

Run the same command again to pull updates. The script:

1. clones or pulls this repo into `~/claude-mods` (override with `CLAUDE_MODS_DIR`);
2. symlinks `skills/*` and `statusline-command.sh` into `~/.claude`, backing up anything already there;
3. sets `env.CLAUDE_CODE_PLUGIN_DIRS` and `statusLine` in `~/.claude/settings.json` (saved first as `settings.json.bak`) and leaves every other key alone;
4. installs the marketplace plugins I use (superpowers, frontend-design, vercel, ponytail, caveman, example-skills);
5. runs `claude plugin validate` on suschatt-flow.

Needs `git`, `python3` and `claude`. The status line also uses `jq`.

## Contents

| Path | What it is |
|---|---|
| `suschatt-flow/` | Subagent orchestration plugin. See its [README](suschatt-flow/README.md). |
| `skills/code-documenter/` | Documentation skill |
| `statusline-command.sh` | Status line script |
| `bootstrap.sh` | Machine setup |
