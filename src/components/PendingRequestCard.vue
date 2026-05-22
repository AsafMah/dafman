<script setup lang="ts">
// Inline pending-request card.
//
// Rendered as a chat-stream item alongside assistant/user/tool
// blocks (driven by the reducer's `pendingRequest` ChatItem kind).
// Non-blocking by design: the user can scroll, switch sessions, or
// keep typing while the card sits there. Responding (or the SDK
// resolving out-of-band) removes the card immediately.
//
// Three layouts mirror the three SDK callback channels:
//
//   - **permission** — Allow once / Reject. The "Allow for session"
//     button was removed in the inline rework: the SDK requires a
//     per-kind rule body (`approval.commandIdentifiers` for shell,
//     `approval.paths` for write, etc.) that we can't synthesize
//     without a real rule editor. Until that ships, the only safe
//     decisions are once-only or reject.
//
//   - **userInput** — question + optional choice radios + free-text
//     textarea (when `allowFreeform`). Submit / Cancel. Cancel
//     resolves with an empty answer so the SDK observes a non-
//     decision.
//
//   - **elicitation** — `mode: "url"` shows the URL + "Open in
//     browser" → switches to "I'm done" → resolves accept.
//     `mode: "form"` shows a "not yet supported" notice + Cancel
//     (form-schema renderer is the next ticket).

import { computed, ref } from "vue";
import Button from "primevue/button";
import RadioButton from "primevue/radiobutton";
import Textarea from "primevue/textarea";
import type {
  AutoModeSwitchRequestData,
  ElicitationRequestData,
  ExitPlanModeRequestData,
  PermissionApprovalRule,
  PermissionRequestData,
  UserInputRequestData,
} from "../ipc/types";
import { useSessionsStore } from "../stores/sessionsStore";
import MessageContent from "./MessageContent.vue";
import { useToastStore } from "../stores/toastStore";
import { invokeCommand } from "../ipc/invoke";
import { styleFor } from "../lib/notificationStyles";
import PermissionDetails from "./PermissionDetails.vue";
import PermissionRuleEditor from "./PermissionRuleEditor.vue";
import JsonSchemaForm from "./JsonSchemaForm.vue";

const props = defineProps<{
  sessionId: string;
  requestId: string;
  pendingKind:
    | "permission"
    | "userInput"
    | "elicitation"
    | "exitPlanMode"
    | "autoModeSwitch";
  message: string;
  request:
    | PermissionRequestData
    | UserInputRequestData
    | ElicitationRequestData
    | ExitPlanModeRequestData
    | AutoModeSwitchRequestData;
}>();

const sessionsStore = useSessionsStore();
const toasts = useToastStore();

const style = computed(() => styleFor(props.pendingKind));

const title = computed(() => {
  switch (props.pendingKind) {
    case "permission":
      return "Permission requested";
    case "userInput":
      return "Question";
    case "elicitation":
      return "Input requested";
    case "exitPlanMode":
      return "Plan approval";
    case "autoModeSwitch":
      return "Auto mode switch";
  }
});

const inputAnswer = ref("");
const inputChoice = ref<string | null>(null);
const urlOpened = ref(false);
const formContent = ref<Record<string, unknown>>({});
const formComponentRef = ref<{ validate: () => string | null } | null>(null);
const exitPlanFeedback = ref("");

// Type-narrowed accessors so the template doesn't need casts.
const asPermission = computed(() =>
  props.pendingKind === "permission"
    ? (props.request as PermissionRequestData)
    : null,
);
const asUserInput = computed(() =>
  props.pendingKind === "userInput"
    ? (props.request as UserInputRequestData)
    : null,
);
const asElicitation = computed(() =>
  props.pendingKind === "elicitation"
    ? (props.request as ElicitationRequestData)
    : null,
);
const asExitPlanMode = computed(() =>
  props.pendingKind === "exitPlanMode"
    ? (props.request as ExitPlanModeRequestData)
    : null,
);
const asAutoModeSwitch = computed(() =>
  props.pendingKind === "autoModeSwitch"
    ? (props.request as AutoModeSwitchRequestData)
    : null,
);

// Permission actions. Only Allow-once / Reject / Allow-and-stop-asking
// — see header comment for why approve-for-session is gone. The
// "Allow + don't ask again" path flips the registry-side approveAll
// toggle on the session so subsequent prompts auto-approve without
// surfacing a card. User can revert via the session-header gear
// menu (the toggle there mirrors the same state).
async function permissionRespond(
  decision: "approveOnce" | "reject",
): Promise<void> {
  await sessionsStore.respondToPending({
    sessionId: props.sessionId,
    requestId: props.requestId,
    response: { kind: "permission", decision },
  });
}

