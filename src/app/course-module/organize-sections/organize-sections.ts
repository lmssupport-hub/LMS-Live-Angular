import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, take } from 'rxjs/operators';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Course } from '../course.model';
import {
  Section,
  SectionApiError,
  SectionManagementService,
} from '../../services/Section management.service';
import { MultimediaUpload } from '../pop-modals/multimedia-upload/multimedia-upload';
import { MultimediaManagementService } from '../../services/multimedia-management.service';
import { MultimediaResource, MultimediaSaveResult } from '../multimedia.model';
import { QuestionBankService, toUiError } from '../../services/question-bank.service';
import { ApiBankResponse } from '../question-bank.model';

// Must match SectionService.validateAndNormalizeName on the backend.
const MIN_CHARS = 3;
const MAX_CHARS = 100;
const GENERIC_ERROR =
  'Unable to complete the requested action due to a server error. Please try again later.';

/** Minimum page height (px) before the page itself is allowed to scroll on very small screens. */
const MIN_PAGE_HEIGHT = 520;

/** Section Name: emoji (incl. flags, skin tones, joined/variation sequences) are not allowed; other special characters are. */
const EMOJI_PATTERN = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u200D\uFE0F\u20E3]/u;
const NAME_EMOJI_MESSAGE = 'Emojis are not allowed.';

/* ---- Activities: Multimedia and Question Bank are live; Ebook comes in the next phase ---- */
export type ActivityKind = 'Ebook' | 'Multimedia' | 'Question Bank';
export interface SectionActivity {
  /** Multimedia resource id OR question bank id - ids of different kinds can be equal, so track by kind + id. */
  id: number;
  kind: ActivityKind;
  title: string;
}

@Component({
  selector: 'app-organize-sections',
  // CHANGED: block host so the fitted height (see updateFit) applies to the root element
  host: { class: 'block' },
  imports: [MultimediaUpload],
  templateUrl: './organize-sections.html',
  styleUrl: './organize-sections.css',
})
export class OrganizeSections implements OnInit, AfterViewInit, OnDestroy {
  /** The course opened from the Course List. */
  @Input({ required: true }) course!: Course;

  /** Back button -> parent closes the Organize screen. */
  readonly closed = output<void>();
  /** "Edit course" button on the banner -> parent opens its edit-course modal. */
  readonly editCourseRequested = output<void>();

  private readonly sectionService = inject(SectionManagementService);

