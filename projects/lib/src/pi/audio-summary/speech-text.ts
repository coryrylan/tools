/**
 * Acronyms `say` mispronounces as a made-up word instead of reading as
 * initials. Case-insensitive when matched; the casing here only documents
 * each acronym's canonical form.
 */
const SPOKEN_ACRONYMS = [
  'API',
  'CD',
  'CDN',
  'CI',
  'CLI',
  'CPU',
  'CSS',
  'DB',
  'DNS',
  'GPU',
  'HTML',
  'HTTP',
  'HTTPS',
  'IDE',
  'IP',
  'JWT',
  'npm',
  'NVE',
  'ORM',
  'PR',
  'SDK',
  'SSH',
  'SSL',
  'TLS',
  'UI',
  'URL',
  'UX'
] as const;

// Longest-acronym-first so `HTTPS` matches before the `HTTP` prefix inside it.
const ACRONYM_PATTERN = new RegExp(
  `\\b(${[...SPOKEN_ACRONYMS].sort((left, right) => right.length - left.length).join('|')})(s)?\\b`,
  'gi'
);

/**
 * Spells configured acronyms letter-by-letter (`CLI` becomes `c.l.i.`, `CLIs`
 * becomes `c.l.i.s`) so `say` reads initials instead of guessing a word.
 * Already-dotted forms (`C.L.I.`) hold no bare acronym, so they pass through
 * untouched.
 */
export function spellAcronyms(text: string): string {
  return text.replace(ACRONYM_PATTERN, (_match, acronym: string, plural?: string) => {
    const spelled = `${Array.from(acronym)
      .map(letter => letter.toLowerCase())
      .join('.')}.`;
    return plural ? `${spelled}s` : spelled;
  });
}

/**
 * Strips common markdown syntax deterministically. Prompt instructions alone
 * don't reliably suppress markdown output from a small summarizer model, so
 * this runs regardless of what the model produced.
 */
export function stripMarkdown(text: string): string {
  const withoutFences = text.replace(/```[\s\S]*?```/g, ' ').replace(/~~~[\s\S]*?~~~/g, ' ');
  const withoutInlineCode = withoutFences.replace(/`([^`]+)`/g, '$1');
  const withoutImages = withoutInlineCode.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  const withoutLinks = withoutImages.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  const withoutHeaders = withoutLinks.replace(/^#{1,6}\s+/gm, '');
  const withoutBlockquotes = withoutHeaders.replace(/^>\s*/gm, '');
  const withoutBullets = withoutBlockquotes.replace(/^\s*[-*+]\s+/gm, '').replace(/^\s*\d+\.\s+/gm, '');
  const withoutEmphasis = withoutBullets
    .replace(/\*\*(\S(?:[^*]*\S)?)\*\*/g, '$1')
    .replace(/__(\S(?:[^_]*\S)?)__/g, '$1')
    .replace(/\*(\S(?:[^*]*\S)?)\*/g, '$1')
    .replace(/(?<!\w)_(\S(?:[^_]*\S)?)_(?!\w)/g, '$1');
  return withoutEmphasis.replace(/\s+/g, ' ').trim();
}

// A terminator ends a sentence only when it closes a multi-letter word: the
// summarizer is asked to emit dotted acronyms (`C.L.I.`), and those dots -
// like the ones in `e.g.` - are not sentence boundaries.
const SENTENCE_END_PATTERN = /(?<!\b[A-Za-z])[.!?]["')\]]?(?=\s|$)/g;

/**
 * Index just past the last sentence-ending punctuation in `text`, or
 * `undefined` when `text` contains no sentence boundary.
 */
export function findLastSentenceEnd(text: string): number | undefined {
  const lastMatch = [...text.matchAll(SENTENCE_END_PATTERN)].at(-1);
  if (!lastMatch) return undefined;

  const [fullMatch] = lastMatch;
  return lastMatch.index + fullMatch.length;
}

/**
 * Clips `text` to at most `maxChars`, preferring to cut at the end of the
 * last full sentence over cutting mid-word.
 */
export function clipToSentence(text: string, maxChars: number): string {
  const trimmed = text.trim();
  const withinBudget = trimmed.length <= maxChars;
  // A within-budget reply that doesn't end on sentence punctuation is a
  // mid-sentence stop from hitting the token cap, not a genuinely short one -
  // fall through and clip the truncated tail like an over-budget reply.
  if (withinBudget && /[.!?]["')\]]?$/.test(trimmed)) return trimmed;

  const candidate = withinBudget ? trimmed : trimmed.slice(0, maxChars);
  const sentenceEnd = findLastSentenceEnd(candidate);
  if (sentenceEnd !== undefined) return candidate.slice(0, sentenceEnd).trim();

  // No boundary to cut on: a within-budget reply is short but whole, while an
  // over-budget one must still be cut - drop its last partial word rather
  // than speaking a severed one.
  if (withinBudget) return trimmed;

  const lastSpace = candidate.lastIndexOf(' ');
  return lastSpace >= 0 ? candidate.slice(0, lastSpace).trim() : candidate.trim();
}
