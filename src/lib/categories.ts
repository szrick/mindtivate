export const CATEGORIES = [
  { label: 'Body', blurb: 'Strength, bodyweight training, and body recomposition.' },
  { label: 'Food', blurb: 'Eating for energy, hormones, and real life — not restriction.' },
  { label: 'Mind', blurb: 'Stress, habits, and the mental side of change.' },
  { label: 'Hormones', blurb: 'Cycle health, PCOS, perimenopause, and menopause.' },
  { label: 'Love', blurb: 'Relationships, boundaries, and connection.' },
  { label: 'Beauty', blurb: 'Skin, hair, and beauty from the inside out.' },
  { label: 'Sleep', blurb: 'Rest, recovery, and moving without pain.' },
  { label: 'Life Stages', blurb: 'Fitness and health through every decade.' },
] as const;

export type CategoryLabel = (typeof CATEGORIES)[number]['label'];

export function toCategorySlug(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '-');
}
