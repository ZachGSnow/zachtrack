// The biological-state timeline that drives the timer ring color, the live
// "what's happening in your body" card, and the in-app milestone banner.
//
// `hourEnd` is exclusive except for the final zone, which uses `Infinity` so
// extended fasts keep displaying the deepest known zone indefinitely.
//
// The text follows human research where it exists and says so where it
// doesn't (each zone's `evidence`). Hour boundaries are typical, not exact:
// they shift with the last meal, activity and the person. Sources, reviewed
// October 2026:
// - Anton et al. 2018, Obesity: "Flipping the metabolic switch" (the shift to
//   fat and ketones from about 12 hours).
// - Mayo Clinic Laboratories, BHB reference: under 0.4 mmol/L after an
//   overnight fast of up to 12 hours.
// - Randomized crossover trial, PMID 33731648 (2021): BHB reached 0.5 mmol/L
//   after about 21 h of fasting, 17.5 h when the fast began with exercise.
// - Rothman et al. 1991, Science: gluconeogenesis supplied about 64% of
//   glucose output in the first 22 h of a fast, then 82% and 96%.
// - Hartman et al. 1992, J Clin Endocrinol Metab: a 2-day fast raised
//   24-hour growth hormone production about fivefold.
// - Pietzner et al. 2024, Nature Metabolism: 7-day water fast, about 3,000
//   plasma proteins; systemic changes evident only after about 3 days.
// - Cheng et al. 2014, Cell Stem Cell: fasting cycles lowered IGF-1 and
//   helped regenerate blood stem cells in mice; human data preliminary.
// - Autophagy: induced by fasting in mice over 24 to 48 h; human timing is
//   not established and rests mostly on markers in blood cells.

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
  /** How well this is known in people, in a sentence. */
  evidence: string;
  /** Shown in the in-app milestone banner once the fast reaches this zone (utils/fastProgress.ts). */
  milestone: string;
}

