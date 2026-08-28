/**
 * Static data for the local analysis engine.
 *
 * Everything in this module is inert data — word lists and rule tables. No
 * logic, no imports, no side effects, so it is trivially testable and safe to
 * load from plain Node.
 */

/**
 * Common English stopwords. A term in this set carries no topical signal, so
 * it is excluded from keywords, term scoring and category naming. Kept
 * deliberately mainstream: aggressive pruning would hurt recall on short
 * documents where function words are doing real work in sentences.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'about', 'above', 'across', 'after', 'again', 'against', 'all', 'almost',
  'along', 'already', 'also', 'although', 'always', 'am', 'among', 'an', 'and',
  'another', 'any', 'anyone', 'anything', 'are', 'as', 'at', 'be', 'because',
  'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can',
  'cannot', 'could', 'did', 'do', 'does', 'doing', 'done', 'down', 'during',
  'each', 'either', 'else', 'enough', 'even', 'ever', 'every', 'few', 'for',
  'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here',
  'hers', 'herself', 'him', 'himself', 'his', 'how', 'however', 'i', 'if',
  'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'might', 'more',
  'most', 'much', 'must', 'my', 'myself', 'no', 'nor', 'not', 'nothing', 'now',
  'of', 'off', 'on', 'once', 'one', 'only', 'onto', 'or', 'other', 'others',
  'our', 'ours', 'ourselves', 'out', 'over', 'own', 'per', 'same', 'shall',
  'she', 'should', 'since', 'so', 'some', 'someone', 'something', 'still',
  'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves',
  'then', 'there', 'therefore', 'these', 'they', 'this', 'those', 'through',
  'thus', 'to', 'too', 'under', 'until', 'up', 'upon', 'us', 'very', 'via',
  'was', 'we', 'well', 'were', 'what', 'whatever', 'when', 'whenever', 'where',
  'whereas', 'whether', 'which', 'while', 'who', 'whoever', 'whom', 'whose',
  'why', 'will', 'with', 'within', 'without', 'would', 'you', 'your', 'yours',
  'yourself', 'yourselves', 'yet',
  // common contractions
  "aren't", "can't", "couldn't", "didn't", "doesn't", "don't", "hadn't",
  "hasn't", "haven't", "he's", "isn't", "it's", "let's", "shouldn't", "that's",
  "there's", "wasn't", "we're", "weren't", "what's", "who's", "won't",
  "wouldn't", "you're",
]);

/**
 * Rendering/boilerplate noise that survives tokenization but is never a useful
 * keyword: page furniture, URL fragments, file-format words, copyright lines.
 */
export const NOISE_TERMS: ReadonlySet<string> = new Set([
  'page', 'pages', 'http', 'https', 'www', 'com', 'org', 'net', 'html', 'pdf',
  'doc', 'docx', 'txt', 'xls', 'xlsx', 'ppt', 'pptx', 'copyright', 'reserved',
  'rights', 'confidential', 'document', 'version', 'updated', 'created',
  'generated', 'downloaded', 'printed', 'footer', 'header',
]);

/**
 * Document-type classification rules.
 *
 * Each rule scores a document by summing the weights of its terms that appear
 * (after stemming) in the text. Multi-word terms are matched as adjacent token
 * pairs. The highest-scoring rule wins, provided it clears `MIN_TYPE_SCORE`.
 * Weights reflect specificity: words that almost only appear in that document
 * type score 3, strong indicators 2, weak/contextual ones 1.
 */
export interface DocTypeRule {
  /** Human-readable type name, stored as `document_type`. */
  type: string;
  /** Terms (already lowercase; multi-word = bigram) with weights 1–3. */
  terms: [term: string, weight: number][];
}