async function permissionAllowAndStopAsking(): Promise<void> {
  // Approve this request first, THEN flip the toggle. Doing it in
  // the other order would race the next-emit window: the registry
  // could short-circuit a queued sibling request before we got to
  // resolve this one.
  await sessionsStore.respondToPending({
    sessionId: props.sessionId,
    requestId: props.requestId,
    response: { kind: "permission", decision: "approveOnce" },
  });
  await sessionsStore.setSessionApproveAll(props.sessionId, true);
  toasts.info(
    "Auto-approve enabled for this session",
    "Toggle it back from the session options gear if you want prompts again.",
  );
}

const showRuleEditor = ref(false);

/// "Allow for session" with a concrete rule. The editor builds the
/// SDK-shaped approval payload (or `domain` for URL); we forward it
/// verbatim through respondToPending. The card is then dismissed by
/// the SDK's resolve path (registry removes the entry).
async function permissionAllowForSession(payload: {
  approval?: PermissionApprovalRule;
  domain?: string;
}): Promise<void> {
  showRuleEditor.value = false;
  await sessionsStore.respondToPending({
    sessionId: props.sessionId,
    requestId: props.requestId,
    response: {
      kind: "permission",
      decision: "approveForSession",
      ...(payload.approval ? { approval: payload.approval } : {}),
      ...(payload.domain ? { domain: payload.domain } : {}),
    },
  });
}

// User-input actions.
const userInputSubmittable = computed(() => {
  const req = asUserInput.value;
  if (!req) return false;
  if (req.allowFreeform && inputAnswer.value.trim().length > 0) return true;
  if (req.choices && req.choices.length > 0 && inputChoice.value !== null)
    return true;
  return false;
});

async function userInputSubmit(): Promise<void> {
  const req = asUserInput.value;
  if (!req) return;
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
    sessionId: props.sessionId,
    requestId: props.requestId,
    response: { kind: "userInput", answer, wasFreeform },
  });
}

async function userInputCancel(): Promise<void> {
  await sessionsStore.respondToPending({
    sessionId: props.sessionId,
    requestId: props.requestId,
    response: { kind: "userInput", answer: "", wasFreeform: false },
  });
}

