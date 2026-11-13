import { A11yModule } from '@angular/cdk/a11y';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { environment } from '../../../environments/environment'; // adjust the path to your project

import {
  QuizAnswer,
  QuizAttempt,
  QuizAttemptService,
  QuizQuestion,
  QuizQuestionType,
  QuizReview,
  QuizSection,
} from '../../services/quiz-attempt.service';

type QuestionState = 'completed' | 'incomplete' | 'unsaved' | 'idle';

interface PaletteItem {
  index: number;
  question: QuizQuestion;
  state: QuestionState;
  current: boolean;
}

const SAVE_DELAY_CHOICE_MS = 500;
const SAVE_DELAY_TEXT_MS = 900;

const TYPE_LABEL: Record<QuizQuestionType, string> = {
  SINGLE_ANSWER: 'Single choice',
  MULTIPLE_ANSWER: 'Multiple choice',
  SHORT_TEXT: 'Short answer',
};

/**
 * Learner "Attempt Quiz" screen (Sections bar, question card, timer, question palette, legend).
 * Answers are saved automatically (and on Next / Previous / Submit Section / Finish).
 * The timer counts up from the moment the learner first opened the quiz.
 *
 * It can run in two ways:
 *  - as a routed page (ids come from the route params), or
 *  - embedded inside the Course content view (ids / thumbnail come from inputs, `leave` tells the parent where to go).
 */
