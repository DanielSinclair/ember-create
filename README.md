# Exact Create

Describe an iOS app, generate its Exact Contract with Muse Ember or Codex, and run it in one reusable simulator container. The terminal UI is also built with Exact.

This is an early local prototype. The first run compiles the terminal and native hosts. Compatible app revisions then travel through Exact's development update stream.

## Quickstart

After [setting up the checkout](QUICKSTART.md#setup):

```sh
exact-create
```

The TUI uses OpenRouter's `meta/muse-ember`. Set `OPENROUTER_API_KEY` in your environment or the ignored root `.env` file; [.env.example](.env.example) shows the format.

1. Press **Ctrl+O** or enter `/simulator` to build and install the container the first time.
2. Describe an app and press **Enter**. Ember names it and generates its Contract.
3. Press **Ctrl+B** or enter `/builds`, then use the arrow keys and Enter to open a saved app. Included examples carry a **[Demo]** label.
4. Enter `/edit <changes>` to revise the selected app.

The first builds can take several minutes. Subsequent project switches reuse the native installation and may restart its process. Compatible edits to the active app use live updates.

`exact-create` opens the TUI with no arguments and runs CLI commands when arguments are supplied. From the checkout, `./bin/exact-create` works the same way.

See [QUICKSTART.md](QUICKSTART.md) for prerequisites, screenshots, CLI examples, and troubleshooting.

## CLI

```sh
./bin/exact-create ios
./bin/exact-create generate "A hydration counter with add, undo, and reset" --id water
./bin/exact-create list
./bin/exact-create open water
./bin/exact-create generate "Add a daily goal of eight glasses" --id water
```

The CLI chooses OpenRouter when its key is available, otherwise Codex. Choose explicitly with `--provider openrouter` or `--provider codex`. Both providers use the same artifact schema and compiler repair loop.

Attach a screenshot with `--image /absolute/path/screen.png`. In the TUI, drop an image into the composer or enter `/image /absolute/path/screen.png`, then describe the app. A terminal file drop must insert a path; clipboard image bytes are not supported.

## Give the app a visual direction

Include the behavior and the design in the same prompt. For example:

- “Track today's real Apple Health steps toward 10,000. Use a deep green botanical style, an ivory background, and a plant that visibly grows with progress.”
- “A warm editorial focus timer with cream paper, terracotta buttons, large tabular time, thin dividers, and no cards or motivational slogans.”

Use `/edit` to refine the selected app, such as `/edit Keep the timer behavior; remove the cards and give the countdown more space.` Review the rendered screen and interactions after generation; style instructions are model inputs, not a guarantee of visual fidelity.

## Current scope

- Contract UI, TypeScript data logic, local persistence, and generated behavior tests.
- Saved projects and revisions; one active app in the fixed iOS container.
- Compiler validation before staging, with up to three generation attempts.
- JSONL progress, model usage, repair diagnostics, and reported OpenRouter cost.
- Local development updates for compatible Contract and TypeScript changes.
- Read-only Apple Health capability in the container, with a [pedometer reference demo](demos/pedometer/README.md).

The generator currently excludes extra asset files, remote images, new dependencies, network calls, and custom native modules. The container includes Exact's HealthKit package; generated health apps must handle unavailable or empty data honestly. Real-device HealthKit access remains a separate verification step. New native capabilities, entitlements, grants, or runtime versions require a container rebuild. Signed hosted OTA, standalone export, and backend provisioning are follow-up work.

Generated behavior tests are saved, but generation currently gates on compilation. Run the app and its interaction tests before treating requested behavior as verified.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/` | CLI, providers, and saved-project registry |
| `tui/` | Exact terminal Contract and Rust CLI bridge |
| `tools/container.mjs` | Validation, staging, preview server, and simulator launch |
| `container/` | Fixed native identity and active preview source |
| `.exact-create/projects/` | Generated projects; `project.json` is the saved record |
| `.exact-create/runs/` | Generation events, diagnostics, and usage |
| `exact/`, `exact-templates/` | Upstream source checkouts |

Development and validation guidance lives in [CONTRIBUTING.md](CONTRIBUTING.md). Upstream references: [Exact](https://github.com/expo/exact) and [Exact Templates](https://github.com/expo/exact-templates).
