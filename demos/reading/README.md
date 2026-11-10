# Reading Nook

A small personal bookshelf: enter a title or story/cover clues, review a possible
match from Muse Spark, then choose **Paint a cover + add to shelf**. Muse Image
reconstructs the cover from the returned description. The shelf and cover images
are saved on the device and remain available after reopening the app.

Identification comes from model memory, not a live library catalog. Editions can
be ambiguous; generated covers are labeled as reconstructions. Searching does not
automatically generate an image. Adding an existing title/author avoids another
image request.

The app calls OpenRouter directly through the shared Muse helper; no application
server is required. Set `OPENROUTER_API_KEY` in the ignored local `.env` before
building. Exact resolves that build environment value into the app. A key
embedded in a distributed client can be recovered, so use a limited demo key for
private testing. Without a configured key, the saved shelf still opens and
lookup reports that Muse is not connected.

Validation:

```sh
bun test demos/reading/source.test.ts
```

These source tests use a fake OpenRouter response to check lookup results, persistence,
duplicate suppression, removal, malformed images, and corrupt-storage handling.
`app.test.contract` exercises the fresh shelf and input controls through Exact's
web driver. Neither test makes paid model requests. A live lookup and cover still
need a configured OpenRouter key and internet access.
