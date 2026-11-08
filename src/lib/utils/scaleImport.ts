import { startOfDay } from './time';

// Weigh-ins from a smart scale's CSV export (ARCHITECTURE.md 3.57): Renpho,
// Withings, Fitbit, Garmin, Eufy, Google Fit and the like. A PWA can't read
// Health Connect or Apple Health, and the research found live platform syncs
// are where data silently goes missing, so the app imports the file the scale
// app already exports. The columns are found by name, not position: a date
// (and a separate time, if any) and a weight, in kg, lb or stone from the
// header or the values. Pure; tests/scaleImport.test.ts.

export type WeightUnit = 'lb' | 'kg' | 'st';

export interface ScaleRow {
  timestamp: number;
  /** In the target field's unit. */
  value: number;
}

export interface ScaleParse {
  rows: ScaleRow[];
  /** The unit the file was in. */
  sourceUnit: WeightUnit;
  /** Rows that had no usable date or weight. */
  skipped: number;
  /** The columns used, for the preview. */
  columns: { date: string; time?: string; weight: string };
}

const KG_PER_LB = 0.45359237;

/** Splits CSV text into rows of cells: quoted cells, doubled quotes, comma, semicolon or tab delimited. */
export function parseCsv(text: string): string[][] {
  // Without a leading byte-order mark (Excel adds one).
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

function unitIn(text: string): WeightUnit | undefined {
  const t = text.toLowerCase();
  if (/\b(kg|kgs|kilograms?)\b/.test(t)) return 'kg';
  if (/\b(lb|lbs|pounds?)\b/.test(t)) return 'lb';
  if (/\b(st|stone)\b/.test(t)) return 'st';
  return undefined;
}

const NOT_WEIGHT = /fat|muscle|bone|water|lean|hydration|change|max|min|goal|target|visceral|protein|bmr|mass index/;

/** A weight like "180.6", "180.6 lbs", "82,3 kg" or "12 st 6 lb"; NaN when it isn't one. */
function parseWeight(cell: string, decimalComma: boolean): { value: number; unit?: WeightUnit } {
  const stLb = cell.match(/^\s*(\d+(?:[.,]\d+)?)\s*st\s*(\d+(?:[.,]\d+)?)?\s*(?:lb|lbs)?\s*$/i);
  if (stLb) return { value: Number(stLb[1].replace(',', '.')) * 14 + Number((stLb[2] ?? '0').replace(',', '.')), unit: 'lb' };
  const m = cell.match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return { value: NaN };
  const num = decimalComma ? m[0].replace(',', '.') : m[0].replace(',', '');
  return { value: Number(num), unit: unitIn(cell) };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A date and optional time as local time; NaN when it can't be read. US month/day order for slashes (the app is US-only). */
export function parseDateTime(text: string): number {
  const t = text.trim().replace(/\s+/g, ' ');
  let y: number, mo: number, d: number;
  let rest = '';
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(.*)$/))) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    rest = m[4];
  } else if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(.*)$/))) {
    [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    rest = m[4];
  } else if ((m = t.match(/^(\d{1,2})[.-](\d{1,2})[.-](\d{4})(.*)$/))) {
    // Day first with dots or dashes (Withings in Europe, Fitbit's 05-11-2026 is month first: decide by the values).
    const [a, b] = [Number(m[1]), Number(m[2])];
    [mo, d] = a > 12 ? [b, a] : t.includes('.') ? [b, a] : [a, b];
    y = Number(m[3]);
    rest = m[4];
  } else if ((m = t.match(/^(?:[a-z]{3,9},? )?([a-z]{3})[a-z]* (\d{1,2}),? (\d{4})(.*)$/i))) {
    mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    [d, y] = [Number(m[2]), Number(m[3])];
    rest = m[4];
    if (mo === 0) return NaN;
  } else if ((m = t.match(/^(\d{1,2}) ([a-z]{3})[a-z]* (\d{4})(.*)$/i))) {
    mo = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    [d, y] = [Number(m[1]), Number(m[3])];
    rest = m[4];
    if (mo === 0) return NaN;
  } else return NaN;
  if (y < 100) y += 2000;
  let hours = 12;
  let minutes = 0;
  const time = rest.replace(/^[,T ]+/, '').match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(am|pm)?/i);
  if (time) {
    hours = Number(time[1]);
    minutes = Number(time[2]);
    const ap = time[3]?.toLowerCase();
    if (ap === 'pm' && hours < 12) hours += 12;
    if (ap === 'am' && hours === 12) hours = 0;
  }
  const date = new Date(y, mo - 1, d, hours, minutes);
  return date.getMonth() === mo - 1 && date.getDate() === d ? date.getTime() : NaN;
}

