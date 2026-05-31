import { ref, watch, type Ref } from 'vue';
import { useTimeoutFn } from '@vueuse/core';

export const BUSY_AFFORDANCE_DELAY_MS = 180;

export function useDelayedBusyValue<T>(
  busyValue: Ref<T | null>,
  delayMs = BUSY_AFFORDANCE_DELAY_MS,
) {
  const visibleBusyValue = ref<T | null>(null);
  const { start, stop } = useTimeoutFn(
    () => {
      visibleBusyValue.value = busyValue.value;
    },
    delayMs,
    { immediate: false },
  );

  watch(
    busyValue,
    (next) => {
      stop();
      visibleBusyValue.value = null;

      if (next !== null) start();
    },
    { immediate: true, flush: 'sync' },
  );

  return visibleBusyValue;
}
