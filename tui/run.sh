#!/bin/sh
set -eu
tui_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:/opt/homebrew/bin:$PATH"
if [ -z "${BUN:-}" ]; then
  if [ -x "$HOME/.bun-1.4.2/bin/bun" ]; then
    BUN="$HOME/.bun-1.4.2/bin/bun"
  else
    BUN=$(command -v bun)
  fi
fi
export BUN
if [ "$("$BUN" --version)" != "1.4.2" ]; then
  echo "Exact Create needs Bun 1.4.2; set BUN to that executable." >&2
  exit 1
fi
export PATH="$(dirname -- "$BUN"):$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"
exec cargo +1.97.0 run --quiet --manifest-path "$tui_dir/Cargo.toml" -- "$@"