export const ZONES: BioZone[] = [
  {
    id: 'fed',
    hourStart: 0,
    hourEnd: 4,
    title: 'Fed: digesting',
    color: '#3b82f6',
    energySource: 'Glucose and fat from your last meal',
    summary: 'Digesting your last meal. Insulin is up and your stores are being topped up.',
    science:
      'After a meal, blood glucose and insulin rise. Insulin moves glucose into muscle and liver, where some is stored as glycogen, and slows the release of fat from fat tissue. The nutrient-sensing pathway mTOR is active, which favors building and repair, such as muscle protein synthesis after a meal with protein.',
    whatsHappening:
      'Digestion and absorption take a few hours, longer after a large, fatty or high-fiber meal. Fat from the meal is mostly stored in fat tissue for later. Turning carbohydrate into fat is a minor pathway in people unless intake is very high.',
    userExperience: 'Usually satisfied. A large, high-carbohydrate meal can be followed by a dip in energy a couple of hours later.',
    evidence: 'Well established physiology.',
    milestone: 'Your fast has started. Digestion is winding down.',
  },
  {
    id: 'post-absorptive',
    hourStart: 4,
    hourEnd: 12,
    title: 'Post-absorptive: stored glycogen',
    color: '#22d3ee',
    energySource: 'Liver glycogen, plus more and more fat',
    summary: 'Insulin falls and your liver releases stored glycogen to keep blood sugar steady.',
    science:
      'As insulin falls and glucagon rises, the liver breaks down glycogen and starts making new glucose (gluconeogenesis) from lactate, glycerol and amino acids. Fat release from fat tissue rises steadily, so muscles burn more fat while the brain still runs mostly on glucose.',
    whatsHappening:
      'Between meals the gut runs a cleaning wave, the migrating motor complex, roughly every 90 to 120 minutes; eating stops it. Ghrelin, a hunger hormone, tends to rise around the times you usually eat, so hunger comes in waves rather than building steadily.',
    userExperience: 'Hunger comes and goes, often at your usual meal times, and usually passes if you wait it out. Water, plain tea or black coffee can help.',
    evidence: 'Well established physiology. An overnight fast ends in this zone.',
    milestone: 'Past 4 hours: your liver is keeping your blood sugar steady from its glycogen.',
  },
  {
    id: 'lipolysis',
    hourStart: 12,
    hourEnd: 16,
    title: 'Metabolic switch: more fat',
    color: '#f97316',
    energySource: 'Fat, increasingly, as liver glycogen falls',
    summary: 'From about 12 hours, fat becomes a bigger share of your fuel.',
    science:
      'With liver glycogen falling and insulin low, fat tissue releases more fatty acids and glycerol (lipolysis). Researchers call this shift toward fat and ketones the metabolic switch and place it from about 12 hours after the last meal: sooner after exercise or a low-carbohydrate day, later after a large carbohydrate meal.',
    whatsHappening:
      'Most tissues now burn more fat, while the liver keeps making glucose for the brain and red blood cells. How much body fat you lose over weeks still depends mostly on your total intake, not on the hours of fasting alone.',
    userExperience: 'For many people hunger settles after the first wave. Light activity such as a walk is usually comfortable.',
    evidence: 'The switch is well documented; when it happens varies from person to person.',
    milestone: 'Past 12 hours: your body is leaning more on fat for fuel.',
  },
  {
    id: 'mild-ketosis',
    hourStart: 16,
    hourEnd: 18,
    title: 'Ketones rising',
    color: '#eab308',
    energySource: 'Fat, with ketones starting to climb',
    summary: 'Your liver turns more fat into ketones, an extra fuel for brain and muscle.',
    science:
      'The liver converts fatty acids into ketone bodies, mainly beta-hydroxybutyrate (BHB), which the brain can use when glucose is scarce. After an overnight fast BHB stays under about 0.4 mmol/L. It rises through this window, but most people are not yet at the 0.5 mmol/L usually used to define ketosis.',
    whatsHappening:
      'BHB is also a signal: in cell and animal studies it calms an inflammatory pathway (the NLRP3 inflammasome) and changes gene activity. Whether that matters at these levels in people is not yet known.',
    userExperience:
      'Some people feel steady energy and focus; others feel low or irritable, especially in their first weeks of fasting. Both are common, and it often gets easier with practice.',
    evidence: 'The ketone rise is well measured. Brain and anti-inflammatory benefits come mostly from lab and animal studies.',
    milestone: 'Past 16 hours: ketones are rising.',
  },
  {
    id: 'deep-ketosis',
    hourStart: 18,
    hourEnd: 24,
    title: 'Into ketosis',
    color: '#a855f7',
    energySource: 'Fat and ketones',
    summary: 'Ketones reach the level usually called ketosis, often between 18 and 24 hours.',
    science:
      "In a 2021 trial, blood BHB reached 0.5 mmol/L after about 21 hours of fasting on average, and after about 17.5 hours when the fast began with exercise. Low insulin and an active AMPK, the cell's energy sensor, also favor autophagy: the process that breaks down and recycles worn-out parts of cells.",
    whatsHappening:
      'Fasting clearly turns up autophagy in mice, usually over 24 to 48 hours. In people it is hard to measure, and studies so far rely mostly on markers in blood cells, so there is no reliable hour at which it starts or peaks in humans.',
    userExperience:
      'Hunger is often lower than people expect by now. A headache can come from too little fluid or salt, or from missing caffeine; water and a pinch of salt usually help.',
    evidence: 'Ketone timing is measured in trials. Autophagy timing in humans is uncertain.',
    milestone: 'Past 18 hours: you are likely approaching ketosis.',
  },
  {
    id: 'peak-autophagy',
    hourStart: 24,
    hourEnd: 48,
    title: 'Past a day: growth hormone up',
    color: '#ec4899',
    energySource: 'Fat and ketones, with glucose newly made by the liver',
    summary: 'Liver glycogen is low, most glucose is newly made, and growth hormone climbs.',
    science:
      'By a day in, the liver makes most of the glucose it releases from scratch: about two thirds in the first 22 hours, rising past four fifths after that. Growth hormone rises sharply; two days of fasting raised daily growth hormone output about fivefold in one study, which helps release fat and spare protein.',
    whatsHappening:
      'Ketones keep climbing, often to around 1 to 2 mmol/L by the second day. Some protein is still broken down to make glucose, which is why longer fasts cost some lean mass along with fat.',
    userExperience:
      'For many people hunger is worst around the second day and then eases. Expect less capacity for hard training. Drink water and take electrolytes (sodium, potassium, magnesium); feeling dizzy when you stand up is a sign you need more.',
    evidence: 'Glucose production and growth hormone are well measured, in small human studies.',
    milestone: 'A day reached: growth hormone is up and your body runs mostly on fat.',
  },
  {
    id: 'immune-reset',
    hourStart: 48,
    hourEnd: Infinity,
    title: 'Extended fast',
    color: '#6366f1',
    energySource: 'Fat and ketones',
    summary: 'Deeper ketosis and falling IGF-1. Whole-body changes show from about 3 days.',
    science:
      'Ketones keep rising over several days and the brain takes more of its energy from them. IGF-1, a growth signal, falls. A 2024 study of a 7-day water fast tracked about 3,000 blood proteins and found broad, whole-body changes only after about 3 days, some likely helpful and some possibly harmful.',
    whatsHappening:
      'In mice, repeated 2 to 5 day fasts lowered IGF-1 and helped regenerate blood stem cells and immune cells after chemotherapy. In people this is preliminary, from small studies in cancer patients; claims of an immune "reset" go beyond the evidence.',
    userExperience:
      'Expect lower energy, feeling cold, and possibly poor sleep. Keep up water and electrolytes, and stop and eat if you feel faint or confused or your heart races. Fasts beyond 3 days are best done with medical supervision, and a long fast needs a careful refeed: eating a lot too fast can upset your electrolytes.',
    evidence: 'Mostly small human studies and animal research.',
    milestone: 'Past 48 hours: an extended fast. Keep up fluids and electrolytes.',
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
