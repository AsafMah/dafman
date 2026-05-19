<script setup lang="ts">
// Global pending-request modal.
//
// Mounted at App.vue level (outside the dockview tree) so it can
// respond to a pending callback even when the owning session isn't
// the active panel. The store's `firstPending` computed picks the
// owning session — preferring the active session if it has a
// pending request, otherwise the first session with a non-empty
// queue. When opening for a non-active session we ALSO activate
// its dockview panel so the user can see the chat context behind
// the modal.
//
// Three layouts, switched on `request.kind`:
//
//   - **permission** — Allow once / Allow for session / Reject. The
//     "Allow for session" path sends the minimal SDK shape
//     `{ kind: "approve-for-session" }` without a rule; the SDK
//     may reject it (then surfaces as a toast via the bun-side
//     resolver), but works for the common path.
//
//   - **userInput** — question + optional choices radio + free-text
//     input when `allowFreeform`. Submit / Cancel. Cancel resolves
//     with an empty answer (`wasFreeform: false`) so the SDK can
//     observe a non-decision; this mirrors the SDK's typed
//     cancellation path.
//
//   - **elicitation** — `mode: "url"` shows the URL + "Open in
//     browser" + "I'm done" (opens via the `openUrl` RPC, then
//     resolves accept). `mode: "form"` shows a "not yet supported"
//     message + Cancel (form-mode schema renderer is the next
//     follow-up ticket per plan.md).
//
// Per anti-regression rule 3, the modal is verified at runtime via
// `bun run smoke` (which boots the bundle and asserts no console
// errors); a deeper end-to-end test against the modal-driven
// pending flow is a Tier-2 follow-up.

import { computed, ref, watch } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import RadioButton from "primevue/radiobutton";
import Textarea from "primevue/textarea";
import { useSessionsStore } from "../stores/sessionsStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useToastStore } from "../stores/toastStore";
import { invokeCommand } from "../ipc/invoke";
import { styleFor } from "../lib/notificationStyles";

const sessionsStore = useSessionsStore();
const layoutStore = useLayoutStore();
const toasts = useToastStore();

const pending = computed(() => sessionsStore.firstPending);

// User-input form state. Resets whenever the active request changes
// (watched below) so a fresh modal doesn't carry the previous
// request's typed answer.
const inputAnswer = ref("");
const inputChoice = ref<string | null>(null);
const urlOpened = ref(false);

watch(
  () => pending.value?.request.requestId,
  () => {
    inputAnswer.value = "";
    inputChoice.value = null;
    urlOpened.value = false;
  },
);

// When the pending request belongs to a non-active session, activate
// its dockview panel so the user has chat context behind the modal.
// Side-effect-only watcher; the modal will open regardless via the
// `pending !== null` template guard.
watch(
  () => pending.value?.record.id ?? null,
  (sessionId) => {
    if (!sessionId) return;
    if (layoutStore.activeSessionId === sessionId) return;
    layoutStore.activatePanel(sessionId);
  },
);

const headerStyle = computed(() => {
  const k = pending.value?.request.kind;
  if (!k) return null;
  return styleFor(k);
});

const title = computed(() => {
  switch (pending.value?.request.kind) {
    case "permission":
      return "Permission requested";
    case "userInput":
      return "Question";
    case "elicitation":
      return "Input requested";
    default:
      return "";
  }
});

const sessionLabel = computed(() => {
  const r = pending.value?.record;
  if (!r) return "";
  return r.title ?? `Session ${r.id.slice(0, 8)}`;
});

// Permission actions.
async function permissionRespond(
  decision: "approveOnce" | "approveForSession" | "reject",
): Promise<void> {
  const p = pending.value;
  if (!p) return;
  await sessionsStore.respondToPending({
    sessionId: p.record.id,
    requestId: p.request.requestId,
    response: { kind: "permission", decision },
  });
}

// User-input actions.
const userInputSubmittable = computed(() => {
  if (pending.value?.request.kind !== "userInput") return false;
  const req = pending.value.request.request;
  if (req.allowFreeform && inputAnswer.value.trim().length > 0) return true;
  if (req.choices && req.choices.length > 0 && inputChoice.value !== null)
    return true;
  return false;
});

