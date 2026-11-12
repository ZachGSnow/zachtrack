import { startOfDay } from '../utils/time';

/**
 * One clock for the screens that show time passing ("2h ago", what's due),
 * instead of a timer in every card (ARCHITECTURE.md 3.68). `now` moves each
 * minute; `day` (local midnight) only when the date changes, so work that
 * depends on the day alone (the weekly review, goal suggestions, dates coming
 * up) isn't redone every minute.
 */
class Clock {
  now = $state(Date.now());
  day = $state(startOfDay(Date.now()));

  constructor() {
    if (typeof window === 'undefined') return;
    setInterval(() => this.tick(), 60_000);
    // Coming back to the app shows the time now, not when it was hidden.
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.tick());
  }

  tick() {
    this.now = Date.now();
    const day = startOfDay(this.now);
    if (day !== this.day) this.day = day;
  }
}

export const clock = new Clock();