@Component({
  selector: 'app-quiz-attempt',
  imports: [A11yModule, DatePipe],
  templateUrl: './quiz-attempt.html',
  styleUrl: './quiz-attempt.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block min-h-0 lg:h-full',
    '(document:keydown.escape)': 'closeOverlays()',
  },
})
export class QuizAttemptPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(QuizAttemptService);

  // ---------- embedded mode (inputs fall back to the route params) ----------
  readonly courseIdIn = input<number | null>(null, { alias: 'courseId' });
  readonly sectionIdIn = input<number | null>(null, { alias: 'sectionId' });
  readonly bankIdIn = input<number | null>(null, { alias: 'bankId' });
  /** Course thumbnail passed by the Course content view (used when the attempt has no thumbnail of its own). */
  readonly thumbnail = input<string | null>(null);
  readonly embedded = input(false);
  /** Embedded only: 'course' = back to the course, a number = open that next course section. */
  readonly leave = output<'course' | number>();

  private courseId = 0;
  private courseSectionId = 0;
  private bankId = 0;

  // ---------- load state ----------
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly attempt = signal<QuizAttempt | null>(null);

  /** Image of the "Ready to take the quiz?" page: attempt thumbnail first, then the course thumbnail. */
  protected readonly thumbnailSrc = computed(() => {
    const own = this.attempt()?.thumbnailUrl;
    if (own) {
      // the backend may send a relative path like "/uploads/thumbnails/x.png"
      return /^(https?:|blob:|data:)/i.test(own) ? own : `${environment.apiBaseUrl}${own}`;
    }
    return this.thumbnail() || null;
  });

  // ---------- position ----------
  protected readonly sectionIndex = signal(0);
  protected readonly questionIndex = signal(0);

  // ---------- local answer state ----------
  protected readonly answers = signal<Record<number, QuizAnswer>>({});
  /** Answered, changed on screen but not saved on the server yet (yellow). */
  protected readonly dirtyIds = signal<ReadonlySet<number>>(new Set());
  /** Questions the learner has opened (an opened question without an answer is "Incomplete", red). */
  protected readonly visitedIds = signal<ReadonlySet<number>>(new Set());
  private readonly versions = new Map<number, number>();
  private readonly saveTimers = new Map<number, ReturnType<typeof setTimeout>>();

  // ---------- actions ----------
  protected readonly confirm = signal<'section' | 'finish' | null>(null);
  protected readonly busy = signal(false);
  protected readonly actionError = signal<string | null>(null);

  // ---------- Score page: Correct / Incorrect Answer - View ----------
  protected readonly reviewKind = signal<'correct' | 'incorrect' | null>(null);
  protected readonly review = signal<QuizReview | null>(null);
  protected readonly reviewLoading = signal(false);
  protected readonly reviewError = signal<string | null>(null);
  protected readonly reviewQuestions = computed(() => {
    const kind = this.reviewKind();
    const data = this.review();
    if (!kind || !data) return [];
    return data.questions
      .map((question, index) => ({ question, number: index + 1 }))
      .filter((item) => (kind === 'correct' ? item.question.correct : !item.question.correct));
  });

  // ---------- timer ----------
  protected readonly elapsedSeconds = signal(0);
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private timerBase = 0;
  private timerStartedAt = 0;

  private readonly paletteHost = viewChild<ElementRef<HTMLDivElement>>('paletteHost');

  // ---------- derived ----------
  protected readonly sections = computed<QuizSection[]>(() => this.attempt()?.sections ?? []);
  protected readonly finished = computed(() => this.attempt()?.status === 'SUBMITTED');
  /** "Ready to take the quiz?" page: the learner has not pressed Start Quiz yet. */
  protected readonly notStarted = computed(() => this.attempt()?.status === 'NOT_STARTED');
  /** The Submit Section button only makes sense when the quiz has more than one section. */
  protected readonly multiSection = computed(() => this.sections().length > 1);
  protected readonly canRetest = computed(() => {
    const a = this.attempt();
    return !!a && a.status === 'SUBMITTED' && a.attemptNumber < a.maxAttempts;
  });
  protected readonly currentSection = computed<QuizSection | null>(() => this.sections()[this.sectionIndex()] ?? null);
  protected readonly currentQuestion = computed<QuizQuestion | null>(
    () => this.currentSection()?.questions[this.questionIndex()] ?? null,
  );
  protected readonly locked = computed(() => this.finished() || this.currentSection()?.submitted === true);
  protected readonly currentAnswer = computed<QuizAnswer>(() => {
    const q = this.currentQuestion();
    return (q && this.answers()[q.id]) || { optionIds: [], text: null };
  });
  protected readonly isFirst = computed(() => this.sectionIndex() === 0 && this.questionIndex() === 0);
  protected readonly isLast = computed(() => {
    const sectionsCount = this.sections().length;
    const section = this.currentSection();
    return !!section && this.sectionIndex() === sectionsCount - 1 && this.questionIndex() === section.questions.length - 1;
  });
  protected readonly typeLabel = computed(() => {
    const q = this.currentQuestion();
    return q ? TYPE_LABEL[q.type] : '';
  });

  protected readonly timerText = computed(() => {
    const total = this.elapsedSeconds();
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  });

  protected readonly palette = computed<PaletteItem[]>(() => {
    const section = this.currentSection();
    if (!section) return [];
    const current = this.questionIndex();
    return section.questions.map((question, index) => ({
      index,
      question,
      current: index === current,
      state: this.stateOf(question, section.submitted || this.finished()),
    }));
  });

  /** Share (0-100) of the Sections bar line after the current step that is filled. */
  protected readonly currentSectionProgress = computed(() => {
    const section = this.currentSection();
    if (!section || !section.questions.length) return 0;
    return Math.round(((this.questionIndex() + 1) / section.questions.length) * 100);
  });

  /** 0-1 share of the score ring that is filled. */
  protected readonly scoreFraction = computed(() => {
    const a = this.attempt();
    if (!a || !a.maxScore || a.maxScore <= 0 || a.score == null) return 0;
    return Math.max(0, Math.min(1, a.score / a.maxScore));
  });
  /** Ring circle (r = 125): visible arc length and the full length. */
  protected readonly ringDash = computed(() => {
    const length = 2 * Math.PI * 125;
    return `${(length * this.scoreFraction()).toFixed(2)} ${length.toFixed(2)}`;
  });

  protected readonly totalQuestions = computed(() => this.sections().reduce((n, s) => n + s.questions.length, 0));
  protected readonly unansweredTotal = computed(() =>
    this.sections().reduce((n, s) => n + s.questions.filter((q) => !this.hasAnswer(q.id)).length, 0),
  );
  protected readonly unansweredInSection = computed(
    () => this.currentSection()?.questions.filter((q) => !this.hasAnswer(q.id)).length ?? 0,
  );

  ngOnInit(): void {
    const params = this.route.snapshot.paramMap;
    this.courseId = this.courseIdIn() ?? Number(params.get('courseId'));
    this.courseSectionId = this.sectionIdIn() ?? Number(params.get('sectionId'));
    this.bankId = this.bankIdIn() ?? Number(params.get('bankId'));
    if (!this.courseId || !this.courseSectionId || !this.bankId) {
      this.loading.set(false);
      this.loadError.set('This quiz could not be found.');
      return;
    }
    this.load();
  }

  ngOnDestroy(): void {
    this.stopTimer();
    // best effort: do not lose the last typed answers when the learner leaves the page
    this.saveTimers.forEach((handle) => clearTimeout(handle));
    this.saveTimers.clear();
    this.dirtyIds().forEach((id) => this.saveQuestion(id));
  }

  // ------------------------------------------------------------------
  // load
  // ------------------------------------------------------------------

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.open(this.courseId, this.courseSectionId, this.bankId).subscribe({
      next: (attempt) => {
        this.applyAttempt(attempt);
        this.loading.set(false);
      },
      error: (error) => {
        this.loading.set(false);
        const message = (error?.error as { message?: string } | undefined)?.message;
        this.loadError.set(
          error?.status === 403 || error?.status === 404
            ? message || 'This quiz is not available.'
            : 'The quiz could not be loaded. Please try again.',
        );
      },
    });
  }

  /** Puts a server attempt on screen and resets every bit of local answer state (first load, Start Quiz, Retest). */
  private applyAttempt(attempt: QuizAttempt): void {
    this.saveTimers.forEach((handle) => clearTimeout(handle));
    this.saveTimers.clear();
    this.versions.clear();
    this.dirtyIds.set(new Set());
    this.reviewKind.set(null);
    this.review.set(null);
    this.actionError.set(null);
    this.confirm.set(null);

    this.attempt.set(attempt);
    const saved: Record<number, QuizAnswer> = {};
    const visited = new Set<number>();
    for (const section of attempt.sections) {
      for (const q of section.questions) {
        saved[q.id] = { optionIds: q.answer?.optionIds ?? [], text: q.answer?.text ?? null };
      }
    }
    this.answers.set(saved);
    // resume on the first section that is not submitted yet
    const firstOpen = attempt.sections.findIndex((s) => !s.submitted);
    this.sectionIndex.set(firstOpen === -1 ? 0 : firstOpen);
    this.questionIndex.set(0);
    const first = this.currentQuestion();
    if (first) visited.add(first.id);
    this.visitedIds.set(visited);

    if (attempt.status === 'IN_PROGRESS') {
      this.startTimer(attempt.elapsedSeconds);
    } else {
      this.stopTimer();
      this.elapsedSeconds.set(attempt.elapsedSeconds);
    }
  }

  /** "Start Quiz": the timer starts now. */
  protected startQuiz(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.api.start(this.courseId, this.courseSectionId, this.bankId).subscribe({
      next: (attempt) => {
        this.applyAttempt(attempt);
        this.busy.set(false);
      },
      error: (error) => this.failAction(error, 'The quiz could not be started. Please try again.'),
    });
  }

  /** "Retest": a new attempt (while attempts are left). */
  protected retest(): void {
    if (this.busy() || !this.canRetest()) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.api.retest(this.courseId, this.courseSectionId, this.bankId).subscribe({
      next: (attempt) => {
        this.applyAttempt(attempt);
        this.busy.set(false);
      },
      error: (error) => this.failAction(error, 'The retest could not be started. Please try again.'),
    });
  }

  // ------------------------------------------------------------------
  // Score page actions
  // ------------------------------------------------------------------

  protected openReview(kind: 'correct' | 'incorrect'): void {
    this.reviewKind.set(kind);
    this.reviewError.set(null);
    if (this.review()) return; // already loaded for this attempt
    this.reviewLoading.set(true);
    this.api.review(this.courseId, this.courseSectionId, this.bankId).subscribe({
      next: (data) => {
        this.review.set(data);
        this.reviewLoading.set(false);
      },
      error: (error) => {
        this.reviewLoading.set(false);
        this.reviewError.set((error?.error as { message?: string } | undefined)?.message || 'The answers could not be loaded.');
      },
    });
  }

  protected closeReview(): void {
    this.reviewKind.set(null);
  }

  protected closeOverlays(): void {
    if (this.reviewKind()) {
      this.closeReview();
    } else {
      this.closeConfirm();
    }
  }

  protected print(): void {
    window.print();
  }

  protected pad(n: number): string {
    return String(n).padStart(2, '0');
  }

  /** "Go to next unit" (next course section), or back to the course on the last unit. */
  protected goNextUnit(): void {
    const next = this.attempt()?.nextSectionId;
    if (this.embedded()) {
      this.leave.emit(next ?? 'course');
      return;
    }
    if (next) {
      void this.router.navigate(['/admin-dashboard', 'courses', this.courseId, 'sections', next, 'content']);
    } else {
      this.backToCourse();
    }
  }

  // ------------------------------------------------------------------
  // timer (counts up)
  // ------------------------------------------------------------------

  private startTimer(baseSeconds: number): void {
    this.stopTimer();
    this.timerBase = baseSeconds;
    this.timerStartedAt = Date.now();
    this.elapsedSeconds.set(baseSeconds);
    this.timerHandle = setInterval(() => {
      this.elapsedSeconds.set(this.timerBase + Math.floor((Date.now() - this.timerStartedAt) / 1000));
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }

  // ------------------------------------------------------------------
  // answering
  // ------------------------------------------------------------------

  protected isSelected(optionId: number): boolean {
    return this.currentAnswer().optionIds.includes(optionId);
  }

  protected selectOption(question: QuizQuestion, optionId: number): void {
    if (this.locked()) return;
    const current = this.answers()[question.id]?.optionIds ?? [];
    let next: number[];
    if (question.type === 'SINGLE_ANSWER') {
      next = [optionId];
    } else {
      next = current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId];
    }
    this.setAnswer(question.id, { optionIds: next, text: null }, SAVE_DELAY_CHOICE_MS);
  }

  protected onTextInput(question: QuizQuestion, event: Event): void {
    if (this.locked()) return;
    const value = (event.target as HTMLTextAreaElement).value;
    this.setAnswer(question.id, { optionIds: [], text: value }, SAVE_DELAY_TEXT_MS);
  }

  private setAnswer(questionId: number, answer: QuizAnswer, saveDelayMs: number): void {
    this.answers.update((all) => ({ ...all, [questionId]: answer }));
    this.versions.set(questionId, (this.versions.get(questionId) ?? 0) + 1);
    this.dirtyIds.update((ids) => new Set(ids).add(questionId));
    this.actionError.set(null);
    const timer = this.saveTimers.get(questionId);
    if (timer) clearTimeout(timer);
    this.saveTimers.set(
      questionId,
      setTimeout(() => {
        this.saveTimers.delete(questionId);
        this.saveQuestion(questionId);
      }, saveDelayMs),
    );
  }

  /** Saves one question now. On failure it stays "Not Saved" (yellow) and is retried on the next change / action. */
  private saveQuestion(questionId: number): void {
    this.saveRequest(questionId).subscribe((ok) => {
      if (!ok) this.actionError.set('Some answers could not be saved. Check your connection and try again.');
    });
  }

  private saveRequest(questionId: number): Observable<boolean> {
    const timer = this.saveTimers.get(questionId);
    if (timer) {
      clearTimeout(timer);
      this.saveTimers.delete(questionId);
    }
    const answer = this.answers()[questionId] ?? { optionIds: [], text: null };
    const sentVersion = this.versions.get(questionId) ?? 0;
    return this.api
      .saveAnswer(this.courseId, this.courseSectionId, this.bankId, questionId, {
        optionIds: answer.optionIds,
        text: answer.text ?? '',
      })
      .pipe(
        map(() => {
          // only "saved" when nothing was typed / clicked while the request was running
          if ((this.versions.get(questionId) ?? 0) === sentVersion) {
            this.dirtyIds.update((ids) => {
              const next = new Set(ids);
              next.delete(questionId);
              return next;
            });
          }
          return true;
        }),
        catchError(() => of(false)),
      );
  }

  /** Saves every unsaved answer; resolves false if any of them failed. */
  private flushAll(): Observable<boolean> {
    const ids = [...this.dirtyIds()];
    if (!ids.length) return of(true);
    return forkJoin(ids.map((id) => this.saveRequest(id))).pipe(map((results) => results.every(Boolean)));
  }

  // ------------------------------------------------------------------
  // question state (palette)
  // ------------------------------------------------------------------

  protected hasAnswer(questionId: number): boolean {
    const a = this.answers()[questionId];
    return !!a && (a.optionIds.length > 0 || (a.text ?? '').trim().length > 0);
  }

  private stateOf(question: QuizQuestion, sectionClosed: boolean): QuestionState {
    if (this.dirtyIds().has(question.id)) return 'unsaved';
    if (this.hasAnswer(question.id)) return 'completed';
    if (sectionClosed || this.visitedIds().has(question.id)) return 'incomplete';
    return 'idle';
  }

  protected paletteClass(item: PaletteItem): string {
    const ring = item.current ? ' ring-2 ring-[#2f7f8c] ring-offset-2' : '';
    switch (item.state) {
      case 'completed':
        return 'bg-[#61b7c5] text-white' + ring;
      case 'incomplete':
        return 'bg-[#ff5a5a] text-white' + ring;
      case 'unsaved':
        return 'bg-[#ffc94d] text-[#4a3a00]' + ring;
      default:
        return (item.current ? 'bg-[#61b7c5] text-white' : 'bg-white text-[#8a9092]') + ring;
    }
  }

  protected paletteLabel(item: PaletteItem): string {
    const text: Record<QuestionState, string> = {
      completed: 'answered',
      incomplete: 'not answered',
      unsaved: 'not saved yet',
      idle: 'not visited',
    };
    return `Question ${item.index + 1}, ${text[item.state]}`;
  }

  // ------------------------------------------------------------------
  // navigation
  // ------------------------------------------------------------------

  private leaveCurrent(): void {
    const q = this.currentQuestion();
    if (q && this.dirtyIds().has(q.id)) this.saveQuestion(q.id);
  }

  private moveTo(sectionIndex: number, questionIndex: number): void {
    this.leaveCurrent();
    this.sectionIndex.set(sectionIndex);
    this.questionIndex.set(questionIndex);
    const q = this.currentQuestion();
    if (q) this.visitedIds.update((ids) => new Set(ids).add(q.id));
    this.actionError.set(null);
  }

  protected goToQuestion(index: number): void {
    this.moveTo(this.sectionIndex(), index);
  }

  protected goToSection(index: number): void {
    if (index === this.sectionIndex()) return;
    this.moveTo(index, 0);
  }

  protected next(): void {
    const section = this.currentSection();
    if (!section || this.isLast()) return;
    if (this.questionIndex() < section.questions.length - 1) {
      this.moveTo(this.sectionIndex(), this.questionIndex() + 1);
    } else {
      this.moveTo(this.sectionIndex() + 1, 0);
    }
  }

  protected previous(): void {
    if (this.isFirst()) return;
    if (this.questionIndex() > 0) {
      this.moveTo(this.sectionIndex(), this.questionIndex() - 1);
    } else {
      const previousSection = this.sections()[this.sectionIndex() - 1];
      this.moveTo(this.sectionIndex() - 1, Math.max(0, (previousSection?.questions.length ?? 1) - 1));
    }
  }

  protected scrollPalette(direction: -1 | 1): void {
    const el = this.paletteHost()?.nativeElement;
    el?.scrollBy({ top: direction * 56, behavior: 'smooth' });
  }

  // ------------------------------------------------------------------
  // submit section / finish
  // ------------------------------------------------------------------

  protected askSubmitSection(): void {
    if (this.locked() || this.busy()) return;
    this.confirm.set('section');
  }

  protected askFinish(): void {
    if (this.finished() || this.busy()) return;
    this.confirm.set('finish');
  }

  protected closeConfirm(): void {
    if (!this.busy()) this.confirm.set(null);
  }

  protected confirmAction(): void {
    const kind = this.confirm();
    if (!kind || this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.flushAll().subscribe((saved) => {
      if (!saved) {
        this.busy.set(false);
        this.confirm.set(null);
        this.actionError.set('Some answers could not be saved. Check your connection and try again.');
        return;
      }
      if (kind === 'section') this.submitSection();
      else this.finishQuiz();
    });
  }

  private submitSection(): void {
    const section = this.currentSection();
    if (!section) {
      this.busy.set(false);
      return;
    }
    this.api.submitSection(this.courseId, this.courseSectionId, this.bankId, section.id).subscribe({
      next: (attempt) => {
        this.attempt.set(attempt);
        this.busy.set(false);
        this.confirm.set(null);
        if (this.sectionIndex() < attempt.sections.length - 1) this.moveTo(this.sectionIndex() + 1, 0);
      },
      error: (error) => this.failAction(error, 'The section could not be submitted. Please try again.'),
    });
  }

  private finishQuiz(): void {
    this.api.finish(this.courseId, this.courseSectionId, this.bankId).subscribe({
      next: (attempt) => {
        this.stopTimer();
        this.attempt.set(attempt);
        this.review.set(null);
        this.elapsedSeconds.set(attempt.elapsedSeconds);
        this.busy.set(false);
        this.confirm.set(null);
      },
      error: (error) => this.failAction(error, 'The quiz could not be submitted. Please try again.'),
    });
  }

  private failAction(error: { error?: { message?: string } } | undefined, fallback: string): void {
    this.busy.set(false);
    this.confirm.set(null);
    this.actionError.set(error?.error?.message || fallback);
  }

  protected backToCourse(): void {
    if (this.embedded()) {
      this.leave.emit('course');
      return;
    }
    void this.router.navigate(['/admin-dashboard', 'courses', this.courseId, 'preview']);
  }
}