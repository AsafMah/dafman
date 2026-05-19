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
  | "permission"
  | "userInput"
  | "elicitation"
  | "unseenActivity";

export interface NotificationStyle {
  /// Solid color CSS expression (already includes `var(--p-…-500)`).
  /// Use directly as `background`, `color`, or inside `color-mix`.
  color: string;
  /// PrimeIcons class (without `pi pi-` prefix) — call sites prepend.
  iconSuffix: string;
  /// Short uppercase tag rendered in banners + a11y labels.
  /// (Banner body still shows the SDK-supplied message; this is
  /// just the "what kind of request" anchor.)
  label: string;
  /// Whether this signal warrants a pulsing animation on the dot.
  /// Pending requests pulse to draw attention; "unseen activity"
  /// stays static.
  pulse: boolean;
}

const STYLES: Record<NotificationEventType, NotificationStyle> = {
  permission: {
    color: "var(--p-amber-500, #f59e0b)",
    iconSuffix: "shield",
    label: "Permission",
    pulse: true,
  },
  userInput: {
    color: "var(--p-sky-500, #0ea5e9)",
    iconSuffix: "comment",
    label: "Input requested",
    pulse: true,
  },
  elicitation: {
    color: "var(--p-violet-500, #8b5cf6)",
    iconSuffix: "external-link",
    label: "Awaiting response",
    pulse: true,
  },
  unseenActivity: {
    color: "var(--p-emerald-500, #10b981)",
    iconSuffix: "check-circle",
    label: "New activity",
    pulse: false,
  },
};

export function styleFor(type: NotificationEventType): NotificationStyle {
  return STYLES[type];
}

/// Maps a `SessionRecord`'s pendingRequest type (and unseenTurns)
/// to the appropriate notification style. Returns null when neither
/// applies. Centralised so the three call sites can share priority:
/// pendingRequest beats unseenTurns.
export function indicatorStyle(
  pendingRequestType: "permission" | "userInput" | "elicitation" | null | undefined,
  unseenTurns: number,
): NotificationStyle | null {
  if (pendingRequestType) return styleFor(pendingRequestType);
  if (unseenTurns > 0) return styleFor("unseenActivity");
  return null;
}
