<script setup lang="ts">
import { computed, ref } from 'vue';
import Button from 'primevue/button';
import Textarea from 'primevue/textarea';
import { storeToRefs } from 'pinia';
import type { JobRecord } from '../ipc/types';
import { useJobsStore } from '../stores/jobsStore';
import { useLayoutStore } from '../stores/layoutStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { useToastStore } from '../stores/toastStore';
import { toErrorMessage } from '../lib/errorMessage';

const jobsStore = useJobsStore();
const layoutStore = useLayoutStore();
const sessionsStore = useSessionsStore();
const toasts = useToastStore();
const { jobs, activeCount, isLoading, busyJobId } = storeToRefs(jobsStore);

const goal = ref('');
const startingAutopilot = ref(false);

const activeSession = computed(() => {
  const id = layoutStore.activeSessionId;

  if (!id) return null;

  return sessionsStore.getSession(id) ?? null;
});

const groupedJobs = computed(() => {
  const groups: Record<string, JobRecord[]> = {
    active: [],
    completed: [],
    failed: [],
    cancelled: [],
  };

  for (const job of jobs.value) {
    if (job.status === 'failed') groups.failed.push(job);
    else if (job.status === 'cancelled') groups.cancelled.push(job);
    else if (job.status === 'completed') groups.completed.push(job);
    else groups.active.push(job);
  }

  return groups;
});

async function startAutopilot(): Promise<void> {
  const session = activeSession.value;
  const trimmed = goal.value.trim();

  if (!session || !trimmed || startingAutopilot.value) return;

  startingAutopilot.value = true;

  try {
    await jobsStore.startAutopilot(session.id, trimmed);
    goal.value = '';
    toasts.success('Autopilot started', session.title ?? session.id.slice(0, 8));
  } catch (err) {
    toasts.error('Failed to start autopilot', toErrorMessage(err));
  } finally {
    startingAutopilot.value = false;
  }
}

function sessionLabel(sessionId: string): string {
  const record = sessionsStore.getSession(sessionId);

  return record?.title ?? record?.workingDirectory ?? sessionId.slice(0, 8);
}

