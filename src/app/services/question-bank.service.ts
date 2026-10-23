import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, concatMap, forkJoin, from, map, of, tap, throwError, toArray } from 'rxjs';

import { environment } from '../../environments/environment';
import {
  ApiBankResponse,
  ApiExistingPage,
  ApiImportResult,
  ApiQuestionRequest,
  ApiQuestionResponse,
  ApiQuestionSectionResponse,
  ApiQuestionType,
  ApiResponse,
  ApiSection,
  ApiSectionRequest,
  BankScope,
  LIMITS,
  MESSAGES,
  OptionVm,
  QuestionType,
  QuestionVm,
  SectionVm,
  SelectedType,
} from '../course-module/question-bank.model';

/**
 * ONE file for everything non-UI:
 *   1. mapper      – UI view-model <-> API DTO, cloning helpers
 *   2. validator   – mirrors QuestionValidator.java (+ SRS rules)
 *   3. errors      – HTTP failure -> exact SRS message
 *   4. draft       – sanitising of the refresh-recovery draft
 *   5. QuestionBankService – REST calls + save orchestration + draft storage
 *
 * Hierarchy:
 *   Course -> Organize Section -> Question Bank -> Question Section (Q1, Q2 ...) -> Questions
 * "SectionVm" in this file is a QUESTION SECTION inside one Question Bank.
 */

// ═══════════════════════════ 1. MAPPER ═══════════════════════════
const TYPE_TO_API: Record<QuestionType, ApiQuestionType> = {
  single: 'SINGLE_ANSWER',
  multiple: 'MULTIPLE_ANSWER',
  short: 'SHORT_TEXT',
};

const TYPE_FROM_API: Record<ApiQuestionType, QuestionType> = {
  SINGLE_ANSWER: 'single',
  MULTIPLE_ANSWER: 'multiple',
  SHORT_TEXT: 'short',
};

export function newClientId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createOption(text = ''): OptionVm {
  return { clientId: newClientId(), text, correct: false, points: 0 };
}

export function createQuestion(type: QuestionType): QuestionVm {
  return {
    clientId: newClientId(),
    id: null,
    version: null,
    persistedHidden: false,
    dirty: true,
    text: '',
    type,
    scoringType: 'basic',
    correctScore: 0,
    incorrectScore: 0,
    correctFeedback: '',
    incorrectFeedback: '',
    expectedAnswer: '',
    hidden: false,
    // SRS: options empty by default. Two blank rows = backend minimum.
    options: type === 'short' ? [] : [createOption(), createOption()],
  };
}

export function createSection(name: string): SectionVm {
  return {
    clientId: newClientId(),
    id: null,
    serverName: null,
    name,
    score: null,
    feedback: '',
    serverScore: null,
    serverFeedback: '',
    questions: [],
    serverQuestionIds: [],
  };
}

export function toSectionVm(section: ApiSection, questions: ApiQuestionResponse[]): SectionVm {
  const score = section.score ?? null;
  const feedback = section.feedback ?? '';
  return {
    clientId: newClientId(),
    id: section.id,
    serverName: section.name,
    name: section.name,
    score,
    feedback,
    serverScore: score,
    serverFeedback: feedback,
    questions: questions.map(fromQuestionResponse),
    serverQuestionIds: questions.map(q => q.id),
  };
}

export function toSectionRequest(s: SectionVm): ApiSectionRequest {
  return {
    name: s.name.trim(),
    score: s.score,
    feedback: blankToNull(s.feedback),
  };
}

export function fromQuestionResponse(r: ApiQuestionResponse): QuestionVm {
  return {
    clientId: newClientId(),
    id: r.id,
    version: r.version,
    persistedHidden: r.hidden,
    dirty: false,
    text: r.text,
    type: TYPE_FROM_API[r.type],
    scoringType: r.scoringType === 'ADVANCED' ? 'advanced' : 'basic',
    correctScore: r.correctScore,
    incorrectScore: r.incorrectScore,
    correctFeedback: r.correctFeedback ?? '',
    incorrectFeedback: r.incorrectFeedback ?? '',
    expectedAnswer: r.expectedAnswer ?? '',
    hidden: r.hidden,
    options: [...r.options]
      .sort((a, b) => a.order - b.order)
      .map(o => ({ clientId: newClientId(), text: o.text, correct: o.correct, points: o.score })),
  };
}