/** Converts between pounds, kilograms and stone. */
export function convertWeight(value: number, from: WeightUnit, to: WeightUnit): number {
  const lb = from === 'lb' ? value : from === 'kg' ? value / KG_PER_LB : value * 14;
  return to === 'lb' ? lb : to === 'kg' ? lb * KG_PER_LB : lb / 14;
}

/** The weigh-ins in a scale app's CSV, in `targetUnit`; an error message when it has no date and weight columns. */
export function parseScaleCsv(text: string, targetUnit: WeightUnit = 'lb'): ScaleParse | string {
  const table = parseCsv(text);
  const headerIndex = table.findIndex((r) => r.some((c) => /weight/i.test(c) && !NOT_WEIGHT.test(c.toLowerCase())) && r.some((c) => /date|time/i.test(c)));
  if (headerIndex < 0) return 'No date and weight columns found. Export the weight history from your scale app as CSV.';
  const header = table[headerIndex].map((c) => c.toLowerCase());
  const weightCols = header.map((h, i) => ({ h, i })).filter(({ h }) => /weight/.test(h) && !NOT_WEIGHT.test(h));
  const weightCol = (weightCols.find(({ h }) => /average/.test(h)) ?? weightCols[0]).i;
  const dateCol = header.findIndex((h) => /date/.test(h)) >= 0 ? header.findIndex((h) => /date/.test(h)) : header.findIndex((h) => /time/.test(h));
  const timeCol = header.findIndex((h, i) => i !== dateCol && /^time\b|time of day/.test(h));
  const headerUnit = unitIn(table[headerIndex][weightCol]);
  const decimalComma = text.split(/\r?\n/, 1)[0].includes(';');

  const rows: ScaleRow[] = [];
  let skipped = 0;
  let sourceUnit: WeightUnit | undefined = headerUnit;
  for (const r of table.slice(headerIndex + 1)) {
    const when = parseDateTime(timeCol >= 0 ? `${r[dateCol] ?? ''} ${r[timeCol] ?? ''}` : (r[dateCol] ?? ''));
    const w = parseWeight(r[weightCol] ?? '', decimalComma);
    if (Number.isNaN(when) || !Number.isFinite(w.value) || w.value <= 0) {
      skipped += 1;
      continue;
    }
    const unit = w.unit ?? headerUnit ?? 'lb';
    sourceUnit ??= unit;
    rows.push({ timestamp: when, value: Math.round(convertWeight(w.value, unit, targetUnit) * 10) / 10 });
  }
  if (rows.length === 0) return 'No weigh-ins could be read from that file.';
  rows.sort((a, b) => a.timestamp - b.timestamp);
  return {
    rows,
    sourceUnit: sourceUnit ?? 'lb',
    skipped,
    columns: { date: table[headerIndex][dateCol], ...(timeCol >= 0 ? { time: table[headerIndex][timeCol] } : {}), weight: table[headerIndex][weightCol] },
  };
}

/** The rows not already logged: a day that has a reading within 0.1 of it is a duplicate. */
export function newWeighIns(rows: readonly ScaleRow[], existing: readonly { timestamp: number; value: number }[]): { add: ScaleRow[]; duplicates: number } {
  const byDay = new Map<number, number[]>();
  for (const e of existing) byDay.set(startOfDay(e.timestamp), [...(byDay.get(startOfDay(e.timestamp)) ?? []), e.value]);
  const add: ScaleRow[] = [];
  let duplicates = 0;
  for (const r of rows) {
    const day = startOfDay(r.timestamp);
    if ((byDay.get(day) ?? []).some((v) => Math.abs(v - r.value) <= 0.1)) duplicates += 1;
    else {
      add.push(r);
      byDay.set(day, [...(byDay.get(day) ?? []), r.value]);
    }
  }
  return { add, duplicates };
}
