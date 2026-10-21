// The biological-state timeline that drives the timer ring color, the live
// "what's happening in your body" card, and milestone notifications.
//
// `hourEnd` is exclusive except for the final zone, which uses `Infinity` so
// extended fasts keep displaying the deepest known zone indefinitely.

export interface BioZone {
  id: string;
  hourStart: number;
  hourEnd: number;
  title: string;
  /** Hex color used for the timer arc + accents while this zone is active. */
  color: string;
  energySource: string;
  /** One-line summary shown directly under the timer. */
  summary: string;
  /** Longer science explanation shown in an expandable "learn more" panel. */
  science: string;
  whatsHappening: string;
  userExperience: string;
  /** Fired as a local notification the moment the fast crosses into this zone. */
  milestone: string;
}

export const ZONES: BioZone[] = [
  {
    id: 'fed',
    hourStart: 0,
    hourEnd: 4,
    title: 'Anabolic (Fed) State',
    color: '#3b82f6',
    energySource: 'Exogenous glucose (the food you just ate)',
    summary: 'Digesting and building \u2014 insulin is high and shuttling glucose into your cells.',
    science:
      'Your body is in a highly anabolic (building) state. The nutrient-sensing pathway mTOR is active, promoting cell growth and protein synthesis. Insulin levels are high to shuttle glucose from your bloodstream into your cells.',
    whatsHappening:
      'Digestion is peaking. Excess glucose is being converted into glycogen and stored in your liver and skeletal muscles. Once those stores are full, the remainder is stored as adipose tissue (body fat).',
    userExperience: 'High energy from food, but possible lethargy or a "crash" if the meal was very carbohydrate-heavy.',
    milestone: 'Your fast has started. Digestion is winding down.',
  },
  {
    id: 'post-absorptive',
    hourStart: 4,
    hourEnd: 12,
    title: 'Post-Absorptive (Catabolic) State',
    color: '#22d3ee',
    energySource: 'Liver glycogen',
    summary: 'Blood sugar has normalized and your liver starts releasing stored glycogen.',
    science:
      'Blood sugar normalizes. As digestion ends, insulin levels drop and the counter-regulatory hormone glucagon begins to rise. Glucagon tells your liver to start releasing its stored glycogen into the bloodstream to keep energy levels stable.',
    whatsHappening:
      'Around hour 8, the stomach empties completely. The digestive tract begins the Migrating Motor Complex (MMC) \u2014 a sweeping wave that cleans out the intestines. You will experience pulses of ghrelin (the hunger hormone), which usually spike around your normal meal times.',
    userExperience: 'Hunger pangs will come and go in waves. Drinking water or black coffee helps blunt the ghrelin response.',
    milestone: 'Entering the post-absorptive state \u2014 your liver is now releasing stored glycogen.',
  },
  {
    id: 'lipolysis',
    hourStart: 12,
    hourEnd: 16,
    title: 'Metabolic Shift & Lipolysis',
    color: '#f97316',
    energySource: 'Transitioning from glycogen to free fatty acids',
    summary: 'Glycogen is running low \u2014 your body is switching on fat burning.',
    science:
      'Liver glycogen is significantly depleted. The enzyme AMPK (your body\u2019s energy sensor) activates, signaling that nutrient supply is low. This triggers lipolysis \u2014 the breaking down of triglycerides (fat cells) into free fatty acids and glycerol.',
    whatsHappening:
      'You are officially entering the "Fat Burning Zone." Systemic inflammation begins to drop. Your body is becoming more insulin-sensitive, meaning your cells are better at utilizing energy.',
    userExperience: 'Hunger often subsides here. You may feel a slight drop in body temperature as blood flow shifts away from the digestive tract.',
    milestone: "You've entered the Fat Burning Zone. Lipolysis is underway.",
  },
  {
    id: 'mild-ketosis',
    hourStart: 16,
    hourEnd: 18,
    title: 'Mild Ketosis & Brain Fuel',
    color: '#eab308',
    energySource: 'Fat and early ketones',
    summary: 'Your liver starts producing ketones \u2014 clean-burning fuel for your brain.',
    science:
      'Because free fatty acids cannot cross the blood-brain barrier, your liver begins converting them into ketone bodies (primarily Beta-Hydroxybutyrate, or BHB).',
    whatsHappening:
      'Ketones are a "cleaner" burning fuel than glucose, producing fewer reactive oxygen species (free radicals). BDNF (Brain-Derived Neurotrophic Factor) \u2014 often described as "Miracle-Gro for the brain" \u2014 begins to increase, promoting new neural connections.',
    userExperience: 'Many users report a sudden surge in mental clarity, sharp focus, and a "clean" buzz of energy.',
    milestone: "You've reached mild ketosis. Expect a boost in mental clarity soon.",
  },
  {
    id: 'deep-ketosis',
    hourStart: 18,
    hourEnd: 24,
    title: 'Deep Ketosis & Autophagy Initiation',
    color: '#a855f7',
    energySource: 'Fat and ketones',
    summary: 'mTOR is suppressed and autophagy \u2014 cellular cleanup \u2014 kicks in.',
    science:
      'With mTOR completely suppressed and AMPK fully activated, the body flips the switch on Autophagy (literally "self-eating").',
    whatsHappening:
      'Your cells form phagophores, which act like cellular garbage trucks. They hunt down misfolded proteins, damaged organelles (like old mitochondria), and cellular junk, delivering them to lysosomes to be recycled into new, healthy parts. This is the primary anti-aging mechanism of fasting. The gut lining is also resting completely, allowing for significant repair of the intestinal wall (helping combat leaky gut).',
    userExperience: 'Mental clarity typically continues. Hunger is usually minimal at this point.',
    milestone: "\ud83c\udf89 You've reached Deep Ketosis. Autophagy is now active.",
  },
  {
    id: 'peak-autophagy',
    hourStart: 24,
    hourEnd: 48,
    title: 'Peak Autophagy & HGH Surge',
    color: '#ec4899',
    energySource: 'Body fat, with HGH sparing lean muscle',
    summary: 'Autophagy peaks and a huge HGH surge protects your muscle and bone.',
    science:
      'Autophagy reaches its peak efficiency. To prevent muscle breakdown (catabolism) during an extended fast, your body releases a massive surge of Human Growth Hormone (HGH) \u2014 frequently increasing by up to 500%.',
    whatsHappening:
      'The NLRP3 inflammasome (a major driver of systemic inflammation) is severely inhibited. Your body is heavily relying on body fat for basal metabolic functions while HGH actively preserves lean muscle tissue and bone density.',
    userExperience: 'Hunger is usually entirely gone. Energy levels are remarkably stable, though physical endurance for heavy weightlifting may be reduced.',
    milestone: "You've hit 24 hours \u2014 peak autophagy and a major HGH surge are underway.",
  },
  {
    id: 'immune-reset',
    hourStart: 48,
    hourEnd: Infinity,
    title: 'Immune Reset & Stem Cell Generation',
    color: '#6366f1',
    energySource: 'Body fat',
    summary: 'IGF-1 drops, clearing old immune cells and priming stem-cell regeneration.',
    science:
      'The hormone IGF-1 (Insulin-like Growth Factor 1) drops significantly. This drop signals the body to kill off old, damaged white blood cells.',
    whatsHappening:
      'When you eventually break the fast, the body triggers hematopoietic stem cell-based regeneration. Essentially, you are recycling your old immune system and generating brand-new, healthy immune cells.',
    userExperience: 'Deep immune system rejuvenation, clearing of senescent ("zombie") cells, and profound cellular protection.',
    milestone: "48 hours reached \u2014 you're in immune reset territory.",
  },
];

export function getZoneForHour(hours: number): BioZone {
  const clamped = Math.max(0, hours);
  return (
    ZONES.find((z) => clamped >= z.hourStart && clamped < z.hourEnd) ?? ZONES[ZONES.length - 1]
  );
}

export function getNextZone(current: BioZone): BioZone | null {
  const idx = ZONES.findIndex((z) => z.id === current.id);
  return idx >= 0 && idx < ZONES.length - 1 ? ZONES[idx + 1] : null;
}