export function toQuestionRequest(q: QuestionVm): ApiQuestionRequest {
  const isShort = q.type === 'short';
  const advanced = !isShort && q.scoringType === 'advanced';
  return {
    text: q.text.trim(),
    type: TYPE_TO_API[q.type],
    scoringType: advanced ? 'ADVANCED' : 'BASIC',
    correctScore: q.correctScore,
    incorrectScore: q.incorrectScore,
    correctFeedback: blankToNull(q.correctFeedback),
    incorrectFeedback: blankToNull(q.incorrectFeedback),
    expectedAnswer: isShort ? blankToNull(q.expectedAnswer) : null,
    options: isShort
      ? []
      : q.options.map(o => ({ text: o.text.trim(), correct: o.correct, score: advanced ? o.points : 0 })),
    version: q.version, // always sent for existing rows so the server can detect concurrent edits
  };
}

/** Deep copy with brand-new identity: used by duplicate / copy / paste / duplicate section. */
export function cloneQuestionAsNew(q: QuestionVm): QuestionVm {
  const copy = structuredClone(q);
  copy.clientId = newClientId();
  copy.id = null;
  copy.version = null;
  copy.persistedHidden = false;
  copy.dirty = true;
  copy.options.forEach(o => (o.clientId = newClientId()));
  return copy;
}

export function cloneSectionAsNew(s: SectionVm): SectionVm {
  return {
    clientId: newClientId(),
    id: null,
    serverName: null,
    name: `${s.name} Copy`.slice(0, LIMITS.sectionNameChars),
    score: s.score,
    feedback: s.feedback,
    serverScore: null,
    serverFeedback: '',
    questions: s.questions.map(cloneQuestionAsNew),
    serverQuestionIds: [],
  };
}

