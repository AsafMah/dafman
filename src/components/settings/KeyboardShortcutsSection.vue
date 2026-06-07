<script setup lang="ts">
/// Settings section: Keyboard Shortcuts editor.
///
/// Lists every command's effective binding(s) grouped by scope.
/// Each row shows current bindings, default bindings, conflict badges,
/// a per-command Reset, and an Add/Edit button (reassignable only).
/// Non-reassignable rows (composer core, native) are read-only.
/// A search box filters label / command id / scope / key chord.
/// "Reset all" restores the full default keymap after confirmation.

import { computed, onUnmounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import { useConfirm } from 'primevue/useconfirm';
import { useSettingsStore } from '@/stores/app/settingsStore';
import { useShortcutRegistry } from '@/stores/shell/shortcutRegistry';
import { useCommandRegistry } from '@/stores/shell/commandRegistry';
import type { ShortcutScope } from '@/lib/shortcuts/types';
import { defaultKeymap } from '@/lib/defaultKeymap';
import { detectConflicts } from '@/lib/shortcuts/conflicts';
import { detectPlatform, formatKeySequenceForDisplay } from '@/lib/shortcuts/normalize';
import SettingsGroup from '@/components/settings/SettingsGroup.vue';
import {
  buildChordFromEvent,
  buildNewPrefsForBinding,
  buildRows,
  detectConflictsForChord,
  filterRows,
  resetCommandPrefs,
  SCOPE_LABELS,
  type ShortcutRow,
} from '@/lib/shortcuts/editorUtils';

defineProps<{ collapsed: boolean }>();
const emit = defineEmits<{ (e: 'update:collapsed', value: boolean): void }>();

const settingsStore = useSettingsStore();
const shortcutRegistry = useShortcutRegistry();
const commandRegistry = useCommandRegistry();
const confirm = useConfirm();
const { settings } = storeToRefs(settingsStore);

const platform = detectPlatform();

// ---------------------------------------------------------------------------
// Row data
// ---------------------------------------------------------------------------

// Run conflict detection against the fully-merged effective bindings
// (includes user customizations, not just defaults).
const allConflicts = computed(() =>
  detectConflicts(
    shortcutRegistry.effectiveBindings.map((b) => ({
      id: b.id,
      commandId: b.commandId,
      scope: b.scope,
      keys: b.keys,
      reassignable: b.reassignable,
    })),
  ),
);

const rows = computed<ShortcutRow[]>(() =>
  buildRows(
    defaultKeymap,
    shortcutRegistry.effectiveBindings,
    settings.value.keyboardShortcuts,
    allConflicts.value,
    (commandId) => commandRegistry.getCommand(commandId)?.label ?? commandId,
  ),
);

// Ordered list of scopes present in the keymap (preserves defaultKeymap order)
const scopeOrder = computed<ShortcutScope[]>(() => {
  const seen: Record<string, true> = {};
  const result: ShortcutScope[] = [];

  for (const b of defaultKeymap) {
    if (!seen[b.scope]) {
      seen[b.scope] = true;
      result.push(b.scope);
    }
  }

  return result;
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const searchQuery = ref('');

const filteredRows = computed(() => filterRows(rows.value, searchQuery.value));

interface ScopeGroup {
  scope: ShortcutScope;
  label: string;
  rows: ShortcutRow[];
}

const visibleGroups = computed<ScopeGroup[]>(() => {
  const byScope = new Map<ShortcutScope, ShortcutRow[]>();

  for (const row of filteredRows.value) {
    const arr = byScope.get(row.scope);

    if (arr) {
      arr.push(row);
    } else {
      byScope.set(row.scope, [row]);
    }
  }

  return scopeOrder.value
    .filter((scope) => byScope.has(scope))
    .map((scope) => ({
      scope,
      label: SCOPE_LABELS[scope] ?? scope,
      rows: byScope.get(scope)!,
    }));
});

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function formatKey(keys: string): string {
  return formatKeySequenceForDisplay(keys, platform);
}

function conflictSeverity(row: ShortcutRow): 'error' | 'warn' | null {
  if (row.conflicts.length === 0) return null;

  const hasHard = row.conflicts.some((c) => c.kind === 'exact' || c.kind === 'prefix');

  return hasHard ? 'error' : 'warn';
}

function conflictTitle(row: ShortcutRow): string {
  return row.conflicts.map((c) => c.message).join('\n');
}

function lockedLabel(scope: ShortcutScope): string {
  if (
    scope === 'composer' ||
    scope === 'composerTypeahead' ||
    scope === 'composerCommandTerminal'
  ) {
    return 'Editor';
  }

  return 'Native';
}

// Whether the effective binding is user-defined (vs default)
function isUserBinding(row: ShortcutRow): boolean {
  return shortcutRegistry.effectiveBindings
    .filter((b) => b.commandId === row.commandId && b.scope === row.scope)
    .some((b) => b.source === 'user');
}

// ---------------------------------------------------------------------------
// Reset per-command
// ---------------------------------------------------------------------------

function handleReset(row: ShortcutRow): void {
  const next = resetCommandPrefs(
    settings.value.keyboardShortcuts,
    row.commandId,
    row.scope,
    defaultKeymap,
  );

  void settingsStore.setKeyboardShortcuts(next);
  shortcutRegistry.setPrefs(next);
}

// ---------------------------------------------------------------------------
// Reset all
// ---------------------------------------------------------------------------

function confirmResetAll(): void {
  confirm.require({
    message: 'Reset all keyboard shortcuts to their defaults? Custom bindings will be lost.',
    header: 'Reset All Shortcuts',
    icon: 'pi pi-exclamation-triangle',
    rejectLabel: 'Cancel',
    acceptLabel: 'Reset all',
    acceptClass: 'p-button-danger',
    accept: () => {
      const next = { customBindings: [], disabledDefaultBindingIds: [] };

      void settingsStore.setKeyboardShortcuts(next);
      shortcutRegistry.setPrefs(next);
    },
  });
}

// ---------------------------------------------------------------------------
// Chord recorder dialog
// ---------------------------------------------------------------------------

const recorderOpen = ref(false);
const recorderRow = ref<ShortcutRow | null>(null);
const recordedChord = ref('');
const isRecording = ref(false);
const recorderConflicts = computed(() => {
  if (!recordedChord.value || !recorderRow.value) return [];

  return detectConflictsForChord(
    recordedChord.value,
    recorderRow.value.scope,
    recorderRow.value.commandId,
    shortcutRegistry.effectiveBindings,
  );
});

let recorderListener: ((e: KeyboardEvent) => void) | null = null;

function removeRecorderListener(): void {
  if (recorderListener) {
    window.removeEventListener('keydown', recorderListener, { capture: true });
    recorderListener = null;
  }
}

function attachRecorderListener(): void {
  removeRecorderListener();
  recorderListener = (event: KeyboardEvent) => {
    if (!isRecording.value) return;

    // Always prevent when recording so we don't type into inputs or trigger other handlers
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      // Cancel this recording attempt without closing the dialog
      isRecording.value = false;

      return;
    }

    const chord = buildChordFromEvent(event);

    if (!chord) return; // modifier-only press — keep waiting

    recordedChord.value = chord;
    isRecording.value = false;
  };
  window.addEventListener('keydown', recorderListener, { capture: true });
}

function openRecorder(row: ShortcutRow): void {
  recorderRow.value = row;
  recordedChord.value = '';
  isRecording.value = false;
  recorderOpen.value = true;
}

function startRecording(): void {
  recordedChord.value = '';
  isRecording.value = true;
  attachRecorderListener();
}

function clearRecording(): void {
  recordedChord.value = '';
  isRecording.value = false;
}

function closeRecorder(): void {
  isRecording.value = false;
  recorderOpen.value = false;
  recorderRow.value = null;
  recordedChord.value = '';
  removeRecorderListener();
}

function saveRecording(): void {
  if (!recordedChord.value || !recorderRow.value) return;

  const next = buildNewPrefsForBinding(
    settings.value.keyboardShortcuts,
    recorderRow.value.commandId,
    recorderRow.value.scope,
    recordedChord.value,
    defaultKeymap,
  );

  void settingsStore.setKeyboardShortcuts(next);
  shortcutRegistry.setPrefs(next);
  closeRecorder();
}

onUnmounted(removeRecorderListener);
</script>

<template>
  <div id="keyboard-shortcuts-section">
    <SettingsGroup
      id="keyboardShortcuts"
      icon="pi-keyboard"
      label="Keyboard Shortcuts"
      :collapsed="collapsed"
      @update:collapsed="(v) => emit('update:collapsed', v)"
    >
      <!-- Toolbar: search + reset all -->
      <div class="kb-toolbar">
        <InputText
          v-model="searchQuery"
          placeholder="Search shortcuts…"
          size="small"
          class="kb-search"
        />
        <Button
          label="Reset all"
          size="small"
          severity="danger"
          text
          class="kb-reset-all"
          @click="confirmResetAll"
        />
      </div>

      <!-- Scope groups -->
      <div
        v-for="group in visibleGroups"
        :key="group.scope"
        class="kb-scope-group"
      >
        <div class="kb-scope-header">{{ group.label }}</div>

        <!-- Shortcut rows -->
        <div
          v-for="row in group.rows"
          :key="row.commandId"
          class="kb-row"
          :class="{ 'kb-row--user': isUserBinding(row) }"
        >
          <!-- Left: label + command id -->
          <div class="kb-row-info">
            <span class="kb-row-label">{{ row.label }}</span>
            <code class="kb-row-id">{{ row.commandId }}</code>
          </div>

          <!-- Center: current binding chips -->
          <div class="kb-row-bindings">
            <template v-if="row.effectiveKeys.length > 0">
              <kbd
                v-for="(k, i) in row.effectiveKeys"
                :key="i"
                class="kb-chip"
                :class="{ 'kb-chip--user': isUserBinding(row) }"
                :title="k"
                >{{ formatKey(k) }}</kbd
              >
            </template>
            <span
              v-else
              class="kb-unbound"
              >—</span
            >

            <!-- Default chips (shown only if different from current) -->
            <template v-if="row.isUserModified && row.defaultKeys.length > 0">
              <span class="kb-default-label">default:</span>
              <kbd
                v-for="(k, i) in row.defaultKeys"
                :key="`d${i}`"
                class="kb-chip kb-chip--default"
                :title="k"
                >{{ formatKey(k) }}</kbd
              >
            </template>
          </div>

          <!-- Right: conflict badge + lock label + action buttons -->
          <div class="kb-row-actions">
            <!-- Conflict badge -->
            <span
              v-if="row.conflicts.length > 0"
              class="kb-conflict"
              :class="`kb-conflict--${conflictSeverity(row)}`"
              :title="conflictTitle(row)"
            >
              <i
                class="pi"
                :class="
                  conflictSeverity(row) === 'error'
                    ? 'pi-exclamation-circle'
                    : 'pi-exclamation-triangle'
                "
              />
            </span>

            <!-- Non-reassignable label -->
            <span
              v-if="!row.reassignable"
              class="kb-locked-badge"
              >{{ lockedLabel(row.scope) }}</span
            >

            <!-- Per-command reset (only when user has modified this command) -->
            <Button
              v-if="row.isUserModified"
              icon="pi pi-undo"
              size="small"
              text
              severity="secondary"
              title="Reset to default"
              aria-label="Reset shortcut to default"
              class="kb-action-btn"
              @click="handleReset(row)"
            />

            <!-- Edit/Assign button (reassignable rows only) -->
            <Button
              v-if="row.reassignable"
              :icon="row.effectiveKeys.length === 0 ? 'pi pi-plus' : 'pi pi-pencil'"
              size="small"
              text
              severity="secondary"
              :title="row.effectiveKeys.length === 0 ? 'Assign shortcut' : 'Edit shortcut'"
              :aria-label="row.effectiveKeys.length === 0 ? 'Assign shortcut' : 'Edit shortcut'"
              class="kb-action-btn"
              @click="openRecorder(row)"
            />
          </div>
        </div>
      </div>

      <p
        v-if="visibleGroups.length === 0"
        class="kb-empty"
      >
        No shortcuts match "{{ searchQuery }}".
      </p>
    </SettingsGroup>
  </div>

  <!-- Chord recorder dialog -->
  <Dialog
    v-model:visible="recorderOpen"
    modal
    :close-on-escape="false"
    :closable="false"
    class="kb-recorder-dialog"
    :pt="{ root: { style: 'width: 380px' } }"
  >
    <template #header>
      <span class="kb-dialog-header">
        <i
          class="pi pi-keyboard"
          aria-hidden="true"
        />
        {{ recorderRow?.effectiveKeys.length ? 'Edit shortcut' : 'Assign shortcut' }}
        <code class="kb-dialog-cmd">{{ recorderRow?.commandId }}</code>
      </span>
    </template>

    <div class="kb-recorder-body">
      <!-- Current / recorded chord -->
      <div class="kb-recorder-zone">
        <div
          v-if="isRecording"
          class="kb-recording-active"
        >
          <i
            class="pi pi-circle-fill kb-recording-dot"
            aria-hidden="true"
          />
          Press a key combination…
        </div>
        <div
          v-else-if="recordedChord"
          class="kb-recording-result"
        >
          <kbd class="kb-chip kb-chip--large">{{ formatKey(recordedChord) }}</kbd>
          <code class="kb-chord-raw">{{ recordedChord }}</code>
        </div>
        <div
          v-else
          class="kb-recording-hint"
        >
          <span
            v-if="recorderRow && recorderRow.effectiveKeys.length > 0"
            class="kb-current-bindings"
          >
            Current:
            <kbd
              v-for="(k, i) in recorderRow.effectiveKeys"
              :key="i"
              class="kb-chip"
              >{{ formatKey(k) }}</kbd
            >
          </span>
          <span v-else>No shortcut assigned.</span>
        </div>
      </div>

      <!-- Record controls -->
      <div class="kb-recorder-controls">
        <Button
          :label="isRecording ? 'Recording…' : 'Record'"
          :icon="isRecording ? 'pi pi-spin pi-spinner' : 'pi pi-circle'"
          size="small"
          :severity="isRecording ? 'warn' : 'secondary'"
          @click="startRecording"
        />
        <Button
          v-if="recordedChord"
          label="Clear"
          icon="pi pi-times"
          size="small"
          severity="secondary"
          text
          @click="clearRecording"
        />
      </div>

      <!-- Conflict warnings -->
      <div
        v-if="recorderConflicts.length > 0"
        class="kb-recorder-conflicts"
      >
        <div
          v-for="(conflict, i) in recorderConflicts"
          :key="i"
          class="kb-conflict-item"
          :class="`kb-conflict-item--${conflict.kind === 'exact' || conflict.kind === 'prefix' ? 'error' : 'warn'}`"
        >
          <i
            class="pi"
            :class="
              conflict.kind === 'exact' || conflict.kind === 'prefix'
                ? 'pi-exclamation-circle'
                : 'pi-exclamation-triangle'
            "
            aria-hidden="true"
          />
          {{ conflict.message }}
        </div>
      </div>
    </div>

    <template #footer>
      <div class="kb-dialog-footer">
        <Button
          label="Cancel"
          severity="secondary"
          text
          size="small"
          @click="closeRecorder"
        />
        <Button
          label="Save"
          severity="primary"
          size="small"
          :disabled="!recordedChord || isRecording"
          @click="saveRecording"
        />
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
#keyboard-shortcuts-section {
  /* Outer wrapper carries the scroll-target id */
}

/* Toolbar */
.kb-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-bottom: 0.4rem;
}

