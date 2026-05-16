// Permission prompt queue — placeholder for the upcoming `PermissionService`
// modal flow (see `plans/plan-toolsAndPermissions.prompt.md`). Today the
// backend still uses `ApproveAllHandler`; this store exists so the next
// milestone item can wire prompts straight into a real UI without
// restructuring components.

import { defineStore } from "pinia";
import { ref } from "vue";

export type PermissionRequest = {
  id: string;
  tool: string;
  summary: string;
  detail?: string;
};

export type PermissionDecision = "allow_once" | "allow_always" | "deny";

export const usePermissionsStore = defineStore("permissions", () => {
  const queue = ref<PermissionRequest[]>([]);

  function enqueue(request: PermissionRequest): void {
    queue.value.push(request);
  }

  function resolve(id: string, _decision: PermissionDecision): void {
    queue.value = queue.value.filter((r) => r.id !== id);
  }

  return { queue, enqueue, resolve };
});