function elapsed(job: JobRecord): string {
  let ms = job.activeTimeMs ?? null;

  if (ms === null && job.startedAt) {
    const start = Date.parse(job.startedAt);
    const end = job.completedAt ? Date.parse(job.completedAt) : Date.now();

    if (Number.isFinite(start) && Number.isFinite(end)) ms = end - start;
  }

  if (ms === null) return '';

  if (ms < 1000) return `${ms}ms`;

  const s = Math.round(ms / 1000);

  if (s < 60) return `${s}s`;

  const m = Math.floor(s / 60);

  if (m < 60) return `${m}m ${s % 60}s`;

  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function statusIcon(job: JobRecord): string {
  switch (job.status) {
    case 'starting':
    case 'running':
      return 'pi pi-spin pi-spinner';
    case 'idle':
      return 'pi pi-pause-circle';
    case 'completed':
      return 'pi pi-check-circle';
    case 'failed':
      return 'pi pi-times-circle';
    case 'cancelled':
      return 'pi pi-ban';
  }
}
</script>

<template>
  <section class="jobs-panel">
    <header class="jobs-header">
      <div>
        <h2>Jobs</h2>
        <p>{{ activeCount }} active</p>
      </div>
      <Button
        icon="pi pi-refresh"
        text
        rounded
        size="small"
        :loading="isLoading"
        aria-label="Refresh jobs"
        @click="jobsStore.refresh"
      />
    </header>

    <section class="autopilot-card">
      <h3>Start Autopilot</h3>
      <p class="hint">Runs in the current session: switches to Autopilot and sends the goal.</p>
      <div
        v-if="activeSession"
        class="context"
      >
        <span>Session</span>
        <strong>{{ sessionLabel(activeSession.id) }}</strong>
        <span>Mode</span>
        <strong>{{ activeSession.mode ?? 'unknown' }}</strong>
        <span>Auto-approve</span>
        <strong>{{ activeSession.approveAll ? 'on' : 'off' }}</strong>
        <span>Pending requests</span>
        <strong>{{ activeSession.pendingRequests.length }}</strong>
      </div>
      <div
        v-else
        class="empty-hint"
      >
        Open a session to start Autopilot.
      </div>
      <Textarea
        v-model="goal"
        rows="4"
        auto-resize
        :disabled="!activeSession || startingAutopilot"
        placeholder="Describe the goal for the current session..."
        aria-label="Autopilot goal"
      />
      <Button
        label="Start Autopilot"
        icon="pi pi-bolt"
        :disabled="!activeSession || !goal.trim()"
        :loading="startingAutopilot"
        @click="startAutopilot"
      />
    </section>

    <div
      v-if="jobsStore.error"
      class="empty-hint error"
    >
      {{ jobsStore.error }}
    </div>
    <div
      v-if="jobs.length === 0 && !isLoading"
      class="empty-hint"
    >
      No jobs yet. Start Autopilot or let the agent spawn background tasks.
    </div>

    <template
      v-for="(list, group) in groupedJobs"
      :key="group"
    >
      <section
        v-if="list.length > 0"
        class="job-group"
      >
        <h3 class="job-group-title">{{ group }} ({{ list.length }})</h3>
        <ul class="job-list">
          <li
            v-for="job in list"
            :key="job.id"
            class="job-row"
            :class="`job-${job.status}`"
          >
            <div class="job-main">
              <i
                :class="statusIcon(job)"
                aria-hidden="true"
              />
              <div class="job-text">
                <div class="job-title-line">
                  <strong>{{ job.title }}</strong>
                  <small>{{ job.kind }}</small>
                  <small v-if="elapsed(job)">{{ elapsed(job) }}</small>
                </div>
                <div class="job-session">{{ sessionLabel(job.sessionId) }}</div>
                <p
                  v-if="job.description"
                  class="job-desc"
                >
                  {{ job.description }}
                </p>
                <p
                  v-if="job.latestResponse"
                  class="job-desc"
                >
                  {{ job.latestResponse }}
                </p>
                <p
                  v-if="job.result"
                  class="job-result"
                >
                  {{ job.result }}
                </p>
                <p
                  v-if="job.error"
                  class="job-error"
                >
                  {{ job.error }}
                </p>
              </div>
            </div>
            <div class="job-actions">
              <Button
                v-if="job.canOpenSession"
                icon="pi pi-arrow-up-right"
                text
                size="small"
                severity="secondary"
                :aria-label="`Open session for ${job.title}`"
                @click="jobsStore.openOwningSession(job.sessionId)"
              />
              <Button
                v-if="job.canPromoteToBackground"
                label="Background"
                size="small"
                severity="secondary"
                :loading="busyJobId === job.id"
                @click="jobsStore.promoteJob(job)"
              />
              <Button
                v-if="job.canCancel"
                label="Cancel"
                size="small"
                severity="secondary"
                :loading="busyJobId === job.id"
                @click="jobsStore.cancelJob(job)"
              />
              <Button
                v-if="job.canRemove"
                icon="pi pi-trash"
                text
                size="small"
                severity="secondary"
                :aria-label="`Remove job ${job.title}`"
                :loading="busyJobId === job.id"
                @click="jobsStore.removeJob(job)"
              />
            </div>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style scoped>
.jobs-panel {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  height: 100%;
  min-width: 0;
  container-type: inline-size;
  padding: 0.75rem;
  overflow-y: auto;
  color: var(--p-text-color);
}

.jobs-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  border-bottom: 1px solid var(--p-surface-border);
  padding-bottom: 0.55rem;
}

.jobs-header h2,
.autopilot-card h3,
.job-group-title {
  margin: 0;
}

.jobs-header h2 {
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.jobs-header p,
.hint,
.empty-hint {
  margin: 0.2rem 0 0;
  font-size: 0.76rem;
  color: var(--p-text-muted-color);
}

.autopilot-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.65rem;
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-md);
  background: color-mix(in srgb, var(--p-primary-color) 6%, transparent);
}

.context {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.2rem 0.6rem;
  font-size: 0.75rem;
}

.context span {
  color: var(--p-text-muted-color);
}

.job-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.job-group-title {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-muted-color);
}

.job-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.job-row {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.55rem;
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-md);
  background: var(--p-content-background);
}

.job-main {
  display: flex;
  gap: 0.55rem;
  min-width: 0;
}

.job-main > .pi {
  margin-top: 0.15rem;
  color: var(--p-primary-color);
  flex-shrink: 0;
}

.job-failed .job-main > .pi {
  color: var(--p-red-500);
}

.job-completed .job-main > .pi {
  color: var(--p-green-500);
}

.job-text {
  min-width: 0;
  flex: 1;
}

.job-title-line {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  min-width: 0;
}

.job-title-line strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job-title-line small,
.job-session {
  color: var(--p-text-muted-color);
  font-size: 0.68rem;
}

.job-desc,
.job-result,
.job-error {
  margin: 0.25rem 0 0;
  font-size: 0.74rem;
  line-height: 1.35;
  color: var(--p-text-muted-color);
  overflow-wrap: anywhere;
}

.job-result {
  color: var(--p-text-color);
}

.job-error,
.empty-hint.error {
  color: var(--p-red-500);
}

.job-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.35rem;
}

@container (max-width: 20rem) {
  .job-title-line {
    align-items: flex-start;
    flex-direction: column;
    gap: 0.1rem;
  }

  .job-actions :deep(.p-button-label) {
    display: none;
  }
}
</style>
