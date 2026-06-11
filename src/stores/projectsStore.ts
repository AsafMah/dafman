// Renderer-side store for the Projects overlay (#264).
//
// Wraps the 6 project RPCs in a Pinia store so Vue components can
// read/write projects reactively. `loadAll` is called lazily (the
// Library Projects tab or auto-apply hook calls it on demand).

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { invokeCommand } from '@/ipc/invoke';
import type { ApplyProjectResult, Project } from '@/ipc/types';
import { toErrorMessage } from '@/lib/errorMessage';
import { useToastStore } from '@/stores/app/toastStore';

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<Project[]>([]);
  const loaded = ref(false);

  async function loadAll(): Promise<void> {
    try {
      const result = await invokeCommand('listProjects', {});

      projects.value = Array.isArray(result) ? result : [];
      loaded.value = true;
    } catch (err) {
      useToastStore().error('Failed to load projects', toErrorMessage(err));
    }
  }

  async function save(project: Project): Promise<void> {
    await invokeCommand('saveProject', { project });
    // Refresh in-memory list
    const idx = projects.value.findIndex((p) => p.path === project.path);

    if (idx >= 0) {
      projects.value[idx] = project;
    } else {
      projects.value.push(project);
    }
  }

  async function remove(path: string): Promise<void> {
    await invokeCommand('deleteProject', { path });
    projects.value = projects.value.filter((p) => p.path !== path);
  }

  async function getForPath(path: string): Promise<Project | null> {
    return invokeCommand('getProjectForPath', { path });
  }

  async function apply(sessionId: string, path: string): Promise<ApplyProjectResult> {
    return invokeCommand('applyProjectToSession', { sessionId, path });
  }

  async function capture(sessionId: string, path: string, name?: string): Promise<Project> {
    const project = await invokeCommand('captureProjectFromSession', {
      sessionId,
      path,
      ...(name !== undefined ? { name } : {}),
    });

    // Upsert in local list so the store stays consistent without a full reload.
    const idx = projects.value.findIndex((p) => p.path === project.path);

    if (idx >= 0) {
      projects.value[idx] = project;
    } else {
      projects.value.push(project);
    }

    return project;
  }

  return { projects, loaded, loadAll, save, remove, getForPath, apply, capture };
});
