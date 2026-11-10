import { readFile, mkdir, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { DATA, ROOT, parseArtifact, parseMetadata, type Artifact, type Metadata } from './projects';
import { GRANTS } from '../tools/container.mjs';
import type { GeneratedAsset } from './assets';

export type Event = { type: string; message: string; [key: string]: unknown };
export type Emit = (event: Event) => void;
export const schema = {
  type: 'object', additionalProperties: false,
  required: ['name', 'contract', 'typescript', 'tests'],
  properties: Object.fromEntries(['name', 'contract', 'typescript', 'tests'].map(k => [k, { type: 'string' }])),
};

const resourcePrimer = `Contract resource syntax is mandatory: every resource must use "as shape NamedShape" (or "as shape NamedShape[]"). Never use "as number", "as string", "as bool", or omit the "as shape" clause. Wrap scalar data in a named record and read its field. Exact example:
shape Count
  value: number

component Example
  resource count = loadCount() as shape Count else empty()
  view
    text count.value

The TypeScript loadCount source returns { value: 0 }, not the scalar 0. A resource fallback is "else empty()", not "else 0". Built-in HealthKit sources use their imported named shapes such as HealthStatistics.\n\n`;

const designGuidance = `DESIGN DIRECTION: Treat the user's aesthetic as a requirement, including named colors, mood, typography, and visual motifs. Explicit author styling wins over the platform defaults in the reference below. Create a coherent design for THIS app: a small contrasting palette, one clear focal point, a readable hierarchy, intentional spacing, and a few useful controls. A botanical green tracker and a warm editorial timer must not reuse the same screen layout, labels, or card stack. Honor requests such as "no cards", restrained black-and-white, playful, or editorial instead of reverting to the starter appearance.
Use a real graphical treatment when requested, not a decorative title or a progress label standing in for an illustration. Keep the screen focused on the task: omit generic motivational slogans and copied "Private by design" sections. Health disclosures should be a brief secondary sentence at the relevant permission/empty state, not a large permanent block. Loading, empty, denied/unknown, and failure states must each say what happened and offer the relevant next action.
LAYOUT: Either use proper routes/navigationKey/native header wiring from the guide, or put a custom title inside the same padded content column as the screen. A bare header/h1 outside the padded scroll is an edge-flush inline heading, not a finished navigation bar. Every navigationScroll="name" MUST have a matching scroll/list id="name" inside that route; omit navigationScroll when not using it. Fill the viewport; give the scroll flex=1 min-height=0 and content consistent horizontal gutters. Do not combine width="100%" and padding without box-sizing="border-box". Do not assume a grouped semantic background contrasts against a plain screen: choose distinct screen/surface colors, or use spacing/dividers without cards. Large numbers should use tabular digits. Preserve native control behavior and accessibility; author visual overrides when the requested style calls for them. Native buttonStyle and custom paint are mutually exclusive: a button with background-color/border/font-size must omit buttonStyle. A custom button should use appearance="none", deliberate padding and a minimum 44-point hit height; do not turn a primary action into a thin text strip.
Valid styling syntax only (choose values and composition for this request; do not copy this palette or wording into every app):
    main height="100%" background-color="#f5f0e6" color="#28241e"
      scroll flex=1 min-height=0
        column padding=24 gap=28
          text "A custom title" font-size=32 font-weight=700
          text "25:00" font-size=64 font-variant-numeric="tabular-nums"
          row height=1 background-color="#d9cfc0"
          button press=start appearance="none" background-color="#ad563c" color="#ffffff" padding="12 18" min-height=44 border-radius=12
            text "Start"
Use background-color, never background. Custom colors belong on the actual screen and visible controls/graphics, not only in a label. Review the final contract against the user's requested look before returning it.\n\n`;

const plantGuidance = `PLANT VISUAL REQUIREMENT: Render an actual visible plant graphic. A stage label, step count, or progress bar alone does not satisfy a request for a growing plant. Use supported inline SVG, or a leaf symbol above a stem; vary its visible size or leaf count with real goal progress. Keep units explicit: ratio is clamped 0–1, while a displayed percent is round(ratio * 100). Never mix a 0–1 ratio with coefficients intended for a 0–100 percent. This small supported iOS example assumes ratio = min(1, max(0, actualStepCount / goal)) from an available HealthKit sample:
  derive leafSize = 36 + ratio * 60
  derive stemHeight = 20 + ratio * 80
  view
    column align-items="center" gap=0
      image "symbol:sf/leaf.fill" font-size=leafSize width=leafSize height=leafSize color="-exact-system-green" aria-label="Your growing plant" testId="plant-leaves"
      column width=8 height=stemHeight background-color="-exact-system-green" border-radius=4 testId="plant-stem"

The symbol glyph scales with font-size, not width alone. At 0, 5,000 and 10,000 steps toward a 10,000-step goal, leaf sizes must visibly differ: 36, 66 and 96 points; stem heights are 20, 60 and 100 points. Place the plant in the known-data branch and derive progress from the returned real count and the user's goal. In unknown/empty/unavailable states show an honest placeholder; never manufacture zero steps or 0% growth. Preserve the requested visual colors and the plant even when revising an earlier artifact that omitted it.\n\n`;

function requestsHealth(request: string) {
  return /\b(?:health(?:kit)?|steps|workouts?|sleep|heart|fitness|pedometer)\b|\bstep[\s-]+(?:count|goal|tracker|tracking)\b|\b[\d,]+[\s-]+step\b/i.test(request);
}

function repairGuidance(previous: Artifact | undefined, diagnostics: string) {
  const invalidResource = previous?.contract.split('\n').find(line => /^\s*resource\s/.test(line) && !/\bas\s+shape\s+/.test(line));
  if (invalidResource || /expected `(?:shape|as)`, found/.test(diagnostics)) {
    return `REQUIRED RESOURCE REPAIR: ${invalidResource ? `Replace this invalid declaration: ${invalidResource.trim()}. ` : ''}Do not remove the type clause or retry a scalar type. Declare a named record shape, use "as shape Name else empty()", change the TypeScript source to return that exact record, and change all consumers to read its field. For real step counts use healthStatistics(...) as shape HealthStatistics, as in the reference, instead of a custom scalar loadSteps source.\n\n`;
  }
  return '';
}

export async function generationPrompt(id: string, request: string, previous?: Artifact, diagnostics?: string, metadata?: Metadata, assets: GeneratedAsset[] = []) {
  const guide = await readFile(join(ROOT, 'exact/docs/start-here.md'), 'utf8');
  const dynamicAI = /\b(?:AI|chatbot|muse[ -](?:ember|spark|image))\b|\b(?:identify|reconstruct|find|search)\b.{0,50}\b(?:books?|covers?)\b|\b(?:in[ -]app|runtime|on[ -]demand|user[ -]generated)\b.{0,50}\b(?:images?|content|generation)\b/i.test(request)
    || /from\s*['"]\.\/muse['"]/.test(previous?.typescript || '');
  const muse = dynamicAI ? `RUNTIME MUSE API: Only for requested AI features, import { museText, museImage, saveMuseImage, museSearchBook } from './muse'. This shared helper is already provided; do not implement it or call OpenRouter directly. Signatures:
museText(prompt: string, model: 'meta/muse-ember' | 'meta/muse-spark-1.3' = 'meta/muse-ember'): Promise<{text: string, costUsd?: number}>;
museImage(prompt: string): Promise<{dataUri: string, mimeType: string, costUsd?: number}>;
saveMuseImage(dataUri: string, path: string, storage): Promise<{path: string, type: string, size: number, width: number, height: number}>;
museSearchBook(title: string, description: string): Promise<{candidate: {title: string, author: string, description: string, coverDescription: string} | null, uncertainty: string, provenance: 'model-memory'}>.
Call these from async TypeScript answer sources in response to deliberate user actions. Show pending, retryable failure, and empty/unknown states; prevent duplicate submissions. Persist accepted results in this project's storage so redraws, refreshes, or launching the app do not repeat billed generation. The helper calls OpenRouter directly over HTTPS using OPENROUTER_API_KEY substituted from the locally configured app environment. No server is used. Never embed provider keys, tokens, URLs, or environment setup in generated app source or UI. For images, call saveMuseImage(result.dataUri, a unique app:/data/${id}-image.png path, storage) from the answer source, persist its returned .path, and use that path in an image node with suitable dimensions, object-fit, and rounded clipping. Do not render raw generated data URIs: native hosts limit their size. The helper writes and compresses the image locally without another model request. Book lookup is model-memory identification, not verified web search; display uncertainty and let users confirm before generating a cover. A generated cover is an AI reconstruction, not an authenticated publisher image. All other network access remains disallowed.\n\n` : '';
  const health = requestsHealth(request)
    ? `HEALTH DATA REQUIREMENT: Step tracking means the person's real Apple HealthKit step count. The container includes @exact/health. Use healthStatus, requestHealthAuthorization and healthStatistics with their imported shapes. A request to see step count does NOT authorize a manual counter, synthetic increments, fake data, or +100/+1000 buttons. Only use manual/sample steps when the user explicitly asks for manual entry or sample data; otherwise replace any previous artifact's loadSteps/addSteps/resetSteps simulation with the real HealthKit reference. A goal/plant visualization must derive progress from returned HealthKit samples and retain honest unavailable/empty/error states. Use its Contract API (not a TypeScript import). Treat unavailable/unknown/denied and empty data honestly. No invented health samples. Apple does not reveal whether read access was denied; an empty result is not proof of denial or zero. The exact interface follows:\n${await readFile(join(ROOT, 'exact/packages/health/exact.json'), 'utf8')}\nValidated pedometer API reference only: borrow data/permission/time wiring, not its screen layout, visual styling, headings, or lengthy privacy copy. Design the UI from this user's request.\napp.contract:\n${await readFile(join(ROOT, 'demos/pedometer/app.contract'), 'utf8')}\napp.ts:\n${await readFile(join(ROOT, 'demos/pedometer/app.ts'), 'utf8')}\n`
    : '';
  const timers = /\b(?:timer|countdown|pomodoro|stopwatch)\b/i.test(request)
    ? `Timer behavior reference only; design your own layout. Compute elapsed/remaining time from performanceNow() and a deadline, not a decrementing tick count. Pausing must preserve the remaining duration. Action assignments commit at the end: after assigning remaining, later expressions still read the old value. When restarting a finished timer, use let duration = minutes * 60000, then remaining = duration and endsAt = performanceNow() + duration.\n${await readFile(join(ROOT, 'exact/docs/recipes/timers.md'), 'utf8')}\n`
    : '';
  return `Generate an interactive iOS app in Expo Exact Contract. Return ONLY the JSON artifact matching the schema. Do not use tools or modify files. The compiler will validate your answer and send errors back.\n\n` +
    `Project ID: ${id}. Request: ${request}\n` +
    (metadata ? `App name: ${metadata.name}. Description: ${metadata.description}. Use this exact app name.\n` : '') +
    `Fields: name, contract (complete app.contract), typescript (complete app.ts, or empty if no data sources), tests (Exact behavioral test). All file strings must be raw source without Markdown code fences, including tests.\n` +
    `This runs in a prebuilt container. No new native modules, dependencies, arbitrary remote images, or undeclared asset files. Use only the generated image manifest below${dynamicAI ? ' or data URIs returned by the supplied Muse helper' : ''}. App ID stays com.exactcreate.demo. If TypeScript is needed, export grants EXACTLY ${JSON.stringify(GRANTS)}; omit appId or use com.exactcreate.demo. Persisted paths MUST start app:/data/${id}-. Import TypeScript types only from './app.contract.d.ts'${dynamicAI ? "; the documented runtime functions may also be imported from './muse'" : ''}. Use a unique PascalCase root component based on project ID. Prefer Contract actions/state and native controls. Implement the requested interactions. For durable data use the supplied storage recipe. No build scripts or shell commands. ${dynamicAI ? 'Network access only through the supplied Muse helper.' : 'No network calls.'} Keep it compact and valid.\n\n` + muse +
    (assets.length ? `GENERATED IMAGE MANIFEST: These images already exist locally. Use their exact immutable paths in image nodes, place each at its intended location, size it to fit the layout using object-fit="contain" (or "cover" for a photo), and match the UI palette/style to the artwork. Do not replace the generated illustrations with SF Symbols; use SF Symbols only for standard interface icons. For progress-stage images select the appropriate image from real data; no-data states must not imply zero. Example: image "${assets[0].path}" width=180 height=180 object-fit="contain" aria-label="${assets[0].purpose.replaceAll('"', '')}". Manifest:\n${JSON.stringify(assets.map(({ file, ...asset }) => asset))}\n\n` : '') +
    resourcePrimer + designGuidance + (/\b(?:plant|sprout|seedling|garden)\b/i.test(request) ? plantGuidance : '') + health + timers + guide + (previous ? `\n\nPrevious artifact:\n${JSON.stringify(previous)}` : '') +
    (diagnostics ? `\n\n${repairGuidance(previous, diagnostics)}Fix these compiler diagnostics, preserving the requested app:\n${diagnostics.slice(-18000)}` : '');
}

export async function generateArtifact(options: { provider: string; model?: string; prompt: string; image?: string; emit: Emit }): Promise<Artifact> {
  const { provider, prompt, image, emit } = options;
  if (provider === 'codex') {
    const dir = join(DATA, 'runs', crypto.randomUUID());
    await mkdir(dir, { recursive: true });
    const schemaPath = join(dir, 'schema.json'), outputPath = join(dir, 'result.json');
    await Bun.write(schemaPath, JSON.stringify(schema));
    const args = ['codex', 'exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '--output-schema', schemaPath, '--output-last-message', outputPath, '--json', '-'];
    if (options.model) args.splice(args.length - 1, 0, '--model', options.model);
    if (image) args.splice(args.length - 1, 0, '--image', image);
    const child = Bun.spawn(args, { cwd: ROOT, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    child.stdin.write(prompt); child.stdin.end();
    const timer = setTimeout(() => child.kill(), 180_000);
    const stdout = new Response(child.stdout).text();
    const stderr = new Response(child.stderr).text();
    try {
      const code = await child.exited;
      const [events, errors] = await Promise.all([stdout, stderr]);
      if (code !== 0) throw new Error(`Codex exited ${code}: ${errors.slice(-3000)} ${events.slice(-3000)}`);
      for (const line of events.split('\n')) {
        try { const event = JSON.parse(line); if (event.type === 'turn.completed') emit({ type: 'usage', message: 'Codex generation complete', usage: event.usage }); } catch {}
      }
      return parseArtifact(await readFile(outputPath, 'utf8'));
    } finally { clearTimeout(timer); await rm(dir, { recursive: true, force: true }); }
  }
  if (provider !== 'openrouter') throw new Error(`Unknown provider: ${provider}`);
  return parseArtifact(await requestOpenRouter({ ...options, schema, schemaName: 'exact_app', maxTokens: 12000 }));
}

export async function generateMetadata(prompt: string, image: string | undefined, emit: Emit): Promise<Metadata> {
  const metadataSchema = {
    type: 'object', additionalProperties: false, required: ['id', 'name', 'description'],
    properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' } },
  };
  const result = await requestOpenRouter({
    model: 'meta/muse-ember', image, emit, schema: metadataSchema, schemaName: 'project_metadata', maxTokens: 1500,
    prompt: `Name this iOS app from the user's request${image ? ' and attached reference image' : ''}. Return only JSON with id, name, description. id must be concise lowercase kebab-case, start with a letter, contain only a-z, 0-9 or hyphens, and be at most 48 characters. name must be a short polished app name, at most 80 characters. description must be a single concrete sentence, at most 500 characters. Describe only what the user requested. Request:\n${prompt}`,
  });
  return parseMetadata(result);
}

export async function requestOpenRouter(options: { model?: string; prompt: string; image?: string; emit: Emit; schema: object; schemaName: string; maxTokens: number }): Promise<string> {
  const { prompt, image, emit } = options;
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('Set OPENROUTER_API_KEY for OpenRouter generation');
  const content: any[] = [{ type: 'text', text: prompt }];
  if (image) {
    const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' } as Record<string, string>)[extname(image).toLowerCase()];
    if (!mime) throw new Error('Images must be PNG, JPEG, or WebP');
    const bytes = await readFile(image);
    if (bytes.length > 20 * 1024 * 1024) throw new Error('Image is larger than 20 MB');
    content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${bytes.toString('base64')}` } });
  }
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(180_000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Exact Create' },
    body: JSON.stringify({ model: options.model || 'meta/muse-ember', reasoning: { effort: process.env.OPENROUTER_REASONING_EFFORT || 'low' }, max_tokens: options.maxTokens, messages: [{ role: 'user', content }], response_format: { type: 'json_schema', json_schema: { name: options.schemaName, strict: true, schema: options.schema } } }),
  });
  const body = await response.json() as any;
  if (!response.ok || body.error) throw new Error(`OpenRouter: ${body.error?.message || response.status}`);
  emit({ type: 'usage', message: options.schemaName === 'project_metadata' ? 'Muse Ember named the project' : `${(options.model || 'meta/muse-ember') === 'meta/muse-ember' ? 'Muse Ember' : options.model} generation complete`, stage: options.schemaName, usage: body.usage, model: body.model });
  return body.choices?.[0]?.message?.content || '';
}