.kb-search {
  flex: 1 1 auto;
  min-width: 0;
}

.kb-reset-all {
  flex: 0 0 auto;
  white-space: nowrap;
}

/* Scope group */
.kb-scope-group {
  margin-bottom: 0.25rem;
}

.kb-scope-header {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--p-text-muted-color);
  padding: 0.35rem 0 0.2rem;
  border-bottom: 1px solid color-mix(in srgb, var(--p-text-color) 8%, transparent);
  margin-bottom: 0.15rem;
}

/* Row */
.kb-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: start;
  gap: 0.35rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid color-mix(in srgb, var(--p-text-color) 4%, transparent);
}

.kb-row:last-child {
  border-bottom: none;
}

.kb-row-info {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.kb-row-label {
  font-size: 0.82rem;
  color: var(--p-text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kb-row-id {
  font-size: 0.68rem;
  color: var(--p-text-muted-color);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Bindings */
.kb-row-bindings {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
}

.kb-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.1em 0.4em;
  font-size: 0.7rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: color-mix(in srgb, var(--p-text-color) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--p-text-color) 18%, transparent);
  border-radius: 3px;
  color: var(--p-text-color);
  white-space: nowrap;
}

.kb-chip--user {
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
  border-color: color-mix(in srgb, var(--p-primary-color) 35%, transparent);
  color: var(--p-primary-color);
}

.kb-chip--default {
  opacity: 0.55;
}

.kb-chip--large {
  font-size: 0.85rem;
  padding: 0.2em 0.5em;
}

.kb-unbound {
  font-size: 0.72rem;
  color: var(--p-text-muted-color);
}

.kb-default-label {
  font-size: 0.68rem;
  color: var(--p-text-muted-color);
  margin-left: 0.2rem;
}

/* Actions */
.kb-row-actions {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  flex: 0 0 auto;
}

.kb-action-btn {
  padding: 0.15rem !important;
}

.kb-conflict {
  font-size: 0.8rem;
  cursor: help;
}

.kb-conflict--error {
  color: var(--p-red-500, #ef4444);
}

.kb-conflict--warn {
  color: var(--p-yellow-500, #f59e0b);
}

.kb-locked-badge {
  font-size: 0.62rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-text-muted-color);
  background: color-mix(in srgb, var(--p-text-color) 7%, transparent);
  border-radius: 3px;
  padding: 0.05em 0.35em;
  white-space: nowrap;
}

.kb-empty {
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
  padding: 0.5rem 0;
  margin: 0;
}

/* Recorder dialog body */
.kb-dialog-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.88rem;
}

.kb-dialog-cmd {
  font-size: 0.72rem;
  color: var(--p-text-muted-color);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.kb-recorder-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.25rem 0;
}

.kb-recorder-zone {
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed color-mix(in srgb, var(--p-text-color) 20%, transparent);
  border-radius: 6px;
  padding: 0.75rem;
}

.kb-recording-active {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.82rem;
  color: var(--p-text-muted-color);
}

.kb-recording-dot {
  color: var(--p-red-500, #ef4444);
  font-size: 0.6rem;
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.2;
  }
}

.kb-recording-result {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.kb-chord-raw {
  font-size: 0.68rem;
  color: var(--p-text-muted-color);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.kb-recording-hint {
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.kb-current-bindings {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
}

.kb-recorder-controls {
  display: flex;
  gap: 0.4rem;
}

.kb-recorder-conflicts {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.kb-conflict-item {
  display: flex;
  align-items: flex-start;
  gap: 0.35rem;
  font-size: 0.72rem;
  line-height: 1.4;
  padding: 0.3rem 0.5rem;
  border-radius: 4px;
}

.kb-conflict-item--error {
  background: color-mix(in srgb, var(--p-red-500, #ef4444) 10%, transparent);
  color: var(--p-red-600, #dc2626);
}

.kb-conflict-item--warn {
  background: color-mix(in srgb, var(--p-yellow-500, #f59e0b) 10%, transparent);
  color: var(--p-yellow-700, #b45309);
}

.kb-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}
</style>
