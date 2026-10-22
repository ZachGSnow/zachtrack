/** Body measurements the app derives BMI and body fat from. */
export type BodyFieldRole = 'weight' | 'waist' | 'neck' | 'hip';

export type BodyFatSex = 'male' | 'female';

/** Settings key holding each role's chosen field id. */
export const BODY_FIELD_SETTING = {
  weight: 'weightFieldId',
  waist: 'waistFieldId',
  neck: 'neckFieldId',
  hip: 'hipFieldId',
} as const satisfies Record<BodyFieldRole, string>;

export const BODY_FIELD_ROLES = Object.keys(BODY_FIELD_SETTING) as BodyFieldRole[];

export type BodyFieldIds = Partial<Record<BodyFieldRole, string>>;

/**
 * The field a body measurement comes from: the one chosen in Profile (e.g.
 * `settings.waistFieldId`), or else the first number field named after the
 * role ("Weight", "Waist", "Neck", "Hip"). The name fallback keeps installs
 * from before the setting existed working.
 */
export function resolveBodyField<T extends { id: string; name: string; kind: string }>(
  fields: readonly T[],
  role: BodyFieldRole,
  chosenId: string | undefined,
): T | undefined {
  const isNumber = (f: T) => f.kind === 'number';
  if (chosenId) {
    const chosen = fields.find((f) => f.id === chosenId && isNumber(f));
    if (chosen) return chosen;
  }
  return fields.find((f) => isNumber(f) && f.name.trim().toLowerCase() === role);
}

/** The field BMI and the goal-weight line follow (see resolveBodyField). */
export function resolveWeightField<T extends { id: string; name: string; kind: string }>(
  fields: readonly T[],
  weightFieldId: string | undefined,
): T | undefined {
  return resolveBodyField(fields, 'weight', weightFieldId);
}

/** Every role's resolved field id, from the settings record's chosen ids. */
export function resolveBodyFieldIds<T extends { id: string; name: string; kind: string }>(
  fields: readonly T[],
  settings: Partial<Record<(typeof BODY_FIELD_SETTING)[BodyFieldRole], string>>,
): BodyFieldIds {
  const ids: BodyFieldIds = {};
  for (const role of BODY_FIELD_ROLES) ids[role] = resolveBodyField(fields, role, settings[BODY_FIELD_SETTING[role]])?.id;
  return ids;
}

/** Standard BMI formula for US units: 703 * lb / in^2. */
export function computeBMI(weightLb: number, heightIn: number): number {
  if (heightIn <= 0) return NaN;
  return (703 * weightLb) / (heightIn * heightIn);
}

const INCHES_PER_UNIT: Record<string, number> = {
  in: 1,
  inch: 1,
  inches: 1,
  '"': 1,
  cm: 1 / 2.54,
  centimeter: 1 / 2.54,
  centimeters: 1 / 2.54,
  centimetre: 1 / 2.54,
  centimetres: 1 / 2.54,
  mm: 1 / 25.4,
  millimeter: 1 / 25.4,
  millimeters: 1 / 25.4,
  millimetre: 1 / 25.4,
  millimetres: 1 / 25.4,
};

/** How many inches one of `unit` is, or undefined for a unit that isn't a length the app knows. */
export function inchesPerUnit(unit: string | undefined): number | undefined {
  return unit ? INCHES_PER_UNIT[unit.trim().toLowerCase()] : undefined;
}

/**
 * US Navy circumference method (DoD Instruction 1308.3), in inches. An
 * estimate of body fat %, typically within 3 to 4 points of a lab
 * measurement. The male formula doesn't use hip. Returns undefined when the
 * measurements can't be right (waist not larger than neck, say).
 */
export function navyBodyFat(
  sex: BodyFatSex,
  m: { waistIn: number; neckIn: number; hipIn?: number; heightIn: number },
): number | undefined {
  if (m.heightIn <= 0) return undefined;
  let pct: number;
  if (sex === 'male') {
    const girth = m.waistIn - m.neckIn;
    if (girth <= 0) return undefined;
    pct = 86.01 * Math.log10(girth) - 70.041 * Math.log10(m.heightIn) + 36.76;
  } else {
    if (m.hipIn == null) return undefined;
    const girth = m.waistIn + m.hipIn - m.neckIn;
    if (girth <= 0) return undefined;
    pct = 163.205 * Math.log10(girth) - 97.684 * Math.log10(m.heightIn) - 78.387;
  }
  return Number.isFinite(pct) && pct > 0 && pct < 100 ? pct : undefined;
}

/**
 * Navy body fat % for every day that has a waist and a neck reading (and a
 * hip, for the female formula), from that same day's values. Undefined when
 * a field's unit isn't a length, so a wrong unit never shows a wrong number.
 */
export function computeNavyBodyFatByDay(
  parts: {
    waist: { byDay: Map<number, number>; unit?: string };
    neck: { byDay: Map<number, number>; unit?: string };
    hip?: { byDay: Map<number, number>; unit?: string };
  },
  sex: BodyFatSex,
  heightInches: number,
): Map<number, number> | undefined {
  const waistK = inchesPerUnit(parts.waist.unit);
  const neckK = inchesPerUnit(parts.neck.unit);
  const hipK = parts.hip ? inchesPerUnit(parts.hip.unit) : undefined;
  if (waistK == null || neckK == null) return undefined;
  if (sex === 'female' && hipK == null) return undefined;

  const byDay = new Map<number, number>();
  for (const [day, waist] of parts.waist.byDay) {
    const neck = parts.neck.byDay.get(day);
    if (neck == null) continue;
    const hip = parts.hip?.byDay.get(day);
    const pct = navyBodyFat(sex, {
      waistIn: waist * waistK,
      neckIn: neck * neckK,
      hipIn: hip != null && hipK != null ? hip * hipK : undefined,
      heightIn: heightInches,
    });
    if (pct != null) byDay.set(day, pct);
  }
  return byDay;
}
