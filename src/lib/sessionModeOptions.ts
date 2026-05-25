/// Canonical list of session run-mode options.
///
/// Shared by ModeButtonGroup, SessionDetailsPanel, and the command palette
/// so the labels, icons, and ordering stay in sync.

import type { SessionMode } from '@/ipc/types';

export interface ModeOption {
  label: string;
  value: SessionMode;
  icon: string;
}

export const MODE_OPTIONS: ModeOption[] = [
  { label: 'Interactive', value: 'interactive', icon: 'pi pi-comments' },
  { label: 'Plan', value: 'plan', icon: 'pi pi-list-check' },
  { label: 'Autopilot', value: 'autopilot', icon: 'pi pi-bolt' },
];
