import type { MatchWeights } from '../config/app-settings.service';

/**
 * Compatibility scoring for the lifestyle questionnaire.
 *
 * The app stores each category as an array of selection groups
 * (`{ q1: [["22:00-23:00"], ["07:00-09:00"]], ... }`) and the order of those
 * groups is part of the contract — see `toApiAnswers` in the app's
 * `questionnaire.content.ts`. This module parses that shape back into named
 * values, so the score reflects how close two students actually are rather
 * than whether their answers happen to be byte-identical.
 */

export type StoredAnswers = Record<string, string[][]>;

export type Lifestyle = {
  /** Bedtime window, in minutes from midnight (after midnight counts as +24h). */
  sleep: [number, number] | null;
  /** Wake-up window, in minutes from midnight. */
  wake: [number, number] | null;
  cleanHabits: string[];
  cleanScore: number | null;
  overnight: string | null;
  guestFrequency: number | null;
  guestTimes: number | null;
  guestTypes: string[];
  acTiming: number | null;
  acTemp: number | null;
  quiet: number | null;
  studyPlace: string | null;
};

export const CLEAN_MAX = 5;
export const QUIET_MAX = 8;
export const GUEST_TIMES_MAX = 10;
export const AC_MIN = 20;
export const AC_MAX = 30;

export const FREQUENCY_LABELS = ['Never', 'Monthly', 'Weekly', 'Anytime'];
export const AC_TIMING_LABELS = [
  'Just day',
  'Just night',
  'Anytime',
  'All time',
];

/** Widest gap the sleep and wake sliders allow, used to normalise closeness. */
const SLEEP_SPREAD_MIN = 390;

const EMPTY: Lifestyle = {
  sleep: null,
  wake: null,
  cleanHabits: [],
  cleanScore: null,
  overnight: null,
  guestFrequency: null,
  guestTimes: null,
  guestTypes: [],
  acTiming: null,
  acTemp: null,
  quiet: null,
  studyPlace: null,
};

/** "22:30" or "02:30+" to minutes past midnight; night times roll past 24h. */
function toMinutes(label: string, night: boolean): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(label.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  // A bedtime of 01:00 is later than 23:00, not 22 hours earlier.
  const rollover = night && hours < 12 ? 24 * 60 : 0;
  return hours * 60 + minutes + rollover;
}

/** Splits "22:00-23:00" (en dash or hyphen) into its two ends. */
function parseRange(
  label: string | undefined,
  night: boolean,
): [number, number] | null {
  if (!label) return null;
  const [from, to] = label.split(/[–—-]/);
  const start = toMinutes(from ?? '', night);
  const end = toMinutes(to ?? from ?? '', night);
  if (start == null || end == null) return null;
  return start <= end ? [start, end] : [end, start];
}

/** Leading number of "3/5", "7/month" or "25 degrees". */
function leadingNumber(label: string | undefined): number | null {
  if (!label) return null;
  const match = /-?\d+(\.\d+)?/.exec(label);
  return match ? Number(match[0]) : null;
}

function cleanList(group: string[] | undefined): string[] {
  if (!Array.isArray(group)) return [];
  return group
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstOf(group: string[] | undefined): string | null {
  const list = cleanList(group);
  return list.length ? list[0] : null;
}

/** Reads the stored selection groups back into named lifestyle values. */
export function parseAnswers(
  stored: StoredAnswers | null | undefined,
): Lifestyle {
  if (!stored || typeof stored !== 'object') return { ...EMPTY };
  const result: Lifestyle = { ...EMPTY };

  const [sleep, wake] = stored.q1 ?? [];
  result.sleep = parseRange(firstOf(sleep) ?? undefined, true);
  result.wake = parseRange(firstOf(wake) ?? undefined, false);

  const [habits, cleanScore] = stored.q2 ?? [];
  result.cleanHabits = cleanList(habits);
  result.cleanScore = leadingNumber(firstOf(cleanScore) ?? undefined);

  const [overnight, frequency, times, types] = stored.q3 ?? [];
  result.overnight = firstOf(overnight);
  const frequencyLabel = firstOf(frequency);
  result.guestFrequency = frequencyLabel
    ? FREQUENCY_LABELS.indexOf(frequencyLabel)
    : null;
  if (result.guestFrequency === -1) result.guestFrequency = null;
  result.guestTimes = leadingNumber(firstOf(times) ?? undefined);
  result.guestTypes = cleanList(types);

  const [timing, temp, quiet, study] = stored.q4 ?? [];
  const timingLabel = firstOf(timing);
  result.acTiming = timingLabel ? AC_TIMING_LABELS.indexOf(timingLabel) : null;
  if (result.acTiming === -1) result.acTiming = null;
  result.acTemp = leadingNumber(firstOf(temp) ?? undefined);
  result.quiet = leadingNumber(firstOf(quiet) ?? undefined);
  result.studyPlace = firstOf(study);

  return result;
}

/** True once a student has given enough for a score to mean anything. */
export function hasAnswers(lifestyle: Lifestyle): boolean {
  return Boolean(
    lifestyle.sleep ||
    lifestyle.wake ||
    lifestyle.cleanScore != null ||
    lifestyle.overnight ||
    lifestyle.acTemp != null,
  );
}

/** Overlap plus midpoint closeness, so near-misses still score well. */
function rangeSimilarity(
  a: [number, number] | null,
  b: [number, number] | null,
): number | null {
  if (!a || !b) return null;
  const overlap = Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
  const union = Math.max(a[1], b[1]) - Math.min(a[0], b[0]);
  const iou = union === 0 ? 1 : overlap / union;
  const centreGap = Math.abs((a[0] + a[1]) / 2 - (b[0] + b[1]) / 2);
  const closeness = Math.max(0, 1 - centreGap / SLEEP_SPREAD_MIN);
  return 0.5 * iou + 0.5 * closeness;
}

/** 1 when identical, tapering to 0 at `spread` apart. */
function numberSimilarity(
  a: number | null,
  b: number | null,
  spread: number,
): number | null {
  if (a == null || b == null || spread <= 0) return null;
  return Math.max(0, 1 - Math.abs(a - b) / spread);
}

function exactSimilarity(a: string | null, b: string | null): number | null {
  if (a == null || b == null) return null;
  return a === b ? 1 : 0;
}

/**
 * Set overlap. Two people who both skipped the question are treated as
 * neutral rather than perfectly aligned, so blank answers cannot inflate a
 * score.
 */
function setSimilarity(a: string[], b: string[]): number | null {
  if (!a.length && !b.length) return null;
  if (!a.length || !b.length) return 0.5;
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const value of left) if (right.has(value)) shared += 1;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : shared / union;
}

