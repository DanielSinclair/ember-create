# Exact Create terminal UI

A monochrome, fullscreen Exact Contract interface with a scrollable transcript
and one bottom composer. A Rust data adapter runs the shared Bun CLI and streams
its JSONL status messages into the screen.

```sh
sh tui/run.sh
# or, from the repository root:
bun run tui
```

Type a description and press Enter. Muse Ember names the project, writes its
contract, and the CLI validates and selects it. Shift+Enter inserts a newline.
Drop an image into the empty composer to attach it immediately, then type your
description. Quoted or shell-escaped paths and local `file://` URLs are recognized
without running a shell. The original text stays intact when it is not a readable
PNG, JPEG, or WebP path.

- **Ctrl+O** launches the iOS simulator.
- **Ctrl+B**, **`/builds`**, or **`/apps`** opens the build picker. Use Up/Down
  and Enter, or click a build, to install and open it. Demo builds show **[Demo]**.
- **`/open ID`** installs and opens a project directly.
- **`/edit description`** revises the selected app.
- **`/image /path/to/image.png`** attaches an image to generation requests;
  **`/image clear`** removes it. Quoted file paths are accepted.
- **`/new description`** explicitly creates an app; ordinary prompts do the same.
- **`/help`** prints the commands.

The launcher requires Bun 1.4.2 and Rust 1.97.0. Set `BUN` to override Bun's path.
Its first Rust build takes several minutes; subsequent launches reuse the binary.
`CARGO_BUILD_JOBS` defaults to four. The UI runs `bun src/cli.ts` from the
repository root; generation and simulator orchestration are shared with the CLI.

Headless interaction uses Exact's terminal operations:

```sh
tui/target/debug/exact-create-tui --size 100x32 print
BUN="$HOME/.bun-1.4.2/bin/bun" tui/target/debug/exact-create-tui \
  --size 100x32 type prompt /apps key Enter until Done print
```

Image clipboard bytes and cancellation of an active CLI operation are not yet
implemented. A draft typed during an operation is retained until you send it.
