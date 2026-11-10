# Contributing

Keep changes focused and preserve the short loop from prompt to a working simulator screen. The CLI and TUI share the same engine; provider-specific behavior belongs in `src/providers.ts`.

## Local checks

Use the pinned Bun executable:

```sh
export BUN="$HOME/.bun-1.4.2/bin/bun" # Adjust to your installation.
"$BUN" test ./tests
```

Keep `./tests` explicit: broad test filters can discover upstream Exact suites. For terminal changes, build and exercise the TUI:

```sh
./tui/run.sh
```

For a model-free pipeline check:

```sh
./bin/exact-create generate "Counter" --fixture --id smoke-counter --no-select --json
./bin/exact-create open smoke-counter --json
```

This stages the smoke app. Use a disposable project ID when testing so an existing project is not replaced.

## Simulator acceptance

Validate changes at the layer they affect:

1. Generate or revise a project; confirm the compiler accepts the artifact.
2. Open it in the installed container and exercise its controls.
3. Switch to a second project and back; check saved data and transient-state behavior.
4. Revise the active project and confirm the visible update without rebuilding or reinstalling the native host.
5. Try an invalid candidate and confirm the working app stays usable.

Generated tests are staged as `container/app.test.contract`. To run Exact's fuller iOS checks from the active container:

```sh
cd container
"$BUN" exact.mjs verify ios
```

That verification command may build its own artifacts. Record model time, compiler time, native build time, and update delivery separately when measuring performance. A successful compile does not establish behavior or delivery.

## Repository boundaries

- `exact/` and `exact-templates/` are upstream checkouts. Follow their own instructions before changing them.
- The ignored upstream checkouts are fetched at the revisions pinned in `tools/setup.sh`. They are not vendored or submodules. Project-specific fixes live under [`patches/`](patches/README.md) and are applied idempotently by setup.
- `container/` is the active preview workspace; generating/selecting a project replaces its Contract, TypeScript, and tests.
- Active container source is ignored. Edit the canonical initial app under `demos/pedometer/` when changing what a fresh checkout launches.
- `.exact-create/` contains local generated projects and run records. Keep these, build caches, and API keys out of contributions.
- Preserve `project.json` as the project record. Editing generated sibling files alone does not change what the CLI stages.

For bug reports, include the command, expected behavior, relevant diagnostics, toolchain versions, and whether the problem occurs on a cold or warm run. Remove credentials and private prompt content from shared logs.

For releases, run `bun tools/embed-key.mjs` with `OPENROUTER_API_KEY` configured before packing. It writes the ignored `src/embedded-key.json`, which is intentionally included in npm releases. Never commit the payload or print the decoded key.
