/**
 * The field BMI and the goal-weight line follow: the one chosen in Profile
 * (`settings.weightFieldId`), or else the first number field named "Weight".
 * The name fallback keeps installs from before the setting existed working.
 */
export function resolveWeightField<T extends { id: string; name: string; kind: string }>(
  fields: readonly T[],
  weightFieldId: string | undefined,
): T | undefined {
  const isNumber = (f: T) => f.kind === 'number';
  if (weightFieldId) {
    const chosen = fields.find((f) => f.id === weightFieldId && isNumber(f));
    if (chosen) return chosen;
  }
  return fields.find((f) => isNumber(f) && f.name.trim().toLowerCase() === 'weight');
}

/** Standard BMI formula for US units: 703 * lb / in^2. */
export function computeBMI(weightLb: number, heightIn: number): number {
  if (heightIn <= 0) return NaN;
  return (703 * weightLb) / (heightIn * heightIn);
}
