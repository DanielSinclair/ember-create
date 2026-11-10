# Exact Create terminal UI

A black-background, fullscreen Exact Contract interface with a scrollable transcript
and one bottom composer. A Rust data adapter runs the shared Bun CLI and streams
its JSONL status messages into the screen. Thinking text animates with cycling dots
and a subtle violet pulse. Cyan marks validation/building, amber marks repairs,
green marks Ready, success and reported OpenRouter cost, and red marks failures. Labels
remain readable without color. Generation cost includes naming and repairs and
is shown after success or failure when OpenRouter reports usage. Total generation
time remains in the transcript. The composer wraps and grows up to six lines,
then scrolls while keeping the caret visible.

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

- **Enter** sends; **Shift+Enter** inserts a newline.
- **Ctrl+O** launches the iOS simulator.
- **Ctrl+B** opens builds; arrows and Enter install and open a selection.
- **Ctrl+E** switches between creating a new app and editing the selected app.
- Drop an image to attach it; **Esc** removes it or closes the build picker.

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
