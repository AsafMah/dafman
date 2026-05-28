<script setup lang="ts">
/// Phase 19b.2 — Library → Agents tab.
///
/// CRUD for filesystem-backed custom agents. **Create + Delete only**
/// in v1 — Edit is deferred because our minimal YAML writer can't
/// round-trip unknown frontmatter keys (mcp-servers, github toolsets,
/// etc.) without potentially losing data. For advanced editing the
/// user opens the file directly via Reveal.
///
/// User-scope writes go to `~/.copilot/agents/`. Project-scope writes
/// require an active session with a working directory; the form
/// disables Project radio when no session is open.

import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import SelectButton from 'primevue/selectbutton';
import Textarea from 'primevue/textarea';
import ToggleSwitch from 'primevue/toggleswitch';
import type { AgentFileEntry, AgentFileScope, AgentFileSpec } from '@/ipc/types';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useSessionsStore } from '@/stores/chat/sessionsStore';
import { useToastStore } from '@/stores/app/toastStore';
import { toErrorMessage } from '@/lib/errorMessage';
import { revealPath } from '@/lib/pathActions';
import { useAgentsLibrary } from '@/composables/library/useAgentsLibrary';
import { useSessionAgents } from '@/components/session/details/useSessionAgents';

const toasts = useToastStore();
const sessionsStore = useSessionsStore();
const layoutStore = useLayoutStore();
const { activeSessionId } = storeToRefs(layoutStore);

/// Resolves the active session if any. The Library tab can be open
/// without a session — in that case we list user-scope agents only
/// and disable Project radio in the form.
const activeSession = computed(() => {
  const id = activeSessionId.value;

  if (!id) return null;

  return sessionsStore.getSession(id) ?? null;
});

const {
  files,
  loaded,
  error,
  load: loadFiles,
  write: writeAgent,
  read: readAgent,
  remove: deleteAgent,
} = useAgentsLibrary();

/// Agent select/deselect surface. Reuses the same composable that
/// drives `SessionDetailsPanel`'s agent list, so the current-agent
/// chip + busy state stay in sync between the two views — selecting
/// from Library reflects in the rail and vice versa.
const sessionIdRef = computed(() => activeSession.value?.id ?? '');
const recordRef = computed(() => activeSession.value ?? undefined);
const {
  selectAgent: selectSessionAgent,
  deselectAgent,
  agentBusyName,
} = useSessionAgents(sessionIdRef, recordRef);
/// Name of the currently-selected agent for the active session, or
/// null if no session / no agent. Drives the row chip + the
/// Select/Deselect button toggle.
const currentAgentName = computed<string | null>(() => {
  const session = activeSession.value;

  if (!session) return null;

  return (session as { currentAgent?: { name?: string } | null }).currentAgent?.name ?? null;
});

async function onSelect(name: string) {
  await selectSessionAgent(name);
}

async function onDeselect() {
  await deselectAgent();
}

async function load() {
  await loadFiles(activeSession.value?.id);
}

onMounted(load);

const grouped = computed(() => {
  const user = files.value.filter((f) => f.scope === 'user');
  const project = files.value.filter((f) => f.scope === 'project');

  return { user, project };
});

// ---------- Create / edit form ----------
const showForm = ref(false);
/// Form mode. 'create' refuses to clobber; 'edit' allows overwrite +
/// passes the preserved unknown-frontmatter tail through so the SDK's
/// custom keys (mcp-servers, github.toolsets, etc.) survive a save.
const formMode = ref<'create' | 'edit'>('create');
const formScope = ref<AgentFileScope>('user');
const formName = ref('');
const formDisplayName = ref('');
const formDescription = ref('');
const formTools = ref('');
const formSkills = ref('');
const formModel = ref('');
const formUserInvocable = ref(true);
const formPrompt = ref('');
const formBusy = ref(false);
const formError = ref<string | null>(null);
/// Preserved verbatim front-matter tail captured at read-time. Round-
/// tripped back into writeAgent options so unknown keys survive Edit.
const formPreservedTail = ref<string>('');
/// Original entry for an Edit (for the dialog header + scope lock).
const formOriginalEntry = ref<AgentFileEntry | null>(null);

const scopeOptions = computed(() => {
  const out: Array<{ label: string; value: AgentFileScope; disabled?: boolean }> = [
    { label: 'User (global)', value: 'user' },
  ];

  out.push({
    label: 'Project (.github/agents)',
    value: 'project',
    disabled: !activeSession.value,
  });

  return out;
});

