// Fictional sample data for the browser tests and README screenshots: three
// weeks of fasts and entries for the starter trackables, relative to today,
// from a seeded random generator so every run produces the same values.
// Nothing here describes a real person.

export interface StarterDefinitions {
  trackables: Array<{ id: string; name: string; fieldIds: string[]; [key: string]: unknown }>;
  fields: Array<{ id: string; name: string; [key: string]: unknown }>;
}

const DAYS = 21;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildSampleExport(starter: StarterDefinitions, now: Date) {
  const rand = mulberry32(20261022);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const int = (lo: number, hi: number) => Math.round(between(lo, hi));

  const trackable = (name: string) => {
    const t = starter.trackables.find((x) => x.name === name);
    if (!t) throw new Error(`starter trackable "${name}" not found`);
    return t;
  };
  const field = (name: string) => {
    const f = starter.fields.find((x) => x.name === name);
    if (!f) throw new Error(`starter field "${name}" not found`);
    return f.id;
  };

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const at = (daysAgo: number, hour: number, minute = 0) => {
    const d = new Date(startOfToday);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, minute, 0, 0);
    return d.getTime();
  };
  const created = at(DAYS + 1, 8);

  const entries: Array<Record<string, unknown>> = [];
  let n = 0;
  const entry = (trackableName: string, timestamp: number, values: Record<string, number | boolean>, note?: string) => {
    if (timestamp > now.getTime()) return;
    entries.push({
      id: `sample-entry-${++n}`,
      trackableId: trackable(trackableName).id,
      timestamp,
      values,
      ...(note ? { note } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  };

  const fasts: Array<Record<string, unknown>> = [];
  for (let d = DAYS; d >= 0; d--) {
    // Weight drifts from about 182 to 179 lb, weighed most mornings.
    if (d % 3 !== 1) entry('Body Measurements', at(d, 7, 10), { [field('Weight')]: round1(182.4 - (DAYS - d) * 0.16 + between(-0.5, 0.5)) });
    if (d % 7 === 0) entry('Body Measurements', at(d, 7, 12), { [field('Waist')]: round1(36.2 - (DAYS - d) * 0.03) });

    // Water three or four times a day (summed per day), one calorie total.
    for (const hour of [9, 12, 15, 19].slice(0, int(3, 4))) entry('Nutrition', at(d, hour), { [field('Water')]: int(12, 20) });
    entry('Nutrition', at(d, 20, 30), { [field('Calories')]: int(1700, 2300), [field('Protein')]: int(110, 160) });

    entry('Sleep', at(d, 6, 45), { [field('Sleep Hours')]: round1(between(6.2, 8.1)), [field('Sleep Quality')]: int(3, 5) });
    if (d % 2 === 0) entry('Wellness Check-in', at(d, 21), { [field('Overall Mood')]: int(3, 5), [field('Stress')]: int(1, 4), [field('Focus')]: int(2, 5) });
    if (d % 3 === 0) entry('Activity', at(d, 18), { [field('Duration')]: int(25, 50), [field('Steps')]: int(6000, 11000) }, d === 0 ? 'Evening walk' : undefined);

    // A 16:8 fast most evenings; the one that started last night is still running.
    if (d >= 1 && d % 6 !== 2) {
      const start = at(d, 20, int(0, 40));
      const hours = d === 1 ? undefined : between(15.5, 18);
      fasts.push({
        uuid: `sample-fast-${d}`,
        startTime: start,
        startDay: at(d, 0),
        ...(hours ? { endTime: start + hours * 3600000 } : {}),
        method: 'preset',
        presetId: '16:8',
        presetLabel: '16:8',
        targetHours: 16,
        ...(hours ? { moodRating: int(3, 5), energyRating: int(3, 5), hungerRating: int(1, 4) } : {}),
        createdAt: start,
        updatedAt: start,
      });
    }
  }
  // Only the fast still running if it really started before now.
  const visibleFasts = fasts.filter((f) => (f.startTime as number) <= now.getTime());

  return {
    format: 'zachtrack-export',
    version: 1,
    exportedAt: now.toISOString(),
    data: {
      fasts: visibleFasts,
      fieldDefinitions: [],
      trackableDefinitions: [],
      trackableEntries: entries,
      settings: { id: 'app-settings', defaultPresetId: '16:8', notificationsEnabled: false, heightInches: 70, goalWeightLb: 176, updatedAt: created },
    },
  };
}
