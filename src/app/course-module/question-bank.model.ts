// ───────────────────────── UI types ─────────────────────────
export type QuestionType = 'single' | 'multiple' | 'short';
export type SelectedType = QuestionType | 'mixed' | null;
export type ScoringType = 'basic' | 'advanced';

/**
 * Hierarchy (matches the Java backend):
 *   Course -> Organize Section -> Question Bank (activity) -> Question Section (Q1, Q2 ...) -> Questions
 * Every Question Bank REST call needs these three ids.
 */
export interface BankScope {
  courseId: number;
  /** The ORGANIZE section (course outline) the Question Bank activity was added to. */
  sectionId: number;
  bankId: number;
}

/** Single source of truth for every SRS / backend limit. Keep in sync with QuestionValidator.java */
export const LIMITS = {
  questionChars: 500,
  optionChars: 200,
  feedbackChars: 500,
  answerChars: 500,
  // Question Section name (inside a bank): backend QuestionSectionService -> 3..100
  sectionNameMinChars: 3,
  sectionNameChars: 100,
  maxSectionsPerBank: 100,
  // Question Bank name (the activity): backend QuestionBankService -> 3..100
  bankNameMinChars: 3,
  bankNameChars: 100,
  minOptions: 2,
  maxOptions: 20,
  minScore: 0,
  maxScore: 100,
  maxQuestionsPerSection: 500,
  maxImportBytes: 100 * 1024 * 1024,
  maxExistingSelection: 100,
  existingPageSize: 20,
} as const;

export const IMPORT_EXTENSIONS: ReadonlySet<string> = new Set(['pdf', 'doc', 'docx', 'csv', 'xls', 'xlsx']);

/** Exact wording from the SRS (field list #4 + edge cases). */
export const MESSAGES = {
  offlineSave: 'Unable to save the Question Bank. Please check your internet connection and try again',
  offlineGeneric: 'Unable to reach the server. Please check your internet connection and try again.',
  sessionExpired: 'Your session has expired. Please log in again.',
  server: 'Something went wrong. Please try again later.',
  conflict: 'Another user has updated this Question Bank. Reload to get the latest changes.',
  forbidden: 'You do not have permission to perform this action.',
  invalidFile: 'Invalid file type',
  fileTooLarge: 'File size exceeds 100 MB.',
  saved: 'Question Bank saved successfully',
  autoSaved: 'Changes saved automatically.',
  conflictResolved: 'Another user has updated this Question Bank. Your latest changes have been saved.',
} as const;

export interface OptionVm {
  clientId: string;
  text: string;
  correct: boolean;
  points: number; // used only when scoringType === 'advanced'
}

export interface QuestionVm {
  clientId: string;            // stable key for @for + Idempotency-Key
  id: number | null;           // null until persisted
  version: number | null;      // optimistic-lock version from server
  persistedHidden: boolean;    // last hidden flag known by server
  dirty: boolean;              // changed since last load/save
  text: string;
  type: QuestionType;
  scoringType: ScoringType;
  correctScore: number;
  incorrectScore: number;
  correctFeedback: string;
  incorrectFeedback: string;
  expectedAnswer: string;      // short text only
  hidden: boolean;
  options: OptionVm[];
}

/**
 * A QUESTION SECTION inside one Question Bank (Q1 = 5 questions, Q2 = 10 questions ...).
 * NOT the course "organize section". `id` is the questionSectionId on the backend.
 *
 * Design fields of a section: name + "Section points" panel (score, feedback).
 */
export interface SectionVm {
  clientId: string;
  id: number | null;
  serverName: string | null;       // last name known by server (to detect renames)
  name: string;
  score: number | null;            // section points -> Score (0..100, empty = null)
  feedback: string;                // section points -> Feedback
  serverScore: number | null;      // last score known by server (to detect changes)
  serverFeedback: string;          // last feedback known by server (to detect changes)
  questions: QuestionVm[];
  serverQuestionIds: number[];     // question ids in server order (baseline for delete / reorder)
}

// ───────────────────────── API contracts (match QuestionDto.java) ─────────────────────────
export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

export type ApiQuestionType = 'SINGLE_ANSWER' | 'MULTIPLE_ANSWER' | 'SHORT_TEXT';
export type ApiScoringType = 'BASIC' | 'ADVANCED';

export interface ApiOptionRequest {
  text: string;
  correct: boolean;
  score: number;
}

export interface ApiQuestionRequest {
  text: string;
  type: ApiQuestionType;
  scoringType: ApiScoringType;
  correctScore: number;
  incorrectScore: number;
  correctFeedback: string | null;
  incorrectFeedback: string | null;
  expectedAnswer: string | null;
  options: ApiOptionRequest[];
  version: number | null;
}

export interface ApiOptionResponse {
  id: number;
  text: string;
  correct: boolean;
  score: number;
  order: number;
}

/** QuestionDto.QuestionResponse */
export interface ApiQuestionResponse {
  id: number;
  questionSectionId: number;
  questionBankId: number;
  text: string;
  type: ApiQuestionType;
  scoringType: ApiScoringType;
  correctScore: number;
  incorrectScore: number;
  correctFeedback: string | null;
  incorrectFeedback: string | null;
  expectedAnswer: string | null;
  hidden: boolean;
  questionOrder: number;
  version: number;
  options: ApiOptionResponse[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ApiExistingPage {
  items: ApiQuestionResponse[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

/**
 * Minimal section shape the editor needs (ApiQuestionSectionResponse is a superset of it).
 * `score` / `feedback` are optional until the backend returns them.
 */
export interface ApiSection {
  id: number;
  name: string;
  score?: number | null;
  feedback?: string | null;
}

/** Body of POST / PUT .../question-sections  (score + feedback = "Section points" panel). */
export interface ApiSectionRequest {
  name: string;
  score: number | null;
  feedback: string | null;
}

/** QuestionDto.QuestionSectionResponse */
export interface ApiQuestionSectionResponse extends ApiSection {
  questionBankId: number;
  sectionOrder: number;
  questionCount: number;
  createdAt?: string;
  updatedAt?: string;
}

/** QuestionDto.BankResponse - the Question Bank activity inside an organize section. */
export interface ApiBankResponse {
  id: number;
  courseId: number;
  sectionId: number;            // organize section
  name: string;
  bankOrder: number;
  questionSectionCount: number;
  totalQuestionCount: number;   // across all question sections of the bank
  createdAt?: string;
  updatedAt?: string;
}

export interface ApiImportResult {
  imported: number;
}