function openForm() {
  showForm.value = true;
  formMode.value = 'create';
  formScope.value = activeSession.value ? 'project' : 'user';
  formName.value = '';
  formDisplayName.value = '';
  formDescription.value = '';
  formTools.value = '';
  formSkills.value = '';
  formModel.value = '';
  formUserInvocable.value = true;
  formPrompt.value = '';
  formError.value = null;
  formPreservedTail.value = '';
  formOriginalEntry.value = null;
}

async function openEditForm(entry: AgentFileEntry) {
  if (!activeSession.value) {
    toasts.error(
      'Need an active session',
      'Open a session to edit agents (the SDK reload path is session-scoped).',
    );

    return;
  }

  const read = await readAgent(activeSession.value.id, entry.scope, entry.name);

  if (!read) return; // toasted

  showForm.value = true;
  formMode.value = 'edit';
  formScope.value = entry.scope;
  formName.value = read.spec.name ?? entry.name;
  formDisplayName.value = read.spec.displayName ?? '';
  formDescription.value = read.spec.description ?? '';
  formTools.value = (read.spec.tools ?? []).join(', ');
  formSkills.value = (read.spec.skills ?? []).join(', ');
  formModel.value = read.spec.model ?? '';
  formUserInvocable.value = read.spec.userInvocable !== false;
  formPrompt.value = read.prompt;
  formError.value = null;
  formPreservedTail.value = read.preservedTail;
  formOriginalEntry.value = entry;
}

function closeForm() {
  showForm.value = false;
}

