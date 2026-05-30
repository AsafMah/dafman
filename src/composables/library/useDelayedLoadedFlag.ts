import { ref } from 'vue';
import { useTimeoutFn } from '@vueuse/core';

export const LOADING_AFFORDANCE_DELAY_MS = 180;

export function useDelayedLoadedFlag() {
  const loaded = ref(false);
  let generation = 0;

  const { start, stop } = useTimeoutFn(
    () => {
      loaded.value = false;
    },
    LOADING_AFFORDANCE_DELAY_MS,
    { immediate: false },
  );

  function beginLoading(): () => void {
    generation += 1;
    const loadingGeneration = generation;

    stop();

    if (loaded.value) {
      start();
    } else {
      loaded.value = false;
    }

    return () => {
      if (loadingGeneration !== generation) return;

      stop();
      loaded.value = true;
    };
  }

  return { loaded, beginLoading };
}
