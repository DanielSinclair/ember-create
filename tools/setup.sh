#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
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

checkout_dependency() {
  dependency_name=$1
  dependency_url=$2
  dependency_revision=$3
  dependency_dir="$project_root/$dependency_name"
  if [ ! -e "$dependency_dir" ]; then
    git clone --no-checkout "$dependency_url" "$dependency_dir"
    git -C "$dependency_dir" checkout --detach "$dependency_revision"
  fi
  actual_revision=$(git -C "$dependency_dir" rev-parse HEAD)
  if [ "$actual_revision" != "$dependency_revision" ]; then
    echo "$dependency_name is at $actual_revision; this project needs $dependency_revision." >&2
    echo "The existing checkout was preserved. Review it before changing revisions." >&2
    exit 1
  fi
}

checkout_dependency exact https://github.com/expo/exact.git 94b8671f70fe2e25b307a40e7fce66dc27c9f802
checkout_dependency exact-templates https://github.com/expo/exact-templates.git ece65894bb53305f2d572c17c780f1f770350b95
for patch_file in "$project_root"/patches/*.patch; do
  [ -f "$patch_file" ] || continue
  if git -C "$project_root/exact" apply --check "$patch_file" 2>/dev/null; then
    git -C "$project_root/exact" apply "$patch_file"
  elif git -C "$project_root/exact" apply --reverse --check "$patch_file" 2>/dev/null; then
    echo "Already applied: $(basename "$patch_file")"
  else
    echo "Cannot apply $(basename "$patch_file"); inspect the Exact checkout before retrying." >&2
    exit 1
  fi
done

(
  cd "$project_root/exact"
  "$BUN" install --frozen-lockfile
)
(
  cd "$project_root/container"
  "$BUN" install --frozen-lockfile
)
for source_file in app.contract app.ts app.test.contract; do
  if [ ! -e "$project_root/container/$source_file" ]; then
    cp "$project_root/demos/pedometer/$source_file" "$project_root/container/$source_file"
  fi
done

command_dir=${EXACT_CREATE_BIN_DIR:-"$HOME/.local/bin"}
mkdir -p "$command_dir"
if [ -e "$command_dir/exact-create" ] || [ -L "$command_dir/exact-create" ]; then
  if [ ! -L "$command_dir/exact-create" ] || [ "$(readlink "$command_dir/exact-create")" != "$project_root/bin/exact-create" ]; then
    echo "Existing $command_dir/exact-create was preserved. Use $project_root/bin/exact-create directly." >&2
    exit 1
  fi
else
  ln -s "$project_root/bin/exact-create" "$command_dir/exact-create"
fi

echo "Setup complete. Ensure $command_dir is on PATH, set OPENROUTER_API_KEY, then run exact-create."
echo "Check native toolchains with: $BUN $project_root/exact/scripts/exact.mjs setup --check"