export const DOC_TYPE_RULES: readonly DocTypeRule[] = [
  {
    type: 'Invoice',
    terms: [
      ['invoice', 3], ['bill to', 3], ['amount due', 3], ['remit', 2],
      ['subtotal', 2], ['invoice number', 3], ['payment terms', 2],
      ['tax', 1], ['payment', 1], ['billed', 2], ['remit to', 3],
    ],
  },
  {
    type: 'Receipt',
    terms: [
      ['receipt', 3], ['payment received', 3], ['paid', 2], ['cash', 1],
      ['change due', 3], ['thank you for your purchase', 3], ['total paid', 3],
      ['transaction', 1], ['tender', 1],
    ],
  },
  {
    type: 'Resume',
    terms: [
      ['resume', 3], ['curriculum vitae', 3], ['work experience', 3],
      ['objective', 1], ['skills', 1], ['education', 1], ['references', 1],
      ['linkedin', 2], ['career summary', 3], ['employment history', 3],
    ],
  },
  {
    type: 'Contract',
    terms: [
      ['contract', 3], ['agreement', 3], ['terms and conditions', 3],
      ['hereby', 2], ['witnesseth', 3], ['parties', 2], ['clause', 2],
      ['effective date', 2], ['obligations', 1], ['breach', 2],
      ['termination', 1], ['indemnify', 3],
    ],
  },
  {
    type: 'Research Paper',
    terms: [
      ['abstract', 3], ['methodology', 2], ['related work', 3],
      ['et al', 3], ['doi', 2], ['peer-reviewed', 3], ['hypothesis', 2],
      ['introduction', 1], ['conclusion', 1], ['references', 1],
      ['journal', 1], ['findings', 1],
    ],
  },
  {
    type: 'Report',
    terms: [
      ['report', 2], ['executive summary', 3], ['findings', 2],
      ['recommendations', 1], ['prepared by', 2], ['submitted to', 2],
      ['analysis', 1], ['overview', 1],
    ],
  },
  {
    type: 'Letter',
    terms: [
      ['dear', 2], ['sincerely', 3], ['yours faithfully', 3],
      ['yours sincerely', 3], ['to whom it may concern', 3], ['regards', 1],
      ['respectfully', 2],
    ],
  },
  {
    type: 'Memorandum',
    terms: [
      ['memorandum', 3], ['memo', 2], ['interoffice', 3], ['subject line', 2],
    ],
  },
  {
    type: 'Presentation',
    terms: [
      ['presentation', 2], ['slides', 2], ['speaker notes', 3],
      ['agenda', 1], ['audience', 1],
    ],
  },
  {
    type: 'Form',
    terms: [
      ['form', 1], ['applicant', 2], ['date of birth', 3],
      ['signature', 1], ['fill in', 2], ['section a', 2], ['checkbox', 2],
      ['please complete', 3],
    ],
  },
  {
    type: 'Syllabus',
    terms: [
      ['syllabus', 3], ['course description', 3], ['grading policy', 3],
      ['office hours', 3], ['semester', 2], ['instructor', 2],
      ['textbook', 2], ['assignments', 1], ['attendance', 1],
    ],
  },
  {
    type: 'Assignment',
    terms: [
      ['assignment', 2], ['submitted by', 2], ['roll number', 3],
      ['student id', 3], ['marks obtained', 3], ['question 1', 2],
    ],
  },
  {
    type: 'User Guide',
    terms: [
      ['user guide', 3], ['user manual', 3], ['troubleshooting', 2],
      ['instructions', 1], ['step 1', 2], ['chapter 1', 2],
      ['installation', 1], ['warranty', 2],
    ],
  },
  {
    type: 'Meeting Notes',
    terms: [
      ['meeting notes', 3], ['minutes of meeting', 3], ['attendees', 2],
      ['action items', 3], ['agenda', 1], ['minutes', 1], ['discussed', 1],
    ],
  },
];

/** Minimum total rule score for a document_type to be assigned at all. */
export const MIN_TYPE_SCORE = 3;

/**
 * Cue words that mark a nearby date as a deadline. Matched within a window of
 * text around the date occurrence (see entities.ts), not whole-document.
 */
export const DEADLINE_CUES: readonly string[] = [
  'due', 'deadline', 'due date', 'no later than', 'closing date',
  'last date', 'expires', 'expiry', 'expiration', 'submit by',
  'submission deadline', 'payment due', 'before',
];

/**
 * Labels that commonly introduce a document's own date ("Date: 12 May 2024").
 * Used when choosing `document_date` among several candidates.
 */
export const DOC_DATE_LABELS: readonly string[] = [
  'date', 'dated', 'issued', 'issue date', 'created', 'published',
];

/** Month names and common abbreviations → month number (1-based). */
export const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};
