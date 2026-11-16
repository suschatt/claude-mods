#!/usr/bin/env bash
# Claude Code status line script

input=$(cat)

# --- data extraction ---
cwd=$(echo "$input"      | jq -r '.workspace.current_dir // .cwd // "?"')
model=$(echo "$input"    | jq -r '.model.display_name // "?"')
remaining=$(echo "$input" | jq -r '.context_window.remaining_percentage // empty')

# --- user@host ---
user=$(whoami)
host=$(hostname -s)

# --- git branch (best-effort, no lock contention) ---
branch=""
if git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    branch=$(git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null \
             || git -C "$cwd" rev-parse --short HEAD 2>/dev/null)
fi

# --- context display ---
ctx_part=""
if [ -n "$remaining" ]; then
    remaining_int=$(printf "%.0f" "$remaining")
    if [ "$remaining_int" -lt 40 ]; then
        # compact warning indicator
        ctx_part=$(printf "\033[1;33mCTX:%d%%!\033[0m" "$remaining_int")
    else
        ctx_part=$(printf "ctx:%d%%" "$remaining_int")
    fi
fi

# --- assemble line ---
# user@host  cwd  [branch]  model  ctx
printf "\033[32m%s@%s\033[0m" "$user" "$host"
printf "  \033[34m%s\033[0m" "$cwd"
if [ -n "$branch" ]; then
    printf "  \033[35m(%s)\033[0m" "$branch"
fi
printf "  \033[36m%s\033[0m" "$model"
if [ -n "$ctx_part" ]; then
    printf "  %s" "$ctx_part"
fi
printf "\n"
