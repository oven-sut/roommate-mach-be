import { DEFAULT_MATCH_WEIGHTS } from '../config/app-settings.service';
import {
  compareLifestyles,
  lifestyleTags,
  parseAnswers,
  type StoredAnswers,
} from './scoring';

/** The exact shape the app's `toApiAnswers` produces. */
function answers(overrides: Partial<Record<string, string[][]>> = {}) {
  const base: StoredAnswers = {
    q1: [['22:00–23:00'], ['07:00–09:00']],
    q2: [['Spotless', 'Dishes same day'], ['3/5']],
    q3: [['sometime'], ['Weekly'], ['4/month'], ['Close friends']],
    q4: [['Anytime'], ['25°'], ['4/8'], ['In room']],
  };
  return { ...base, ...overrides } as StoredAnswers;
}

describe('parseAnswers', () => {
  it('reads every group the app sends', () => {
    const parsed = parseAnswers(answers());

    expect(parsed.sleep).toEqual([22 * 60, 23 * 60]);
    expect(parsed.wake).toEqual([7 * 60, 9 * 60]);
    expect(parsed.cleanHabits).toEqual(['Spotless', 'Dishes same day']);
    expect(parsed.cleanScore).toBe(3);
    expect(parsed.overnight).toBe('sometime');
    expect(parsed.guestFrequency).toBe(2); // "Weekly"
    expect(parsed.guestTimes).toBe(4);
    expect(parsed.guestTypes).toEqual(['Close friends']);
    expect(parsed.acTiming).toBe(2); // "Anytime"
    expect(parsed.acTemp).toBe(25);
    expect(parsed.quiet).toBe(4);
    expect(parsed.studyPlace).toBe('In room');
  });

  it('treats an after-midnight bedtime as later than 23:00, not earlier', () => {
    const late = parseAnswers(
      answers({ q1: [['23:30–01:00'], ['07:00–09:00']] }),
    );
    const early = parseAnswers(
      answers({ q1: [['21:00–22:00'], ['07:00–09:00']] }),
    );

    expect(late.sleep![0]).toBe(23 * 60 + 30);
    expect(late.sleep![1]).toBe(25 * 60); // 01:00 the next day
    expect(late.sleep![0]).toBeGreaterThan(early.sleep![1]);
  });

  it('accepts a plain hyphen as well as an en dash', () => {
    expect(parseAnswers(answers({ q1: [['22:00-23:00'], []] })).sleep).toEqual([
      22 * 60,
      23 * 60,
    ]);
  });

  it('survives missing, empty and malformed payloads', () => {
    expect(parseAnswers(null).sleep).toBeNull();
    expect(parseAnswers({}).cleanScore).toBeNull();
    expect(parseAnswers({ q1: [], q2: [] }).cleanHabits).toEqual([]);
    expect(parseAnswers({ q1: [['not a time'], []] }).sleep).toBeNull();
  });
});

describe('compareLifestyles', () => {
  const compare = (a: StoredAnswers, b: StoredAnswers) =>
    compareLifestyles(parseAnswers(a), parseAnswers(b), DEFAULT_MATCH_WEIGHTS);

  it('scores an identical pair at 100', () => {
    const { score, breakdown } = compare(answers(), answers());
    expect(score).toBe(100);
    expect(breakdown).toEqual({
      sleep: 100,
      cleanliness: 100,
      guests: 100,
      temperature: 100,
    });
  });

  it('scores opposites far below an identical pair', () => {
    const opposite = answers({
      q1: [['01:00–02:30+'], ['11:00–11:30+']],
      q2: [['Laundry piles up'], ['0/5']],
      q3: [['no'], ['Never'], ['0/month'], ['No one']],
      q4: [['Just day'], ['30°'], ['0/8'], ['Library']],
    });

    const far = compare(answers(), opposite);
    const near = compare(answers(), answers());

    expect(far.score).toBeLessThan(50);
    expect(far.score!).toBeLessThan(near.score!);
  });

  it('rewards near misses instead of treating them as total mismatches', () => {
    // One notch apart on bedtime is nothing like a six-hour gap.
    const nearby = answers({ q1: [['22:30–23:30'], ['07:00–09:00']] });
    const distant = answers({ q1: [['01:00–02:00'], ['07:00–09:00']] });

    expect(compare(answers(), nearby).breakdown.sleep!).toBeGreaterThan(
      compare(answers(), distant).breakdown.sleep!,
    );
  });

  it('returns null rather than a made-up score when nobody has answered', () => {
    expect(compare({}, {}).score).toBeNull();
    expect(compare(answers(), {}).score).toBeNull();
  });

  it('ignores categories the pair did not both answer', () => {
    const sleepOnly: StoredAnswers = { q1: [['22:00–23:00'], ['07:00–09:00']] };
    const { score, breakdown } = compare(sleepOnly, sleepOnly);

    expect(score).toBe(100);
    expect(breakdown.cleanliness).toBeUndefined();
  });

  it('follows the configured weights', () => {
    const differentSleep = answers({ q1: [['01:00–02:00'], ['11:00–11:30+']] });

    const sleepHeavy = compareLifestyles(
      parseAnswers(answers()),
      parseAnswers(differentSleep),
      { sleep: 100, cleanliness: 0, guests: 0, temperature: 0 },
    );
    const sleepIgnored = compareLifestyles(
      parseAnswers(answers()),
      parseAnswers(differentSleep),
      { sleep: 0, cleanliness: 40, guests: 30, temperature: 30 },
    );

    expect(sleepHeavy.score!).toBeLessThan(sleepIgnored.score!);
    expect(sleepIgnored.score).toBe(100);
  });

  it('does not reward two people for both skipping a question', () => {
    const noHabits = answers({ q2: [[], ['3/5']] });
    const withHabits = answers();

    // Both blank is neutral, not a perfect match on habits.
    expect(compare(noHabits, noHabits).breakdown.cleanliness).toBe(100);
    expect(compare(noHabits, withHabits).breakdown.cleanliness!).toBeLessThan(
      100,
    );
  });
});

describe('lifestyleTags', () => {
  it('builds the chips the discover card shows', () => {
    expect(lifestyleTags(parseAnswers(answers()))).toEqual([
      'Early Bird 22:00–23:00',
      'Spotless 3/5',
      'Guests: sometime',
      'Quiet hours 4/8',
      'AC 25°',
    ]);
  });

  it('calls a late bedtime a night owl', () => {
    const owl = parseAnswers(
      answers({ q1: [['23:30–01:00'], ['09:00–10:00']] }),
    );
    expect(lifestyleTags(owl)[0]).toBe('Night Owl 23:30–01:00');
  });

  it('emits nothing for a student who has not answered', () => {
    expect(lifestyleTags(parseAnswers(null))).toEqual([]);
  });
});
