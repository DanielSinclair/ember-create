import { readFile, mkdir, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { DATA, ROOT, parseArtifact, parseMetadata, type Artifact, type Metadata } from './projects';
import { GRANTS } from '../tools/container.mjs';

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

const plantGuidance = `PLANT VISUAL REQUIREMENT: Render an actual visible plant graphic. A stage label, step count, or progress bar alone does not satisfy a request for a growing plant. Use supported inline SVG, or a leaf symbol above a stem; vary its visible size or leaf count with real goal progress. This small supported iOS example assumes progress is a clamped 0–100 percentage derived from an available HealthKit sample:
  derive leafSize = 36 + progress * 0.6
  derive stemHeight = 20 + progress * 0.8
  view
    column align-items="center" gap=0
      image "symbol:sf/leaf.fill" font-size=leafSize width=leafSize height=leafSize color="-exact-system-green" aria-label="Your growing plant" testId="plant-leaves"
      column width=8 height=stemHeight background-color="-exact-system-green" border-radius=4 testId="plant-stem"

The symbol glyph scales with font-size, not width alone. Place the plant in the known-data branch and derive progress from the returned real count and the user's goal. In unknown/empty/unavailable states show an honest placeholder; never manufacture zero steps or 0% growth. Preserve the requested visual colors and the plant even when revising an earlier artifact that omitted it.\n\n`;

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

export async function generationPrompt(id: string, request: string, previous?: Artifact, diagnostics?: string, metadata?: Metadata) {
  const guide = await readFile(join(ROOT, 'exact/docs/start-here.md'), 'utf8');
  const health = requestsHealth(request)
    ? `HEALTH DATA REQUIREMENT: Step tracking means the person's real Apple HealthKit step count. The container includes @exact/health. Use healthStatus, requestHealthAuthorization and healthStatistics with their imported shapes. A request to see step count does NOT authorize a manual counter, synthetic increments, fake data, or +100/+1000 buttons. Only use manual/sample steps when the user explicitly asks for manual entry or sample data; otherwise replace any previous artifact's loadSteps/addSteps/resetSteps simulation with the real HealthKit reference. A goal/plant visualization must derive progress from returned HealthKit samples and retain honest unavailable/empty/error states. Use its Contract API (not a TypeScript import). Treat unavailable/unknown/denied and empty data honestly. No invented health samples. Apple does not reveal whether read access was denied; an empty result is not proof of denial or zero. The exact interface follows:\n${await readFile(join(ROOT, 'exact/packages/health/exact.json'), 'utf8')}\nValidated pedometer reference (adapt its name, root component and tests for this project):\napp.contract:\n${await readFile(join(ROOT, 'demos/pedometer/app.contract'), 'utf8')}\napp.ts:\n${await readFile(join(ROOT, 'demos/pedometer/app.ts'), 'utf8')}\n`
    : '';
  return `Generate an interactive iOS app in Expo Exact Contract. Return ONLY the JSON artifact matching the schema. Do not use tools or modify files. The compiler will validate your answer and send errors back.\n\n` +
    `Project ID: ${id}. Request: ${request}\n` +
    (metadata ? `App name: ${metadata.name}. Description: ${metadata.description}. Use this exact app name.\n` : '') +
    `Fields: name, contract (complete app.contract), typescript (complete app.ts, or empty if no data sources), tests (Exact behavioral test).\n` +
    `This runs in a prebuilt container. No new native modules, dependencies, remote images, external assets or other files. App ID stays com.exactcreate.demo. If TypeScript is needed, export grants EXACTLY ${JSON.stringify(GRANTS)}; omit appId or use com.exactcreate.demo. Persisted paths MUST start app:/data/${id}-. Import TypeScript types only from './app.contract.d.ts'. Use a unique PascalCase root component based on project ID. Prefer Contract actions/state and native controls. Implement the requested interactions. For durable data use the supplied storage recipe. No build scripts, shell commands, or network calls. Keep it compact and valid.\n\n` +
    resourcePrimer + (/\b(?:plant|sprout|seedling|garden)\b/i.test(request) ? plantGuidance : '') + health + guide + (previous ? `\n\nPrevious artifact:\n${JSON.stringify(previous)}` : '') +
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

async function requestOpenRouter(options: { model?: string; prompt: string; image?: string; emit: Emit; schema: object; schemaName: string; maxTokens: number }): Promise<string> {
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
