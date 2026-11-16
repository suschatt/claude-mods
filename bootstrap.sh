#!/usr/bin/env bash
# Set up suschatt's Claude Code mods on a Linux machine. Safe to re-run: it pulls updates.
#   curl -fsSL https://raw.githubusercontent.com/suschatt/claude-mods/main/bootstrap.sh | bash
set -euo pipefail

REPO=https://github.com/suschatt/claude-mods.git
DIR=${CLAUDE_MODS_DIR:-$HOME/claude-mods}
C=$HOME/.claude
MARKETPLACES="anthropics/claude-plugins-official DietrichGebert/ponytail JuliusBrussee/caveman https://github.com/anthropics/skills.git"
PLUGINS="superpowers@claude-plugins-official frontend-design@claude-plugins-official vercel@claude-plugins-official ponytail@ponytail caveman@caveman example-skills@anthropic-agent-skills"

command -v claude >/dev/null || { echo "Install Claude Code first: https://claude.com/claude-code"; exit 1; }

# 1. Clone or update the repo.
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone "$REPO" "$DIR"; fi

# 2. Link skills and the status line into ~/.claude. A real file or folder in the way is backed up, not deleted.
link() {
  if [ -e "$2" ] && [ ! -L "$2" ]; then mv "$2" "$2.bak.$(date +%s)"; echo "backed up $2"; fi
  ln -sfn "$1" "$2"
}
mkdir -p "$C/skills"
for s in "$DIR"/skills/*/; do link "${s%/}" "$C/skills/$(basename "$s")"; done
link "$DIR/statusline-command.sh" "$C/statusline-command.sh"

# 3. Add the plugin path and status line to settings.json. Every other key is left as it is.
[ -f "$C/settings.json" ] && cp "$C/settings.json" "$C/settings.json.bak"
python3 - "$C/settings.json" "$DIR/suschatt-flow" <<'EOF'
import json, os, sys
path, plugin = sys.argv[1], sys.argv[2]
s = json.load(open(path)) if os.path.exists(path) else {}
s.setdefault("env", {})["CLAUDE_CODE_PLUGIN_DIRS"] = plugin
s["statusLine"] = {"type": "command", "command": "bash ~/.claude/statusline-command.sh"}
json.dump(s, open(path, "w"), indent=2)
EOF

# 4. Marketplace plugins. Already-added or already-installed ones are skipped.
for m in $MARKETPLACES; do claude plugin marketplace add "$m" >/dev/null 2>&1 || true; done
for p in $PLUGINS; do claude plugin install "$p" >/dev/null 2>&1 && echo "installed $p" || echo "skipped $p (already installed or failed)"; done

# 5. Check the mod.
claude plugin validate "$DIR/suschatt-flow"
echo "Done. Start a new claude session to load everything."