/** The backend rejects duplicate option texts, so "Duplicate option" must produce a unique text. */
export function uniqueCopyText(text: string, existing: readonly string[]): string {
  const taken = new Set(existing.map(t => t.trim().toLowerCase()));
  const base = text.trim();
  for (let n = 1; n < 100; n++) {
    const suffix = n === 1 ? ' (copy)' : ` (copy ${n})`;
    const candidate = base.slice(0, LIMITS.optionChars - suffix.length) + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}

/** Section names must be unique inside a bank, so Copy / Paste / Duplicate need a free "Name Copy" name. */
export function uniqueSectionName(name: string, existing: readonly string[]): string {
  const taken = new Set(existing.map(n => n.trim().toLowerCase()));
  const base = name.trim();
  for (let n = 1; n < 1000; n++) {
    const suffix = n === 1 ? ' Copy' : ` Copy ${n}`;
    const candidate = base.slice(0, LIMITS.sectionNameChars - suffix.length) + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}

export function isNumber(v: number | null | undefined): v is number {
  return typeof v === 'number';
}

function blankToNull(v: string): string | null {
  const t = v?.trim();
  return t ? t : null;
}

// ═══════════════════════════ 2. VALIDATOR ═══════════════════════════
export interface ValidationIssue {
  sectionClientId: string;
  questionClientId: string | null;
  message: string;
}

const isValidScore = (v: unknown): boolean =>
  typeof v === 'number' && Number.isInteger(v) && v >= LIMITS.minScore && v <= LIMITS.maxScore;

/** NEW: Question Bank name (the activity added inside an organize section). Mirrors QuestionBankService.validateName. */
export function validateBankName(raw: string): string | null {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return 'Question Bank Name is required.';
  if (name.length < LIMITS.bankNameMinChars || name.length > LIMITS.bankNameChars) {
    return `Question Bank Name must be between ${LIMITS.bankNameMinChars} and ${LIMITS.bankNameChars} characters.`;
  }
  return null;
}

/** Mirrors QuestionValidator.java so the user gets instant feedback and never sees a 400 for a known rule. */
export function validateQuestion(q: QuestionVm): string | null {
  const text = q.text?.trim() ?? '';
  if (!text) return 'Question is required.';
  if (text.length > LIMITS.questionChars) return 'Question must not exceed 500 characters.';

  if (!isValidScore(q.correctScore) || !isValidScore(q.incorrectScore)) {
    return 'Score must be between 0 and 100.';
  }
  if ((q.correctFeedback?.trim().length ?? 0) > LIMITS.feedbackChars ||
      (q.incorrectFeedback?.trim().length ?? 0) > LIMITS.feedbackChars) {
    return 'Feedback must not exceed 500 characters.';
  }

  if (q.type === 'short') {
    if ((q.expectedAnswer?.trim().length ?? 0) > LIMITS.answerChars) {
      return 'Answer must not exceed 500 characters.';
    }
    return null;
  }

  if (q.options.length < LIMITS.minOptions || q.options.length > LIMITS.maxOptions) {
    return `A question must have between ${LIMITS.minOptions} and ${LIMITS.maxOptions} options.`;
  }

  const seen = new Set<string>();
  let correctCount = 0;
  for (const o of q.options) {
    const t = o.text?.trim() ?? '';
    if (!t) return 'Option text is required.';
    if (t.length > LIMITS.optionChars) return 'Option must not exceed 200 characters.';
    if (!seen.add(t.toLowerCase())) return 'Duplicate options are not allowed.';
    if (q.scoringType === 'advanced' && !isValidScore(o.points)) return 'Score must be between 0 and 100.';
    if (o.correct) correctCount++;
  }

  if (q.type === 'single' && correctCount !== 1) {
    return 'A Single Answer question must have exactly one correct option.';
  }
  if (q.type === 'multiple' && correctCount < 1) {
    return 'A Multiple Answer question must have at least one correct option.';
  }
  return null;
}

/**
 * Validates every QUESTION SECTION of the bank (names, section points, count caps, then each question).
 * Returns the FIRST problem found (with its location) or null when the whole bank is valid.
 */
export function validateSections(sections: readonly SectionVm[]): ValidationIssue | null {
  const names = new Set<string>();

  // backend: QuestionSectionService.MAX_SECTIONS_PER_BANK
  if (sections.length > LIMITS.maxSectionsPerBank) {
    return {
      sectionClientId: sections[LIMITS.maxSectionsPerBank].clientId,
      questionClientId: null,
      message: `A question bank can contain at most ${LIMITS.maxSectionsPerBank} sections.`,
    };
  }

  for (let si = 0; si < sections.length; si++) {
    const section = sections[si];
    const name = section.name?.trim() ?? '';

    if (!name) return { sectionClientId: section.clientId, questionClientId: null, message: `Section ${si + 1}: Section name is required.` };
    // backend: QuestionSectionService.validateName -> 3..100
    if (name.length < LIMITS.sectionNameMinChars || name.length > LIMITS.sectionNameChars) {
      return {
        sectionClientId: section.clientId,
        questionClientId: null,
        message: `${name}: Section Name must be between ${LIMITS.sectionNameMinChars} and ${LIMITS.sectionNameChars} characters.`,
      };
    }
    if (!names.add(name.toLowerCase())) {
      return { sectionClientId: section.clientId, questionClientId: null, message: `Section name "${name}" is already used.` };
    }
    // "Section points" panel
    if (section.score !== null && !isValidScore(section.score)) {
      return { sectionClientId: section.clientId, questionClientId: null, message: `${name}: Section score must be between 0 and 100.` };
    }
    if ((section.feedback?.trim().length ?? 0) > LIMITS.feedbackChars) {
      return { sectionClientId: section.clientId, questionClientId: null, message: `${name}: Section feedback must not exceed 500 characters.` };
    }
    if (section.questions.length > LIMITS.maxQuestionsPerSection) {
      return { sectionClientId: section.clientId, questionClientId: null, message: `A section can contain at most ${LIMITS.maxQuestionsPerSection} questions.` };
    }

    for (let qi = 0; qi < section.questions.length; qi++) {
      const q = section.questions[qi];
      const problem = validateQuestion(q);
      if (problem) {
        return { sectionClientId: section.clientId, questionClientId: q.clientId, message: `${name}, Question ${qi + 1}: ${problem}` };
      }
    }
  }
  return null;
}

// ═══════════════════════════ 3. ERRORS ═══════════════════════════
export type UiErrorKind = 'offline' | 'session' | 'conflict' | 'forbidden' | 'client' | 'server';
export type ErrorContext = 'save' | 'load' | 'import' | 'export' | 'action';

export interface UiError {
  kind: UiErrorKind;
  message: string;
}

/**
 * Error for the NAME-based endpoints (Question Bank + Question Section).
 * Their 409 means "duplicate name" (a normal field error), whereas a 409 on a Question
 * means optimistic-lock ("someone else edited it"). toUiError tells them apart by this class
 * (it is detected by shape: an Error that carries a numeric `status`).
 */
export class NameApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'NameApiError';
  }
}

/** HttpErrorResponse -> NameApiError (anything else is passed through untouched). */
export function toNameApiError(err: unknown): unknown {
  return err instanceof HttpErrorResponse ? new NameApiError(readServerMessage(err) ?? '', err.status) : err;
}

interface ErrorInfo {
  status: number;
  message: string | null;
  /** true when the failing call was a Question Bank / Question Section (name-based) endpoint. */
  fromSectionApi: boolean;
}

/**
 * Converts any failure into the exact wording required by the SRS edge cases.
 * Understands BOTH raw HttpErrorResponse (question calls) and NameApiError
 * (bank / question-section calls).
 *
 * Server text is only shown for 4xx/501 (business or validation messages) – never for 5xx.
 */