/** Mean of the signals that both students actually answered. */
function combine(parts: (number | null)[]): number | null {
  const known = parts.filter((part): part is number => part != null);
  if (!known.length) return null;
  return known.reduce((sum, part) => sum + part, 0) / known.length;
}

export type ScoreBreakdown = {
  sleep?: number;
  cleanliness?: number;
  guests?: number;
  temperature?: number;
};

export type ScoreResult = {
  /** 0-100, or null when neither side has answered enough to compare. */
  score: number | null;
  breakdown: ScoreBreakdown;
};

const asPercent = (value: number | null) =>
  value == null ? undefined : Math.round(value * 100);

/** Weighted compatibility between two students, plus the per-category split. */
export function compareLifestyles(
  a: Lifestyle,
  b: Lifestyle,
  weights: MatchWeights,
): ScoreResult {
  // An empty questionnaire on either side is no signal at all. Without this,
  // the "one side left a chip group blank" allowance below would manufacture a
  // middling score for someone who has answered nothing.
  if (!hasAnswers(a) || !hasAnswers(b)) return { score: null, breakdown: {} };

  const categories = {
    sleep: combine([
      rangeSimilarity(a.sleep, b.sleep),
      rangeSimilarity(a.wake, b.wake),
    ]),
    cleanliness: combine([
      setSimilarity(a.cleanHabits, b.cleanHabits),
      numberSimilarity(a.cleanScore, b.cleanScore, CLEAN_MAX),
    ]),
    guests: combine([
      exactSimilarity(a.overnight, b.overnight),
      numberSimilarity(
        a.guestFrequency,
        b.guestFrequency,
        FREQUENCY_LABELS.length - 1,
      ),
      numberSimilarity(a.guestTimes, b.guestTimes, GUEST_TIMES_MAX),
      setSimilarity(a.guestTypes, b.guestTypes),
    ]),
    temperature: combine([
      exactSimilarity(
        a.acTiming == null ? null : String(a.acTiming),
        b.acTiming == null ? null : String(b.acTiming),
      ),
      numberSimilarity(a.acTemp, b.acTemp, AC_MAX - AC_MIN),
      numberSimilarity(a.quiet, b.quiet, QUIET_MAX),
      exactSimilarity(a.studyPlace, b.studyPlace),
    ]),
  };

  let weighted = 0;
  let totalWeight = 0;
  for (const key of Object.keys(categories) as (keyof typeof categories)[]) {
    const value = categories[key];
    if (value == null) continue;
    const weight = Math.max(0, weights[key] ?? 0);
    weighted += value * weight;
    totalWeight += weight;
  }

  return {
    score:
      totalWeight === 0 ? null : Math.round((weighted / totalWeight) * 100),
    breakdown: {
      sleep: asPercent(categories.sleep),
      cleanliness: asPercent(categories.cleanliness),
      guests: asPercent(categories.guests),
      temperature: asPercent(categories.temperature),
    },
  };
}

/** "Night Owl" once the usual bedtime starts at 23:00 or later. */
function chronotype(sleep: [number, number] | null) {
  if (!sleep) return null;
  return sleep[0] >= 23 * 60 ? 'Night Owl' : 'Early Bird';
}

function clockLabel(minutes: number): string {
  const wrapped = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(wrapped / 60);
  const mins = wrapped % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * The chips shown on a discover card. Mirrors `lifestyleTags` in the app so a
 * card looks the same whether the tags came from the API or were derived on
 * the device.
 */
export function lifestyleTags(lifestyle: Lifestyle): string[] {
  const tags: string[] = [];

  if (lifestyle.sleep) {
    const range = `${clockLabel(lifestyle.sleep[0])}–${clockLabel(lifestyle.sleep[1])}`;
    tags.push(`${chronotype(lifestyle.sleep)} ${range}`);
  }
  if (lifestyle.cleanScore != null) {
    tags.push(`Spotless ${lifestyle.cleanScore}/${CLEAN_MAX}`);
  }
  if (lifestyle.overnight) tags.push(`Guests: ${lifestyle.overnight}`);
  if (lifestyle.quiet != null) {
    tags.push(`Quiet hours ${lifestyle.quiet}/${QUIET_MAX}`);
  }
  if (lifestyle.acTemp != null) tags.push(`AC ${lifestyle.acTemp}°`);

  return tags;
}
