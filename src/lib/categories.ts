export const CATEGORIES = [
  { label: 'Weight Loss', blurb: 'Sustainable approaches, not crash diets.' },
  { label: 'Strength Training', blurb: 'Lifting programs and form guidance.' },
  { label: 'Nutrition', blurb: 'What the research actually says.' },
  { label: 'Mental Health', blurb: 'The mind side of fitness and habits.' },
  { label: 'Bodyweight Fitness', blurb: 'No-gym strength and mobility.' },
  { label: 'Recovery', blurb: 'Sleep, rest days, and injury prevention.' },
  { label: 'Motivation', blurb: 'Staying consistent when motivation dips.' },
] as const;

export type CategoryLabel = (typeof CATEGORIES)[number]['label'];

export function toCategorySlug(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '-');
}