export function toUiError(err: unknown, context: ErrorContext = 'action'): UiError {
  const info = describe(err);
  if (!info) return { kind: 'server', message: MESSAGES.server };

  const { status, message, fromSectionApi } = info;

  if (status === 0) {
    return { kind: 'offline', message: context === 'save' ? MESSAGES.offlineSave : MESSAGES.offlineGeneric };
  }
  if (status === 401) return { kind: 'session', message: MESSAGES.sessionExpired };
  if (status === 403) return { kind: 'forbidden', message: MESSAGES.forbidden };
  if (status === 413) return { kind: 'client', message: MESSAGES.fileTooLarge };

  if (status === 409) {
    // Question 409 = optimistic-lock (someone else edited) → offer "Reload latest".
    // Bank / Question Section 409 = duplicate name → a normal field error, nothing to reload.
    return fromSectionApi
      ? { kind: 'client', message: message ?? MESSAGES.server }
      : { kind: 'conflict', message: message ?? MESSAGES.conflict };
  }

  if ((status >= 400 && status < 500) || status === 501) {
    return { kind: 'client', message: message ?? MESSAGES.server };
  }
  return { kind: 'server', message: MESSAGES.server };
}

function describe(err: unknown): ErrorInfo | null {
  if (err instanceof HttpErrorResponse) {
    return { status: err.status, message: readServerMessage(err), fromSectionApi: false };
  }
  if (err instanceof Error) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number') {
      return { status, message: clipMessage(err.message) || null, fromSectionApi: true };
    }
  }
  return null;
}

function readServerMessage(err: HttpErrorResponse): string | null {
  const body: unknown = err.error;
  if (!body || typeof body !== 'object' || body instanceof Blob) return null;

  const { message, data } = body as { message?: unknown; data?: unknown };

  // Bean-validation failures arrive as { data: { field: "message" } } – show the first field message.
  if (data && typeof data === 'object') {
    const first = Object.values(data as Record<string, unknown>).find(v => typeof v === 'string');
    if (typeof first === 'string') return clipMessage(first);
  }
  return typeof message === 'string' && message.trim() ? clipMessage(message) : null;
}

const clipMessage = (s: string): string => s.trim().slice(0, 300);

// ═══════════════════════════ 4. DRAFT SANITISING ═══════════════════════════
export interface DraftPayload {
  selectedType: SelectedType;
  baselineSectionIds: number[];
  sections: SectionVm[];
}

const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const toScore = (v: unknown): number =>
  typeof v === 'number' && Number.isInteger(v) ? Math.min(LIMITS.maxScore, Math.max(LIMITS.minScore, v)) : 0;
const toScoreOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? toScore(v) : null);
const toId = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
const isType = (v: unknown): v is QuestionType => v === 'single' || v === 'multiple' || v === 'short';
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const ids = (v: unknown): number[] =>
  (Array.isArray(v) ? v : []).map(toId).filter((id): id is number => id !== null);

/** Everything read back from sessionStorage is untrusted: re-validate shape, types and lengths. */
function sanitizeDraft(raw: string): DraftPayload | null {
  const data = rec(JSON.parse(raw));
  if (data['v'] !== 1 || !Array.isArray(data['sections'])) return null;
  const selected = data['selectedType'];
  return {
    selectedType: selected === 'mixed' || isType(selected) ? selected : null,
    baselineSectionIds: ids(data['baselineSectionIds']),
    sections: (data['sections'] as unknown[]).slice(0, LIMITS.maxSectionsPerBank).map(sanitizeSection),
  };
}

function sanitizeSection(raw: unknown): SectionVm {
  const s = rec(raw);
  return {
    clientId: newClientId(),
    id: toId(s['id']),
    serverName: typeof s['serverName'] === 'string' ? s['serverName'] : null,
    name: clip(s['name'], LIMITS.sectionNameChars),
    score: toScoreOrNull(s['score']),
    feedback: clip(s['feedback'], LIMITS.feedbackChars),
    serverScore: toScoreOrNull(s['serverScore']),
    serverFeedback: clip(s['serverFeedback'], LIMITS.feedbackChars),
    serverQuestionIds: ids(s['serverQuestionIds']),
    questions: (Array.isArray(s['questions']) ? (s['questions'] as unknown[]) : [])
      .slice(0, LIMITS.maxQuestionsPerSection)
      .map(sanitizeQuestion)
      .filter((q): q is QuestionVm => q !== null),
  };
}

function sanitizeQuestion(raw: unknown): QuestionVm | null {
  const q = rec(raw);
  if (!isType(q['type'])) return null;
  const type = q['type'];
  const options: OptionVm[] =
    type === 'short'
      ? []
      : (Array.isArray(q['options']) ? (q['options'] as unknown[]) : []).slice(0, LIMITS.maxOptions).map(o => {
          const opt = rec(o);
          return {
            clientId: newClientId(),
            text: clip(opt['text'], LIMITS.optionChars),
            correct: opt['correct'] === true,
            points: toScore(opt['points']),
          };
        });

  return {
    clientId: newClientId(),
    id: toId(q['id']),
    version: typeof q['version'] === 'number' ? (q['version'] as number) : null,
    persistedHidden: q['persistedHidden'] === true,
    dirty: true,
    text: clip(q['text'], LIMITS.questionChars),
    type,
    scoringType: q['scoringType'] === 'advanced' ? 'advanced' : 'basic',
    correctScore: toScore(q['correctScore']),
    incorrectScore: toScore(q['incorrectScore']),
    correctFeedback: clip(q['correctFeedback'], LIMITS.feedbackChars),
    incorrectFeedback: clip(q['incorrectFeedback'], LIMITS.feedbackChars),
    expectedAnswer: clip(q['expectedAnswer'], LIMITS.answerChars),
    hidden: q['hidden'] === true,
    options,
  };
}