function splitCsv(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function submitForm() {
  formError.value = null;

  if (!formName.value.trim()) {
    formError.value = 'Name is required';

    return;
  }

  if (!formDescription.value.trim()) {
    formError.value = 'Description is required';

    return;
  }

  if (formScope.value === 'project' && !activeSession.value) {
    formError.value = 'Project scope requires an active session';

    return;
  }

  formBusy.value = true;

  try {
    // Session id is required for both scopes (writeAgentFile uses
    // it to call session.rpc.agent.reload after the write); for
    // user scope it doesn't need the workspace path. We bail early
    // above if no session is open AND scope is project, so the
    // remaining cases all have a session.
    if (!activeSession.value) {
      formError.value = 'An active session is required to create agents';

      return;
    }

    const spec: AgentFileSpec = {
      scope: formScope.value,
      name: formName.value.trim(),
      description: formDescription.value.trim(),
      prompt: formPrompt.value,
      userInvocable: formUserInvocable.value,
    };

    if (formDisplayName.value.trim()) spec.displayName = formDisplayName.value.trim();

    const tools = splitCsv(formTools.value);

    if (tools.length > 0) spec.tools = tools;

    const skills = splitCsv(formSkills.value);

    if (skills.length > 0) spec.skills = skills;

    if (formModel.value.trim()) spec.model = formModel.value.trim();

    const path = await writeAgent(activeSession.value.id, spec, {
      ...(formMode.value === 'edit'
        ? { allowOverwrite: true, preservedTail: formPreservedTail.value }
        : {}),
    });

    if (!path) {
      // toast already shown by composable; surface the failure inline too
      formError.value = 'Save failed';

      return;
    }

    toasts.success(formMode.value === 'edit' ? 'Agent saved' : 'Agent created', path);
    closeForm();
    await load();
  } catch (err) {
    formError.value = toErrorMessage(err);
  } finally {
    formBusy.value = false;
  }
}

async function deleteFile(entry: AgentFileEntry) {
  if (!activeSession.value) {
    toasts.error(
      'Need an active session',
      'Open a session to delete project-scope agents. User-scope deletion also requires the session for SDK reload.',
    );

    return;
  }

  const ok = confirm(
    `Delete agent "${entry.name}" (${entry.scope})?\n\nThis removes the file at:\n${entry.path}`,
  );

  if (!ok) return;

  const removed = await deleteAgent(activeSession.value.id, entry.scope, entry.name);

  if (removed === null) return;

  if (removed) {
    toasts.success('Agent deleted', entry.name);
  } else {
    toasts.info('Already gone', `No file at ${entry.path}`);
  }

  await load();
}

async function reveal(path: string) {
  await revealPath(path, 'Reveal failed');
}
</script>

<template>
  <div class="agents-tab">
    <header class="agents-header">
      <span class="agents-summary">
        <span v-if="!loaded">Loading…</span>
        <span
          v-else-if="error"
          class="error"
          >{{ error }}</span
        >
        <span v-else>{{ files.length }} agent{{ files.length === 1 ? '' : 's' }}</span>
      </span>
      <Button
        size="small"
        :disabled="!activeSession"
        :title="activeSession ? '' : 'Open a session first'"
        icon="pi pi-plus"
        label="New agent"
        @click="openForm"
      />
    </header>

    <div
      v-if="!activeSession && loaded"
      class="hint"
    >
      No session is open. Showing user-scope agents only. Open a session to manage project-scope
      agents under
      <code>.github/agents/</code>.
    </div>

    <section
      v-if="grouped.project.length > 0 && loaded"
      class="agents-group"
    >
      <h3 class="group-title">Project ({{ grouped.project.length }})</h3>
      <ul class="agents-list">
        <li
          v-for="entry in grouped.project"
          :key="`p:${entry.name}`"
          class="agent-row"
          :class="{ 'agent-row-selected': currentAgentName === entry.name }"
        >
          <div class="agent-line">
            <span class="agent-name">{{ entry.name }}</span>
            <small
              v-if="!entry.canonical"
              class="warn-tag"
              title="File ends with .md (not .agent.md)"
            >
              .md
            </small>
            <span
              v-if="currentAgentName === entry.name"
              class="agent-current-chip"
              :title="`This agent is selected for the active session`"
            >
              Selected
            </span>
          </div>
          <div
            class="agent-path"
            :title="entry.path"
          >
            {{ entry.path }}
          </div>
          <div class="agent-actions">
            <Button
              v-if="currentAgentName === entry.name"
              size="small"
              severity="secondary"
              :loading="agentBusyName === '__deselect__'"
              :disabled="!activeSession || !!agentBusyName"
              label="Deselect"
              :aria-label="`Deselect agent ${entry.name}`"
              @click="onDeselect"
            />
            <Button
              v-else
              size="small"
              :loading="agentBusyName === entry.name"
              :disabled="!activeSession || !!agentBusyName"
              label="Select"
              :aria-label="`Select agent ${entry.name}`"
              @click="onSelect(entry.name)"
            />
            <Button
              size="small"
              text
              icon="pi pi-pencil"
              :disabled="!activeSession"
              :aria-label="`Edit ${entry.name}`"
              @click="openEditForm(entry)"
            />
            <Button
              size="small"
              text
              icon="pi pi-external-link"
              :aria-label="`Reveal ${entry.name} in file manager`"
              @click="reveal(entry.path)"
            />
            <Button
              size="small"
              severity="danger"
              text
              icon="pi pi-trash"
              :disabled="!activeSession"
              :aria-label="`Delete ${entry.name}`"
              @click="deleteFile(entry)"
            />
          </div>
        </li>
      </ul>
    </section>

    <section
      v-if="grouped.user.length > 0 && loaded"
      class="agents-group"
    >
      <h3 class="group-title">User ({{ grouped.user.length }})</h3>
      <ul class="agents-list">
        <li
          v-for="entry in grouped.user"
          :key="`u:${entry.name}`"
          class="agent-row"
          :class="{ 'agent-row-selected': currentAgentName === entry.name }"
        >
          <div class="agent-line">
            <span class="agent-name">{{ entry.name }}</span>
            <small
              v-if="!entry.canonical"
              class="warn-tag"
              title="File ends with .md (not .agent.md)"
            >
              .md
            </small>
            <span
              v-if="currentAgentName === entry.name"
              class="agent-current-chip"
              :title="`This agent is selected for the active session`"
            >
              Selected
            </span>
          </div>
          <div
            class="agent-path"
            :title="entry.path"
          >
            {{ entry.path }}
          </div>
          <div class="agent-actions">
            <Button
              v-if="currentAgentName === entry.name"
              size="small"
              severity="secondary"
              :loading="agentBusyName === '__deselect__'"
              :disabled="!activeSession || !!agentBusyName"
              label="Deselect"
              :aria-label="`Deselect agent ${entry.name}`"
              @click="onDeselect"
            />
            <Button
              v-else
              size="small"
              :loading="agentBusyName === entry.name"
              :disabled="!activeSession || !!agentBusyName"
              label="Select"
              :aria-label="`Select agent ${entry.name}`"
              @click="onSelect(entry.name)"
            />
            <Button
              size="small"
              text
              icon="pi pi-pencil"
              :disabled="!activeSession"
              :aria-label="`Edit ${entry.name}`"
              @click="openEditForm(entry)"
            />
            <Button
              size="small"
              text
              icon="pi pi-external-link"
              :aria-label="`Reveal ${entry.name} in file manager`"
              @click="reveal(entry.path)"
            />
            <Button
              size="small"
              severity="danger"
              text
              icon="pi pi-trash"
              :disabled="!activeSession"
              :aria-label="`Delete ${entry.name}`"
              @click="deleteFile(entry)"
            />
          </div>
        </li>
      </ul>
    </section>

    <div
      v-if="loaded && files.length === 0"
      class="empty-hint"
    >
      No custom agents yet. Click "New agent" to create one — it'll be saved as a markdown file
      under
      <code>~/.copilot/agents/</code> (User) or <code>.github/agents/</code> (Project).
    </div>

    <!-- New agent form -->
    <div
      v-if="showForm"
      class="agent-form-wrap"
      role="dialog"
      aria-modal="true"
    >
      <div class="agent-form">
        <header class="form-header">
          <h3>{{ formMode === 'edit' ? `Edit ${formName}` : 'New custom agent' }}</h3>
          <Button
            size="small"
            text
            icon="pi pi-times"
            aria-label="Close"
            @click="closeForm"
          />
        </header>
        <div class="form-body">
          <div
            v-if="formMode === 'edit' && formPreservedTail"
            class="form-preserved-hint"
            title="These frontmatter keys are not editable in this form, but they are preserved verbatim across saves."
          >
            <i
              class="pi pi-info-circle"
              aria-hidden="true"
            />
            <span>
              <strong>Unknown frontmatter keys preserved:</strong>
              edits won't strip
              <code>mcp-servers</code>, <code>github</code>, plugin keys, etc. Reveal the file to
              inspect them.
            </span>
          </div>
          <label class="form-field">
            <span class="form-label">Scope</span>
            <SelectButton
              v-model="formScope"
              :options="scopeOptions"
              option-label="label"
              option-value="value"
              option-disabled="disabled"
              size="small"
              :disabled="formMode === 'edit' || formBusy"
              aria-label="Agent scope"
            />
          </label>
          <label class="form-field">
            <span class="form-label"
              >Name <small>(filename; letters/digits/.-_, max 64)</small></span
            >
            <InputText
              v-model="formName"
              placeholder="e.g. reviewer"
              :disabled="formBusy || formMode === 'edit'"
              size="small"
            />
          </label>
          <label class="form-field">
            <span class="form-label">Display name <small>(optional)</small></span>
            <InputText
              v-model="formDisplayName"
              placeholder="Code Reviewer"
              :disabled="formBusy"
              size="small"
            />
          </label>
          <label class="form-field">
            <span class="form-label">Description <small>(required)</small></span>
            <InputText
              v-model="formDescription"
              placeholder="What this agent does, in one line"
              :disabled="formBusy"
              size="small"
            />
          </label>
          <label class="form-field">
            <span class="form-label">Tools <small>(comma-separated; empty = all)</small></span>
            <InputText
              v-model="formTools"
              placeholder="read, grep, bash"
              :disabled="formBusy"
              size="small"
            />
          </label>
          <label class="form-field">
            <span class="form-label">Skills <small>(comma-separated)</small></span>
            <InputText
              v-model="formSkills"
              placeholder="pr-review, code-style"
              :disabled="formBusy"
              size="small"
            />
          </label>
          <label class="form-field">
            <span class="form-label">Model <small>(optional override)</small></span>
            <InputText
              v-model="formModel"
              placeholder="e.g. gpt-5"
              :disabled="formBusy"
              size="small"
            />
          </label>
          <label class="form-field form-toggle">
            <ToggleSwitch
              v-model="formUserInvocable"
              :disabled="formBusy"
              aria-label="User invocable"
            />
            <span>User invocable (can be selected as the session agent)</span>
          </label>
          <label class="form-field">
            <span class="form-label">Prompt <small>(markdown body)</small></span>
            <Textarea
              v-model="formPrompt"
              :rows="8"
              auto-resize
              :disabled="formBusy"
              placeholder="You are a strict code reviewer..."
            />
          </label>
          <div
            v-if="formError"
            class="form-error"
          >
            {{ formError }}
          </div>
        </div>
        <footer class="form-footer">
          <Button
            size="small"
            severity="secondary"
            label="Cancel"
            :disabled="formBusy"
            @click="closeForm"
          />
          <Button
            size="small"
            :label="formMode === 'edit' ? 'Save' : 'Create'"
            :loading="formBusy"
            :disabled="formBusy"
            @click="submitForm"
          />
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agents-tab {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
  min-height: 100%;
}

.agents-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid var(--p-surface-border);
}

