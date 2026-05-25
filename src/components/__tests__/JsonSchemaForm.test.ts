import { describe, expect, test } from 'bun:test';
import { render, fireEvent, cleanup } from '@testing-library/vue';
import { ref, nextTick, h } from 'vue';
import PrimeVue from 'primevue/config';
import JsonSchemaForm from '../JsonSchemaForm.vue';

/// JsonSchemaForm renders inputs per JSON-Schema and validates required.
///
/// We don't need a Pinia harness — the component is intentionally
/// closure-driven (no store access), so a plain render is enough.

function mountForm(schema: Record<string, unknown>) {
  const model = ref<Record<string, unknown>>({});
  // Capture the form instance via a template ref. testing-library/vue
  // doesn't expose component refs directly, so we render a tiny wrapper.
  const formRef = ref<{ validate: () => string | null } | null>(null);
  const utils = render(
    {
      components: { JsonSchemaForm },
      setup() {
        return () =>
          h(JsonSchemaForm, {
            ref: (el: unknown) => {
              formRef.value = el as { validate: () => string | null } | null;
            },
            schema,
            modelValue: model.value,
            'onUpdate:modelValue': (v: Record<string, unknown>) => {
              model.value = v;
            },
          });
      },
    },
    { global: { plugins: [PrimeVue] } },
  );
  return { utils, model, formRef };
}

describe('JsonSchemaForm', () => {
  test('seeds defaults from the schema on mount', async () => {
    const { model } = mountForm({
      type: 'object',
      properties: {
        host: { type: 'string', default: 'localhost' },
        port: { type: 'integer', default: 5432 },
        ssl: { type: 'boolean', default: true },
      },
    });
    await nextTick();
    expect(model.value).toEqual({ host: 'localhost', port: 5432, ssl: true });
    cleanup();
  });

  test('validate() returns first missing required field path', async () => {
    const { formRef } = mountForm({
      type: 'object',
      required: ['host', 'port'],
      properties: {
        host: { type: 'string' },
        port: { type: 'integer' },
      },
    });
    await nextTick();
    expect(formRef.value).not.toBeNull();
    expect(formRef.value!.validate()).toBe('host');
    cleanup();
  });

  test('validate() returns null when required fields are filled', async () => {
    const { formRef, model } = mountForm({
      type: 'object',
      required: ['host'],
      properties: { host: { type: 'string', default: 'x' } },
    });
    await nextTick();
    expect(formRef.value!.validate()).toBe(null);
    expect(model.value.host).toBe('x');
    cleanup();
  });

  test('text input updates the model on user input', async () => {
    const { model, utils } = mountForm({
      type: 'object',
      properties: { name: { type: 'string', title: 'Name' } },
    });
    await nextTick();
    const input = utils.container.querySelector('input[type=text]')!;
    expect(input).not.toBeNull();
    await fireEvent.update(input, 'Alice');
    await nextTick();
    expect(model.value.name).toBe('Alice');
    cleanup();
  });

  test('renders enum oneOf as radio buttons (≤4 options)', async () => {
    const { utils } = mountForm({
      type: 'object',
      properties: {
        env: {
          type: 'string',
          oneOf: [
            { const: 'dev', title: 'Development' },
            { const: 'prod', title: 'Production' },
          ],
        },
      },
    });
    await nextTick();
    // PrimeVue RadioButton renders an input[type=radio] internally.
    const radios = utils.container.querySelectorAll('input[type=radio]');
    expect(radios.length).toBe(2);
    cleanup();
  });

  test('recurses into nested objects', async () => {
    const { model, utils } = mountForm({
      type: 'object',
      properties: {
        creds: {
          type: 'object',
          properties: {
            user: { type: 'string', default: 'u' },
          },
        },
      },
    });
    await nextTick();
    expect(model.value).toEqual({ creds: { user: 'u' } });
    // The nested fieldset should be in the DOM.
    expect(utils.container.querySelector('fieldset')).not.toBeNull();
    cleanup();
  });

  test('validate() walks nested required', async () => {
    const { formRef } = mountForm({
      type: 'object',
      required: ['creds'],
      properties: {
        creds: {
          type: 'object',
          required: ['user'],
          properties: { user: { type: 'string' } },
        },
      },
    });
    await nextTick();
    expect(formRef.value!.validate()).toBe('creds.user');
    cleanup();
  });
});
