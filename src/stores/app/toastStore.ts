// In-app toast notifications.
//
// Rendering uses PrimeVue's Toast component, but PrimeVue's `useToast()`
// only works inside a component setup context. To let non-component code
// (Pinia stores, background tasks, IPC handlers) fire toasts, the app root
// registers a render sink via `register()`; toasts pushed before that
// (boot-time) or in unit tests queue in `pending` and flush on register.

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

/// Renders one queued toast — registered once by the app root (wraps
/// PrimeVue's `add`). Toasts pushed before registration are buffered.
export type ToastSink = (msg: ToastMessage) => void;

let nextToastId = 1;

export const useToastStore = defineStore('toast', () => {
  const pending = ref<ToastMessage[]>([]);
  // Buffer for toasts pushed before a sink registers (boot) or when none
  // is (unit tests). `consume()` drains it.
  let sink: ToastSink | null = null;

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
      life: life <= 0 ? 0 : Math.max(1, life),
    };

    if (sink) {
      sink(msg);
    } else {
      pending.value.push(msg);
    }

    return msg;
  }

  /// Register the renderer sink; flush anything queued before mount, then
  /// route future toasts straight through.
  function register(render: ToastSink): void {
    sink = render;

    if (pending.value.length > 0) {
      const drained = pending.value.slice();

      pending.value = [];

      for (const msg of drained) render(msg);
    }
  }

  function unregister(): void {
    sink = null;
  }

  function consume(): ToastMessage[] {
    const drained = pending.value.slice();

    pending.value = [];

    return drained;
  }

  return {
    pending,
    push,
    register,
    unregister,
    info: (summary: string, detail?: string) => push('info', summary, detail),
    success: (summary: string, detail?: string) => push('success', summary, detail),
    warn: (summary: string, detail?: string) => push('warn', summary, detail),
    // Errors are sticky (life 0 = no auto-dismiss) so the message can be
    // read and copied; the user closes them manually.
    error: (summary: string, detail?: string) => push('error', summary, detail, 0),
    consume,
  };
});
