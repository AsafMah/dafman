<script setup lang="ts">
/// JSON-Schema → form renderer used by elicitation form-mode.
///
/// Why this exists: MCP servers send a subset-of-JSON-Schema describing
/// what they want from the user (config object, OAuth-like form, free-
/// form questionnaire). Showing the raw schema as JSON would be hostile.
/// This component walks the schema and emits the right PrimeVue control
/// per field.
///
/// Supported (per MCP elicitation spec + general JSON-Schema):
/// - `type: "object"` with `properties` + `required` → fieldset
/// - `type: "string"` → InputText (text/email/uri/date/datetime-local
///   depending on `format`)
/// - `type: "string"` + `enum` → RadioButton group (≤4) / Dropdown (>4)
/// - `type: "number"` | `"integer"` → InputNumber (integer locks step=1)
/// - `type: "boolean"` → InputSwitch
/// - `type: "array"` with primitive `items` → repeated input rows w/ ＋／－
/// - Nested objects → recurse
///
/// `default`, `description`, `title` are honored on every node.
///
/// `validate()` (exposed via defineExpose) returns the first error path
/// or null. The card wires "Submit" through that gate.

import { computed, ref, watch } from 'vue';
import JsonSchemaField from '@/components/shared/JsonSchemaField.vue';

type JsonSchema = {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  /// MCP `oneOf: [{ const, title }]` carries human-readable labels.
  oneOf?: Array<{ const?: unknown; title?: string }>;
  format?: 'email' | 'uri' | 'date' | 'date-time';
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
};

const props = defineProps<{
  schema: JsonSchema;
  modelValue: Record<string, unknown>;
  /// Field-path → boolean. When a child field changes, we wipe its
  /// "touched" mark on the way out so the next validate() flags it.
  /// Reserved for future; current pass validates on submit.
  required?: string[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, unknown>): void;
}>();

const value = ref<Record<string, unknown>>({ ...props.modelValue });

// Seed defaults from the schema once (so an empty `modelValue` still
// presents the user with sensible starting values).
function seedDefaults(schema: JsonSchema, target: Record<string, unknown>): void {
  if (schema.type !== 'object' || !schema.properties) return;

  for (const [key, sub] of Object.entries(schema.properties)) {
    if (target[key] !== undefined) continue;

    if (sub.default !== undefined) {
      target[key] = structuredClone(sub.default);
      continue;
    }

    if (sub.type === 'object') {
      const child: Record<string, unknown> = {};

      seedDefaults(sub, child);
      target[key] = child;
      continue;
    }

    if (sub.type === 'array') {
      target[key] = [];
      continue;
    }

    if (sub.type === 'boolean') {
      target[key] = false;
    }
  }
}

seedDefaults(props.schema, value.value);
emit('update:modelValue', value.value);

watch(
  () => props.modelValue,
  (next) => {
    // External resets (e.g. card cancel) — refill local state.
    value.value = { ...next };
    seedDefaults(props.schema, value.value);
  },
);

function update(path: string[], v: unknown): void {
  // Walk path on a shallow-cloned chain so Vue picks up the change.
  const root: Record<string, unknown> = { ...value.value };
  let cursor: Record<string, unknown> = root;

  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    const next = { ...(cursor[seg] as Record<string, unknown>) };

    cursor[seg] = next;
    cursor = next;
  }

  cursor[path[path.length - 1]] = v;
  value.value = root;
  emit('update:modelValue', root);
}

