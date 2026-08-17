// Structural templates for stage 3 (article drafting), selected via
// `npm run pipeline:draft -- --template <id>`. A template only changes
// shape/length/style — Mindtivate's core voice and compliance rules
// (never diet-culture, cite only verified sources, one natural product
// mention) live in 3-generate-article.mjs's base system prompt and apply
// regardless of which template is chosen.

export const ARTICLE_TEMPLATES = {
  standard: {
    id: 'standard',
    label: 'Mindtivate standard explainer',
    wordCountTarget: '600-900',
    maxTokens: 3000,
    guidance: `STRUCTURE: Standard explainer article. Open with the specific problem/question
that prompted this piece, explain the "why" behind it, then walk through
what the research/reasoning actually supports, and close with a clear,
practical takeaway. Use "## " subheadings to break up sections as the
content naturally calls for it — no fixed section count or listicle
format required.`,
  },

  'self-listicle': {
    id: 'self-listicle',
    label: 'SELF-style numbered habit listicle',
    wordCountTarget: '1100-1300',
    maxTokens: 4200,
    guidance: `STRUCTURE TEMPLATE: SELF-style listicle (modeled on self.com's "[N] Simple
[Time] Habits That [Benefit]" format).

Title format: "[Number] Simple [Time-of-day or context] Habits That
[Benefit]" — adapt the framing to the actual topic (doesn't have to be
"morning" or literally "habits" if the pain point calls for something
else).

Structure:
1. Intro (~120-180 words): hook naming a common or hidden problem in
   relatable terms; a nuance acknowledging it's more complex than it
   sounds (e.g. the thing isn't inherently bad); problem framing (when
   or why it's actually worth addressing); reassurance that no extreme
   overhaul is needed, just small realistic changes; then explicitly set
   up the list ("Here are N easy habits to get you started.").
2. One "## " subheading per habit/tip (3-7 total), action-oriented
   phrasing (e.g. "Start your morning with a gut-friendly drink"), each
   ~200-300 words following why it matters (science-lite, 2-4 sentences,
   tie to the main benefit) -> what to do (concrete, specific actions,
   not vague advice) -> how it helps (tie back to the benefit). Friendly,
   non-judgmental, "you can start today" tone throughout.
3. No separate formal conclusion section — the final habit's paragraph
   doubles as a calm, natural wrap-up.

Style: second-person voice throughout ("you," "your"); short paragraphs
(2-5 sentences); conversational connective phrases where they fit
naturally ("Here's the deal," "The best part?," "Let's be real," "trust
me" — use sparingly, don't force all of them in every section); light,
plain-language references to research, no jargon-dumping.`,
  },

  'quick-hacks': {
    id: 'quick-hacks',
    label: 'Fast, snackable hacks listicle',
    wordCountTarget: '800-1200',
    maxTokens: 3600,
    guidance: `STRUCTURE TEMPLATE: Quick-hacks listicle — fast, snackable, time-boxed
(Marie Claire "hacks" style).

Title format: speed/simplicity framing, e.g. "[Number] [Topic] Hacks
That Take Less Than [X] Minutes."

Structure:
1. Very tight intro (~60-100 words, 1-2 short paragraphs): name the
   problem fast, promise speed and simplicity, skip elaborate
   scene-setting.
2. 4-6 numbered tips, punchy action-oriented "## " subheadings,
   ~120-180 words each: one quick "why" line (skip heavy explanation),
   the concrete action, a brief "why it's fast/easy" reassurance line.
3. No formal conclusion — end on the last tip's practical note.

Style: snappy, high-energy, time-efficient framing (e.g. "if you only
have five minutes..."); very short paragraphs (1-3 sentences); minimal
science explanation — this format prioritizes speed over depth.`,
  },
};

export function listTemplateIds() {
  return Object.keys(ARTICLE_TEMPLATES);
}