async function userInputSubmit(): Promise<void> {
  const p = pending.value;
  if (p?.request.kind !== "userInput") return;
  const req = p.request.request;
  // Prefer freeform if the user typed something AND chose nothing;
  // otherwise prefer the choice. If both are populated, freeform
  // wins (matches the SDK's "freeform wins when present" semantic).
  let answer = "";
  let wasFreeform = false;
  if (req.allowFreeform && inputAnswer.value.trim().length > 0) {
    answer = inputAnswer.value;
    wasFreeform = true;
  } else if (inputChoice.value !== null) {
    answer = inputChoice.value;
    wasFreeform = false;
  }
  await sessionsStore.respondToPending({
    sessionId: p.record.id,
    requestId: p.request.requestId,
    response: { kind: "userInput", answer, wasFreeform },
  });
}

async function userInputCancel(): Promise<void> {
  const p = pending.value;
  if (p?.request.kind !== "userInput") return;
  await sessionsStore.respondToPending({
    sessionId: p.record.id,
    requestId: p.request.requestId,
    response: { kind: "userInput", answer: "", wasFreeform: false },
  });
}

// Elicitation actions.
async function openElicitationUrl(): Promise<void> {
  const p = pending.value;
  if (p?.request.kind !== "elicitation") return;
  const url = p.request.request.url;
  if (!url) {
    toasts.warn("No URL provided", "The agent didn't supply a URL to open.");
    return;
  }
  const ok = await invokeCommand("openUrl", { url });
  if (ok) {
    urlOpened.value = true;
  } else {
    toasts.error("Couldn't open URL", url);
  }
}

async function elicitationAccept(): Promise<void> {
  const p = pending.value;
  if (p?.request.kind !== "elicitation") return;
  await sessionsStore.respondToPending({
    sessionId: p.record.id,
    requestId: p.request.requestId,
    response: { kind: "elicitation", action: "accept" },
  });
}

async function elicitationCancel(action: "decline" | "cancel" = "cancel"): Promise<void> {
  const p = pending.value;
  if (p?.request.kind !== "elicitation") return;
  await sessionsStore.respondToPending({
    sessionId: p.record.id,
    requestId: p.request.requestId,
    response: { kind: "elicitation", action },
  });
}

// Pretty-printed JSON for the permission "details" block so the user
// can see what's being requested (path/command/url/etc.).
const permissionDetails = computed(() => {
  if (pending.value?.request.kind !== "permission") return null;
  const raw = pending.value.request.request.raw;
  try {
    return JSON.stringify(raw, null, 2);
  } catch {
    return null;
  }
});

// Allow closing via dialog header X = treat as cancel/reject for
// the appropriate kind so we don't leave the SDK promise hanging.
async function handleDialogClose(): Promise<void> {
  const p = pending.value;
  if (!p) return;
  switch (p.request.kind) {
    case "permission":
      await permissionRespond("reject");
      break;
    case "userInput":
      await userInputCancel();
      break;
    case "elicitation":
      await elicitationCancel();
      break;
  }
}
</script>

