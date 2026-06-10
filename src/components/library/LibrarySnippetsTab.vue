<script setup lang="ts">
/// Library → Snippets tab.
///
/// CRUD for user-created prompt snippets. Each row shows title + tag pills.
/// Row actions: Insert (into active session's composer), Edit (inline form),
/// Delete (with confirm). Inline form: title input, body textarea with char
/// counter (max 10 000), tags (comma-separated), optional shortcut.

import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import ConfirmPopup from 'primevue/confirmpopup';
import { useConfirm } from 'primevue/useconfirm';
import type { Snippet } from '@/ipc/types';
import { useSnippetsStore } from '@/stores/snippetsStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useToastStore } from '@/stores/app/toastStore';
import { insertSnippetIntoComposer } from '@/lib/insertSnippetIntoComposer';
import LibraryTabHeader from '@/components/library/LibraryTabHeader.vue';
import type { LibraryTabHeaderAction } from '@/components/library/libraryTabHeader';

const snippetsStore = useSnippetsStore();
const { snippets, loaded, error } = storeToRefs(snippetsStore);
const layoutStore = useLayoutStore();
const toasts = useToastStore();
const confirm = useConfirm();

const BODY_MAX = 10_000;

// ---------------------------------------------------------------------------
// Header actions
// ---------------------------------------------------------------------------

const headerActions = computed<LibraryTabHeaderAction[]>(() => [
  {
    key: 'refresh',
    label: 'Refresh',
    icon: 'pi pi-refresh',
    ariaLabel: 'Refresh snippets',
    title: 'Refresh snippets',
  },
  {
    key: 'new',
    label: 'New snippet',
    icon: 'pi pi-plus',
    ariaLabel: 'New snippet',
    title: 'New snippet',
    variant: 'primary',
  },
]);

async function onHeaderAction(key: string) {
  if (key === 'refresh') {
    await snippetsStore.loadAll();
  } else if (key === 'new') {
    openForm(null);
  }
}

// ---------------------------------------------------------------------------
// Inline create/edit form
// ---------------------------------------------------------------------------

const formVisible = ref(false);
const editingId = ref<string | null>(null);
const formTitle = ref('');
const formBody = ref('');
const formTags = ref('');
const formShortcut = ref('');
const formError = ref<string | null>(null);
const saving = ref(false);

const bodyOverflow = computed(() => formBody.value.length > BODY_MAX);

function openForm(snippet: Snippet | null) {
  editingId.value = snippet?.id ?? null;
  formTitle.value = snippet?.title ?? '';
  formBody.value = snippet?.body ?? '';
  formTags.value = snippet?.tags.join(', ') ?? '';
  formShortcut.value = snippet?.shortcut ?? '';
  formError.value = null;
  formVisible.value = true;
}

function closeForm() {
  formVisible.value = false;
  editingId.value = null;
}

function validateForm(): string | null {
  if (!formTitle.value.trim()) return 'Title is required.';

  if (bodyOverflow.value) return `Body exceeds ${BODY_MAX.toLocaleString()} character limit.`;

  const sc = formShortcut.value.trim();

  if (sc && !/^[a-zA-Z0-9]+$/.test(sc)) {
    return 'Shortcut must be alphanumeric (no leading /).';
  }

  return null;
}

