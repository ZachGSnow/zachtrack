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
  { id: '18:6', label: '18:6', targetHours: 18, description: 'Reaches mild ketosis' },
  { id: '20:4', label: '20:4', targetHours: 20, description: 'The "Warrior Diet" window' },
  { id: 'omad', label: 'OMAD (23:1)', targetHours: 23, description: 'One meal a day' },
  { id: '36h', label: '36 Hours', targetHours: 36, description: 'Extended fast into peak autophagy' },
  { id: '48h', label: '48 Hours', targetHours: 48, description: 'Extended fast into immune reset' },
  { id: 'custom', label: 'Custom / Count-Up', description: 'Just hit start \u2014 track for as long as you like' },
];

export const DEFAULT_PRESET_ID = '16:8';
