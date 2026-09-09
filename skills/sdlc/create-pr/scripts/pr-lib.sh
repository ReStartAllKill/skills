#!/usr/bin/env bash
# Shared profile loader for create-pr scripts. Source this file.
# Operates independently of the runtime version pinned by the repository.

# Read a single YAML scalar, stripping trailing comments and quotes.
pr_yml() {
  sed -n "s/^$1:[[:space:]]*//p" "$2" 2>/dev/null | head -1 \
    | sed -e 's/[[:space:]]\{1,\}#.*$//' -e 's/^["'\'']//' -e 's/["'\'']$//' -e 's/[[:space:]]*$//'
}

# Read YAML block-sequence values one per line. Inline arrays are unsupported.
pr_yml_list() {
  awk -v key="$1" '
    $0 ~ "^" key ":[[:space:]]*(#.*)?$" { inlist = 1; next }
    inlist && /^[[:space:]]*-[[:space:]]/ { sub(/^[[:space:]]*-[[:space:]]*/, ""); print; next }
    inlist && /^[^[:space:]#]/ { inlist = 0 }
  ' "$2" 2>/dev/null \
    | sed -e 's/[[:space:]]\{1,\}#.*$//' -e 's/^["'\'']//' -e 's/["'\'']$//' -e 's/[[:space:]]*$//'
}

# Set TREE, PROFILE, and SPEC_DIR from the current worktree.
# Returns: 0 profile found, 1 no profile (TREE set), 2 not a Git repository.
pr_repo_profile() {
  TREE="$(git rev-parse --show-toplevel 2>/dev/null)" || TREE="${CLAUDE_PROJECT_DIR:-}"
  [ -n "$TREE" ] && [ -d "$TREE" ] || { PROFILE=""; SPEC_DIR=".sdlc/specs"; return 2; }
  PROFILE="$TREE/.claude/spec-profile.yml"
  SPEC_DIR=".sdlc/specs"
  [ -f "$PROFILE" ] || { PROFILE=""; return 1; }
  local dir; dir="$(pr_yml spec_dir "$PROFILE")"
  [ -n "$dir" ] && SPEC_DIR="$dir"
  return 0
}
