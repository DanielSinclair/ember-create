# Exact compatibility patch

`exact-validation-secret-backend.patch` applies to the pinned Exact revision
`94b8671f70fe2e25b307a40e7fce66dc27c9f802`.

During native live replacement, Exact boots an already-loaded disposable
TypeScript module for validation. Configuring its secret backend must succeed
without acquiring live authority. The patch returns early for that validation
module and keeps the loaded-module refusal for live modules. Without it, the
native host rejects otherwise valid updates with a secret-configuration error.

The same patch also rebinds native-module handlers when a live update replaces
the runner while retaining the session's native module instance. This keeps
capabilities such as HealthKit connected after a replacement.

`tools/setup.sh` applies the patch, or recognizes that it is already applied.
The ignored upstream checkout stays pinned to its original commit; the patch is owned
by this project rather than an unpublished upstream commit.

The focused regression command is:

```sh
cargo +1.97.0 test --manifest-path exact/Cargo.toml -p exact-js \
  validation_never_acquires_the_live_secret_backend -- --nocapture
```

This regression and Rust formatting were checked during integration. The full
upstream suite was not run. Native Contract updates were also observed applying
and reverting in the same simulator process without replacing its binary.
The native binding change made HealthKit available and displayed the real
system Steps authorization sheet in the simulator. Real-device data access
remains under verification; a dedicated Swift binding regression is pending.