async function submitForm() {
  const validationError = validateForm();

  if (validationError) {
    formError.value = validationError;

    return;
  }

  formError.value = null;
  saving.value = true;

  const now = new Date().toISOString();
  const existing = editingId.value
    ? snippets.value.find((s) => s.id === editingId.value)
    : undefined;

  const snippet: Snippet = {
    id: editingId.value ?? crypto.randomUUID(),
    title: formTitle.value.trim(),
    body: formBody.value,
    tags: formTags.value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    ...(formShortcut.value.trim() ? { shortcut: formShortcut.value.trim() } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const ok = await snippetsStore.save(snippet);

  saving.value = false;

  if (ok) closeForm();
}

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

function onInsert(snippet: Snippet) {
  const sessionId = layoutStore.activeSessionId;

  if (!sessionId) {
    toasts.warn('No active session', 'Open a session first to insert a snippet.');

    return;
  }

  insertSnippetIntoComposer(snippet.id, sessionId);
}

function onEdit(snippet: Snippet) {
  openForm(snippet);
}

function onDelete(event: Event, snippet: Snippet) {
  confirm.require({
    target: event.currentTarget as HTMLElement,
    message: `Delete "${snippet.title}"?`,
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Delete',
    rejectLabel: 'Cancel',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await snippetsStore.remove(snippet.id);
    },
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(() => {
  void snippetsStore.loadAll();
});
</script>

<template>
  <div class="snippets-tab">
    <ConfirmPopup />
    <LibraryTabHeader
      :actions="headerActions"
      @action="onHeaderAction"
    >
      <span v-if="loaded">{{ snippets.length }} snippet{{ snippets.length === 1 ? '' : 's' }}</span>
      <span
        v-else-if="error"
        class="snippets-tab__error-summary"
        >Error loading snippets</span
      >
      <span v-else>Loading…</span>
    </LibraryTabHeader>

    <!-- Error banner -->
    <div
      v-if="error"
      class="snippets-tab__error"
    >
      {{ error }}
    </div>

    <!-- Inline create/edit form -->
    <div
      v-if="formVisible"
      class="snippets-form"
    >
      <div class="snippets-form__field">
        <label class="snippets-form__label">Title</label>
        <InputText
          v-model="formTitle"
          class="snippets-form__input"
          placeholder="My snippet"
          size="small"
          @keydown.escape="closeForm"
        />
      </div>
      <div class="snippets-form__field">
        <label class="snippets-form__label">
          Body
          <span
            :class="['snippets-form__counter', { 'snippets-form__counter--over': bodyOverflow }]"
          >
            {{ formBody.length }} / {{ BODY_MAX.toLocaleString() }}
          </span>
        </label>
        <Textarea
          v-model="formBody"
          class="snippets-form__textarea"
          placeholder="Snippet text…"
          :rows="6"
          auto-resize
        />
      </div>
      <div class="snippets-form__field">
        <label class="snippets-form__label">Tags (comma-separated)</label>
        <InputText
          v-model="formTags"
          class="snippets-form__input"
          placeholder="tag1, tag2"
          size="small"
        />
      </div>
      <div class="snippets-form__field">
        <label class="snippets-form__label">Shortcut (optional, alphanumeric)</label>
        <InputText
          v-model="formShortcut"
          class="snippets-form__input"
          placeholder="codereview"
          size="small"
        />
      </div>
      <div
        v-if="formError"
        class="snippets-form__field-error"
      >
        {{ formError }}
      </div>
      <div class="snippets-form__actions">
        <Button
          label="Cancel"
          severity="secondary"
          text
          size="small"
          @click="closeForm"
        />
        <Button
          :label="editingId ? 'Save' : 'Create'"
          :loading="saving"
          :disabled="bodyOverflow"
          size="small"
          @click="submitForm"
        />
      </div>
    </div>

    <!-- Snippet list -->
    <div
      v-if="loaded && snippets.length === 0 && !formVisible"
      class="snippets-tab__empty"
    >
      No snippets yet — click <strong>New snippet</strong> to add one.
    </div>

    <ul
      v-else-if="snippets.length > 0"
      class="snippets-list"
    >
      <li
        v-for="snippet in snippets"
        :key="snippet.id"
        class="snippets-list__row"
      >
        <div class="snippets-list__info">
          <span class="snippets-list__title">{{ snippet.title }}</span>
          <span
            v-if="snippet.shortcut"
            class="snippets-list__shortcut"
            >/{{ snippet.shortcut }}</span
          >
          <span class="snippets-list__tags">
            <span
              v-for="tag in snippet.tags"
              :key="tag"
              class="snippets-list__tag"
              >{{ tag }}</span
            >
          </span>
        </div>
        <div class="snippets-list__actions">
          <Button
            icon="pi pi-arrow-right"
            title="Insert into composer"
            aria-label="Insert snippet"
            severity="secondary"
            text
            size="small"
            @click="onInsert(snippet)"
          />
          <Button
            icon="pi pi-pencil"
            title="Edit snippet"
            aria-label="Edit snippet"
            severity="secondary"
            text
            size="small"
            @click="onEdit(snippet)"
          />
          <Button
            icon="pi pi-trash"
            title="Delete snippet"
            aria-label="Delete snippet"
            severity="danger"
            text
            size="small"
            @click="onDelete($event, snippet)"
          />
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.snippets-tab {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 0;
  min-height: 0;
}

.snippets-tab__error {
  font-size: 0.78rem;
  color: var(--p-red-500);
  padding: 0.25rem 0;
}

.snippets-tab__error-summary {
  color: var(--p-red-500);
}

.snippets-tab__empty {
  font-size: 0.82rem;
  color: var(--p-text-muted-color);
  padding: 0.5rem 0;
}

/* ---- Form ---- */
.snippets-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--p-surface-border);
  margin-bottom: 0.25rem;
}

.snippets-form__field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.snippets-form__label {
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
  display: flex;
  justify-content: space-between;
}

.snippets-form__counter {
  font-variant-numeric: tabular-nums;
}

.snippets-form__counter--over {
  color: var(--p-red-500);
}

.snippets-form__input,
.snippets-form__textarea {
  width: 100%;
  font-size: 0.82rem;
}

.snippets-form__field-error {
  font-size: 0.78rem;
  color: var(--p-red-500);
}

.snippets-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.35rem;
}

/* ---- List ---- */
.snippets-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.snippets-list__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.25rem;
  border-radius: 4px;
}

.snippets-list__row:hover {
  background: var(--p-surface-hover);
}

.snippets-list__info {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.snippets-list__title {
  font-size: 0.82rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 12rem;
}

.snippets-list__shortcut {
  font-size: 0.72rem;
  color: var(--p-text-muted-color);
  font-family: var(--p-font-family-mono, monospace);
}

.snippets-list__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem;
}

.snippets-list__tag {
  font-size: 0.68rem;
  padding: 0.1rem 0.35rem;
  border-radius: 10px;
  background: var(--p-surface-100, var(--p-surface-border));
  color: var(--p-text-muted-color);
}

.snippets-list__actions {
  display: flex;
  gap: 0.15rem;
  flex-shrink: 0;
}
</style>
