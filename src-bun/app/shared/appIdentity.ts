/// OS window title composition. Non-stable channels (`dev` / `canary`)
/// get a ` — <channel>` suffix so a side-by-side dev+canary+stable set is
/// distinguishable in Alt-Tab / the taskbar; `stable` (and an empty/unknown
/// channel) keeps the bare product name.
export function channelWindowTitle(channel: string): string {
  return channel && channel !== 'stable' ? `Dafman — ${channel}` : 'Dafman';
}