.agents-summary {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.agents-summary .error {
  color: var(--p-red-500, #ef4444);
}

.hint {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  padding: 0.5rem 0.6rem;
  border: 1px dashed var(--p-surface-border);
  border-radius: var(--p-border-radius-sm);
}

.hint code,
.empty-hint code,
.form-label small code {
  background: color-mix(in srgb, var(--p-text-color) 10%, transparent);
  padding: 0 0.25rem;
  border-radius: 0.15rem;
  font-size: 0.95em;
}

.agents-group {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.group-title {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  color: var(--p-text-muted-color);
  margin: 0;
}

.agents-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.agent-row {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 0.2rem 0.5rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-sm);
  background: color-mix(in srgb, var(--p-content-hover-background) 25%, transparent);
  min-width: 0;
  align-items: center;
  border-left: 3px solid transparent;
}

/* Selected agent gets a tinted left rail in the primary color so the
 * row reads as "this is the active one" at a glance, matching the
 * palette's selected-item visual language. */
.agent-row-selected {
  border-left-color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 8%, transparent);
}

.agent-current-chip {
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0.1rem 0.4rem;
  background: color-mix(in srgb, var(--p-primary-color) 22%, transparent);
  color: var(--p-primary-color);
  border-radius: 0.25rem;
  font-weight: 600;
}

.form-preserved-hint {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: color-mix(in srgb, var(--p-blue-500, #3b82f6) 10%, transparent);
  border-left: 3px solid var(--p-blue-500, #3b82f6);
  border-radius: 0.25rem;
  color: var(--p-text-color);
  font-size: 0.82rem;
}
.form-preserved-hint i {
  flex: 0 0 auto;
  color: var(--p-blue-500, #3b82f6);
  margin-top: 0.1rem;
}
.form-preserved-hint code {
  background: color-mix(in srgb, var(--p-text-color) 8%, transparent);
  padding: 0.05rem 0.3rem;
  border-radius: 0.2rem;
  font-size: 0.78rem;
}

.agent-line {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  min-width: 0;
}

.agent-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.warn-tag {
  text-transform: uppercase;
  font-size: 0.55rem;
  padding: 0.05rem 0.3rem;
  background: color-mix(in srgb, var(--p-yellow-500, #eab308) 18%, transparent);
  color: var(--p-yellow-500, #eab308);
  border-radius: 0.2rem;
}

.agent-path {
  grid-row: 2;
  grid-column: 1 / 2;
  font-size: 0.65rem;
  color: var(--p-text-muted-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.agent-actions {
  grid-row: 1 / 3;
  grid-column: 2;
  display: flex;
  gap: 0.2rem;
}

.empty-hint {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  padding: 0.6rem;
  border: 1px dashed var(--p-surface-border);
  border-radius: var(--p-border-radius-sm);
  text-align: center;
}

/* Form card stays in the tab flow so narrow sidebars don't stack the
 * fields on top of each other or hide the footer behind an overlay. */
.agent-form-wrap {
  position: static;
  display: block;
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-md);
  background: var(--p-content-background);
  overflow: hidden;
}

.agent-form {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.form-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--p-surface-border);
}

.form-header h3 {
  margin: 0;
  font-size: 0.9rem;
}

.form-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.form-field.form-toggle {
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
}

.form-label {
  font-size: 0.75rem;
  color: var(--p-text-secondary-color);
}

.form-label small {
  color: var(--p-text-muted-color);
  font-weight: 400;
}

.form-error {
  font-size: 0.75rem;
  color: var(--p-red-500, #ef4444);
  background: color-mix(in srgb, var(--p-red-500, #ef4444) 10%, transparent);
  padding: 0.4rem 0.5rem;
  border-radius: var(--p-border-radius-sm);
}

.form-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--p-surface-border);
}
</style>
