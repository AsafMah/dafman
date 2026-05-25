// Toast notifications surfaced via PrimeVue's `useToast` service.
//
// We keep the queue here (rather than calling `useToast()` directly from
// components) so non-component code — stores, background tasks — can push
// toasts without grabbing a Vue setup context.

import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastSeverity = 'success' | 'info' | 'warn' | 'error';

export type ToastMessage = {
  id: number;
  severity: ToastSeverity;
  summary: string;
  detail?: string;
  life: number;
};

let nextToastId = 1;

export const useToastStore = defineStore('toast', () => {
  const pending = ref<ToastMessage[]>([]);

  function push(
    severity: ToastSeverity,
    summary: string,
    detail?: string,
    life = 2500,
  ): ToastMessage {
    const msg: ToastMessage = {
      id: nextToastId++,
      severity,
      summary,
      detail,
      life: Math.max(1, life),
    };
    pending.value.push(msg);
    return msg;
  }

  function consume(): ToastMessage[] {
    const drained = pending.value.slice();
    pending.value = [];
    return drained;
  }

  return {
    pending,
    push,
    info: (summary: string, detail?: string) => push('info', summary, detail),
    success: (summary: string, detail?: string) => push('success', summary, detail),
    warn: (summary: string, detail?: string) => push('warn', summary, detail),
    error: (summary: string, detail?: string) => push('error', summary, detail, 5000),
    consume,
  };
});
