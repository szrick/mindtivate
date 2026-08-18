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

  'personal-essay': {
    id: 'personal-essay',
    label: 'Reader-grounded personal-essay opening',
    wordCountTarget: '700-1000',
    maxTokens: 3200,
    guidance: `STRUCTURE TEMPLATE: Personal-essay-style opening, grounded in the real
reader's own words — not an invented personal narrative.

CONTENT HONESTY (non-negotiable): never invent a first-person account and
attribute it to the mindtivate-team byline as if an editor personally
lived it — that's exactly what COMPLIANCE.md prohibits. Research shows
personal essays engage readers through specific, sensory, concrete
detail and a real emotional throughline — you can get that same effect
honestly by opening with the ACTUAL reader's real situation (from the
pain point detail provided), closely paraphrased or lightly quoted, made
explicit as theirs ("One reader in r/xxfitness described...", "As she
put it..."). Do not write "I" as if you are that reader.

Title format: reflects the real question/moment, e.g. "She Asked Whether
X Actually Works — Here's What the Research Says" or "What Actually
Happens When You Try to X" — not "I tried X" framed as the site's own
experience.

Structure:
1. Open with the real reader's specific, concrete situation — the exact
   detail/number/timeframe/feeling from their actual post, attributed to
   them, not invented.
2. Pivot explicitly ("Here's what's actually going on" / "Here's what
   the research says") into the site's usual third-person, evidence-based
   analysis — while still checking back in with that reader's specific
   situation periodically ("for her specifically...", "if you're in a
   similar spot...").
3. Close by returning to the reader's real situation with a concrete,
   grounded takeaway — bookend structure.

Style: concrete and specific in the reader-grounded opening/closing;
second-person ("you") when addressing the broader audience in the
analysis section, matching the rest of the site's voice.`,
  },

  'myth-vs-fact': {
    id: 'myth-vs-fact',
    label: 'Myth vs. fact correction format',
    wordCountTarget: '900-1200',
    maxTokens: 3800,
    guidance: `STRUCTURE TEMPLATE: Myth vs. fact. Research on correction formats shows
question-answer/myth-fact structure outperforms a fact-only rundown,
but only when the myths are things people genuinely believe — a myth
nobody actually holds falls flat, so ground each one in a real
misconception implied by the pain point or common in that community
(e.g. what commenters on the source thread got wrong or disagreed on).

Title format: "[Number] Myths About [Topic] — Busted" or "Is [Common
Belief] Actually True? Separating Fact From Fiction."

Structure:
1. Brief intro (~80-120 words): name why misconceptions about this
   specific topic are common or persistent, promise clarity.
2. 3-5 myth/fact pairs. Each as its own "## Myth: [specific, genuinely-
   held misconception, stated plainly]" subheading, followed by a
   **Fact:** paragraph (100-160 words) with a SPECIFIC, concrete
   correction — real numbers, timeframes, or mechanisms, never a vague
   "it depends" or "it's complicated."
3. No separate conclusion — the last myth/fact pair can close with a
   brief practical wrap-up line.

Style: direct and clarifying, not condescending toward whoever might
believe the myth — frame corrections as "here's the more complete
picture," not "you were wrong."`,
  },

  'ask-the-expert-qa': {
    id: 'ask-the-expert-qa',
    label: 'Ask-the-expert Q&A format',
    wordCountTarget: '900-1200',
    maxTokens: 3800,
    guidance: `STRUCTURE TEMPLATE: Ask-the-expert Q&A. A literal question-then-answer
structure — research shows this format improves scannability, clarity,
and perceived authority versus a standard prose essay on the same
topic.

Title format: "Your Questions About [Topic], Answered" or "[Topic]:
What You Need to Know."

Structure:
1. Brief intro (~60-100 words): why these specific questions come up
   for this audience.
2. 4-6 literal Q&A pairs. Each question as its own "## " subheading,
   phrased the way a real reader would actually ask it (conversational,
   specific — not a formal restatement); each answer a direct, concrete
   paragraph (100-180 words). Order questions so they escalate naturally
   (basic first, more nuanced later), the way a genuinely curious reader
   would ask them in sequence.
3. No separate conclusion — the last answer can close the practical
   loop.

Style: each answer should actually answer the question in its first
sentence before adding nuance — no throat-clearing or "great question"
filler.`,
  },

  'self-assessment-checklist': {
    id: 'self-assessment-checklist',
    label: 'Self-assessment checklist',
    wordCountTarget: '700-1000',
    maxTokens: 3200,
    guidance: `STRUCTURE TEMPLATE: Self-assessment checklist. Interactive/checklist-style
content drives meaningfully higher engagement than passive prose by
inviting active participation — this adapts that principle to a static
article: a reflective checklist the reader mentally works through,
rather than a true interactive quiz.

Title format: "Is [Thing] Right for You? A Quick Self-Check" or "[N]
Signs You Might Need to [Action]."

Structure:
1. Brief intro (~80-120 words): frame what the self-check is for and
   explicitly state it's a reflection tool, not a diagnosis.
2. 5-8 checklist items as a markdown list, each a specific, concrete
   reflective question or statement ("Do you often...", "Have you
   noticed...") with 1-2 sentences of brief context underneath explaining
   why it matters.
3. A short "what your answers might mean" section grouped into rough
   bands (e.g. "if most of this sounds familiar...", "if only one or two
   apply...") with practical, non-diagnostic next steps for each band.

Style: never phrase this as a diagnostic tool or imply a specific
answer count means a specific condition — consistent with the site's
existing rule against giving medical diagnoses. Frame results as "worth
a closer look" or "worth talking to a provider about," not verdicts.`,
  },

  'step-by-step-guide': {
    id: 'step-by-step-guide',
    label: 'Step-by-step how-to guide',
    wordCountTarget: '800-1100',
    maxTokens: 3500,
    guidance: `STRUCTURE TEMPLATE: Step-by-step how-to guide. Numbered, sequential
steps with a front-loaded value statement — research on high-dwell-time
how-to content emphasizes stating exactly what the reader will walk away
able to do before the steps begin.

Title format: "How to [Specific Outcome]: A Step-by-Step Guide."

Structure:
1. Open with 1-2 sentences stating exactly what the reader will be able
   to do by the end — no throat-clearing.
2. Brief context paragraph (~60-100 words): why this matters or the most
   common mistake people make skipping straight to the steps.
3. 4-7 numbered steps, each its own "## Step N: [action]" subheading,
   with concrete instructions (100-160 words) and, where it matters, a
   brief "why this step matters" line rather than just the instruction.
4. Close with a short, realistic expectation-setting note (a timeline,
   what to do if stuck, or when to expect to see results) — not a
   generic "you've got this."

Style: imperative, concrete, no vague steps like "eat healthier" —
every step should be something the reader can literally go do right
now.`,
  },

  comparison: {
    id: 'comparison',
    label: '"X vs. Y" comparison',
    wordCountTarget: '900-1200',
    maxTokens: 3800,
    guidance: `STRUCTURE TEMPLATE: "X vs. Y" comparison. Research on comparison content
shows it captures high-intent readers who already know they're choosing
between two specific options, and tends to outperform generic content on
engagement — but only when it resists crowning one universal winner.

Title format: "[Option A] vs. [Option B]: Which Is Right for You?"

Structure:
1. Brief intro (~80-120 words): name the specific decision the reader is
   actually facing, and be upfront that most either/or content
   oversimplifies it.
2. "## What Is [Option A]" and "## What Is [Option B]" — brief, clear,
   neutral definitions (80-120 words each).
3. "## Key Differences" — direct comparison on the 3-5 factors that
   actually matter for this decision, not an exhaustive feature dump.
4. "## Which Should You Choose" — situational guidance ("if X is true
   for you, A tends to fit better; if Y, B does") rather than a single
   universal recommendation.
5. Close by acknowledging it's not always strictly either/or — sometimes
   both, sometimes neither, is the honest answer.

Style: genuinely neutral until the situational-guidance section — don't
telegraph a "correct" choice in the definitions or differences
sections.`,
  },
};

export function listTemplateIds() {
  return Object.keys(ARTICLE_TEMPLATES);
}
