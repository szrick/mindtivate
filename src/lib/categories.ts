export const CATEGORIES = [
  { label: 'Body', blurb: 'Strength, bodyweight training, and body recomposition.', tint: 'var(--tint-body)' },
  { label: 'Food', blurb: 'Eating for energy, hormones, and real life — not restriction.', tint: 'var(--tint-food)' },
  { label: 'Mind', blurb: 'Stress, habits, and the mental side of change.', tint: 'var(--tint-mind)' },
  { label: 'Hormones', blurb: 'Cycle health, PCOS, perimenopause, and menopause.', tint: 'var(--tint-hormones)' },
  { label: 'Love', blurb: 'Relationships, boundaries, and connection.', tint: 'var(--tint-love)' },
  { label: 'Beauty', blurb: 'Skin, hair, and beauty from the inside out.', tint: 'var(--tint-beauty)' },
  { label: 'Sleep', blurb: 'Rest, recovery, and moving without pain.', tint: 'var(--tint-sleep)' },
  { label: 'Life Stages', blurb: 'Fitness and health through every decade.', tint: 'var(--tint-life-stages)' },
] as const;

export type CategoryLabel = (typeof CATEGORIES)[number]['label'];

export function toCategorySlug(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '-');
}
