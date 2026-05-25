// Composable: usage metrics + account quota for the session details rail.

import { ref, type ComputedRef } from 'vue';
import { invokeCommand } from '@/ipc/invoke';
import { useToastStore } from '@/stores/app/toastStore';
import { toErrorMessage } from '@/lib/errorMessage';
import type { SessionRecord } from '@/stores/chat/sessionsStore';

const MAX_PLAUSIBLE_CONTEXT_TOKENS = 500_000;

function normalizeContextLimit(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;

  if (value > MAX_PLAUSIBLE_CONTEXT_TOKENS) return null;

  return value;
}

export type UsageMetrics = {
  totalUserRequests: number;
  totalPremiumRequestCost: number;
  totalApiDurationMs: number;
  lastCallInputTokens: number;
  lastCallOutputTokens: number;
  currentTokens: number;
  tokenLimit: number;
};

export type QuotaSnapshot = {
  type: string;
  isUnlimitedEntitlement: boolean;
  entitlementRequests: number;
  usedRequests: number;
  remainingPercentage: number;
  overage: number;
  resetDate?: string;
};

function deriveUsageFromEvents(
  events: Array<{ eventType: string; data: Record<string, unknown> }>,
): UsageMetrics {
  let totalUserRequests = 0;
  let totalPremiumRequestCost = 0;
  let totalApiDurationMs = 0;
  let lastCallInputTokens = 0;
  let lastCallOutputTokens = 0;
  let currentTokens = 0;
  let tokenLimit = 0;

  for (const event of events) {
    const data = event.data;

    if (event.eventType === 'assistant.usage') {
      totalUserRequests += 1;
      const cost = data.cost;

      if (typeof cost === 'number') totalPremiumRequestCost += cost;

      const duration = data.duration;

      if (typeof duration === 'number') totalApiDurationMs += duration;

      const input = data.inputTokens;

      if (typeof input === 'number') {
        lastCallInputTokens = input;
        currentTokens = input;
      }

      const output = data.outputTokens;

      if (typeof output === 'number') lastCallOutputTokens = output;
    } else if (event.eventType === 'session.usage_info') {
      const current = data.currentTokens;

      if (typeof current === 'number') currentTokens = current;

      const limit = data.tokenLimit;

      if (typeof limit === 'number') tokenLimit = normalizeContextLimit(limit) ?? 0;
    }
  }

  return {
    totalUserRequests,
    totalPremiumRequestCost,
    totalApiDurationMs,
    lastCallInputTokens,
    lastCallOutputTokens,
    currentTokens,
    tokenLimit,
  };
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;

  const s = ms / 1000;

  if (s < 60) return `${s.toFixed(1)} s`;

  const min = Math.floor(s / 60);
  const sec = Math.round(s % 60);

  return `${min}m ${sec}s`;
}

export function useSessionUsage(
  sessionId: ComputedRef<string>,
  record: ComputedRef<SessionRecord | undefined>,
) {
  const toasts = useToastStore();
  const usage = ref<UsageMetrics | null>(null);
  const usageError = ref<string | null>(null);

  async function loadUsage() {
    if (!sessionId.value) return;

    usageError.value = null;

    try {
      const raw = await invokeCommand('getSessionUsageMetrics', {
        sessionId: sessionId.value,
      });
      const fromRpc = {
        totalUserRequests: typeof raw.totalUserRequests === 'number' ? raw.totalUserRequests : 0,
        totalPremiumRequestCost:
          typeof raw.totalPremiumRequestCost === 'number' ? raw.totalPremiumRequestCost : 0,
        totalApiDurationMs: typeof raw.totalApiDurationMs === 'number' ? raw.totalApiDurationMs : 0,
        lastCallInputTokens:
          typeof raw.lastCallInputTokens === 'number' ? raw.lastCallInputTokens : 0,
        lastCallOutputTokens:
          typeof raw.lastCallOutputTokens === 'number' ? raw.lastCallOutputTokens : 0,
        currentTokens:
          typeof raw.currentTokens === 'number'
            ? raw.currentTokens
            : typeof raw.inputTokens === 'number'
              ? raw.inputTokens
              : 0,
        tokenLimit:
          typeof raw.tokenLimit === 'number'
            ? (normalizeContextLimit(raw.tokenLimit) ?? 0)
            : typeof raw.maxTokens === 'number'
              ? (normalizeContextLimit(raw.maxTokens) ?? 0)
              : 0,
      };
      const fromEvents = deriveUsageFromEvents(record.value?.events ?? []);

      usage.value =
        fromRpc.totalUserRequests > 0 || fromRpc.lastCallInputTokens > 0 || fromRpc.tokenLimit > 0
          ? fromRpc
          : fromEvents;
    } catch (err) {
      const fromEvents = deriveUsageFromEvents(record.value?.events ?? []);

      if (fromEvents.totalUserRequests > 0 || fromEvents.tokenLimit > 0) {
        usage.value = fromEvents;

        return;
      }

      usageError.value = toErrorMessage(err);
    }
  }

  function resetUsage() {
    usage.value = null;
    usageError.value = null;
  }

  // -- Quota --
  const quota = ref<QuotaSnapshot[]>([]);
  const quotaError = ref<string | null>(null);
  const warnedThresholds = new Set<string>();

  async function loadQuota() {
    quotaError.value = null;

    try {
      const raw = await invokeCommand('getAccountQuota', {});
      const snapshots: QuotaSnapshot[] = Object.entries(raw).map(([type, snap]) => ({
        type,
        ...snap,
      }));

      quota.value = snapshots;

      for (const snap of snapshots) {
        if (snap.isUnlimitedEntitlement) continue;

        const usedPct = 100 - snap.remainingPercentage;

        for (const threshold of [90, 75]) {
          const key = `${snap.type}:${threshold}`;

          if (usedPct >= threshold && !warnedThresholds.has(key)) {
            warnedThresholds.add(key);
            const severity = threshold === 90 ? 'warn' : 'info';

            toasts[severity](
              `Quota at ${usedPct.toFixed(0)}%`,
              `${snap.type}: ${snap.usedRequests}/${snap.entitlementRequests} used`,
            );
            break;
          }
        }
      }
    } catch (err) {
      quotaError.value = toErrorMessage(err);
    }
  }

  return {
    usage,
    usageError,
    loadUsage,
    resetUsage,
    quota,
    quotaError,
    loadQuota,
  };
}
