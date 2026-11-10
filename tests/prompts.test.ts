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
  expect(prompt).toContain('never manufacture zero steps or 0% growth');
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
