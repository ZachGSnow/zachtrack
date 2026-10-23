import { describe, expect, it } from 'vitest';
import type { FastRecord } from '../src/lib/db';
import { eatingWindowText, formatCountdown, nextStartReminder, parseScheduleTime, scheduleStatus } from '../src/lib/utils/fastingSchedule';
import { computeFastStats } from '../src/lib/utils/stats';

// America/New_York (vitest config).
const oct = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const started = (...times: number[]) => times.map((startTime) => ({ startTime }));

describe('schedule time', () => {
  it('accepts HH:MM only', () => {
    expect(parseScheduleTime('20:00')).toEqual({ hours: 20, minutes: 0 });
    expect(parseScheduleTime('7:00')).toBeNull();
    expect(parseScheduleTime('24:00')).toBeNull();
    expect(parseScheduleTime(undefined)).toBeNull();
  });

  it('formats countdowns compactly', () => {
    expect(formatCountdown(45 * 60000)).toBe('45m');
    expect(formatCountdown(2 * 3600000 + 15 * 60000)).toBe('2h 15m');
    expect(formatCountdown(3 * 3600000)).toBe('3h');
  });
});

describe('schedule status while no fast runs', () => {
  it('counts down to the start later today', () => {
    const s = scheduleStatus('20:00', started(oct(21, 20)), oct(22, 17, 45))!;
    expect(s.late).toBe(false);
    expect(s.text).toMatch(/^Next fast starts in 2h 15m \(8:00\s?PM\)$/);
  });

  it("is late after today's time until a fast starts", () => {
    const s = scheduleStatus('20:00', started(oct(21, 20)), oct(22, 20, 25))!;
    expect(s.late).toBe(true);
    expect(s.text).toMatch(/^Your fast was due at 8:00\s?PM, 25m ago$/);
  });

  it("counts down to tomorrow once today's fast has started", () => {
    // Started early at 7 PM and already ended by 11 PM.
    const s = scheduleStatus('20:00', started(oct(22, 19)), oct(22, 23))!;
    expect(s).toMatchObject({ late: false, at: oct(23, 20) });
  });

  it('has nothing to say without a schedule', () => {
    expect(scheduleStatus(undefined, [], oct(22, 12))).toBeNull();
  });
});

describe('start reminder', () => {
  it("fires at the next start that hasn't happened yet", () => {
    expect(nextStartReminder('20:00', [], oct(22, 12))).toBe(oct(22, 20));
    expect(nextStartReminder('20:00', started(oct(22, 19)), oct(22, 19, 30))).toBe(oct(23, 20));
    expect(nextStartReminder('20:00', [], oct(22, 21))).toBe(oct(23, 20));
  });
});

describe('eating window', () => {
  it('opens at start plus target, and says goal reached after it', () => {
    const fast = { startTime: oct(22, 20), targetHours: 16 };
    expect(eatingWindowText(fast, oct(22, 22))).toMatch(/^Eating window opens at 12:00\s?PM tomorrow$/);
    expect(eatingWindowText(fast, oct(23, 9))).toMatch(/^Eating window opens at 12:00\s?PM$/);
    expect(eatingWindowText(fast, oct(23, 13))).toMatch(/^Goal reached at 12:00\s?PM$/);
    expect(eatingWindowText({ startTime: oct(22, 20) }, oct(22, 22))).toBeNull();
  });
});

describe('hit rate', () => {
  it('counts completed fasts that reached their target', () => {
    const fast = (d: number, hours: number, targetHours?: number): FastRecord => ({
      uuid: `f${d}`,
      startTime: oct(d, 20),
      startDay: oct(d, 0),
      endTime: oct(d, 20) + hours * 3600000,
      method: 'preset',
      targetHours,
      createdAt: 1,
      updatedAt: 1,
    });
    const stats = computeFastStats([fast(1, 16.5, 16), fast(2, 15, 16), fast(3, 18, 18), fast(4, 20)]);
    expect(stats).toMatchObject({ withTarget: 3, hitTarget: 2 });
  });
});