function readPath(path: string[]): unknown {
  let cursor: unknown = value.value;

  for (const seg of path) {
    if (cursor && typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }

  return cursor;
}

// PrimeVue InputText/InputNumber's `format` prop is for number locale,
// not html-input type. We pass `type=` directly to the underlying input
// via `inputProps` for InputText. Map JSON-Schema format → html input.
function htmlInputType(format?: JsonSchema['format']): string {
  switch (format) {
    case 'email':
      return 'email';
    case 'uri':
      return 'url';
    case 'date':
      return 'date';
    case 'date-time':
      return 'datetime-local';
    default:
      return 'text';
  }
}

function enumOptions(schema: JsonSchema): Array<{ value: unknown; label: string }> {
  if (schema.oneOf && schema.oneOf.length > 0) {
    return schema.oneOf.map((opt) => ({
      value: opt.const,
      label: opt.title ?? String(opt.const),
    }));
  }

  if (schema.enum && schema.enum.length > 0) {
    return schema.enum.map((v) => ({ value: v, label: String(v) }));
  }

  return [];
}

/// Validate an object node — required + recurse into properties.
function validateObjectNode(schema: JsonSchema, v: unknown, path: string[]): string | null {
  const obj = (v ?? {}) as Record<string, unknown>;
  const req = schema.required ?? [];

  for (const key of req) {
    const child = obj[key];
    const isEmpty =
      child === undefined ||
      child === null ||
      (typeof child === 'string' && child.trim() === '') ||
      (Array.isArray(child) && child.length === 0);

    if (isEmpty) return [...path, key].join('.') || key;
  }

  if (schema.properties) {
    for (const [key, sub] of Object.entries(schema.properties)) {
      const err = validateNode(sub, obj[key], [...path, key]);

      if (err) return err;
    }
  }

  return null;
}

/// Validate an array node — minItems / maxItems.
function validateArrayNode(schema: JsonSchema, v: unknown, path: string[]): string | null {
  if (!Array.isArray(v)) return null;

  if (schema.minItems !== undefined && v.length < schema.minItems) {
    return path.join('.') || '(array)';
  }

  if (schema.maxItems !== undefined && v.length > schema.maxItems) {
    return path.join('.') || '(array)';
  }

  return null;
}

/// Validate a string node — minLength / maxLength.
function validateStringNode(schema: JsonSchema, v: unknown, path: string[]): string | null {
  if (typeof v !== 'string') return null;

  if (schema.minLength !== undefined && v.length < schema.minLength) {
    return path.join('.') || '(string)';
  }

  if (schema.maxLength !== undefined && v.length > schema.maxLength) {
    return path.join('.') || '(string)';
  }

  return null;
}

/// Validate a number/integer node — minimum / maximum.
function validateNumberNode(schema: JsonSchema, v: unknown, path: string[]): string | null {
  if (typeof v !== 'number') return null;

  if (schema.minimum !== undefined && v < schema.minimum) {
    return path.join('.') || '(number)';
  }

  if (schema.maximum !== undefined && v > schema.maximum) {
    return path.join('.') || '(number)';
  }

  return null;
}

/// Top-level required-set for validate(). Recursing only honors immediate
/// `required` lists — nested schemas carry their own.
function validateNode(schema: JsonSchema, v: unknown, path: string[]): string | null {
  if (schema.type === 'object') return validateObjectNode(schema, v, path);

  if (schema.type === 'array') return validateArrayNode(schema, v, path);

  if (schema.type === 'string') return validateStringNode(schema, v, path);

  if (schema.type === 'number' || schema.type === 'integer') {
    return validateNumberNode(schema, v, path);
  }

  return null;
}

function validate(): string | null {
  return validateNode(props.schema, value.value, []);
}

defineExpose({ validate });

// Top-level properties array — when root isn't an object, we still
// render a single field at path `[]`.
const rootProperties = computed(() => {
  if (props.schema.type === 'object' && props.schema.properties) {
    return Object.entries(props.schema.properties).map(([key, sub]) => ({
      key,
      schema: sub,
      required: (props.schema.required ?? []).includes(key),
    }));
  }

  return [];
});
</script>

<template>
  <div
    class="json-schema-form"
    role="group"
  >
    <p
      v-if="schema.description"
      class="form-description"
    >
      {{ schema.description }}
    </p>

    <template v-if="rootProperties.length > 0">
      <JsonSchemaField
        v-for="prop in rootProperties"
        :key="prop.key"
        :schema="prop.schema"
        :path="[prop.key]"
        :required="prop.required"
        :read-value="readPath"
        :update="update"
        :enum-options="enumOptions"
        :html-input-type="htmlInputType"
      />
    </template>
    <p
      v-else
      class="form-empty"
    >
      No fields requested.
    </p>
  </div>
</template>

<style scoped>
.json-schema-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.form-description {
  margin: 0;
  font-size: 0.85rem;
  color: var(--p-text-muted-color);
}

.form-empty {
  margin: 0;
  font-style: italic;
  color: var(--p-text-muted-color);
}
</style>
