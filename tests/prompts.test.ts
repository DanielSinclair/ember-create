import { expect, test } from 'bun:test';
import { generationPrompt } from '../src/providers';

const request = 'Build an app that allows me to see my step count; it should be green and show a plant growing as I get closer to 10,000 step goal each day';

test('the original singular step-count request gets real HealthKit instructions and resource grammar', async () => {
  const prompt = await generationPrompt('step-sprout', request);
  expect(prompt).toContain('HEALTH DATA REQUIREMENT');
  expect(prompt).toContain('from "@exact/health"');
  expect(prompt).toContain('resource steps = healthStatistics(');
  expect(prompt).toContain('A request to see step count does NOT authorize a manual counter');
  expect(prompt).toContain('Only use manual/sample steps when the user explicitly asks');
  expect(prompt).toContain('as shape Count else empty()');
  expect(prompt).toContain('Never use "as number"');
});

test('unrelated step-by-step instructions do not pull in HealthKit', async () => {
  const prompt = await generationPrompt('recipe', 'A step-by-step recipe app');
  expect(prompt).not.toContain('HEALTH DATA REQUIREMENT');
  expect(prompt).toContain('Contract resource syntax is mandatory');
});

test('a growing plant request requires a visible progress-dependent graphic', async () => {
  const prompt = await generationPrompt('step-bloom', request);
  expect(prompt).toContain('PLANT VISUAL REQUIREMENT');
  expect(prompt).toContain('A stage label, step count, or progress bar alone does not satisfy');
  expect(prompt).toContain('image "symbol:sf/leaf.fill" font-size=leafSize');
  expect(prompt).toContain('height=stemHeight');
  expect(prompt).toContain('ratio is clamped 0–1');
  expect(prompt).toContain('leafSize = 36 + ratio * 60');
  expect(prompt).toContain('36, 66 and 96 points');
  expect(prompt).toContain('never manufacture zero steps or 0% growth');
});

test('requested aesthetics override starter styling and references do not dictate the screen', async () => {
  const editorial = 'A warm editorial focus timer with cream paper, terracotta buttons, large tabular time, thin dividers, and no cards or motivational slogans';
  const prompt = await generationPrompt('paper-focus', editorial);
  expect(prompt).toContain(editorial);
  expect(prompt).toContain('Explicit author styling wins over the platform defaults');
  expect(prompt).toContain('Honor requests such as "no cards"');
  expect(prompt).toContain('same padded content column');
  expect(prompt).toContain('choose distinct screen/surface colors');
  expect(prompt).toContain('matching scroll/list id="name"');
  expect(prompt).toContain('must omit buttonStyle');
  expect(prompt).toContain('minimum 44-point hit height');
  expect(prompt).toContain('Timer behavior reference only');
  expect(prompt).toContain('Pausing must preserve the remaining duration');
  expect(prompt).not.toContain('HEALTH DATA REQUIREMENT');
  const botanical = await generationPrompt('step-garden', request);
  expect(botanical).toContain('Validated pedometer API reference only');
  expect(botanical).toContain('not its screen layout, visual styling, headings, or lengthy privacy copy');
  expect(botanical).toContain('brief secondary sentence');
});

test('repairs both scalar resources and missing as clauses with a concrete replacement', async () => {
  for (const declaration of ['resource steps = loadSteps() as number else 0', 'resource steps = loadSteps() else 0']) {
    const previous = { name: 'Step Sprout', contract: `component StepSprout\n  ${declaration}\n`, typescript: '', tests: '' };
    const diagnostics = declaration.includes('as number') ? 'expected `shape`, found `number`' : 'expected `as`, found `else`';
    const prompt = await generationPrompt('step-sprout', request, previous, diagnostics);
    expect(prompt).toContain(`Replace this invalid declaration: ${declaration}`);
    expect(prompt).toContain('change the TypeScript source to return that exact record');
    expect(prompt).toContain('instead of a custom scalar loadSteps source');
    expect(prompt).toContain(diagnostics);
  }
});
