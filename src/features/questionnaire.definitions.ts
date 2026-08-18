/**
 * The four lifestyle categories the app asks about.
 *
 * The app renders its own controls (sliders, chips, segmented pickers) from
 * `questionnaire.content.ts`, so these rows exist to give every stored answer
 * a real `Question` to hang off and to describe the payload for anyone reading
 * the API. Group order is the contract: it is the order selections arrive in.
 */
export type QuestionDefinition = {
  id: string;
  key: string;
  step: number;
  title: string;
  sub: string;
  note?: string;
  groups: { label: string; items: string[]; active: number[] }[];
};

export const QUESTION_DEFINITIONS: QuestionDefinition[] = [
  {
    id: 'q1',
    key: 'q1',
    step: 1,
    title: 'Sleep & wake rhythm',
    sub: 'When you usually turn in, and when your day starts.',
    note: 'Students with overlapping rhythms report far fewer late-night clashes.',
    groups: [
      { label: 'Usual bedtime', items: ['20:00 - 02:30+'], active: [] },
      { label: 'Usual wake-up time', items: ['05:00 - 11:30+'], active: [] },
    ],
  },
  {
    id: 'q2',
    key: 'q2',
    step: 2,
    title: 'Cleanliness & routines',
    sub: 'The habits that matter most in a shared room.',
    groups: [
      {
        label: 'Non-negotiables',
        items: [
          'Spotless',
          'Dishes same day',
          'Shared chore chart',
          'Organized chaos',
          'Weekly deep clean',
          'Laundry piles up',
          'Shoes off inside',
          'Tidy-ish',
        ],
        active: [],
      },
      { label: 'How much tidiness matters', items: ['0/5 - 5/5'], active: [] },
    ],
  },
  {
    id: 'q3',
    key: 'q3',
    step: 3,
    title: 'Guests & social energy',
    sub: 'Expectations for visitors and shared social time.',
    groups: [
      {
        label: 'Overnight guests',
        items: ['no', 'sometime', 'yes'],
        active: [],
      },
      {
        label: 'How often guests visit',
        items: ['Never', 'Monthly', 'Weekly', 'Anytime'],
        active: [],
      },
      { label: 'Visits per month', items: ['0/month - 10/month'], active: [] },
      {
        label: 'Who might visit',
        items: [
          'Close friends',
          'Study group',
          'Partner',
          'Family',
          'Anyone',
          'No one',
        ],
        active: [],
      },
    ],
  },
  {
    id: 'q4',
    key: 'q4',
    step: 4,
    title: 'Temperature & study setup',
    sub: 'How you keep the room, and where you work best.',
    groups: [
      {
        label: 'When the AC runs',
        items: ['Just day', 'Just night', 'Anytime', 'All time'],
        active: [],
      },
      { label: 'Preferred temperature', items: ['20° - 30°'], active: [] },
      { label: 'Need for quiet', items: ['0/8 - 8/8'], active: [] },
      {
        label: 'Best study location',
        items: ['In room', 'Library', 'Cafe / out'],
        active: [],
      },
    ],
  },
];

export const QUESTION_KEYS = QUESTION_DEFINITIONS.map((q) => q.key);
