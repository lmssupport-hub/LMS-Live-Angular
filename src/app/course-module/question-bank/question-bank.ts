import { HttpResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { EMPTY, Subject, catchError, debounceTime, distinctUntilChanged, finalize, switchMap, tap } from 'rxjs';

import {
  ErrorContext,
  QuestionBankService,
  ValidationIssue,
  cloneQuestionAsNew,
  cloneSectionAsNew,
  createOption,
  createQuestion,
  createSection,
  fromQuestionResponse,
  isNumber,
  toUiError,
  uniqueCopyText,
  uniqueSectionName,
  validateSections,
} from '../../services/question-bank.service';
import {
  ApiExistingPage,
  ApiQuestionResponse,
  BankScope,
  IMPORT_EXTENSIONS,
  LIMITS,
  MESSAGES,
  QuestionType,
  QuestionVm,
  ScoringType,
  SectionVm,
  SelectedType,
} from '../question-bank.model';

interface Banner {
  kind: 'success' | 'error' | 'info';
  text: string;
  conflict?: boolean;
}

interface ConfirmState {
  title: string;
  message: string;
  action: () => void;
}

/** manual = Save button, auto = quiet auto save, retry = second attempt after a concurrent-edit conflict. */
type SaveMode = 'manual' | 'auto' | 'retry';

const AUTO_SAVE_DELAY_MS = 3000;
const SESSION_REDIRECT_DELAY_MS = 2500;
/** Popup (toast) auto-dismiss times. */
const TOAST_SUCCESS_MS = 3000;
const TOAST_ERROR_MS = 6000;

@Component({
  selector: 'app-question-bank',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DragDropModule],
  templateUrl: './question-bank.html',
})
export class QuestionBankComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(QuestionBankService);

  readonly limits = LIMITS;
  readonly importAccept = '.pdf,.doc,.docx,.csv,.xls,.xlsx';

  readonly questionTypes: ReadonlyArray<{ label: string; value: Exclude<SelectedType, null> }> = [
    { label: 'Single Answer', value: 'single' },
    { label: 'Multiple Answer', value: 'multiple' },
    { label: 'Short Text', value: 'short' },
    { label: 'Mixed', value: 'mixed' },
  ];
  readonly typeOptions: ReadonlyArray<{ label: string; value: QuestionType }> = [
    { label: 'Single Answer', value: 'single' },
    { label: 'Multiple Answer', value: 'multiple' },
    { label: 'Short Text', value: 'short' },
  ];

  // ───── state (signals) ─────
  readonly sections = signal<SectionVm[]>([]);
  readonly activeSectionId = signal<string | null>(null);
  readonly selectedType = signal<SelectedType>(null); // SRS: nothing selected by default
  readonly editingSectionId = signal<string | null>(null);
  readonly highlightId = signal<string | null>(null);
  /** Question whose scoring/feedback block is expanded (closed by default). */
  readonly scoringOpenId = signal<string | null>(null);
  /** Question whose "more actions" dropdown is open. */
  readonly menuOpenId = signal<string | null>(null);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly importing = signal(false);
  readonly exporting = signal(false);
  readonly dirty = signal(false);

  readonly banner = signal<Banner | null>(null);
  readonly showBackDialog = signal(false);
  readonly confirm = signal<ConfirmState | null>(null);
  readonly hasClipboard = signal(false);
  readonly hasSectionClipboard = signal(false);
  /** pulling the other user's latest version after a conflict */
  readonly resolving = signal(false);
  /** session expired: message is on screen, redirect to Login is pending */
  readonly redirecting = signal(false);

  // existing-questions dialog
  readonly showExisting = signal(false);
  readonly existingPage = signal<ApiExistingPage | null>(null);
  readonly existingLoading = signal(false);
  readonly existingKeyword = signal('');
  readonly selectedExisting = signal<ReadonlySet<number>>(new Set());

  readonly activeSection = computed(() => this.sections().find(s => s.clientId === this.activeSectionId()) ?? null);
  readonly busy = computed(
    () => this.loading() || this.saving() || this.importing() || this.exporting() || this.resolving() || this.redirecting(),
  );
  readonly canExport = computed(() => !!this.activeSection()?.questions.some(q => q.id !== null));

  private courseId = 0;
  /** course + organize section + bank. null until the route params are valid. */
  private scope: BankScope | null = null;
  private baselineSectionIds: number[] = [];
  private clipboard: QuestionVm | null = null;
  private sectionClipboard: SectionVm | null = null;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** bumped on every edit, so an edit made while a save is running is never marked as saved */
  private editVersion = 0;
  private readonly keyword$ = new Subject<string>();
  /** `sectionId` here is the QUESTION SECTION id the search is made from. */
  private readonly existingQuery$ = new Subject<{ sectionId: number; keyword: string; page: number }>();

  constructor() {
    // Never lose the last <400 ms of typing when the user navigates away.
    this.destroyRef.onDestroy(() => {
      if (this.draftTimer) clearTimeout(this.draftTimer);
      if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
      this.flushDraft();
    });

    // Popup (toast) auto-dismiss: success/info after 3s, error after 6s.
    // Conflict banner (has "Reload latest" button) and session-expired message stay until the user acts / redirect happens.
    effect(onCleanup => {
      const b = this.banner();
      if (!b || b.conflict || this.redirecting()) return;
      const timer = setTimeout(() => this.banner.set(null), b.kind === 'error' ? TOAST_ERROR_MS : TOAST_SUCCESS_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }

  // ───────────────────────── lifecycle ─────────────────────────
  ngOnInit(): void {
    const courseId = this.readId('courseId');
    const sectionId = this.readId('sectionId');
    const bankId = this.readId('bankId');
    if (!courseId || !sectionId || !bankId) {
      this.banner.set({ kind: 'error', text: 'Question Bank not found. Please open it from a course section.' });
      return;
    }
    this.courseId = courseId;
    const scope: BankScope = { courseId, sectionId, bankId };
    this.scope = scope;

    this.keyword$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(keyword => this.queryExisting(keyword, 0));

    this.existingQuery$
      .pipe(
        tap(() => this.existingLoading.set(true)),
        switchMap(q =>
          this.service.searchExisting(scope, q.sectionId, q.keyword, q.page, LIMITS.existingPageSize).pipe(
            catchError(err => {
              this.existingLoading.set(false);
              this.handleError(err, 'load');
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(page => {
        this.existingPage.set(page);
        this.existingLoading.set(false);
      });

    this.loadFromServer();
  }

  private readId(name: string): number | null {
    const raw = this.route.snapshot.paramMap.get(name) ?? this.route.snapshot.queryParamMap.get(name);
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) event.preventDefault();
  }

  /** Close the question action menu on any outside click or Escape. */
  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  closeMenu(): void {
    if (this.menuOpenId()) this.menuOpenId.set(null);
  }

  toggleMenu(id: string, event: Event): void {
    event.stopPropagation(); // don't let the document click handler close it straight away
    this.menuOpenId.update(current => (current === id ? null : id));
  }

  // ───────────────────────── load ─────────────────────────
  private loadFromServer(): void {
    if (!this.scope) return;
    this.loading.set(true);
    this.service
      .loadBank(this.scope)
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: sections => {
          this.applyServerState(sections);
          this.restoreDraftIfAny();
        },
        error: err => this.handleError(err, 'load'),
      });
  }

  private applyServerState(sections: SectionVm[]): void {
    this.sections.set(sections);
    this.baselineSectionIds = sections.map(s => s.id).filter(isNumber);
    this.activeSectionId.set(sections[0]?.clientId ?? null);
    this.dirty.set(false);
  }

  private restoreDraftIfAny(): void {
    if (!this.scope) return;
    const draft = this.service.loadDraft(this.scope);
    if (!draft) return;
    this.sections.set(draft.sections);
    this.baselineSectionIds = draft.baselineSectionIds;
    this.selectedType.set(draft.selectedType);
    this.activeSectionId.set(draft.sections[0]?.clientId ?? null);
    this.dirty.set(true);
    this.banner.set({ kind: 'info', text: 'Your unsaved changes were restored.' });
  }

  reloadLatest(): void {
    if (this.scope) this.service.clearDraft(this.scope);
    this.banner.set(null);
    this.loadFromServer();
  }

  // ───────────────────────── dirty / draft ─────────────────────────
  markDirty(question?: QuestionVm, autoSave = true): void {
    if (question) question.dirty = true;
    this.dirty.set(true);
    this.editVersion++;
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => this.flushDraft(), 400);
    if (autoSave) this.scheduleAutoSave();
  }

  /** SRS field #7: question sections have "Auto Save". Saves quietly once the user stops editing. */
  private scheduleAutoSave(): void {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => {
      if (!this.dirty() || this.redirecting()) return;
      if (this.busy()) this.scheduleAutoSave();
      else this.runSave(undefined, 'auto');
    }, AUTO_SAVE_DELAY_MS);
  }

  private flushDraft(): void {
    if (!this.dirty() || !this.scope) return;
    this.service.saveDraft(this.scope, {
      selectedType: this.selectedType(),
      baselineSectionIds: this.baselineSectionIds,
      sections: this.sections(),
    });
  }

  private touchSections(): void {
    this.sections.update(s => [...s]);
  }

  // ───────────────────────── question type ─────────────────────────
  /** Top radio = type used for NEW questions. Existing questions keep their own type. */
  setDefaultType(type: Exclude<SelectedType, null>): void {
    this.selectedType.set(type);
    this.markDirty(undefined, false); // only a UI choice: nothing to auto save
  }

  changeQuestionType(question: QuestionVm, type: QuestionType): void {
    if (question.type === type) return;
    question.type = type;

    if (type === 'short') {
      question.options = [];
      question.scoringType = 'basic';
    } else {
      if (question.options.length === 0) question.options = [createOption(), createOption()];
      if (type === 'single') this.keepFirstCorrect(question);
    }
    this.markDirty(question);
  }

  private keepFirstCorrect(question: QuestionVm): void {
    let found = false;
    for (const o of question.options) {
      if (o.correct && !found) found = true;
      else o.correct = false;
    }
  }

  changeScoring(question: QuestionVm, scoring: ScoringType): void {
    question.scoringType = scoring;
    this.markDirty(question);
  }

  /** Expand / collapse the scoring + feedback block of one question. */
  toggleScoring(id: string): void {
    this.scoringOpenId.update(current => (current === id ? null : id));
  }

  // ───────────────────────── sections (question sections of this bank) ─────────────────────────
  addSection(): void {
    if (this.sections().length >= LIMITS.maxSectionsPerBank) {
      this.notifyError(`A question bank can contain at most ${LIMITS.maxSectionsPerBank} sections.`);
      return;
    }
    const section = createSection(`Section ${this.sections().length + 1}`);
    this.sections.update(s => [...s, section]);
    this.activeSectionId.set(section.clientId);
    this.markDirty();
  }

  selectSection(id: string): void {
    this.activeSectionId.set(id);
  }

  editSection(id: string): void {
    this.activeSectionId.set(id);
    this.editingSectionId.set(id);
    setTimeout(() => document.getElementById(`section-name-${id}`)?.focus());
  }

  renameSection(section: SectionVm, name: string): void {
    section.name = name.slice(0, LIMITS.sectionNameChars);
    this.markDirty();
  }

  // ───── section points (bottom panel): score + feedback ─────
  sectionScore(section: SectionVm): number | null {
    return section.score;
  }

  sectionFeedback(section: SectionVm): string {
    return section.feedback;
  }

  setSectionScore(section: SectionVm, value: unknown): void {
    section.score = value === '' || value === null || value === undefined ? null : this.clampScore(value);
    this.markDirty();
  }

  setSectionFeedback(section: SectionVm, text: string): void {
    section.feedback = (text ?? '').slice(0, LIMITS.feedbackChars);
    this.markDirty();
  }

  requestDeleteSection(section: SectionVm): void {
    if (section.id === null && section.questions.length === 0) {
      this.deleteSection(section.clientId);
      return;
    }
    this.confirm.set({
      title: 'Delete section',
      message: `Delete "${section.name}" and its ${section.questions.length} question(s)? This is applied when you save.`,
      action: () => this.deleteSection(section.clientId),
    });
  }

  private deleteSection(clientId: string): void {
    const remaining = this.sections().filter(s => s.clientId !== clientId);
    this.sections.set(remaining);
    if (this.activeSectionId() === clientId) this.activeSectionId.set(remaining[0]?.clientId ?? null);
    this.markDirty();
  }

  duplicateSection(section: SectionVm): void {
    if (this.sections().length >= LIMITS.maxSectionsPerBank) {
      this.notifyError(`A question bank can contain at most ${LIMITS.maxSectionsPerBank} sections.`);
      return;
    }
    const copy = cloneSectionAsNew(section);
    copy.name = uniqueSectionName(section.name, this.sections().map(s => s.name));
    const next = [...this.sections()];
    next.splice(next.indexOf(section) + 1, 0, copy);
    this.sections.set(next);
    this.activeSectionId.set(copy.clientId);
    this.markDirty();
  }

  /** SRS field #7: section Copy (then "Paste Section" adds it at the end of the list). */
  copySection(section: SectionVm): void {
    this.sectionClipboard = structuredClone(section);
    this.hasSectionClipboard.set(true);
    this.banner.set({ kind: 'info', text: 'Section copied. Choose "Paste Section" to add it.' });
  }

  pasteSection(): void {
    const source = this.sectionClipboard;
    if (!source) return;
    if (this.sections().length >= LIMITS.maxSectionsPerBank) {
      this.notifyError(`A question bank can contain at most ${LIMITS.maxSectionsPerBank} sections.`);
      return;
    }
    const copy = cloneSectionAsNew(source);
    copy.name = uniqueSectionName(source.name, this.sections().map(s => s.name));
    this.sections.update(s => [...s, copy]);
    this.activeSectionId.set(copy.clientId);
    this.markDirty();
  }

  moveSection(section: SectionVm, direction: -1 | 1): void {
    const next = [...this.sections()];
    const from = next.indexOf(section);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= next.length) return;
    moveItemInArray(next, from, to);
    this.sections.set(next);
    this.markDirty();
  }

  dropSection(event: CdkDragDrop<SectionVm[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const next = [...this.sections()];
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    this.sections.set(next);
    this.markDirty();
  }

  // ───────────────────────── questions ─────────────────────────
  addQuestion(): void {
    const selected = this.selectedType();
    if (!selected) {
      this.notifyError('Please select a question type first.');
      return;
    }
    const section = this.ensureActiveSection();
    if (!this.hasRoom(section)) return;

    const type: QuestionType = selected === 'mixed' ? 'single' : selected;
    section.questions.push(createQuestion(type));
    this.touchSections();
    this.markDirty();
  }

  duplicateQuestion(section: SectionVm, question: QuestionVm): void {
    if (!this.hasRoom(section)) return;
    section.questions.splice(section.questions.indexOf(question) + 1, 0, cloneQuestionAsNew(question));
    this.touchSections();
    this.markDirty();
  }

  copyQuestion(question: QuestionVm): void {
    this.clipboard = structuredClone(question);
    this.hasClipboard.set(true);
    this.banner.set({ kind: 'info', text: 'Question copied. Select a section and choose Paste.' });
  }

  cutQuestion(section: SectionVm, question: QuestionVm): void {
    this.copyQuestion(question);
    this.removeQuestion(section, question);
  }

  pasteQuestion(): void {
    if (!this.clipboard) return;
    const section = this.ensureActiveSection();
    if (!this.hasRoom(section)) return;
    section.questions.push(cloneQuestionAsNew(this.clipboard));
    this.touchSections();
    this.markDirty();
  }

  requestDeleteQuestion(section: SectionVm, question: QuestionVm): void {
    if (!question.text.trim() && question.id === null) {
      this.removeQuestion(section, question);
      return;
    }
    this.confirm.set({
      title: 'Delete question',
      message: 'Delete this question? This is applied when you save.',
      action: () => this.removeQuestion(section, question),
    });
  }

  private removeQuestion(section: SectionVm, question: QuestionVm): void {
    section.questions = section.questions.filter(q => q !== question);
    this.touchSections();
    this.markDirty();
  }

  toggleHidden(question: QuestionVm): void {
    question.hidden = !question.hidden;
    this.markDirty(); // hidden is synced through its own PATCH, so the question isn't marked dirty
  }

  moveQuestion(section: SectionVm, index: number, direction: -1 | 1): void {
    const to = index + direction;
    if (to < 0 || to >= section.questions.length) return;
    moveItemInArray(section.questions, index, to);
    this.touchSections();
    this.markDirty();
  }

  setScore(question: QuestionVm, field: 'correctScore' | 'incorrectScore', value: unknown): void {
    question[field] = this.clampScore(value);
    this.markDirty(question);
  }

  private ensureActiveSection(): SectionVm {
    const current = this.activeSection();
    if (current) return current;
    this.addSection();
    return this.activeSection() as SectionVm;
  }

  private hasRoom(section: SectionVm): boolean {
    if (section.questions.length >= LIMITS.maxQuestionsPerSection) {
      this.notifyError(`A section can contain at most ${LIMITS.maxQuestionsPerSection} questions.`);
      return false;
    }
    return true;
  }

  // ───────────────────────── options ─────────────────────────
  addOption(question: QuestionVm): void {
    if (question.options.length >= LIMITS.maxOptions) {
      this.notifyError(`A question can have at most ${LIMITS.maxOptions} options.`);
      return;
    }
    question.options.push(createOption());
    this.markDirty(question);
  }

  deleteOption(question: QuestionVm, index: number): void {
    if (question.options.length <= LIMITS.minOptions) {
      this.notifyError(`A question needs at least ${LIMITS.minOptions} options.`);
      return;
    }
    question.options.splice(index, 1);
    this.markDirty(question);
  }

  duplicateOption(question: QuestionVm, index: number): void {
    if (question.options.length >= LIMITS.maxOptions) {
      this.notifyError(`A question can have at most ${LIMITS.maxOptions} options.`);
      return;
    }
    const source = question.options[index];
    const copy = createOption(uniqueCopyText(source.text || 'Option', question.options.map(o => o.text)));
    copy.points = source.points; // correct flag intentionally NOT copied
    question.options.splice(index + 1, 0, copy);
    this.markDirty(question);
  }

  setCorrect(question: QuestionVm, index: number): void {
    if (question.type === 'single') {
      question.options.forEach((o, i) => (o.correct = i === index));
    } else {
      question.options[index].correct = !question.options[index].correct;
    }
    this.markDirty(question);
  }

  setOptionPoints(question: QuestionVm, index: number, value: unknown): void {
    question.options[index].points = this.clampScore(value);
    this.markDirty(question);
  }

  private clampScore(value: unknown): number {
    const n = Math.trunc(Number(value));
    return Number.isFinite(n) ? Math.min(LIMITS.maxScore, Math.max(LIMITS.minScore, n)) : 0;
  }

  // ───────────────────────── save ─────────────────────────
  save(): void {
    this.runSave();
  }

  private runSave(afterSuccess?: () => void, mode: SaveMode = 'manual'): void {
    if (this.saving() || this.redirecting()) return; // edge case #1: ignore duplicate clicks
    const scope = this.scope;
    if (!scope) return;

    const issue = validateSections(this.sections());
    if (issue) {
      if (mode === 'auto') return; // unfinished work: stay quiet, the draft keeps it safe
      this.showIssue(issue);
      return;
    }

    const editsAtStart = this.editVersion;
    this.saving.set(true);
    this.banner.set(null);
    this.highlightId.set(null);

    this.service
      .saveBank(scope, this.sections(), this.baselineSectionIds)
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ids => {
          this.baselineSectionIds = ids;
          this.touchSections();
          if (this.editVersion === editsAtStart) {
            this.dirty.set(false);
            this.service.clearDraft(scope);
          }
          this.banner.set(this.savedBanner(mode));
          afterSuccess?.();
        },
        error: err => {
          this.touchSections(); // partial progress (ids/versions) is already in memory
          if (mode !== 'retry' && toUiError(err, 'save').kind === 'conflict') {
            this.resolveConflict(afterSuccess);
            return;
          }
          this.handleError(err, 'save');
        },
      });
  }

  private savedBanner(mode: SaveMode): Banner {
    if (mode === 'auto') return { kind: 'info', text: MESSAGES.autoSaved };
    if (mode === 'retry') return { kind: 'info', text: MESSAGES.conflictResolved };
    return { kind: 'success', text: MESSAGES.saved };
  }

  /**
   * SRS edge case 6: another user updated the same Question Bank.
   * Pull their latest versions, then save this user's latest changes on top (one retry) and tell the user.
   */
  private resolveConflict(afterSuccess?: () => void): void {
    const scope = this.scope;
    if (!scope) return;
    this.resolving.set(true);
    this.service
      .refreshFromServer(scope, this.sections())
      .pipe(
        finalize(() => this.resolving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.touchSections();
          setTimeout(() => this.runSave(afterSuccess, 'retry')); // after `resolving` is cleared
        },
        error: err => this.handleError(err, 'save'),
      });
  }

  private showIssue(issue: ValidationIssue): void {
    this.activeSectionId.set(issue.sectionClientId);
    this.highlightId.set(issue.questionClientId);
    this.notifyError(issue.message);

    if (issue.questionClientId) {
      // Score / feedback fields live in the collapsed "Scoring" block: open it so the user sees the problem.
      if (/score|feedback/i.test(issue.message)) this.scoringOpenId.set(issue.questionClientId);
      setTimeout(() =>
        document.getElementById(`q-${issue.questionClientId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      );
    } else if (/score|feedback/i.test(issue.message)) {
      // Section-level problem -> the "Section points" panel at the bottom.
      setTimeout(() => document.getElementById('section-score')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
  }

  // ───────────────────────── import / export / existing ─────────────────────────
  importFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file
    if (!file) return;

    const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
    if (!IMPORT_EXTENSIONS.has(ext)) return this.notifyError(MESSAGES.invalidFile);
    if (file.size > LIMITS.maxImportBytes) return this.notifyError(MESSAGES.fileTooLarge);
    if (file.size === 0) return this.notifyError('Please select a file to import.');

    const scope = this.scope;
    const section = this.requireSavedSection();
    if (!scope || !section) return;
    const sectionId = section.id as number; // question section id

    this.importing.set(true);
    this.banner.set(null);
    this.service
      .importFile(scope, sectionId, file)
      .pipe(
        switchMap(result =>
          this.service.fetchQuestions(scope, sectionId).pipe(tap(items => this.mergeServerQuestions(section, items, result.imported))),
        ),
        finalize(() => this.importing.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({ error: err => this.handleError(err, 'import') });
  }

  exportQuestions(): void {
    const scope = this.scope;
    const section = this.requireSavedSection();
    if (!scope || !section) return;
    if (!this.canExport()) return this.notifyError('No questions available to export.');

    this.exporting.set(true);
    this.service
      .exportCsv(scope, section.id as number)
      .pipe(
        finalize(() => this.exporting.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: res => {
          this.download(res);
          this.banner.set({ kind: 'success', text: 'Questions exported successfully.' });
        },
        error: err => this.handleError(err, 'export'),
      });
  }

  openExisting(): void {
    const section = this.requireSavedSection();
    if (!section) return;
    this.selectedExisting.set(new Set());
    this.existingKeyword.set('');
    this.existingPage.set(null);
    this.showExisting.set(true);
    this.queryExisting('', 0);
  }

  onExistingKeyword(value: string): void {
    this.existingKeyword.set(value.slice(0, 100));
    this.keyword$.next(this.existingKeyword());
  }

  existingPageChange(delta: -1 | 1): void {
    const page = this.existingPage();
    if (!page) return;
    const next = page.page + delta;
    if (next < 0 || next >= page.totalPages) return;
    this.queryExisting(this.existingKeyword(), next);
  }

  toggleExisting(id: number): void {
    const next = new Set(this.selectedExisting());
    if (next.has(id)) next.delete(id);
    else if (next.size < LIMITS.maxExistingSelection) next.add(id);
    this.selectedExisting.set(next);
  }

  addSelectedExisting(): void {
    const scope = this.scope;
    const section = this.activeSection();
    const ids = [...this.selectedExisting()];
    if (!scope || !section || section.id === null || ids.length === 0) return;

    this.service
      .addExisting(scope, section.id, ids)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: added => {
          section.questions.push(...added.map(fromQuestionResponse));
          section.serverQuestionIds = [...section.serverQuestionIds, ...added.map(a => a.id)];
          this.touchSections();
          this.showExisting.set(false);
          this.banner.set({ kind: 'success', text: `${added.length} question(s) added.` });
        },
        error: err => this.handleError(err, 'action'),
      });
  }

  private queryExisting(keyword: string, page: number): void {
    const section = this.activeSection();
    if (!section || section.id === null) return;
    this.existingQuery$.next({ sectionId: section.id, keyword, page });
  }

  /** Adds server-side questions we don't have yet, without touching the user's unsaved edits. */
  private mergeServerQuestions(section: SectionVm, items: ApiQuestionResponse[], imported: number): void {
    const known = new Set<number>([...section.serverQuestionIds, ...section.questions.map(q => q.id).filter(isNumber)]);
    section.questions.push(...items.filter(i => !known.has(i.id)).map(fromQuestionResponse));
    section.serverQuestionIds = items.map(i => i.id);
    this.touchSections();
    this.banner.set({ kind: 'success', text: `${imported} question(s) imported. Please review the correct answers.` });
  }

  private requireSavedSection(): SectionVm | null {
    const section = this.activeSection();
    if (!section) {
      this.notifyError('Please add a section first.');
      return null;
    }
    if (section.id === null) {
      this.notifyError('Please save the Question Bank before using this option.');
      return null;
    }
    return section;
  }

  private download(res: HttpResponse<Blob>): void {
    const blob = res.body;
    if (!blob) return;
    const header = res.headers.get('Content-Disposition') ?? '';
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
    let name = 'questions.csv';
    try {
      if (encoded) name = decodeURIComponent(encoded);
    } catch {
      /* keep default */
    }
    name = name.replace(/[^\w.\-]/g, '_'); // never trust a server-supplied file name blindly

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ───────────────────────── back / dialogs ─────────────────────────
  back(): void {
    if (this.dirty()) this.showBackDialog.set(true);
    else this.navigateBack();
  }

  discardChanges(): void {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    if (this.draftTimer) clearTimeout(this.draftTimer);
    if (this.scope) this.service.clearDraft(this.scope);
    this.dirty.set(false);
    this.showBackDialog.set(false);
    this.navigateBack();
  }

  saveAndBack(): void {
    this.showBackDialog.set(false);
    this.runSave(() => this.navigateBack());
  }

  runConfirmed(): void {
    const state = this.confirm();
    this.confirm.set(null);
    state?.action();
  }

  private navigateBack(): void {
    void this.router.navigate(['/admin-dashboard', 'courses'], {
      queryParams: this.courseId ? { organize: this.courseId } : undefined,
    });
  }

  // ───────────────────────── errors ─────────────────────────
  private notifyError(text: string): void {
    this.banner.set({ kind: 'error', text });
  }

  private handleError(err: unknown, context: ErrorContext): void {
    const ui = toUiError(err, context);

    if (ui.kind === 'session') {
      // SRS edge case 4: show the message on this page, then redirect to Login.
      if (this.redirecting()) return;
      if (this.draftTimer) clearTimeout(this.draftTimer);
      if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
      this.flushDraft(); // keep work for after re-login
      this.redirecting.set(true);
      this.banner.set({ kind: 'error', text: ui.message });
      setTimeout(
        () => void this.router.navigate(['/login'], { queryParams: { reason: 'session-expired', returnUrl: this.router.url } }),
        SESSION_REDIRECT_DELAY_MS,
      );
      return;
    }
    this.banner.set({ kind: 'error', text: ui.message, conflict: ui.kind === 'conflict' });
  }
}