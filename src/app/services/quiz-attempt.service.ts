import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { ApiResponse } from '../course-module/course.model';
import { ApiBankResponse } from '../course-module/question-bank.model';

export type QuizQuestionType = 'SINGLE_ANSWER' | 'MULTIPLE_ANSWER' | 'SHORT_TEXT';

export interface QuizOption {
  id: number;
  text: string;
}

/** The learner's saved answer (empty optionIds / null text = not answered). */
export interface QuizAnswer {
  optionIds: number[];
  text: string | null;
}

export interface QuizQuestion {
  id: number;
  text: string;
  type: QuizQuestionType;
  options: QuizOption[];
  answer: QuizAnswer;
}

/** One "Question Section" of the bank = one step of the Sections bar. */
export interface QuizSection {
  id: number;
  name: string;
  /** true after "Submit Section" - the answers of this section are locked. */
  submitted: boolean;
  questions: QuizQuestion[];
}

export interface QuizAttempt {
  /** null while NOT_STARTED */
  attemptId: number | null;
  bankName: string;
  courseName: string;
  /** Course thumbnail for the "Ready to take the quiz?" page (may be null). */
  thumbnailUrl: string | null;
  /** NOT_STARTED = intro page, IN_PROGRESS = quiz, SUBMITTED = score page */
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED';
  /** 0 while NOT_STARTED, otherwise 1, 2, 3... */
  attemptNumber: number;
  maxAttempts: number;
  /** Next unit (course section) for "Go to next unit"; null on the last unit. */
  nextSectionId: number | null;
  /** ISO date-time the quiz was finished (SUBMITTED only). */
  submittedAt: string | null;
  /** Seconds since the attempt started (frozen once submitted). */
  elapsedSeconds: number;
  /** Only after the quiz is finished. */
  score: number | null;
  maxScore: number | null;
  sections: QuizSection[];
}

export interface ReviewOption {
  id: number;
  text: string;
  correct: boolean;
  selected: boolean;
}

export interface ReviewQuestion {
  id: number;
  sectionName: string;
  text: string;
  type: QuizQuestionType;
  /** true only when the learner answered it fully right */
  correct: boolean;
  answered: boolean;
  options: ReviewOption[];
  givenText: string | null;
  expectedAnswer: string | null;
  feedback: string | null;
}

export interface QuizReview {
  correctCount: number;
  incorrectCount: number;
  questions: ReviewQuestion[];
}

/** Learner "Attempt Quiz". The server never sends correct answers or scores of single questions. */
@Injectable({ providedIn: 'root' })
export class QuizAttemptService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/courses`;

  private url(courseId: number, sectionId: number, bankId: number): string {
    return `${this.baseUrl}/${courseId}/sections/${sectionId}/question-banks/${bankId}/attempt`;
  }

  /** Quizzes of a course section for a learner (the instructor list needs the organize permission). */
  listForSection(courseId: number, sectionId: number): Observable<ApiBankResponse[]> {
    return this.http
      .get<ApiResponse<ApiBankResponse[]>>(`${this.baseUrl}/${courseId}/sections/${sectionId}/quizzes`)
      .pipe(map((res) => res.data));
  }

  /** Opens the page WITHOUT starting the timer: intro (NOT_STARTED), resume (IN_PROGRESS) or score (SUBMITTED). */
  open(courseId: number, sectionId: number, bankId: number): Observable<QuizAttempt> {
    return this.http
      .get<ApiResponse<QuizAttempt>>(this.url(courseId, sectionId, bankId))
      .pipe(map((res) => res.data));
  }

  /** "Start Quiz" - the timer starts now. */
  start(courseId: number, sectionId: number, bankId: number): Observable<QuizAttempt> {
    return this.http
      .post<ApiResponse<QuizAttempt>>(`${this.url(courseId, sectionId, bankId)}/start`, {})
      .pipe(map((res) => res.data));
  }

  /** "Retest" - a new attempt while attempts are left. */
  retest(courseId: number, sectionId: number, bankId: number): Observable<QuizAttempt> {
    return this.http
      .post<ApiResponse<QuizAttempt>>(`${this.url(courseId, sectionId, bankId)}/retest`, {})
      .pipe(map((res) => res.data));
  }

  /** Correct / Incorrect Answer - View (only after finishing). */
  review(courseId: number, sectionId: number, bankId: number): Observable<QuizReview> {
    return this.http
      .get<ApiResponse<QuizReview>>(`${this.url(courseId, sectionId, bankId)}/review`)
      .pipe(map((res) => res.data));
  }

  /** Empty optionIds and blank text clear the answer. */
  saveAnswer(
    courseId: number,
    sectionId: number,
    bankId: number,
    questionId: number,
    answer: { optionIds: number[]; text: string },
  ): Observable<void> {
    return this.http
      .put<ApiResponse<void>>(`${this.url(courseId, sectionId, bankId)}/answers/${questionId}`, answer)
      .pipe(map(() => undefined));
  }

  submitSection(courseId: number, sectionId: number, bankId: number, questionSectionId: number): Observable<QuizAttempt> {
    return this.http
      .post<ApiResponse<QuizAttempt>>(`${this.url(courseId, sectionId, bankId)}/sections/${questionSectionId}/submit`, {})
      .pipe(map((res) => res.data));
  }

  finish(courseId: number, sectionId: number, bankId: number): Observable<QuizAttempt> {
    return this.http
      .post<ApiResponse<QuizAttempt>>(`${this.url(courseId, sectionId, bankId)}/finish`, {})
      .pipe(map((res) => res.data));
  }
}