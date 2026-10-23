export interface FastPreset {
  id: string;
  label: string;
  /** Target fasting hours; undefined means open-ended (count-up only). */
  targetHours?: number;
  description: string;
}

export const PRESETS: FastPreset[] = [
  { id: '12:12', label: '12:12', targetHours: 12, description: 'Beginner-friendly daily rhythm' },
  { id: '14:10', label: '14:10', targetHours: 14, description: 'Gentle step up from 12:12' },
  { id: '16:8', label: '16:8', targetHours: 16, description: 'The classic intermittent fast' },
  { id: '18:6', label: '18:6', targetHours: 18, description: 'Into the metabolic switch, with ketones starting to rise' },
  { id: '20:4', label: '20:4', targetHours: 20, description: 'A 4-hour eating window' },
  { id: 'omad', label: 'OMAD (23:1)', targetHours: 23, description: 'One meal a day' },
  { id: '36h', label: '36 Hours', targetHours: 36, description: 'A day and a half: ketosis and higher growth hormone' },
  { id: '48h', label: '48 Hours', targetHours: 48, description: 'Two days: deeper ketosis; plan water and electrolytes' },
  { id: 'custom', label: 'Custom / Count-Up', description: 'Just hit start \u2014 track for as long as you like' },
];

export const DEFAULT_PRESET_ID = '16:8';

/** A fast length you saved yourself (settings.customFastPresets), shown with the built-in ones. */
export interface CustomFastPreset {
  id: string;
  label: string;
  targetHours: number;
}

/** "15:9" for a fast under a day (fasting:eating hours), "36 Hours" from a day up. */
export function customPresetLabel(hours: number): string {
  if (hours < 24 && Number.isInteger(hours)) return `${hours}:${24 - hours}`;
  return `${hours} Hours`;
}

/** The built-in presets with your own inserted before the open-ended Count-Up. */
export function allPresets(custom: readonly CustomFastPreset[] | undefined): FastPreset[] {
  const mine: FastPreset[] = (custom ?? []).map((c) => ({ ...c, description: `Your own ${c.targetHours}-hour fast` }));
  const countUp = PRESETS.findIndex((p) => p.id === 'custom');
  return [...PRESETS.slice(0, countUp), ...mine, ...PRESETS.slice(countUp)];
}