<template>
  <Dialog
    :visible="pending !== null"
    :modal="true"
    :closable="true"
    :draggable="false"
    :dismissable-mask="false"
    :close-on-escape="false"
    :style="{ width: '30rem', maxWidth: '90vw' }"
    @update:visible="(v: boolean) => { if (!v) handleDialogClose(); }"
  >
    <template #header>
      <div v-if="pending && headerStyle" class="pending-modal-header">
        <i
          class="pi pending-modal-icon"
          :class="`pi-${headerStyle.iconSuffix}`"
          :style="{ color: headerStyle.color }"
          aria-hidden="true"
        />
        <div class="pending-modal-title">
          <span class="pending-modal-kind">{{ title }}</span>
          <span class="pending-modal-session">{{ sessionLabel }}</span>
        </div>
      </div>
    </template>

    <!-- Permission layout -->
    <div v-if="pending?.request.kind === 'permission'" class="pending-modal-body">
      <p class="pending-modal-message">{{ pending.request.message }}</p>
      <details v-if="permissionDetails" class="pending-modal-details">
        <summary>Show details</summary>
        <pre class="pending-modal-raw">{{ permissionDetails }}</pre>
      </details>
      <div class="pending-modal-actions">
        <Button
          label="Reject"
          severity="danger"
          @click="permissionRespond('reject')"
        />
        <Button
          label="Allow for session"
          severity="secondary"
          @click="permissionRespond('approveForSession')"
        />
        <Button
          label="Allow once"
          severity="primary"
          @click="permissionRespond('approveOnce')"
        />
      </div>
    </div>

    <!-- User-input layout -->
    <div v-else-if="pending?.request.kind === 'userInput'" class="pending-modal-body">
      <p class="pending-modal-message">{{ pending.request.message }}</p>
      <div
        v-if="pending.request.request.choices && pending.request.request.choices.length > 0"
        class="pending-modal-choices"
      >
        <label
          v-for="choice in pending.request.request.choices"
          :key="choice"
          class="pending-modal-choice"
        >
          <RadioButton
            v-model="inputChoice"
            :name="`pending-${pending.request.requestId}`"
            :value="choice"
          />
          <span>{{ choice }}</span>
        </label>
      </div>
      <div v-if="pending.request.request.allowFreeform" class="pending-modal-input">
        <label class="pending-modal-input-label">
          {{ pending.request.request.choices && pending.request.request.choices.length > 0 ? "Or type your own:" : "Your answer:" }}
        </label>
        <Textarea
          v-model="inputAnswer"
          rows="3"
          autofocus
          @keydown.ctrl.enter.prevent="userInputSubmit"
        />
        <span class="pending-modal-hint">Ctrl+Enter to submit</span>
      </div>
      <div class="pending-modal-actions">
        <Button
          label="Cancel"
          severity="secondary"
          @click="userInputCancel"
        />
        <Button
          label="Submit"
          severity="primary"
          :disabled="!userInputSubmittable"
          @click="userInputSubmit"
        />
      </div>
    </div>

    <!-- Elicitation url-mode -->
    <div
      v-else-if="pending?.request.kind === 'elicitation' && pending.request.request.mode === 'url'"
      class="pending-modal-body"
    >
      <p class="pending-modal-message">{{ pending.request.message }}</p>
      <div v-if="pending.request.request.url" class="pending-modal-url">
        <code class="pending-modal-url-text">{{ pending.request.request.url }}</code>
      </div>
      <p v-if="pending.request.request.elicitationSource" class="pending-modal-source">
        Requested by: {{ pending.request.request.elicitationSource }}
      </p>
      <div class="pending-modal-actions">
        <Button
          label="Decline"
          severity="secondary"
          @click="elicitationCancel('decline')"
        />
        <Button
          v-if="!urlOpened"
          label="Open in browser"
          severity="primary"
          icon="pi pi-external-link"
          @click="openElicitationUrl"
        />
        <Button
          v-else
          label="I'm done"
          severity="primary"
          icon="pi pi-check"
          @click="elicitationAccept"
        />
      </div>
    </div>

    <!-- Elicitation form-mode (deferred) -->
    <div v-else-if="pending?.request.kind === 'elicitation'" class="pending-modal-body">
      <p class="pending-modal-message">{{ pending.request.message }}</p>
      <p class="pending-modal-unsupported">
        <i class="pi pi-info-circle" aria-hidden="true" />
        Form-based input isn't supported in this build yet. Cancel to let the
        agent proceed; a future release will render the requested form fields.
      </p>
      <div class="pending-modal-actions">
        <Button
          label="Cancel"
          severity="secondary"
          @click="elicitationCancel('cancel')"
        />
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.pending-modal-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.pending-modal-icon {
  font-size: 1.25rem;
}

.pending-modal-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.pending-modal-kind {
  font-weight: 600;
  color: var(--p-text-color);
}

.pending-modal-session {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pending-modal-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.pending-modal-message {
  margin: 0;
  white-space: pre-wrap;
}

.pending-modal-details {
  margin: 0;
  padding: 0.5rem 0.75rem;
  background: var(--p-content-hover-background);
  border-radius: var(--p-border-radius-sm);
  font-size: 0.85rem;
}

.pending-modal-details summary {
  cursor: pointer;
  user-select: none;
  color: var(--p-text-muted-color);
}

.pending-modal-raw {
  margin: 0.5rem 0 0;
  padding: 0.5rem;
  background: var(--p-content-background);
  border-radius: var(--p-border-radius-sm);
  overflow: auto;
  max-height: 12rem;
  font-size: 0.8rem;
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
}

.pending-modal-choices {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.pending-modal-choice {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.pending-modal-input {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.pending-modal-input-label {
  font-size: 0.85rem;
  color: var(--p-text-muted-color);
}

.pending-modal-hint {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  align-self: flex-end;
}

.pending-modal-url {
  padding: 0.5rem 0.75rem;
  background: var(--p-content-hover-background);
  border-radius: var(--p-border-radius-sm);
  overflow: auto;
}

.pending-modal-url-text {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.85rem;
  word-break: break-all;
}

.pending-modal-source {
  margin: 0;
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.pending-modal-unsupported {
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: color-mix(in srgb, var(--p-amber-500, gold) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--p-amber-500, gold) 40%, transparent);
  border-radius: var(--p-border-radius-sm);
  color: var(--p-text-color);
  font-size: 0.85rem;
}

.pending-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
