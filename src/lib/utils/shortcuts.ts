// Home-screen shortcuts (the manifest's `shortcuts`, shown on a long press of
// the installed app's icon) open the app at `/?shortcut=<name>#/...`. The
// query is read once and then removed, so a reload doesn't repeat the action.

export type ShortcutName = 'start-fast';

/** True if the app was opened by this shortcut; removes the marker from the address either way. */
export function takeShortcut(name: ShortcutName): boolean {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('shortcut');
  if (requested == null) return false;
  params.delete('shortcut');
  const query = params.toString();
  history.replaceState(history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  return requested === name;
}
