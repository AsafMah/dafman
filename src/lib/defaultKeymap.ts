/**
 * Default keyboard shortcut bindings for Dafman.
 *
 * Source of truth for the initial keymap. User overrides and disabled-ids are
 * merged on top of this in `shortcutRegistry`.
 *
 * Naming convention for ids: `<scope>.<commandId>` (dots replaced where the
 * command id already contains dots: use the full command id verbatim after the
 * scope prefix).
 */

import type { DefaultKeyBinding } from './shortcuts/types';

export const defaultKeymap: DefaultKeyBinding[] = [
  // -------------------------------------------------------------------------
  // global — shell-level commands
  // -------------------------------------------------------------------------

  {
    id: 'global.commandPalette.toggle',
    commandId: 'commandPalette.toggle',
    scope: 'global',
    keys: '$mod+K',
    reassignable: true,
  },
  {
    id: 'global.session.new',
    commandId: 'session.new',
    scope: 'global',
    keys: '$mod+N',
    reassignable: true,
  },
  {
    id: 'global.settings.open',
    commandId: 'settings.open',
    scope: 'global',
    keys: '$mod+,',
    reassignable: true,
  },
  {
    id: 'global.sessions-manager.toggle',
    commandId: 'sessions-manager.toggle',
    scope: 'global',
    keys: '$mod+Shift+S',
    reassignable: true,
  },
  {
    id: 'global.library.open',
    commandId: 'library.open',
    scope: 'global',
    keys: '$mod+Shift+L',
    reassignable: true,
  },
  {
    id: 'global.terminals.open',
    commandId: 'terminals.open',
    scope: 'global',
    // Store code value for layout-sensitive backquote key
    keys: '$mod+Backquote',
    reassignable: true,
  },
  {
    id: 'global.terminal.new',
    commandId: 'terminal.new',
    scope: 'global',
    keys: '$mod+Shift+Backquote',
    reassignable: true,
  },
  {
    id: 'global.jobs.open',
    commandId: 'jobs.open',
    scope: 'global',
    keys: '$mod+Shift+J',
    reassignable: true,
  },
  {
    id: 'global.logs.open',
    commandId: 'logs.open',
    scope: 'global',
    keys: '$mod+Shift+O',
    reassignable: true,
  },
  {
    id: 'global.sessionDetails.toggle',
    commandId: 'sessionDetails.toggle',
    scope: 'global',
    keys: '$mod+I',
    reassignable: true,
  },
  {
    id: 'global.view.nextGroup',
    commandId: 'view.nextGroup',
    scope: 'global',
    keys: '$mod+Shift+]',
    reassignable: true,
  },
  {
    id: 'global.view.prevGroup',
    commandId: 'view.prevGroup',
    scope: 'global',
    keys: '$mod+Shift+[',
    reassignable: true,
  },
  {
    id: 'global.keyboardShortcuts.open',
    commandId: 'keyboardShortcuts.open',
    scope: 'global',
    keys: '$mod+Shift+K',
    reassignable: true,
  },
  {
    id: 'global.search.global',
    commandId: 'search.global',
    scope: 'global',
    keys: '$mod+Shift+F',
    reassignable: true,
  },

  // -------------------------------------------------------------------------
  // commandPalette — palette-owned navigation
  // -------------------------------------------------------------------------

  {
    id: 'commandPalette.commandPalette.close',
    commandId: 'commandPalette.close',
    scope: 'commandPalette',
    keys: 'Escape',
    // Palette Escape is not user-reassignable — it's fundamental to dismissal UX
    reassignable: false,
  },

  // -------------------------------------------------------------------------
  // composer — Lexical composer actions (display-only / locked for v1)
  // -------------------------------------------------------------------------

  {
    id: 'composer.composer.submit.default',
    commandId: 'composer.submit.default',
    scope: 'composer',
    keys: 'Enter',
    reassignable: false,
  },
  {
    id: 'composer.composer.insert.softBreak',
    commandId: 'composer.insert.softBreak',
    scope: 'composer',
    keys: 'Shift+Enter',
    reassignable: false,
  },
  {
    id: 'composer.composer.insert.paragraph',
    commandId: 'composer.insert.paragraph',
    scope: 'composer',
    keys: '$mod+Enter',
    reassignable: false,
  },
  {
    id: 'composer.composer.submit.steer',
    commandId: 'composer.submit.steer',
    scope: 'composer',
    keys: 'Alt+Enter',
    reassignable: false,
  },
  {
    id: 'composer.composer.submit.queue',
    commandId: 'composer.submit.queue',
    scope: 'composer',
    keys: '$mod+Shift+Enter',
    reassignable: false,
  },
  {
    id: 'composer.composer.submit.interrupt',
    commandId: 'composer.submit.interrupt',
    scope: 'composer',
    keys: '$mod+Alt+Enter',
    reassignable: false,
  },
  {
    id: 'composer.composer.commandMode.enter',
    commandId: 'composer.commandMode.enter',
    scope: 'composer',
    keys: '! !',
    reassignable: false,
  },

  // -------------------------------------------------------------------------
  // composerTypeahead — typeahead/slash-menu navigation (native, locked)
  // -------------------------------------------------------------------------

  {
    id: 'composerTypeahead.slash.completeSelected',
    commandId: 'slash.completeSelected',
    scope: 'composerTypeahead',
    keys: 'Tab',
    reassignable: false,
  },

  // -------------------------------------------------------------------------
  // filePicker
  // -------------------------------------------------------------------------

  {
    id: 'filePicker.filePicker.toggleHidden',
    commandId: 'filePicker.toggleHidden',
    scope: 'filePicker',
    keys: 'Alt+H',
    reassignable: true,
  },
  {
    id: 'filePicker.filePicker.toggleIgnored',
    commandId: 'filePicker.toggleIgnored',
    scope: 'filePicker',
    keys: 'Alt+I',
    reassignable: true,
  },
  {
    id: 'filePicker.filePicker.select',
    commandId: 'filePicker.select',
    scope: 'filePicker',
    keys: 'Enter',
    reassignable: false,
  },

  // -------------------------------------------------------------------------
  // messageEditor — inline message editing
  // -------------------------------------------------------------------------

  {
    id: 'messageEditor.messageEditor.save',
    commandId: 'messageEditor.save',
    scope: 'messageEditor',
    keys: '$mod+Enter',
    reassignable: false,
  },
  {
    id: 'messageEditor.messageEditor.saveAndFork',
    commandId: 'messageEditor.saveAndFork',
    scope: 'messageEditor',
    keys: '$mod+Shift+Enter',
    reassignable: false,
  },
  {
    id: 'messageEditor.messageEditor.cancel',
    commandId: 'messageEditor.cancel',
    scope: 'messageEditor',
    keys: 'Escape',
    reassignable: false,
  },

  // -------------------------------------------------------------------------
  // terminal — Xterm copy (locked; Xterm hook owns execution)
  // -------------------------------------------------------------------------

  {
    id: 'terminal.terminal.copySelection',
    commandId: 'terminal.copySelection',
    scope: 'terminal',
    keys: 'Ctrl+Shift+C',
    reassignable: false,
  },
  {
    id: 'terminal.terminal.copySelection.alt',
    commandId: 'terminal.copySelection',
    scope: 'terminal',
    keys: 'Alt+Insert',
    reassignable: false,
  },

  // -------------------------------------------------------------------------
  // composerCommandTerminal — command-terminal mode
  // -------------------------------------------------------------------------

  {
    id: 'composerCommandTerminal.composer.commandMode.exit',
    commandId: 'composer.commandMode.exit',
    scope: 'composerCommandTerminal',
    keys: 'Escape Escape',
    reassignable: false,
  },
  {
    id: 'composerCommandTerminal.composer.commandMode.exit.alt',
    commandId: 'composer.commandMode.exit',
    scope: 'composerCommandTerminal',
    keys: 'Ctrl+Backspace',
    reassignable: false,
  },

  // -------------------------------------------------------------------------
  // pendingRequest — user-input card
  // -------------------------------------------------------------------------

  {
    id: 'pendingRequest.pendingRequest.submitUserInput',
    commandId: 'pendingRequest.submitUserInput',
    scope: 'pendingRequest',
    keys: '$mod+Enter',
    reassignable: true,
  },
  {
    id: 'pendingRequest.pendingRequest.submitUserInput.ctrl',
    commandId: 'pendingRequest.submitUserInput',
    scope: 'pendingRequest',
    // Keep Ctrl+Enter alias for backwards compatibility (current code)
    keys: 'Ctrl+Enter',
    reassignable: false,
  },

  // -------------------------------------------------------------------------
  // dockviewTabRename — local form behavior (native, locked)
  // -------------------------------------------------------------------------

  {
    id: 'dockviewTabRename.native.commit',
    commandId: 'dockviewTabRename.commit',
    scope: 'dockviewTabRename',
    keys: 'Enter',
    reassignable: false,
  },
  {
    id: 'dockviewTabRename.native.cancel',
    commandId: 'dockviewTabRename.cancel',
    scope: 'dockviewTabRename',
    keys: 'Escape',
    reassignable: false,
  },

  // -------------------------------------------------------------------------
  // accessibility — WAI-ARIA activation (native, locked)
  // -------------------------------------------------------------------------

  {
    id: 'accessibility.native.activate.enter',
    commandId: 'accessibility.activate',
    scope: 'accessibility',
    keys: 'Enter',
    reassignable: false,
  },
  {
    id: 'accessibility.native.activate.space',
    commandId: 'accessibility.activate',
    scope: 'accessibility',
    keys: 'Space',
    reassignable: false,
  },
];
