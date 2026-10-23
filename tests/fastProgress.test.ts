import { describe, expect, it } from 'vitest';
import { endSummary, fastTimeline, latestMilestone, longFastGuidance, refeedingNote, startedAgo } from '../src/lib/utils/fastProgress';

// America/New_York (vitest config).
const oct = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const fast = (startTime: number, targetHours?: number) => ({ uuid: 'f1', startTime, targetHours });

describe('timeline', () => {
  it('says when it started, when the goal is, and what comes next', () => {
    const t = fastTimeline(fast(oct(21, 20), 16), oct(22, 8));
    expect(t.started).toMatch(/^Started 8:00\sPM yesterday$/);
    expect(t.goal).toMatch(/^Goal 12:00\sPM, 4h left$/);
    expect(t.next).toBe('Ketones rising in 4h'); // 12h in: lipolysis now, ketosis at 16h
  });

  it('says when the goal was reached, and nothing about a goal for a count-up fast', () => {
    expect(fastTimeline(fast(oct(21, 20), 16), oct(22, 13)).goal).toMatch(/^Goal reached at 12:00\sPM$/);
    expect(fastTimeline(fast(oct(22, 8)), oct(22, 9)).goal).toBeNull();
  });

  it('has no next zone past the deepest one', () => {
    expect(fastTimeline(fast(oct(20, 8)), oct(22, 9)).next).toBeNull();
  });
});

describe('milestones', () => {
  it('nothing in the first hours', () => {
    expect(latestMilestone(fast(oct(22, 8), 16), oct(22, 11))).toBeNull();
  });

  it('the deepest zone reached, keyed per fast', () => {
    const m = latestMilestone(fast(oct(22, 0), 16), oct(22, 13))!;
    expect(m.key).toBe('f1:lipolysis');
    expect(m.title).toBe('You reached Metabolic switch: more fat (12h)');
  });

  it('the goal once reached, unless a later zone came after it', () => {
    expect(latestMilestone(fast(oct(22, 0), 16), oct(22, 17))!.key).toBe('f1:goal');
    expect(latestMilestone(fast(oct(22, 0), 16), oct(22, 19))!.key).toBe('f1:deep-ketosis');
    expect(latestMilestone(fast(oct(22, 0), 18), oct(22, 19))!.key).toBe('f1:goal');
  });
});

describe('ending', () => {
  it('says how far from the goal', () => {
    expect(endSummary(fast(oct(22, 0), 16), oct(22, 14, 40))).toEqual({
      duration: '14h 40m',
      goal: '1h 20m short of 16h',
      goalMet: false,
      zone: 'Metabolic switch: more fat',
    });
    expect(endSummary(fast(oct(22, 0), 16), oct(22, 16, 12))).toMatchObject({ goal: 'Goal of 16h reached', goalMet: true });
    expect(endSummary(fast(oct(22, 0)), oct(22, 5))).toMatchObject({ goal: null, goalMet: null });
  });

  it('started earlier is minutes before now', () => {
    expect(startedAgo(90, oct(22, 12))).toBe(oct(22, 10, 30));
  });
});

describe('long fasts', () => {
  it('nothing for an ordinary fast, hydration from 20h or a goal past a day', () => {
    expect(longFastGuidance(fast(oct(22, 0), 16), oct(22, 15))).toEqual([]);
    expect(longFastGuidance(fast(oct(22, 0), 36), oct(22, 2))).toHaveLength(1);
    expect(longFastGuidance(fast(oct(22, 0)), oct(22, 21))[0]).toMatch(/electrolytes/);
  });

  it('adds cautions at 48 and 72 hours', () => {
    expect(longFastGuidance(fast(oct(20, 0), 72), oct(22, 1))).toHaveLength(2);
    expect(longFastGuidance(fast(oct(19, 0), 72), oct(22, 1))[2]).toMatch(/doctor/);
  });

  it('refeeding advice for a fast of a day or more', () => {
    expect(refeedingNote(23.9)).toBeNull();
    expect(refeedingNote(24)).toMatch(/^Break a fast this long gently/);
  });
});
