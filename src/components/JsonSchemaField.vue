<script setup lang="ts">
/// One field of a JSON-Schema form. Recurses for `type: "object"`.
///
/// Stateless: reads/writes through the parent via `readValue` / `update`
/// closures so the parent owns the single source of truth (avoids the
/// "two-way binding via prop-mutation" foot-gun and lets validate()
/// inspect the same store the inputs write to).

import { computed } from "vue";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import RadioButton from "primevue/radiobutton";
import Dropdown from "primevue/dropdown";
import InputSwitch from "primevue/toggleswitch";
import Button from "primevue/button";

type JsonSchema = {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  oneOf?: Array<{ const?: unknown; title?: string }>;
  format?: "email" | "uri" | "date" | "date-time";
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
  path: string[];
  required: boolean;
  readValue: (path: string[]) => unknown;
  update: (path: string[], v: unknown) => void;
  enumOptions: (schema: JsonSchema) => Array<{ value: unknown; label: string }>;
  htmlInputType: (format?: JsonSchema["format"]) => string;
}>();

const label = computed(() => props.schema.title ?? props.path[props.path.length - 1] ?? "");
const fieldId = computed(() => `jsf-${props.path.join("-")}`);
const current = computed(() => props.readValue(props.path));

const isEnum = computed(
  () => (props.schema.enum && props.schema.enum.length > 0)
    || (props.schema.oneOf && props.schema.oneOf.length > 0),
);
const enumOpts = computed(() => props.enumOptions(props.schema));
const useRadio = computed(() => isEnum.value && enumOpts.value.length <= 4);
const useDropdown = computed(() => isEnum.value && enumOpts.value.length > 4);

const textValue = computed({
  get: () => (typeof current.value === "string" ? current.value : ""),
  set: (v: string) => props.update(props.path, v),
});

const numberValue = computed({
  get: () => (typeof current.value === "number" ? current.value : null),
  set: (v: number | null) => props.update(props.path, v),
});

const booleanValue = computed({
  get: () => current.value === true,
  set: (v: boolean) => props.update(props.path, v),
});

const enumValue = computed({
  get: () => current.value,
  set: (v: unknown) => props.update(props.path, v),
});

const arrayValue = computed(() => {
  const v = current.value;
  return Array.isArray(v) ? v : [];
});

const nestedProperties = computed(() => {
  if (props.schema.type === "object" && props.schema.properties) {
    return Object.entries(props.schema.properties).map(([key, sub]) => ({
      key,
      schema: sub,
      required: (props.schema.required ?? []).includes(key),
    }));
  }
  return [];
});

function addArrayItem(): void {
  const items = props.schema.items ?? { type: "string" };
  const seed =
    items.default !== undefined
      ? structuredClone(items.default)
      : items.type === "number" || items.type === "integer"
        ? null
        : items.type === "boolean"
          ? false
          : items.type === "object"
            ? {}
            : "";
  props.update(props.path, [...arrayValue.value, seed]);
}

function removeArrayItem(idx: number): void {
  const next = [...arrayValue.value];
  next.splice(idx, 1);
  props.update(props.path, next);
}

function updateArrayItem(idx: number, v: unknown): void {
  const next = [...arrayValue.value];
  next[idx] = v;
  props.update(props.path, next);
}
</script>