// ═══════════════════════════ 5. SERVICE ═══════════════════════════
type Task = () => Observable<unknown>;

const sameOrder = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Single entry point for the Question Bank screen.
 *
 *  - REST wrappers for QuestionBankController / QuestionSectionController / QuestionController
 *    (JWT is attached by your existing authInterceptor).
 *  - loadBank / saveBank: turn the editor state into the minimal sequential set of REST calls.
 *    Calls run one after another (the backend assigns order + versions). ids / versions are
 *    written back as each call succeeds, so pressing Save again after a failure never duplicates.
 *  - draft storage in sessionStorage (SRS edge case #2: refresh before saving).
 *
 * URL shapes:
 *   banks      /api/courses/{c}/sections/{s}/question-banks[/{b}]
 *   q-sections /api/courses/{c}/sections/{s}/question-banks/{b}/question-sections[/{qs}]
 *   questions  /api/courses/{c}/sections/{s}/question-banks/{b}/question-sections/{qs}/questions[/{q}]
 */
@Injectable({ providedIn: 'root' })
export class QuestionBankService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/api`;

  // ───────────── URL builders ─────────────
  private bankUrl(courseId: number, sectionId: number, suffix = ''): string {
    return `${this.base}/courses/${courseId}/sections/${sectionId}/question-banks${suffix}`;
  }

  private qsUrl(scope: BankScope, suffix = ''): string {
    return this.bankUrl(scope.courseId, scope.sectionId, `/${scope.bankId}/question-sections${suffix}`);
  }

  private qUrl(scope: BankScope, questionSectionId: number, suffix = ''): string {
    return this.qsUrl(scope, `/${questionSectionId}/questions${suffix}`);
  }

  /** Bank / question-section calls: tag failures as NameApiError (409 = duplicate name, not optimistic lock). */
  private named<T>(source$: Observable<T>): Observable<T> {
    return source$.pipe(catchError(err => throwError(() => toNameApiError(err))));
  }

  // ───────────── REST: question banks (the activity inside an organize section) ─────────────
  listBanks(courseId: number, sectionId: number): Observable<ApiBankResponse[]> {
    return this.named(
      this.http.get<ApiResponse<ApiBankResponse[]>>(this.bankUrl(courseId, sectionId)).pipe(map(r => r.data)),
    );
  }

  getBank(scope: BankScope): Observable<ApiBankResponse> {
    return this.named(
      this.http
        .get<ApiResponse<ApiBankResponse>>(this.bankUrl(scope.courseId, scope.sectionId, `/${scope.bankId}`))
        .pipe(map(r => r.data)),
    );
  }

  /** "Add Activity -> Question Bank": creates the bank only (empty). Question sections are added from the editor. */
  createBank(courseId: number, sectionId: number, name: string): Observable<ApiBankResponse> {
    return this.named(
      this.http
        .post<ApiResponse<ApiBankResponse>>(this.bankUrl(courseId, sectionId), { name: name.trim() })
        .pipe(map(r => r.data)),
    );
  }

  renameBank(scope: BankScope, name: string): Observable<ApiBankResponse> {
    return this.named(
      this.http
        .put<ApiResponse<ApiBankResponse>>(this.bankUrl(scope.courseId, scope.sectionId, `/${scope.bankId}`), { name: name.trim() })
        .pipe(map(r => r.data)),
    );
  }

  /** DB cascade removes the bank's question sections, questions and options. */
  deleteBank(scope: BankScope): Observable<void> {
    return this.named(
      this.http
        .delete<ApiResponse<void>>(this.bankUrl(scope.courseId, scope.sectionId, `/${scope.bankId}`))
        .pipe(map(() => undefined)),
    );
  }

  // ───────────── REST: question sections (Q1, Q2 ... inside one bank) ─────────────
  fetchQuestionSections(scope: BankScope): Observable<ApiQuestionSectionResponse[]> {
    return this.named(this.http.get<ApiResponse<ApiQuestionSectionResponse[]>>(this.qsUrl(scope)).pipe(map(r => r.data)));
  }

  private apiCreateSection(scope: BankScope, body: ApiSectionRequest): Observable<ApiQuestionSectionResponse> {
    return this.named(
      this.http.post<ApiResponse<ApiQuestionSectionResponse>>(this.qsUrl(scope), body).pipe(map(r => r.data)),
    );
  }

  private apiUpdateSection(scope: BankScope, questionSectionId: number, body: ApiSectionRequest): Observable<ApiQuestionSectionResponse> {
    return this.named(
      this.http
        .put<ApiResponse<ApiQuestionSectionResponse>>(this.qsUrl(scope, `/${questionSectionId}`), body)
        .pipe(map(r => r.data)),
    );
  }

  private apiDeleteSection(scope: BankScope, questionSectionId: number): Observable<void> {
    return this.named(
      this.http.delete<ApiResponse<void>>(this.qsUrl(scope, `/${questionSectionId}`)).pipe(map(() => undefined)),
    );
  }

  /**
   * NOTE: QuestionSectionController currently has NO reorder endpoint. This call targets
   * PATCH .../question-sections/reorder with { items: [{ questionSectionId, newOrder }] }
   * (same shape as the question reorder). It is only sent when the section order really changed.
   */
  private apiReorderSections(scope: BankScope, orderedIds: readonly number[]): Observable<void> {
    const items = orderedIds.map((questionSectionId, i) => ({ questionSectionId, newOrder: i + 1 }));
    return this.named(
      this.http.patch<ApiResponse<unknown>>(this.qsUrl(scope, '/reorder'), { items }).pipe(map(() => undefined)),
    );
  }

  // ───────────── REST: questions (all take the QUESTION SECTION id) ─────────────
  fetchQuestions(scope: BankScope, questionSectionId: number): Observable<ApiQuestionResponse[]> {
    return this.http.get<ApiResponse<ApiQuestionResponse[]>>(this.qUrl(scope, questionSectionId)).pipe(map(r => r.data));
  }

  /** "Existing Questions": same Question Bank, OTHER question sections. */
  searchExisting(scope: BankScope, questionSectionId: number, keyword: string, page: number, size: number): Observable<ApiExistingPage> {
    const params = new HttpParams().set('keyword', keyword).set('page', page).set('size', size); // HttpParams encodes values
    return this.http
      .get<ApiResponse<ApiExistingPage>>(this.qUrl(scope, questionSectionId, '/existing'), { params })
      .pipe(map(r => r.data));
  }

  addExisting(scope: BankScope, questionSectionId: number, questionIds: readonly number[]): Observable<ApiQuestionResponse[]> {
    return this.http
      .post<ApiResponse<ApiQuestionResponse[]>>(this.qUrl(scope, questionSectionId, '/existing'), { questionIds })
      .pipe(map(r => r.data));
  }

  importFile(scope: BankScope, questionSectionId: number, file: File): Observable<ApiImportResult> {
    const form = new FormData();
    form.append('file', file, file.name); // do NOT set Content-Type: the browser adds the multipart boundary
    return this.http
      .post<ApiResponse<ApiImportResult>>(this.qUrl(scope, questionSectionId, '/import'), form)
      .pipe(map(r => r.data));
  }

  exportCsv(scope: BankScope, questionSectionId: number): Observable<HttpResponse<Blob>> {
    return this.http.get(this.qUrl(scope, questionSectionId, '/export'), { observe: 'response', responseType: 'blob' });
  }

  private apiCreate(scope: BankScope, questionSectionId: number, body: ApiQuestionRequest, idempotencyKey: string): Observable<ApiQuestionResponse> {
    return this.http
      .post<ApiResponse<ApiQuestionResponse>>(this.qUrl(scope, questionSectionId), body, {
        headers: new HttpHeaders({ 'Idempotency-Key': idempotencyKey }), // = question.clientId, stable across retries
      })
      .pipe(map(r => r.data));
  }

  private apiUpdate(scope: BankScope, questionSectionId: number, questionId: number, body: ApiQuestionRequest): Observable<ApiQuestionResponse> {
    return this.http
      .put<ApiResponse<ApiQuestionResponse>>(this.qUrl(scope, questionSectionId, `/${questionId}`), body)
      .pipe(map(r => r.data));
  }

  private apiRemove(scope: BankScope, questionSectionId: number, questionId: number): Observable<void> {
    return this.http
      .delete<ApiResponse<void>>(this.qUrl(scope, questionSectionId, `/${questionId}`))
      .pipe(map(() => undefined));
  }

  private apiSetHidden(scope: BankScope, questionSectionId: number, questionId: number, hidden: boolean): Observable<ApiQuestionResponse> {
    return this.http
      .patch<ApiResponse<ApiQuestionResponse>>(this.qUrl(scope, questionSectionId, `/${questionId}/visibility`), { hidden })
      .pipe(map(r => r.data));
  }

  private apiReorder(scope: BankScope, questionSectionId: number, orderedIds: readonly number[]): Observable<void> {
    const items = orderedIds.map((questionId, i) => ({ questionId, newOrder: i + 1 }));
    return this.http
      .patch<ApiResponse<unknown>>(this.qUrl(scope, questionSectionId, '/reorder'), { items })
      .pipe(map(() => undefined));
  }

  // ───────────── load / save orchestration ─────────────
  /** Loads every question section of the bank, each with its own questions. */
  loadBank(scope: BankScope): Observable<SectionVm[]> {
    return this.fetchQuestionSections(scope).pipe(
      // explicit sort: the reorder baseline relies on server order == sectionOrder
      map(list => [...list].sort((a, b) => a.sectionOrder - b.sectionOrder)),
      concatMap(list =>
        list.length === 0
          ? of<SectionVm[]>([])
          : forkJoin(list.map(s => this.fetchQuestions(scope, s.id).pipe(map(qs => toSectionVm(s, qs))))),
      ),
    );
  }

  /** Emits the final question-section-id order once everything is stored. */
  saveBank(scope: BankScope, sections: readonly SectionVm[], baselineSectionIds: readonly number[]): Observable<number[]> {
    const createdSectionIds: number[] = [];
    const keep = new Set(sections.map(s => s.id).filter(isNumber));
    const survivors = baselineSectionIds.filter(id => keep.has(id));
    const tasks: Task[] = [];

    for (const id of baselineSectionIds) {
      if (!keep.has(id)) tasks.push(() => this.apiDeleteSection(scope, id));
    }
    for (const section of sections) {
      tasks.push(() => this.persistSection(scope, section, createdSectionIds));
    }
    tasks.push(() => this.persistSectionOrder(scope, sections, survivors, createdSectionIds));

    return this.run(tasks).pipe(map(() => sections.map(s => s.id as number)));
  }

  private persistSection(scope: BankScope, section: SectionVm, created: number[]): Observable<unknown> {
    return this.ensureSection(scope, section, created).pipe(
      concatMap(questionSectionId => this.persistQuestions(scope, questionSectionId, section)),
    );
  }

  /** Creates the section, or updates it when its name / score / feedback changed. */
  private ensureSection(scope: BankScope, section: SectionVm, created: number[]): Observable<number> {
    const body = toSectionRequest(section);
    const id = section.id;

    if (id === null) {
      return this.apiCreateSection(scope, body).pipe(
        tap(r => {
          section.id = r.id;
          this.markSectionSynced(section, body);
          created.push(r.id);
        }),
        map(r => r.id),
      );
    }

    const changed =
      body.name !== section.serverName ||
      body.score !== section.serverScore ||
      (body.feedback ?? '') !== section.serverFeedback.trim();

    if (changed) {
      return this.apiUpdateSection(scope, id, body).pipe(
        tap(() => this.markSectionSynced(section, body)),
        map(() => id),
      );
    }
    return of(id);
  }

  /** Remember what the server now has, so the next Save only sends real changes. */
  private markSectionSynced(section: SectionVm, sent: ApiSectionRequest): void {
    section.serverName = sent.name;
    section.serverScore = sent.score;
    section.serverFeedback = sent.feedback ?? '';
  }

  private persistSectionOrder(scope: BankScope, sections: readonly SectionVm[], survivors: number[], created: number[]): Observable<unknown> {
    const intended = sections.map(s => s.id).filter(isNumber);
    const serverOrderNow = [...survivors, ...created];
    if (intended.length < 2 || sameOrder(intended, serverOrderNow)) return of(null);
    // Needs the FULL list in the intended order – `intended` is exactly that.
    return this.apiReorderSections(scope, intended);
  }

  private persistQuestions(scope: BankScope, questionSectionId: number, section: SectionVm): Observable<unknown> {
    const tasks: Task[] = [];
    const alive = new Set(section.questions.map(q => q.id).filter(isNumber));

    for (const id of section.serverQuestionIds.filter(x => !alive.has(x))) {
      tasks.push(() =>
        this.apiRemove(scope, questionSectionId, id).pipe(
          tap(() => (section.serverQuestionIds = section.serverQuestionIds.filter(x => x !== id))),
        ),
      );
    }
    for (const q of section.questions) {
      if (q.id === null) tasks.push(() => this.persistNewQuestion(scope, questionSectionId, section, q));
      else if (q.dirty || q.hidden !== q.persistedHidden) tasks.push(() => this.persistQuestionUpdate(scope, questionSectionId, q));
    }
    tasks.push(() => this.persistQuestionOrder(scope, questionSectionId, section));
    return this.run(tasks);
  }

  private persistNewQuestion(scope: BankScope, questionSectionId: number, section: SectionVm, q: QuestionVm): Observable<unknown> {
    return this.apiCreate(scope, questionSectionId, toQuestionRequest(q), q.clientId).pipe(
      tap(r => {
        q.id = r.id;
        this.applyServerState(q, r);
        section.serverQuestionIds = [...section.serverQuestionIds, r.id];
      }),
      concatMap(r => (q.hidden ? this.syncHidden(scope, questionSectionId, q, r.id) : of(r))),
    );
  }

  private persistQuestionUpdate(scope: BankScope, questionSectionId: number, q: QuestionVm): Observable<unknown> {
    const id = q.id as number;
    const put$: Observable<unknown> = q.dirty
      ? this.apiUpdate(scope, questionSectionId, id, toQuestionRequest(q)).pipe(tap(r => this.applyServerState(q, r)))
      : of(null);
    return put$.pipe(
      concatMap(() => (q.hidden !== q.persistedHidden ? this.syncHidden(scope, questionSectionId, q, id) : of(null))),
    );
  }

  private syncHidden(scope: BankScope, questionSectionId: number, q: QuestionVm, id: number): Observable<ApiQuestionResponse> {
    return this.apiSetHidden(scope, questionSectionId, id, q.hidden).pipe(tap(r => this.applyServerState(q, r)));
  }

  private persistQuestionOrder(scope: BankScope, questionSectionId: number, section: SectionVm): Observable<unknown> {
    const intended = section.questions.map(q => q.id).filter(isNumber);
    if (intended.length < 2 || sameOrder(intended, section.serverQuestionIds)) return of(null);
    return this.apiReorder(scope, questionSectionId, intended).pipe(tap(() => (section.serverQuestionIds = intended)));
  }

  /** Only server-owned fields are copied back – never overwrite what the user typed. */
  private applyServerState(q: QuestionVm, r: ApiQuestionResponse): void {
    q.version = r.version;
    q.persistedHidden = r.hidden;
    q.dirty = false;
  }

  private run(tasks: readonly Task[]): Observable<void> {
    return from(tasks).pipe(
      concatMap(task => task()),
      toArray(),
      map(() => undefined),
    );
  }

  // ───────────── concurrent edit (SRS edge case 6) ─────────────
  /**
   * Another user changed the same questions (409). Pull the server's latest versions so the user's own
   * changes can be saved on top of them, and pick up anything the other user added.
   */
  refreshFromServer(scope: BankScope, sections: readonly SectionVm[]): Observable<void> {
    const saved = sections.filter(s => s.id !== null);
    if (saved.length === 0) return of(undefined);
    return forkJoin(
      saved.map(section => this.fetchQuestions(scope, section.id as number).pipe(tap(latest => this.mergeLatest(section, latest)))),
    ).pipe(map(() => undefined));
  }

  private mergeLatest(section: SectionVm, latest: ApiQuestionResponse[]): void {
    const byId = new Map(latest.map(r => [r.id, r]));
    const known = new Set<number>([...section.serverQuestionIds, ...section.questions.map(q => q.id).filter(isNumber)]);

    for (const q of section.questions) {
      if (q.id === null) continue;
      const r = byId.get(q.id);
      if (r) {
        q.version = r.version; // the edit is re-sent with the fresh version (edited questions only)
        q.persistedHidden = r.hidden;
      } else {
        // deleted by the other user: keep the user's work and create it again on the next save
        q.id = null;
        q.version = null;
        q.persistedHidden = false;
        q.dirty = true;
      }
    }
    // questions the other user added: show them, never drop them
    section.questions.push(...latest.filter(r => !known.has(r.id)).map(fromQuestionResponse));
    section.serverQuestionIds = latest.map(r => r.id);
  }

  // ───────────── draft (sessionStorage – dies with the tab, never localStorage) ─────────────
  /** One draft per Question Bank (course + organize section + bank). */
  private draftKey(scope: BankScope): string {
    return `qb:draft:v2:${scope.courseId}:${scope.sectionId}:${scope.bankId}`;
  }

  saveDraft(scope: BankScope, payload: DraftPayload): boolean {
    try {
      sessionStorage.setItem(this.draftKey(scope), JSON.stringify({ v: 1, savedAt: new Date().toISOString(), ...payload }));
      return true;
    } catch {
      return false; // quota / private mode – editor keeps working, only refresh-recovery is lost
    }
  }

  loadDraft(scope: BankScope): DraftPayload | null {
    try {
      const raw = sessionStorage.getItem(this.draftKey(scope));
      return raw ? sanitizeDraft(raw) : null;
    } catch {
      this.clearDraft(scope);
      return null;
    }
  }

  clearDraft(scope: BankScope): void {
    try {
      sessionStorage.removeItem(this.draftKey(scope));
    } catch {
      /* ignore */
    }
  }
}