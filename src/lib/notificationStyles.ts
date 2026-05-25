// Centralised visual styling for the four notification-worthy event
// types. Used by:
//   - ChatTab.vue              (status dot left of the title)
//   - SessionsManager.vue      (status dot on each open-session row)
//   - ChatWindow.vue           (composer banner)
// so a contributor changing one keeps the rest in sync, and so the
// four event types read distinctly at a glance instead of all sharing
// a single amber dot.
//
// Color choices map to semantic-token hues that exist in PrimeVue's
// palette and read on both light and dark themes:
//
//   permission       — amber:  destructive-leaning, user judgement
//   userInput        — sky:    direct Q&A, low-stakes prompt
//   elicitation      — violet: external/OAuth handoff, distinctive
//   unseenActivity   — emerald: task complete, just a "fyi" cue
//
// Icons follow the same intent and map to PrimeIcons (`pi pi-*`)
// available in the bundle.

export type NotificationEventType =
  | 'permission'
  | 'userInput'
  | 'elicitation'
  | 'exitPlanMode'
  | 'autoModeSwitch'
  | 'thinking'
  | 'unseenActivity';

export interface NotificationStyle {
  /// Solid color CSS expression (already includes `var(--p-…-500)`).
  /// Use directly as `background`, `color`, or inside `color-mix`.
  color: string;
  /// PrimeIcons class suffix(es) — call sites prepend `pi `. May
  /// include additional modifiers when needed (e.g. the
  /// "thinking" entry returns `"spin pi-spinner"` so the icon
  /// self-animates without the call site having to know).
  iconSuffix: string;
  /// Short uppercase tag rendered in banners + a11y labels.
  /// (Banner body still shows the SDK-supplied message; this is
  /// just the "what kind of request" anchor.)
  label: string;
  /// Whether this signal warrants a pulsing animation on the
  /// indicator (slow opacity fade). Pending requests pulse to draw
  /// attention; "thinking" already self-animates via pi-spin so it
  /// doesn't pulse; "unseen activity" stays static.
  pulse: boolean;
}

const STYLES: Record<NotificationEventType, NotificationStyle> = {
  permission: {
    color: 'var(--p-amber-500, #f59e0b)',
    iconSuffix: 'shield',
    label: 'Permission',
    pulse: true,
  },
  userInput: {
    color: 'var(--p-sky-500, #0ea5e9)',
    iconSuffix: 'comment',
    label: 'Input requested',
    pulse: true,
  },
  elicitation: {
    color: 'var(--p-violet-500, #8b5cf6)',
    iconSuffix: 'external-link',
    label: 'Awaiting response',
    pulse: true,
  },
  exitPlanMode: {
    color: 'var(--p-indigo-500, #6366f1)',
    iconSuffix: 'list-check',
    label: 'Plan approval',
    pulse: true,
  },
  autoModeSwitch: {
    color: 'var(--p-orange-500, #f97316)',
    iconSuffix: 'bolt',
    label: 'Auto mode',
    pulse: true,
  },
  thinking: {
    // Session-primary tinted so it reads as "this session is
    // working" rather than as a blocking signal. Spinner icon
    // self-animates; no extra pulse.
    color: 'var(--p-primary-color)',
    iconSuffix: 'spin pi-spinner',
    label: 'Thinking…',
    pulse: false,
  },
  unseenActivity: {
    color: 'var(--p-emerald-500, #10b981)',
    iconSuffix: 'circle-fill',
    label: 'New activity',
    pulse: false,
  },
};

export function styleFor(type: NotificationEventType): NotificationStyle {
  return STYLES[type];
}

/// Maps a `SessionRecord`'s pendingRequest type, isThinking flag,
/// and unseenTurns to the appropriate notification style. Returns
/// null when nothing's worth surfacing. Centralised so the three
/// call sites can share priority:
///
///   pendingRequest > thinking > unseenActivity
///
/// Rationale: a blocking request is the most-urgent signal (user
/// must act), thinking is informational ("don't close this — the
/// agent is mid-turn"), and unseen activity is the lowest priority
/// ("there was new output you haven't read yet").
export function indicatorStyle(
  pendingRequestType:
    | 'permission'
    | 'userInput'
    | 'elicitation'
    | 'exitPlanMode'
    | 'autoModeSwitch'
    | null
    | undefined,
  isThinking: boolean,
  unseenTurns: number,
): NotificationStyle | null {
  if (pendingRequestType) return styleFor(pendingRequestType);

  if (isThinking) return styleFor('thinking');

  if (unseenTurns > 0) return styleFor('unseenActivity');

  return null;
}