<template>
  <!-- Object: nested fieldset, recurses -->
  <fieldset v-if="schema.type === 'object'" class="jsf-fieldset">
    <legend class="jsf-legend">
      {{ label }}<span v-if="required" class="jsf-required" aria-label="required">*</span>
    </legend>
    <p v-if="schema.description" class="jsf-description">{{ schema.description }}</p>
    <JsonSchemaField
      v-for="prop in nestedProperties"
      :key="prop.key"
      :schema="prop.schema"
      :path="[...path, prop.key]"
      :required="prop.required"
      :read-value="readValue"
      :update="update"
      :enum-options="enumOptions"
      :html-input-type="htmlInputType"
    />
  </fieldset>

  <!-- Array: repeated rows of items -->
  <div v-else-if="schema.type === 'array'" class="jsf-field">
    <label class="jsf-label" :for="fieldId">
      {{ label }}<span v-if="required" class="jsf-required" aria-label="required">*</span>
    </label>
    <p v-if="schema.description" class="jsf-description">{{ schema.description }}</p>
    <div class="jsf-array">
      <div
        v-for="(_item, idx) in arrayValue"
        :key="idx"
        class="jsf-array-row"
      >
        <JsonSchemaField
          :schema="schema.items ?? { type: 'string' }"
          :path="[...path, String(idx)]"
          :required="false"
          :read-value="readValue"
          :update="(_p, v) => updateArrayItem(idx, v)"
          :enum-options="enumOptions"
          :html-input-type="htmlInputType"
        />
        <Button
          icon="pi pi-times"
          severity="secondary"
          text
          rounded
          size="small"
          aria-label="Remove item"
          @click="removeArrayItem(idx)"
        />
      </div>
      <Button
        label="Add item"
        icon="pi pi-plus"
        severity="secondary"
        size="small"
        @click="addArrayItem"
      />
    </div>
  </div>

  <!-- Enum (string with enum/oneOf): radio for ≤4, dropdown for >4 -->
  <div v-else-if="isEnum" class="jsf-field">
    <label class="jsf-label" :for="fieldId">
      {{ label }}<span v-if="required" class="jsf-required" aria-label="required">*</span>
    </label>
    <p v-if="schema.description" class="jsf-description">{{ schema.description }}</p>
    <div v-if="useRadio" class="jsf-radios">
      <label
        v-for="opt in enumOpts"
        :key="String(opt.value)"
        class="jsf-radio-option"
      >
        <RadioButton
          :model-value="enumValue"
          :value="opt.value"
          :name="fieldId"
          @update:model-value="enumValue = $event"
        />
        <span>{{ opt.label }}</span>
      </label>
    </div>
    <Dropdown
      v-else-if="useDropdown"
      :id="fieldId"
      :model-value="enumValue"
      :options="enumOpts"
      option-label="label"
      option-value="value"
      placeholder="Select…"
      @update:model-value="enumValue = $event"
    />
  </div>

  <!-- Number / integer -->
  <div v-else-if="schema.type === 'number' || schema.type === 'integer'" class="jsf-field">
    <label class="jsf-label" :for="fieldId">
      {{ label }}<span v-if="required" class="jsf-required" aria-label="required">*</span>
    </label>
    <p v-if="schema.description" class="jsf-description">{{ schema.description }}</p>
    <InputNumber
      :input-id="fieldId"
      :model-value="numberValue"
      :min="schema.minimum"
      :max="schema.maximum"
      :max-fraction-digits="schema.type === 'integer' ? 0 : 20"
      :use-grouping="false"
      @update:model-value="numberValue = $event"
    />
  </div>

  <!-- Boolean -->
  <div v-else-if="schema.type === 'boolean'" class="jsf-field jsf-field-inline">
    <InputSwitch
      :input-id="fieldId"
      :model-value="booleanValue"
      @update:model-value="booleanValue = $event"
    />
    <label class="jsf-label" :for="fieldId">
      {{ label }}<span v-if="required" class="jsf-required" aria-label="required">*</span>
    </label>
    <p v-if="schema.description" class="jsf-description jsf-description-inline">
      {{ schema.description }}
    </p>
  </div>

  <!-- String (text / email / uri / date / date-time) -->
  <div v-else class="jsf-field">
    <label class="jsf-label" :for="fieldId">
      {{ label }}<span v-if="required" class="jsf-required" aria-label="required">*</span>
    </label>
    <p v-if="schema.description" class="jsf-description">{{ schema.description }}</p>
    <InputText
      :id="fieldId"
      :model-value="textValue"
      :type="htmlInputType(schema.format)"
      :minlength="schema.minLength"
      :maxlength="schema.maxLength"
      @update:model-value="textValue = $event ?? ''"
    />
  </div>
</template>

<style scoped>
.jsf-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.jsf-field-inline {
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.jsf-label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--p-text-color);
}

.jsf-required {
  color: var(--p-red-500);
  margin-left: 0.2em;
}

.jsf-description {
  margin: 0;
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
}

.jsf-description-inline {
  flex: 1 1 100%;
  margin-left: calc(2.5rem + 0.5rem);
}

.jsf-fieldset {
  margin: 0;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--p-surface-border);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.jsf-legend {
  padding: 0 0.4em;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--p-text-color);
}

.jsf-radios {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.jsf-radio-option {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.88rem;
  cursor: pointer;
}

.jsf-array {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.jsf-array-row {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
}

.jsf-array-row > :first-child {
  flex: 1 1 auto;
  min-width: 0;
}
</style>
