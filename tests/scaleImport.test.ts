import { describe, expect, it } from 'vitest';
import { convertWeight, newWeighIns, parseCsv, parseDateTime, parseScaleCsv, type ScaleParse } from '../src/lib/utils/scaleImport';

// America/New_York (vitest config). Header shapes follow the scale apps'
// exports; the values are made up.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const ok = (r: ScaleParse | string): ScaleParse => {
  if (typeof r === 'string') throw new Error(r);
  return r;
};

describe('scale CSV import', () => {
  it('reads Renpho: a quoted date and time with a comma, weight in lb', () => {
    const csv = 'Time of Measurement,Weight(lb),BMI,Body Fat(%),Muscle Mass(lb)\n"11/05/2026, 7:12 AM",192.4,25.4,22.1,140.2\n"11/06/2026, 6:58 AM",191.8,25.3,22.0,140.1\n';
    const r = ok(parseScaleCsv(csv));
    expect(r.columns).toEqual({ date: 'Time of Measurement', weight: 'Weight(lb)' });
    expect(r.rows).toEqual([
      { timestamp: at(2026, 11, 5, 7, 12), value: 192.4 },
      { timestamp: at(2026, 11, 6, 6, 58), value: 191.8 },
    ]);
  });

  it('reads Withings: ISO date-times, weight in kg, converted to lb, ignoring fat and muscle mass', () => {
    const csv = 'Date,Weight (kg),Fat mass (kg),Bone mass (kg),Muscle mass (kg),Hydration (kg),Comments\n2026-11-05 07:12:00,87.3,19.1,3.4,65.0,48.2,\n';
    const r = ok(parseScaleCsv(csv, 'lb'));
    expect(r.sourceUnit).toBe('kg');
    expect(r.columns.weight).toBe('Weight (kg)');
    expect(r.rows).toEqual([{ timestamp: at(2026, 11, 5, 7, 12), value: 192.5 }]);
  });

  it('reads Garmin values with units in them, and Google Fit average weight', () => {
    const garmin = 'Time,Weight,Change,BMI,Body Fat\n"Nov 5, 2026 7:12 AM",192.4 lbs,-0.6 lbs,25.4,22.1 %\n';
    expect(ok(parseScaleCsv(garmin)).rows).toEqual([{ timestamp: at(2026, 11, 5, 7, 12), value: 192.4 }]);
    const fit = 'Date,Average weight (kg),Max weight (kg),Min weight (kg)\n2026-11-05,87.3,87.5,87.1\n';
    const r = ok(parseScaleCsv(fit));
    expect(r.columns.weight).toBe('Average weight (kg)');
    expect(r.rows).toEqual([{ timestamp: at(2026, 11, 5), value: 192.5 }]);
  });

  it('reads separate date and time columns, semicolons with decimal commas, and skips bad rows', () => {
    const csv = 'Date;Time;Weight (kg);BMI\n05.11.2026;07:12;87,3;25,4\nnot a date;07:00;87,0;\n06.11.2026;06:58;;\n';
    const r = ok(parseScaleCsv(csv));
    expect(r.columns).toEqual({ date: 'Date', time: 'Time', weight: 'Weight (kg)' });
    expect(r.rows).toEqual([{ timestamp: at(2026, 11, 5, 7, 12), value: 192.5 }]);
    expect(r.skipped).toBe(2);
  });

  it('says what is wrong with a file that has no weight column', () => {
    expect(parseScaleCsv('Date,Steps\n2026-11-05,9000\n')).toMatch(/^No date and weight columns found/);
    expect(parseScaleCsv('Date,Weight\nyesterday,heavy\n')).toBe('No weigh-ins could be read from that file.');
  });

  it('parses dates and converts units', () => {
    expect(parseDateTime('2026-11-05T07:12:00Z'.replace('Z', ''))).toBe(at(2026, 11, 5, 7, 12));
    expect(parseDateTime('11/5/26 7:12 PM')).toBe(at(2026, 11, 5, 19, 12));
    expect(parseDateTime('5 Nov 2026')).toBe(at(2026, 11, 5));
    expect(parseDateTime('2026-02-30')).toBeNaN();
    expect(convertWeight(100, 'kg', 'lb')).toBeCloseTo(220.462, 2);
    expect(convertWeight(14, 'st', 'lb')).toBe(196);
    expect(parseCsv('a,"b ""c"", d"\n1,2\n')).toEqual([
      ['a', 'b "c", d'],
      ['1', '2'],
    ]);
  });

  it('leaves out weigh-ins already logged that day', () => {
    const rows = [
      { timestamp: at(2026, 11, 5, 7), value: 192.4 },
      { timestamp: at(2026, 11, 6, 7), value: 191.8 },
      { timestamp: at(2026, 11, 6, 7, 5), value: 191.8 },
    ];
    const r = newWeighIns(rows, [{ timestamp: at(2026, 11, 5, 8), value: 192.4 }]);
    expect(r.add).toEqual([rows[1]]);
    expect(r.duplicates).toBe(2);
  });
});

describe('a file saved by Excel', () => {
  it('reads past a leading byte-order mark', () => {
    const bom = String.fromCharCode(0xfeff);
    const r = parseScaleCsv(`${bom}Date,Weight (lb)\n2026-11-05,192.4\n`);
    expect(typeof r === 'string' ? r : r.rows).toEqual([{ timestamp: new Date(2026, 10, 5, 12).getTime(), value: 192.4 }]);
  });
});
