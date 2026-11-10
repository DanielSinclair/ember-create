# Ten little apps

A collection of colorful personal tools. These are curated demos, shown as
**[Demo]** in the build picker. They use real native controls and remember small
preferences on the device. They do not require model calls to open.

| Demo | Look | Useful interactions |
| --- | --- | --- |
| **Step Garden** (`pedometer`) | Lilac, lime, and a growing plant | Real Apple Health steps, health access, refresh, adjustable goal |
| **Little Garden** (`water`) | Pistachio and forest green | Watering checklist for three houseplants, remembered checks, new round |
| **Sip Club** (`hydration`) | Pool blue and coral | Add or undo a glass, change the target, start a new day |
| **Paper Hour** (`focus`) | Butter paper and terracotta | 5/15/25-minute focus timer, pause/resume, reset |
| **Pocket Money** (`budget`) | Cobalt and apricot | Local weekly envelope, quick expenses, adjust the envelope, new week |
| **Bay Day** (`ferry`) | Navy and seafoam | Alameda/SF direction, published sailing subset, outing checklist |
| **Pantry Party** (`pantry`) | Tomato red and kitchen cream | Pick ingredients, get a simple meal idea, save tonight's choice |
| **Soft Landing** (`mood`) | Lavender and peach | Mood selection, personal note, new check-in |
| **Small Adventures** (`weekend`) | Sunflower yellow and blue | Choose a weekend day, check off three little outings, reset |
| **Reading Nook** (`reading`) | Wine red and pale butter | Book clues, Muse Spark identification, Muse Image cover reconstruction, saved bookshelf |

Open `exact-create`, press **Ctrl+B**, and choose a demo. Each folder contains its
Contract, data module where needed, behavior tests, and demo metadata.

Step Garden does not invent health readings. A simulator may have no shared
samples; real-device data requires a HealthKit permission flow. Pocket Money
uses editable local sample amounts and has no bank connection. Bay Day includes
selected weekday sailings from the [November 2, 2026 official schedule](demos/ferry/README.md),
with a link to check current service; it is not a live departure feed.
[Reading Nook](demos/reading/README.md) keeps its bookshelf locally; identifying
books and painting covers use OpenRouter directly and require a configured API
key. Matches come from model memory and covers are labeled AI reconstructions.

Each demo bundles a generated Muse Image sticker hero, its original
`assets.plan.json`, and an `assets.json` manifest with model, dimensions, and
content hash. The opaque artwork sits on a white rounded tile. Opening a demo
uses its bundled image and makes no image-generation request.
