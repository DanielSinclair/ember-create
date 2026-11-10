# Exact Create

Describe an iOS app. Muse Ember generates it; Exact runs it in one reusable simulator container. The TUI is built with Exact too.

The npm package is not published yet. Run the source preview:

```sh
git clone https://github.com/DanielSinclair/ember-create.git
cd ember-create
sh tools/setup.sh
export PATH="$HOME/.local/bin:$PATH"
export OPENROUTER_API_KEY=your-key
bunx --no-install exact-create
```

Requires macOS, Xcode with an iOS simulator, Bun 1.4.2, and Rust 1.97.0. Initial builds take several minutes; compatible edits then reload without rebuilding the native app.

- **Enter:** generate · **Shift+Enter:** new line
- **Ctrl+E:** edit the selected app · **Ctrl+B:** saved apps
- **Ctrl+O:** build/open the simulator
- Drop an image to use it as a reference; **Esc** removes it.

Describe the behavior and look together: “A warm editorial focus timer with cream paper, terracotta controls, and no cards.”

CLI commands also work through `bunx --no-install exact-create`, for example `list`, `open focus`, or `generate "A hydration counter"`. Add `--provider codex` to use a logged-in Codex CLI.

First packaged launch prepares pinned sources in a persistent local runtime. No API keys are bundled. [Setup details](QUICKSTART.md) · [Development](CONTRIBUTING.md)