  private readonly multimediaService = inject(MultimediaManagementService);
  private readonly questionBankService = inject(QuestionBankService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  // ---------- page state ----------
  readonly sections = signal<Section[]>([]);
  readonly sectionsLoading = signal(false);
  readonly sectionsError = signal('');
  readonly sectionsRetryAvailable = signal(false);
  readonly sectionSaveMessage = signal('');
  readonly resourceSuccessMessage = signal(''); // top-right toast (used for section toasts too)
  readonly expandedSectionId = signal<number | null>(null);
  readonly previewingSection = signal<Section | null>(null);

  /**
   * NEW: height (px) that fits the admin content area, so the header + banner stay fixed
   * and ONLY the sections list scrolls. null = natural height (before first measure).
   */
  readonly fitHeight = signal<number | null>(null);

  /** NEW: true while the Show Preview icon spins, right before navigating to the preview page. */
  readonly previewOpening = signal(false);

  // ---------- add / edit dialog ----------
  readonly sectionDialogOpen = signal(false);
  readonly editingSection = signal<Section | null>(null);
  /** When set, the new section is inserted right after this section instead of at the end. */
  private readonly insertAfterSectionId = signal<number | null>(null);
  readonly sectionDraft = signal('');
  readonly sectionError = signal('');
  readonly sectionRetryAvailable = signal(false);
  readonly sectionSaving = signal(false); // dialog save in flight
  readonly minNameChars = MIN_CHARS;
  readonly maxNameChars = MAX_CHARS;
  readonly sectionCharCount = computed(() => this.sectionDraft().length);

  // ---------- delete confirmation (section) ----------
  readonly confirmOpen = signal(false);
  readonly confirmMessage = signal('');
  private pendingDelete: Section | null = null;

  // ---------- delete confirmation (activity / multimedia / question bank) ----------
  readonly activityConfirmOpen = signal(false);
  readonly activityConfirmMessage = signal('');
  private pendingActivityDelete: { sectionId: number; activity: SectionActivity } | null = null;

  // ---------- reorder ----------
  readonly reorderingSectionId = signal<number | null>(null);
  readonly draggedSectionId = signal<number | null>(null);
  readonly dragOverSectionId = signal<number | null>(null);

  /** delete / reorder in flight */
  private readonly listSaving = signal(false);
  /** Any write in flight (used to disable Back / Move buttons). */
  readonly sectionsSaving = computed(() => this.sectionSaving() || this.listSaving());

  // ---------- activities ----------
  readonly activityMenuSectionId = signal<number | null>(null);
  readonly draggedActivity = signal<{ sectionId: number; index: number } | null>(null);
  readonly activityDropTarget = signal<{ sectionId: number; index: number } | null>(null);
  private readonly noActivities: SectionActivity[] = [];
  private readonly activityMenuUsedIds = signal<number[]>([]);
  private readonly router = inject(Router);

  isActivityMenuUsed(sectionId: number): boolean {
    return this.activityMenuUsedIds().includes(sectionId);
  }

  markActivityMenuUsed(sectionId: number): void {
    this.activityMenuUsedIds.update(ids => (ids.includes(sectionId) ? ids : [...ids, sectionId]));
  }

  // ---------- multimedia ----------
  /** Resources already fetched, keyed by section id. */
  private readonly resourcesBySection = signal<ReadonlyMap<number, MultimediaResource[]>>(new Map());
  // ---------- question banks ----------
  /** Question banks already fetched, keyed by ORGANIZE section id. */
  private readonly banksBySection = signal<ReadonlyMap<number, ApiBankResponse[]>>(new Map());
  /** Blocks double clicks on Add Activity -> Question Bank while the bank is being created. */
  private readonly bankCreating = signal(false);
  /** Multimedia rows first, then question banks - shaped for the activity rows in the template. */
  private readonly activitiesBySection = computed(() => {
    const resources = this.resourcesBySection();
    const banks = this.banksBySection();
    const map = new Map<number, SectionActivity[]>();
    const sectionIds = new Set<number>([...resources.keys(), ...banks.keys()]);
    for (const sectionId of sectionIds) {
      map.set(sectionId, [
        ...(resources.get(sectionId) ?? []).map(r => ({
          id: r.id,
          kind: 'Multimedia' as const,
          title: r.name,
        })),
        ...(banks.get(sectionId) ?? []).map(b => ({
          id: b.id,
          kind: 'Question Bank' as const,
          title: b.name,
        })),
      ]);
    }
    return map;
  });
  /** Open upload / edit dialog: null = closed, resource = null means "new upload". */
  readonly resourceDialog = signal<{ sectionId: number; resource: MultimediaResource | null } | null>(
    null,
  );

  private pendingRetry: (() => void) | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  // =====================================================================
  // lifecycle
  // =====================================================================

  ngOnInit(): void {
    this.loadSections();
  }

  ngAfterViewInit(): void {
    // wait one tick so the admin layout (sidebar / header) has finished laying out
    setTimeout(() => this.updateFit());
    setTimeout(() => this.updateFit(), 200); // second pass once fonts / layout have settled
  }

  ngOnDestroy(): void {
    clearTimeout(this.toastTimer);
  }

  /** SRS Edge Case #2 / #3: warn before a refresh / tab close discards a half-typed section. */
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) {
      event.preventDefault();
    }
  }

  private hasUnsavedChanges(): boolean {
    if (!this.sectionDialogOpen()) return false;
    return this.sectionDraft().trim() !== (this.editingSection()?.name ?? '');
  }

  // =====================================================================
  // layout: fit the admin content area (only the sections list scrolls)
  // =====================================================================

  @HostListener('window:resize')
  updateFit(): void {
    const top = this.host.nativeElement.getBoundingClientRect().top + window.scrollY;
    const available = window.innerHeight - top - this.ancestorsBottomSpace() - 1;
    this.fitHeight.set(Math.max(MIN_PAGE_HEIGHT, Math.floor(available)));
  }

  /** Bottom padding / margin / border of every ancestor, so the page never overflows the viewport. */
  private ancestorsBottomSpace(): number {
    let total = 0;
    let el: HTMLElement | null = this.host.nativeElement.parentElement;
    while (el) {
      const cs = getComputedStyle(el);
      total +=
        (parseFloat(cs.paddingBottom) || 0) +
        (parseFloat(cs.marginBottom) || 0) +
        (parseFloat(cs.borderBottomWidth) || 0);
      el = el.parentElement;
    }
    return total;
  }

  // =====================================================================
  // header / navigation
  // =====================================================================

  back(): void {
    if (this.sectionsSaving()) return;
    this.closed.emit();
  }

  /** "Show Preview" -> opens the separate course preview page (route: courses/:courseId/preview). */
  openPreviewPage(): void {
    if (this.previewOpening()) return; // repeated clicks open only once
    try {
      sessionStorage.setItem(`course-preview:${this.course.id}`, JSON.stringify(this.course));
    } catch {
      /* storage unavailable */
    }
    // let the ▶ icon finish its 360° spin, then open the page (which unrolls itself)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.previewOpening.set(true);
    setTimeout(
      () => void this.router.navigate(['/admin-dashboard', 'courses', this.course.id, 'preview']),
      reduceMotion ? 0 : 450,
    );
  }

  // =====================================================================
  // course display helpers
  // =====================================================================

  /**
   * ASSUMPTION: the Course model exposes the thumbnail as `thumbnailUrl`.
   * If yours is named differently, change it here (or reuse the course list's cardThumbnail logic).
   */
  cardThumbnail(): string | null {
    const raw = (this.course as Course & { thumbnailUrl?: string | null }).thumbnailUrl;
    if (!raw) return null;
    return /^https?:\/\//i.test(raw)
      ? raw
      : `${environment.apiBaseUrl}${raw.startsWith('/') ? '' : '/'}${raw}`;
  }

  levelLabel(level: unknown): string {
    if (typeof level !== 'string' || !level) return '';
    const text = level.replace(/_/g, ' ').toLowerCase();
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // =====================================================================
  // load section list
  // =====================================================================

  loadSections(): void {
    this.sectionsLoading.set(true);
    this.clearPageError();
    this.sectionService
      .getSections(this.course.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: list => {
          this.sections.set(this.sortByOrder(list));
          this.sectionsLoading.set(false);
          // fetch every section's activities so the count pills are correct on page load / refresh
          this.loadAllResources(this.sections());
        },
        error: (err: unknown) => {
          this.sectionsLoading.set(false);
          this.failPage(err, () => this.loadSections());
        },
      });
  }

  retrySectionsRequest(): void {
    const retry = this.pendingRetry;
    this.clearPageError();
    retry?.();
  }

  // =====================================================================
  // add / edit section
  // =====================================================================

  /**
   * Optional `afterSectionId` - when given (from the "+" between sections),
   * the new section is placed right after that section; otherwise it goes at the end.
   */
  openAddSection(afterSectionId: number | null = null): void {
    this.insertAfterSectionId.set(afterSectionId);
    this.editingSection.set(null);
    this.sectionDraft.set('');
    this.sectionError.set('');
    this.sectionRetryAvailable.set(false);
    this.sectionDialogOpen.set(true);
  }

  openEditSection(section: Section): void {
    this.insertAfterSectionId.set(null);
    this.editingSection.set(section);
    this.sectionDraft.set(section.name);
    this.sectionError.set('');
    this.sectionRetryAvailable.set(false);
    this.sectionDialogOpen.set(true);
  }

  closeSectionDialog(): void {
    if (this.sectionSaving()) return; // Cancel is ignored while a save is in flight
    this.resetSectionDialog();
  }

  /** Unconditional reset - also used by the save success handler. */
  private resetSectionDialog(): void {
    this.insertAfterSectionId.set(null);
    this.sectionDialogOpen.set(false);
    this.editingSection.set(null);
    this.sectionDraft.set('');
    this.sectionError.set('');
    this.sectionRetryAvailable.set(false);
  }

  /** Stops emoji from being typed or pasted into Section Name (validateName still catches anything else). */
  blockEmoji(event: Event): void {
    const data = (event as InputEvent).data;
    if (data && EMOJI_PATTERN.test(data)) event.preventDefault();
  }

  retrySectionSave(): void {
    this.saveSection();
  }

  saveSection(): void {
    // SRS Edge Case #1: repeated clicks must create only one section.
    if (this.sectionSaving()) return;

    const editing = this.editingSection();
    const name = this.sectionDraft().trim();
    // captured before the dialog is reset in the success handler
    const afterId = this.insertAfterSectionId();

    const validationError = this.validateName(name, editing?.id ?? null);
    if (validationError) {
      this.sectionError.set(validationError);
      this.sectionRetryAvailable.set(false);
      return;
    }

    this.sectionError.set('');
    this.sectionRetryAvailable.set(false);
    this.sectionSaving.set(true);
    this.sectionSaveMessage.set('Saving…');

    const request$ = editing
      ? this.sectionService.updateSection(this.course.id, editing.id, name)
      : this.sectionService.createSection(this.course.id, name);

    request$
      .pipe(
        finalize(() => {
          this.sectionSaving.set(false);
          this.sectionSaveMessage.set('');
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: saved => {
          if (editing) {
            this.sections.update(list => list.map(s => (s.id === saved.id ? saved : s)));
            this.resetSectionDialog(); // NOT closeSectionDialog(): sectionSaving is still true here
            this.showToast('Section updated successfully.');
            return;
          }

          // The backend creates the new section at the end.
          const list = this.sortByOrder([...this.sections(), saved]);
          this.sections.set(list);
          this.resetSectionDialog(); // NOT closeSectionDialog(): sectionSaving is still true here

          // If it was added from a "+" between sections, move it right after that section
          // using the existing reorder API (no backend change needed).
          const afterIndex = afterId === null ? -1 : list.findIndex(s => s.id === afterId);
          if (afterIndex >= 0 && afterIndex < list.length - 2) {
            const reordered = list.filter(s => s.id !== saved.id);
            reordered.splice(afterIndex + 1, 0, saved);
            this.persistOrder(reordered, 'Section created successfully.');
          } else {
            this.showToast('Section created successfully.');
          }
        },
        error: (err: unknown) => {
          this.sectionError.set(this.messageOf(err));
          this.sectionRetryAvailable.set(err instanceof SectionApiError && err.retryable);
        },
      });
  }

  // =====================================================================
  // row actions (Edit / Delete / Reorder / Preview)
  // =====================================================================

  toggleSection(sectionId: number): void {
    // The Add Activity menu lives inside the expanded panel, which is destroyed on collapse.
    // Reset its state so a re-opened panel doesn't render the menu already in its "closing" state
    // (that was the "activity menu appears then closes" flash).
    this.activityMenuSectionId.set(null);
    this.activityMenuUsedIds.set([]);

    this.expandedSectionId.update(current => (current === sectionId ? null : sectionId));
    // Refresh this section's multimedia when it is opened
    if (this.expandedSectionId() === sectionId) this.loadResources(sectionId);
  }

  selectSectionAction(section: Section, select: HTMLSelectElement): void {
    const action = select.value;
    select.value = ''; // reset the dropdown back to "Actions"

    switch (action) {
      case 'edit':
        this.openEditSection(section);
        break;
      case 'delete':
        this.requestRemoveSection(section);
        break;
      case 'reorder':
        this.reorderingSectionId.update(current => (current === section.id ? null : section.id));
        break;
      case 'preview':
        this.loadResources(section.id); // make sure the preview lists its multimedia
        this.previewingSection.set(section);
        break;
    }
  }

  closeSectionPreview(): void {
    this.previewingSection.set(null);
  }

  // =====================================================================
  // delete
  // =====================================================================

  requestRemoveSection(section: Section): void {
    this.pendingDelete = section;
    const activityCount = this.activitiesForSection(section.id).length;
    // SRS Edge Case #7: sections that contain learning content still need a confirmation.
    this.confirmMessage.set(
      activityCount > 0
        ? `"${section.name}" contains ${activityCount} activit${activityCount === 1 ? 'y' : 'ies'}. Deleting this section will remove them as well. This action cannot be undone.`
        : `Are you sure you want to delete "${section.name}"? This action cannot be undone.`,
    );
    this.confirmOpen.set(true);
  }

  answerRemoveSection(confirmed: boolean): void {
    const target = this.pendingDelete;
    this.pendingDelete = null;
    this.confirmOpen.set(false);
    if (confirmed && target) {
      this.deleteSection(target);
    }
  }

  private deleteSection(target: Section): void {
    if (this.listSaving()) return;

    this.clearPageError();
    this.listSaving.set(true);
    this.sectionSaveMessage.set('Deleting…');

    this.sectionService
      .deleteSection(this.course.id, target.id)
      .pipe(
        finalize(() => {
          this.listSaving.set(false);
          this.sectionSaveMessage.set('');
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          // The backend renumbers the remaining sections 1..n; mirror that locally.
          this.sections.update(list =>
            list.filter(s => s.id !== target.id).map((s, i) => ({ ...s, sectionOrder: i + 1 })),
          );
          // drop the deleted section's cached multimedia
          this.resourcesBySection.update(map => {
            const next = new Map(map);
            next.delete(target.id);
            return next;
          });
          // ...and its cached question banks (the backend cascades the delete)
          this.banksBySection.update(map => {
            const next = new Map(map);
            next.delete(target.id);
            return next;
          });
          if (this.expandedSectionId() === target.id) this.expandedSectionId.set(null);
          if (this.reorderingSectionId() === target.id) this.reorderingSectionId.set(null);
          if (this.previewingSection()?.id === target.id) this.previewingSection.set(null);
          this.showToast('Section deleted successfully.');
        },
        error: (err: unknown) => this.failPage(err, () => this.deleteSection(target)),
      });
  }

  // =====================================================================
  // reorder (Move up / Move down / drag & drop)
  // =====================================================================

  canMoveSection(sectionId: number, direction: -1 | 1): boolean {
    const list = this.sections();
    const index = list.findIndex(s => s.id === sectionId);
    const target = index + direction;
    return index >= 0 && target >= 0 && target < list.length;
  }

  moveSection(sectionId: number, direction: -1 | 1): void {
    if (!this.canMoveSection(sectionId, direction)) return;
    const next = [...this.sections()];
    const index = next.findIndex(s => s.id === sectionId);
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    this.persistOrder(next);
  }

  startSectionDrag(event: DragEvent, section: Section): void {
    this.draggedSectionId.set(section.id);
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', String(section.id));
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  dragOverSection(event: DragEvent, section: Section): void {
    if (this.draggedSectionId() === null) return; // ignore activity drags
    event.preventDefault(); // required to allow dropping
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dragOverSectionId.set(section.id);
  }

  dropSection(event: DragEvent, section: Section): void {
    const draggedId = this.draggedSectionId();
    if (draggedId === null) return;
    event.preventDefault();
    this.endSectionDrag();
    if (draggedId !== section.id) {
      this.moveSectionTo(draggedId, section.id);
    }
  }

  endSectionDrag(): void {
    this.draggedSectionId.set(null);
    this.dragOverSectionId.set(null);
  }

  private moveSectionTo(sourceId: number, targetId: number): void {
    const next = [...this.sections()];
    const from = next.findIndex(s => s.id === sourceId);
    const to = next.findIndex(s => s.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    this.persistOrder(next);
  }

  /**
   * Optimistic update: show the new order immediately, roll back if the API call fails.
   * Optional `successMessage` so "create after a section" can reuse this with its own toast.
   */
  private persistOrder(next: Section[], successMessage = 'Sections reordered successfully.'): void {
    if (this.listSaving() || next.length < 2) return;

    const previous = this.sections();
    const renumbered = next.map((s, i) => ({ ...s, sectionOrder: i + 1 }));
    this.sections.set(renumbered);

    this.clearPageError();
    this.listSaving.set(true);
    this.sectionSaveMessage.set('Saving order…');

    const items = renumbered.map(s => ({ sectionId: s.id, newOrder: s.sectionOrder }));

    this.sectionService
      .reorderSections(this.course.id, items)
      .pipe(
        finalize(() => {
          this.listSaving.set(false);
          this.sectionSaveMessage.set('');
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: updated => {
          this.sections.set(this.sortByOrder(updated));
          this.showToast(successMessage);
        },
        error: (err: unknown) => {
          this.sections.set(previous);
          this.failPage(err, () => this.persistOrder(next));
        },
      });
  }

  // =====================================================================
  // ACTIVITIES
  // Multimedia and Question Bank are implemented below. Ebook / activity drag & drop
  // are still placeholders so the template compiles.
  // =====================================================================

  activitiesForSection(sectionId: number): SectionActivity[] {
    return this.activitiesBySection().get(sectionId) ?? this.noActivities;
  }

  /**
   * Single entry point for row click / Enter / Space / pencil icon on an EXISTING activity.
   * It always passes `activity`, so an existing Question Bank is opened (goToBank) and
   * never re-created as a new empty bank.
   */
  openActivity(sectionId: number, activity: SectionActivity): void {
    if (activity.kind === 'Question Bank') {
      this.openQuestionBankList(sectionId, activity);
    } else {
      this.openResourceDialog(activity.kind, sectionId, activity);
    }
  }

  /** Add Activity -> Multimedia opens the upload dialog; the pencil icon on a row opens it in edit mode. */
  openResourceDialog(kind: ActivityKind, sectionId: number, activity?: SectionActivity): void {
    this.activityMenuSectionId.set(null);
    // the pencil icon of a Question Bank row opens that bank's editor
    if (kind === 'Question Bank') {
      if (activity) this.openQuestionBankList(sectionId, activity);
      return;
    }
    if (kind !== 'Multimedia') {
      this.showToast(`${kind} upload will be available soon.`);
      return;
    }
    const resource = activity
      ? ((this.resourcesBySection().get(sectionId) ?? []).find(r => r.id === activity.id) ?? null)
      : null;
    this.resourceDialog.set({ sectionId, resource });
  }

  closeResourceDialog(): void {
    this.resourceDialog.set(null);
  }

  /** <app-multimedia-upload> finished a successful upload / edit. */
  onResourceSaved({ resource, created }: MultimediaSaveResult): void {
    this.resourcesBySection.update(map => {
      const list = map.get(resource.sectionId) ?? [];
      const next = created
        ? [...list, resource]
        : list.map(r => (r.id === resource.id ? resource : r));
      return new Map(map).set(resource.sectionId, next);
    });
    this.resourceDialog.set(null);
    this.showToast(created ? 'Resource uploaded successfully.' : 'Resource updated successfully.');
  }

  /** Delete icon on an activity row -> open the confirmation popup first. */
  requestRemoveActivity(sectionId: number, activity: SectionActivity): void {
    this.pendingActivityDelete = { sectionId, activity };
    this.activityConfirmMessage.set(
      activity.kind === 'Question Bank'
        ? `Are you sure you want to delete "${activity.title}"? All its sections and questions will be removed. This action cannot be undone.`
        : `Are you sure you want to delete "${activity.title}"? This action cannot be undone.`,
    );
    this.activityConfirmOpen.set(true);
  }

  /** Cancel / Delete activity buttons of the confirmation popup. */
  answerRemoveActivity(confirmed: boolean): void {
    const target = this.pendingActivityDelete;
    this.pendingActivityDelete = null;
    this.activityConfirmOpen.set(false);
    if (confirmed && target) {
      // a Question Bank row is deleted through the question-bank API, not the multimedia API
      if (target.activity.kind === 'Question Bank') {
        this.removeBank(target.sectionId, target.activity.id);
      } else {
        this.removeActivity(target.sectionId, target.activity.id);
      }
    }
  }

  removeActivity(sectionId: number, activityId: number): void {
    this.multimediaService
      .deleteResource(this.course.id, sectionId, activityId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.resourcesBySection.update(map =>
            new Map(map).set(
              sectionId,
              (map.get(sectionId) ?? []).filter(r => r.id !== activityId),
            ),
          );
          this.showToast('Resource deleted successfully.');
        },
        error: (err: unknown) => this.showToast(this.messageOf(err)),
      });
  }

  /** Deletes a Question Bank (the backend cascades its question sections, questions and options). */
  private removeBank(sectionId: number, bankId: number): void {
    this.questionBankService
      .deleteBank({ courseId: this.course.id, sectionId, bankId })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.banksBySection.update(map =>
            new Map(map).set(
              sectionId,
              (map.get(sectionId) ?? []).filter(b => b.id !== bankId),
            ),
          );
          this.showToast('Question bank deleted successfully.');
        },
        error: (err: unknown) => this.showToast(toUiError(err).message),
      });
  }

  /** Page load / refresh - fetch every section's multimedia + question banks so the count pills are correct. */
  private loadAllResources(sections: Section[]): void {
    sections.forEach(s => this.loadResources(s.id, true));
  }

  /**
   * `silent` = background load (page load) - failures don't pop an error toast.
   * Expanding / previewing a section still reports errors.
   */
  private loadResources(sectionId: number, silent = false): void {
    this.loadBanks(sectionId, silent);
    this.multimediaService
      .getResources(this.course.id, sectionId)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: list => this.resourcesBySection.update(map => new Map(map).set(sectionId, list)),
        error: (err: unknown) => {
          if (!silent) this.showToast(this.messageOf(err));
        },
      });
  }

  /** Question banks of one organize section. */
  private loadBanks(sectionId: number, silent: boolean): void {
    this.questionBankService
      .listBanks(this.course.id, sectionId)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: list => this.banksBySection.update(map => new Map(map).set(sectionId, list)),
        error: (err: unknown) => {
          if (!silent) this.showToast(toUiError(err).message);
        },
      });
  }

  /**
   * Question Bank activity.
   *  - Add Activity -> Question Bank (no `activity`): creates a new empty bank in THIS organize section
   *    and opens its editor.
   *  - Click / pencil on an existing Question Bank row (`activity` given): opens that bank's editor.
   * The editor route carries courseId + organize sectionId + bankId.
   */
  openQuestionBankList(sectionId: number, activity?: SectionActivity): void {
    this.activityMenuSectionId.set(null);
    if (activity) {
      this.goToBank(sectionId, activity.id);
      return;
    }
    this.createBankAndOpen(sectionId);
  }

  private createBankAndOpen(sectionId: number): void {
    if (this.bankCreating()) return; // repeated clicks must create only one bank
    this.bankCreating.set(true);

    this.questionBankService
      .createBank(this.course.id, sectionId, this.nextBankName(sectionId))
      .pipe(
        finalize(() => this.bankCreating.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: bank => {
          this.banksBySection.update(map => new Map(map).set(sectionId, [...(map.get(sectionId) ?? []), bank]));
          this.goToBank(sectionId, bank.id);
        },
        error: (err: unknown) => this.showToast(toUiError(err).message),
      });
  }

  private goToBank(sectionId: number, bankId: number): void {
    void this.router.navigate([
      '/admin-dashboard',
      'courses',
      this.course.id,
      'sections',
      sectionId,
      'question-banks',
      bankId,
    ]);
  }

  /** "Question Bank 1", "Question Bank 2" ... - unique inside the section (backend rejects duplicate names). */
  private nextBankName(sectionId: number): string {
    const existing = this.banksBySection().get(sectionId) ?? [];
    const taken = new Set(existing.map(b => b.name.trim().toLowerCase()));
    for (let n = existing.length + 1; n < existing.length + 1000; n++) {
      const candidate = `Question Bank ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `Question Bank ${Date.now()}`;
  }

  startActivityDrag(event: DragEvent, sectionId: number, index: number): void {
    this.draggedActivity.set({ sectionId, index });
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', `activity:${sectionId}:${index}`);
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  endActivityDrag(): void {
    this.draggedActivity.set(null);
    this.activityDropTarget.set(null);
  }

  dragOverActivity(event: DragEvent, sectionId: number, index: number): void {
    const dragged = this.draggedActivity();
    // Only reordering inside the same section is supported.
    if (!dragged || dragged.sectionId !== sectionId) return;
    event.preventDefault(); // required to allow dropping
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.activityDropTarget.set({ sectionId, index });
  }

  dropActivity(event: DragEvent, sectionId: number, index: number): void {
    const dragged = this.draggedActivity();
    if (!dragged || dragged.sectionId !== sectionId) {
      this.endActivityDrag();
      return;
    }
    event.preventDefault();
    this.endActivityDrag();
    this.moveActivity(sectionId, dragged.index, index);
  }

  dropActivityAtEnd(event: DragEvent, sectionId: number): void {
    const dragged = this.draggedActivity();
    if (!dragged || dragged.sectionId !== sectionId) {
      this.endActivityDrag();
      return;
    }
    event.preventDefault();
    this.endActivityDrag();
    this.moveActivity(sectionId, dragged.index, this.activitiesForSection(sectionId).length);
  }

  /**
   * Moves an activity row inside its section (local order only).
   * Multimedia rows are listed first, then Question Banks, so each kind is reordered within its own group:
   * dropping a bank on a multimedia row puts it at the top of the banks.
   * TODO: call the backend reorder endpoint here once it exists, otherwise the order resets
   * when the section is collapsed / expanded (loadResources re-fetches the server order).
   */
  private moveActivity(sectionId: number, from: number, to: number): void {
    const resources = [...(this.resourcesBySection().get(sectionId) ?? [])];
    const banks = [...(this.banksBySection().get(sectionId) ?? [])];

    // Multimedia row
    if (from >= 0 && from < resources.length) {
      if (from === to) return;
      const [moved] = resources.splice(from, 1);
      resources.splice(Math.min(to, resources.length), 0, moved);
      this.resourcesBySection.update(map => new Map(map).set(sectionId, resources));
      return;
    }

    // Question Bank row
    const bankFrom = from - resources.length;
    if (bankFrom < 0 || bankFrom >= banks.length) return;
    const bankTo = Math.max(0, Math.min(to - resources.length, banks.length));
    if (bankFrom === bankTo) return;
    const [moved] = banks.splice(bankFrom, 1);
    banks.splice(Math.min(bankTo, banks.length), 0, moved);
    this.banksBySection.update(map => new Map(map).set(sectionId, banks));
  }

  // =====================================================================
  // helpers
  // =====================================================================

  /** Same rules as SectionService.validateAndNormalizeName + the duplicate check. */
  private validateName(name: string, excludeId: number | null): string | null {
    if (!name) return 'Section Name is required.';
    if (EMOJI_PATTERN.test(name)) return NAME_EMOJI_MESSAGE;
    if (name.length < MIN_CHARS) return `Section Name must be at least ${MIN_CHARS} characters.`;
    if (name.length > MAX_CHARS) return `Section Name must not exceed ${MAX_CHARS} characters.`;
    const duplicate = this.sections().some(
      s => s.id !== excludeId && s.name.trim().toLowerCase() === name.toLowerCase(),
    );
    return duplicate ? 'A section with the same name already exists in this course.' : null;
  }

  private sortByOrder(list: Section[]): Section[] {
    return [...list].sort((a, b) => a.sectionOrder - b.sectionOrder);
  }

  private messageOf(err: unknown): string {
    return err instanceof Error && err.message ? err.message : GENERIC_ERROR;
  }

  private failPage(err: unknown, retry: () => void): void {
    this.sectionsError.set(this.messageOf(err));
    const retryable = err instanceof SectionApiError ? err.retryable : true;
    this.sectionsRetryAvailable.set(retryable);
    this.pendingRetry = retryable ? retry : null;
  }

  private clearPageError(): void {
    this.sectionsError.set('');
    this.sectionsRetryAvailable.set(false);
    this.pendingRetry = null;
  }

  private showToast(message: string): void {
    clearTimeout(this.toastTimer);
    this.resourceSuccessMessage.set(message);
    this.toastTimer = setTimeout(() => this.resourceSuccessMessage.set(''), 3000);
  }
}