// Elicitation actions.
async function openElicitationUrl(): Promise<void> {
  const req = asElicitation.value;
  if (!req) return;
  if (!req.url) {
    toasts.warn("No URL provided", "The agent didn't supply a URL to open.");
    return;
  }
  try {
    const ok = await invokeCommand("openUrl", { url: req.url });
    if (ok) {
      urlOpened.value = true;
    } else {
      toasts.error("Couldn't open URL", req.url);
    }
  } catch (err) {
    toasts.error(
      "Couldn't open URL",
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function elicitationAccept(): Promise<void> {
  // Form-mode: validate first, then ship the collected content.
  if (asElicitation.value && asElicitation.value.mode === "form") {
    const formRef = formComponentRef.value;
    if (formRef) {
      const err = formRef.validate();
      if (err) {
        toasts.warn("Form incomplete", `Please fill in ${err}.`);
        return;
      }
    }
    await sessionsStore.respondToPending({
      sessionId: props.sessionId,
      requestId: props.requestId,
      response: {
        kind: "elicitation",
        action: "accept",
        content: formContent.value,
      },
    });
    return;
  }
  await sessionsStore.respondToPending({
    sessionId: props.sessionId,
    requestId: props.requestId,
    response: { kind: "elicitation", action: "accept" },
  });
}

async function elicitationCancel(
  action: "decline" | "cancel" = "cancel",
): Promise<void> {
  await sessionsStore.respondToPending({
    sessionId: props.sessionId,
    requestId: props.requestId,
    response: { kind: "elicitation", action },
  });
}

async function exitPlanRespond(
  approved: boolean,
  selectedAction?: "interactive" | "autopilot" | "exit_only" | "autopilot_fleet",
): Promise<void> {
  await sessionsStore.respondToPending({
    sessionId: props.sessionId,
    requestId: props.requestId,
    response: {
      kind: "exitPlanMode",
      approved,
      ...(selectedAction ? { selectedAction } : {}),
      ...(exitPlanFeedback.value.trim()
        ? { feedback: exitPlanFeedback.value.trim() }
        : {}),
    },
  });
}

async function autoModeRespond(response: "yes" | "yes_always" | "no"): Promise<void> {
  await sessionsStore.respondToPending({
    sessionId: props.sessionId,
    requestId: props.requestId,
    response: { kind: "autoModeSwitch", response },
  });
}
</script>

<template>
  <article
    class="pending-card"
    :style="{ '--card-accent': style.color }"
    :aria-label="`${title}: ${message}`"
  >
    <header class="pending-card-header">
      <i
        class="pi pending-card-icon"
        :class="`pi-${style.iconSuffix}`"
        aria-hidden="true"
      />
      <span class="pending-card-title">{{ title }}</span>
    </header>

    <p class="pending-card-message">{{ message }}</p>

    <!-- Permission -->
    <template v-if="asPermission">
      <PermissionDetails :request="asPermission" />
      <div class="pending-card-actions">
        <Button
          label="Reject"
          severity="danger"
          size="small"
          @click="permissionRespond('reject')"
        />
        <Button
          v-if="!showRuleEditor"
          label="Allow for session…"
          severity="secondary"
          size="small"
          icon="pi pi-shield"
          @click="showRuleEditor = true"
        />
        <Button
          label="Allow + don't ask again"
          severity="secondary"
          size="small"
          icon="pi pi-bolt"
          @click="permissionAllowAndStopAsking"
        />
        <Button
          label="Allow once"
          severity="primary"
          size="small"
          @click="permissionRespond('approveOnce')"
        />
      </div>
      <PermissionRuleEditor
        v-if="showRuleEditor"
        :request="asPermission"
        @submit="permissionAllowForSession"
        @cancel="showRuleEditor = false"
      />
    </template>

    <!-- User input -->
    <template v-else-if="asUserInput">
      <div
        v-if="asUserInput.choices && asUserInput.choices.length > 0"
        class="pending-card-choices"
      >
        <label
          v-for="choice in asUserInput.choices"
          :key="choice"
          class="pending-card-choice"
        >
          <RadioButton
            v-model="inputChoice"
            :name="`pending-${requestId}`"
            :value="choice"
          />
          <span>{{ choice }}</span>
        </label>
      </div>
      <div v-if="asUserInput.allowFreeform" class="pending-card-input">
        <label class="pending-card-input-label">
          {{ asUserInput.choices && asUserInput.choices.length > 0 ? "Or type your own:" : "Your answer:" }}
        </label>
        <Textarea
          v-model="inputAnswer"
          rows="3"
          @keydown.ctrl.enter.prevent="userInputSubmit"
        />
        <span class="pending-card-hint">Ctrl+Enter to submit</span>
      </div>
      <div class="pending-card-actions">
        <Button
          label="Cancel"
          severity="secondary"
          size="small"
          @click="userInputCancel"
        />
        <Button
          label="Submit"
          severity="primary"
          size="small"
          :disabled="!userInputSubmittable"
          @click="userInputSubmit"
        />
      </div>
    </template>

    <!-- Elicitation url-mode -->
    <template v-else-if="asElicitation && asElicitation.mode === 'url'">
      <div v-if="asElicitation.url" class="pending-card-url">
        <code class="pending-card-url-text">{{ asElicitation.url }}</code>
      </div>
      <p v-if="asElicitation.elicitationSource" class="pending-card-source">
        Requested by: {{ asElicitation.elicitationSource }}
      </p>
      <div class="pending-card-actions">
        <Button
          label="Decline"
          severity="secondary"
          size="small"
          @click="elicitationCancel('decline')"
        />
        <Button
          v-if="!urlOpened"
          label="Open in browser"
          severity="primary"
          icon="pi pi-external-link"
          size="small"
          @click="openElicitationUrl"
        />
        <Button
          v-else
          label="I'm done"
          severity="primary"
          icon="pi pi-check"
          size="small"
          @click="elicitationAccept"
        />
      </div>
    </template>

    <!-- Elicitation form-mode (JSON-Schema → form) -->
    <template v-else-if="asElicitation">
      <JsonSchemaForm
        v-if="asElicitation.requestedSchema"
        ref="formComponentRef"
        :schema="(asElicitation.requestedSchema as Record<string, unknown>)"
        v-model="formContent"
      />
      <p v-else class="pending-card-unsupported">
        <i class="pi pi-info-circle" aria-hidden="true" />
        No schema was provided. Cancel to let the agent proceed.
      </p>
      <p v-if="asElicitation.elicitationSource" class="pending-card-source">
        Requested by: {{ asElicitation.elicitationSource }}
      </p>
      <div class="pending-card-actions">
        <Button
          label="Decline"
          severity="secondary"
          size="small"
          @click="elicitationCancel('decline')"
        />
        <Button
          v-if="asElicitation.requestedSchema"
          label="Submit"
          severity="primary"
          icon="pi pi-check"
          size="small"
          @click="elicitationAccept"
        />
        <Button
          v-else
          label="Cancel"
          severity="secondary"
          size="small"
          @click="elicitationCancel('cancel')"
        />
      </div>
    </template>

    <!-- Exit plan mode -->
    <template v-else-if="asExitPlanMode">
      <p class="pending-card-source">
        Recommended: {{ asExitPlanMode.recommendedAction }}
      </p>
      <div
        v-if="asExitPlanMode.planContent"
        class="pending-card-plan"
      >
        <MessageContent :text="asExitPlanMode.planContent" label="Plan markdown" />
      </div>
      <div class="pending-card-input">
        <label class="pending-card-input-label">Feedback / requested changes:</label>
        <Textarea v-model="exitPlanFeedback" rows="3" />
      </div>
      <div class="pending-card-actions">
        <Button
          v-if="asExitPlanMode.actions.includes('exit_only')"
          label="Exit only"
          severity="secondary"
          size="small"
          @click="exitPlanRespond(false, 'exit_only')"
        />
        <Button
          v-if="asExitPlanMode.actions.includes('interactive')"
          label="Continue interactive"
          severity="primary"
          size="small"
          @click="exitPlanRespond(true, 'interactive')"
        />
        <Button
          v-if="asExitPlanMode.actions.includes('autopilot')"
          label="Autopilot"
          severity="warn"
          size="small"
          icon="pi pi-bolt"
          @click="exitPlanRespond(true, 'autopilot')"
        />
        <Button
          v-if="asExitPlanMode.actions.includes('autopilot_fleet')"
          label="Autopilot fleet"
          severity="warn"
          size="small"
          icon="pi pi-users"
          @click="exitPlanRespond(true, 'autopilot_fleet')"
        />
      </div>
    </template>

    <!-- Rate-limit auto-mode switch -->
    <template v-else-if="asAutoModeSwitch">
      <p class="pending-card-source">
        The CLI can switch modes after an eligible rate limit.
        <template v-if="asAutoModeSwitch.retryAfterSeconds !== undefined">
          Retry after {{ asAutoModeSwitch.retryAfterSeconds }}s.
        </template>
      </p>
      <div class="pending-card-actions">
        <Button
          label="No"
          severity="secondary"
          size="small"
          @click="autoModeRespond('no')"
        />
        <Button
          label="Yes"
          severity="primary"
          size="small"
          @click="autoModeRespond('yes')"
        />
        <Button
          label="Yes, always"
          severity="warn"
          size="small"
          icon="pi pi-bolt"
          @click="autoModeRespond('yes_always')"
        />
      </div>
    </template>
  </article>
</template>

<style scoped>
.pending-card {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  margin: 0.25rem 0;
  border-radius: var(--p-border-radius-md);
  border: 1px solid color-mix(in srgb, var(--card-accent, var(--p-primary-color)) 45%, transparent);
  background: color-mix(in srgb, var(--card-accent, var(--p-primary-color)) 8%, var(--p-content-background));
  /* Slim accent rail on the left to match the visual language of the
   * chat-tile + tab indicators. */
  border-left: 4px solid var(--card-accent, var(--p-primary-color));
  color: var(--p-text-color);
}

.pending-card-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.pending-card-icon {
  font-size: 1rem;
  color: var(--card-accent, var(--p-primary-color));
}

.pending-card-title {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--card-accent, var(--p-primary-color));
}

.pending-card-message {
  margin: 0;
  font-size: 0.95rem;
  white-space: pre-wrap;
  word-break: break-word;
}

.pending-card-choices {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.pending-card-choice {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.9rem;
}

.pending-card-input {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.pending-card-input-label {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.pending-card-hint {
  font-size: 0.72rem;
  color: var(--p-text-muted-color);
  align-self: flex-end;
}

.pending-card-url {
  padding: 0.4rem 0.6rem;
  background: var(--p-content-hover-background);
  border-radius: var(--p-border-radius-sm);
  overflow: auto;
}

.pending-card-url-text {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.82rem;
  word-break: break-all;
}

.pending-card-plan {
  max-height: 16rem;
  overflow: auto;
  margin: 0;
  padding: 0.6rem 0.75rem;
  border-radius: var(--p-border-radius-sm);
  background: var(--p-content-hover-background);
}

.pending-card-plan :deep(.md-html-segment) {
  font-size: 0.82rem;
  line-height: 1.35;
}

.pending-card-source {
  margin: 0;
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
}

.pending-card-unsupported {
  display: flex;
  gap: 0.5rem;
  padding: 0.4rem 0.6rem;
  background: color-mix(in srgb, var(--p-amber-500, gold) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--p-amber-500, gold) 40%, transparent);
  border-radius: var(--p-border-radius-sm);
  font-size: 0.82rem;
}

.pending-card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.25rem;
}
</style>
