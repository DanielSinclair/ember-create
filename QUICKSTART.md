# Quickstart

## Prerequisites

- macOS with Xcode selected by `xcode-select`, plus an installed iOS simulator runtime.
- Bun **1.4.2**. The launchers recognize `~/.bun-1.4.2/bin/bun`; set `BUN` to another installation if needed.
- Rust **1.97.0** through rustup. Exact's first web/native build may request additional targets or toolchains.
- The Exact source checkout at `./exact`. `exact-templates/` is reference material for this prototype.
- An OpenRouter API key for the TUI, or a logged-in Codex CLI for CLI generation.

Check Exact's toolchain requirements without starting a build:

```sh
export BUN="$HOME/.bun-1.4.2/bin/bun" # Adjust to your installation.
"$BUN" exact/scripts/exact.mjs setup --check
```

Install Exact's JavaScript dependencies from its own directory with `bun install --frozen-lockfile` if they are missing. Keep the upstream checkout and its pinned toolchains together; moving to another Exact revision can require rebuilding the hosts.

## Setup

```sh
git clone https://github.com/DanielSinclair/ember-create.git
cd ember-create
sh tools/setup.sh
```

Setup checks Bun, clones the upstream dependencies at pinned revisions when absent, applies the project's compatibility patch, installs dependencies, and seeds the active container if its source is absent. Existing dependency checkouts must match those revisions; setup refuses a mismatch and preserves their work. The upstream directories are ignored and are not included in this repository.

Setup also links `exact-create` into `~/.local/bin`; make sure that directory is on PATH. Set `EXACT_CREATE_BIN_DIR` to choose another command directory. Existing unrelated commands are preserved.

The checked-in source for the initial container is `demos/pedometer/`. Its active copies in `container/` are ignored because selecting a generated app replaces them. Setup preserves existing active source.

## Open the TUI

With the command installed:

```sh
exact-create
```

The launcher builds the terminal binary if needed. It defaults Cargo to four build jobs to reduce contention during the first native build. Press Enter to submit a prompt and Shift+Enter for a new line.

Without installing the command, run `./bin/exact-create` from the checkout. Supplying arguments runs the CLI, such as `exact-create list`.

| TUI input | Action |
| --- | --- |
| An app description | Create a new project; Ember chooses its name and ID |
| `/builds`, `/apps`, or Ctrl+B | Open the saved-build picker; use arrows and Enter to select |
| `/open <id>` | Switch to a saved project |
| `/edit <changes>` | Revise the selected project |
| `/image <path>` | Attach a screenshot to subsequent generation requests |
| `/image clear` | Remove the attachment |
| `/simulator` or Ctrl+O | Build/launch the iOS container |
| `/help` | Show command help |

The TUI always uses Muse Ember. Place `OPENROUTER_API_KEY=your-key` in the root `.env`, or export it before launch. The installed command loads this file even when invoked outside the checkout. Keep `.env` local. The CLI supports Codex without an OpenRouter key:

```sh
./bin/exact-create generate "A counter with increment and reset" --provider codex --id counter
```

## Build once, switch apps

The CLI offers the same flow:

```sh
./bin/exact-create ios
./bin/exact-create generate "A counter with increment and reset" --id counter
./bin/exact-create generate "A timer with start, pause, and reset" --id timer
./bin/exact-create open counter
./bin/exact-create open timer
```

Generation selects the result automatically. Add `--no-select` to validate and save a candidate without changing the active app. Reusing `--id` includes the previous artifact in the generation request:

```sh
./bin/exact-create generate "Add a decrement button and prevent negative counts" --id counter
```

Switching projects can restart the installed container to reset transient state. Compatible same-project updates use the running preview stream. Persistent records use project-specific paths; switching does not provide a separate iOS sandbox for each project.

## Clone from a screenshot

```sh
./bin/exact-create generate "Recreate this screen with working controls" \
  --id reference-app --image "/absolute/path/reference screen.png"
```

The OpenRouter adapter accepts PNG, JPEG, and WebP files up to 20 MB. The image is sent to the selected model. The current generator recreates UI with native controls and Contract; it does not extract and package image assets from the screenshot.

For TUI drag-and-drop, drop a file directly into the composer. The terminal must insert a local path; supported paths become an attachment. `/image <path>` is the explicit alternative. The attachment remains active until `/image clear`.

## Apple Health demo

The container includes `@exact/health` for read-only access to supported HealthKit data. Health-related prompts receive that package's interface and the [Stride pedometer reference](demos/pedometer/README.md).

Stride requests access only after the person chooses Connect Apple Health. It contains no invented step samples. A simulator may have no HealthKit data; a device with known data is needed to verify authorization and totals. The demo was authored directly to exercise the native capability, independently of model-generation tests.

Included examples in the build picker are labeled **[Demo]** so they remain distinct from generated projects.

## Useful commands

| Command | Result |
| --- | --- |
| `./bin/exact-create list` | Saved projects and active selection |
| `./bin/exact-create serve` | Start or reconnect to the local preview server |
| `./bin/exact-create ios --sim <UDID>` | Build/launch on a chosen simulator |
| `./bin/exact-create generate "Counter" --fixture --id demo` | Deterministic counter without a model call |
| `./bin/exact-create generate "…" --json` | JSONL progress, diagnostics, usage, and result |

The default server port is `8791`. Keep that default for the simplest flow: project activation currently connects to it.

## Troubleshooting

- **First run is slow:** Rust, the terminal host, the web producer, and the iOS host have cold build caches. Let the existing builds finish; launching duplicates can increase contention.
- **Bun version error:** set `BUN` to the Bun 1.4.2 executable. The TUI checks the exact version.
- **No generated app appears:** inspect `.exact-create/container-server.log`, confirm the simulator was launched, then open the saved project again.
- **Model generation fails:** inspect the corresponding `.exact-create/runs/*.jsonl`. Compiler repairs are bounded to three attempts; the prior app remains active when validation fails.
- **A capability requires rebuilding:** the demo container has a fixed runtime and grants. Contract edits cannot add native modules or entitlements.

An app being staged means its source was accepted for the development stream. Confirm its visible screen and interactions in the simulator before treating the update as delivered.
