import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { hasNativeModelInputTypes, patchModelImageInputSource, patchModelSelectContrastSource } = require('../scripts/patch-deps.js');
const modelsFile = new URL('../node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js', import.meta.url);
const presetFile = new URL('../node_modules/@deepseek-ai/dsh-client-ui-agent-preset/lib/client.js', import.meta.url);
const jsx = (type: unknown, props: any) => ({ type, props });
const runtime = { jsx, jsxs: jsx };

test('0.2.1 model selects retain the mainline contrast fix on the real bundle', {
  skip: !existsSync(modelsFile),
}, () => {
  const source = readFileSync(modelsFile, 'utf8');
  const anchor = source.match(/select\.([A-Za-z0-9_-]+_input)\{cursor:pointer;max-width:240px\}/);
  assert.ok(anchor, 'the reviewed model select anchor must remain present');
  const patched = patchModelSelectContrastSource(source);
  assert.ok(patched);
  const selector = `select.${anchor[1]}`;
  assert.ok(patched.includes(`${selector}{background-color:#232324;color:#f9fafb;color-scheme:light}`));
  assert.ok(patched.includes(`${selector}::picker(select){background-color:#ffffff!important;color:#1b1b1c!important`));
  assert.ok(patched.includes(`${selector} option{background-color:#ffffff!important;color:#1b1b1c!important`));
  assert.ok(patched.includes(`${selector} option:checked{background-color:#e8f0fe!important;color:#1b1b1c!important}`));
  assert.equal(patched.split('/*dsh-desktop-select-contrast*/').length, 2);
  assert.equal(patchModelSelectContrastSource(patched), patched);
  assert.equal(patchModelSelectContrastSource('const upstreamChanged = true;'), undefined);
  assert.ok(hasNativeModelInputTypes(patched), 'native image input controls must remain intact');
});

test('0.2.1 native input types retain nonempty selection and image metadata semantics', {
  skip: !existsSync(modelsFile),
}, () => {
  const source = readFileSync(modelsFile, 'utf8');
  assert.ok(hasNativeModelInputTypes(source));
  assert.equal(patchModelImageInputSource(source), source);
  const start = source.indexOf('function ModelInputTypes(');
  const body = source.slice(start, source.indexOf('//#endregion', start));
  const render = new Function('react_jsx_runtime', 'ModelsSection_module_css_default',
    '_deepseek_ai_dsh_client_ui_primitives', `${body};return ModelInputTypes;`)(runtime, {}, { Checkbox: 'checkbox' });
  let next: any;
  const model = { id: 'custom', inputModalities: ['text', 'image'], imagePixelBudget: 123, imageMaxBytes: 456, context: 8192 };
  const choices = (value: any, field = 'inputModalities', disabled = false, fallback?: string[]) => render({
    model: value, field, position: 0, disabled, fallback, t: (key: string) => key,
    onChange: (value: any) => { next = value; },
  }).props.children[1].props.children;
  const initial = choices({ id: 'inherited' });
  assert.equal(initial[0].props.checked, true);
  assert.equal(initial[0].props.disabled, true);
  initial[1].props.onChange(true);
  assert.deepEqual(next.inputModalities, ['text', 'image']);
  choices(model)[1].props.onChange(false);
  assert.deepEqual(next, { id: 'custom', inputModalities: ['text'], context: 8192 });
  assert.deepEqual(model.inputModalities, ['text', 'image'], 'the input model must not be mutated');
  choices({ input: ['text'] }, 'input')[1].props.onChange(true);
  assert.deepEqual(next.input, ['text', 'image']);
  assert.ok(choices(model, 'inputModalities', true).every((item: any) => item.props.disabled));
  const inherited = choices({}, 'inputModalities', false, ['image']);
  assert.equal(inherited[1].props.checked, true);
  assert.equal(inherited[1].props.disabled, true);
});

test('0.2.1 preset grouping consumes the developerTools-filtered options', {
  skip: !existsSync(presetFile),
}, () => {
  const source = readFileSync(presetFile, 'utf8');
  const start = source.indexOf('function AgentPresetSeat(');
  const seat = source.slice(start);
  const filter = seat.match(/const options = (.*);/);
  const itemsStart = seat.indexOf('items: ');
  const itemsEnd = seat.indexOf(',\n\t\t\t\tselectedId: state.current', itemsStart);
  assert.ok(filter && itemsStart >= 0 && itemsEnd > itemsStart);
  const render = new Function('state', 'developerTools', 'react', 'requiresCodingTools',
    'react_jsx_runtime', 'AgentPresetSeat_module_css_default', 'presetDisplayText', 't',
    `const options = ${filter[1]}; return ${seat.slice(itemsStart + 7, itemsEnd)};`);
  const options = [
    { id: 'basic', trust: 'system' }, { id: 'ptc', trust: 'system' },
    { id: 'custom', trust: 'user' }, { id: 'minimal', trust: 'system' },
  ];
  const run = (developerTools: boolean) => render({ options }, developerTools, { useMemo: (fn: any) => fn() },
    (option: any) => option.trust === 'system' && ['ptc', 'minimal'].includes(option.id), runtime, {},
    (option: any) => ({ name: option.id, description: 'description' }), (key: string) => key);
  const restricted = run(false);
  assert.deepEqual(restricted.map((item: any) => item.id), ['basic', 'dsh-desktop:third-party']);
  assert.deepEqual(restricted[1].submenu.map((item: any) => item.id), ['custom']);
  assert.equal(restricted[1].submenu[0].label.props.style.flexDirection, 'column');
  assert.deepEqual(run(true).map((item: any) => item.id), ['basic', 'ptc', 'minimal', 'dsh-desktop:third-party']);
});
