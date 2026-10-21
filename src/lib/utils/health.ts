/** Standard BMI formula for US units: 703 * lb / in^2. */
export function computeBMI(weightLb: number, heightIn: number): number {
  if (heightIn <= 0) return NaN;
  return (703 * weightLb) / (heightIn * heightIn);
}
