import { CommonModule } from '@angular/common';
import { Component, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs/operators';
 
import { CreateCourseModal } from '../pop-modals/create-course-modal/create-course-modal';
import { OrganizeSections } from '../organize-sections/organize-sections';
import {
  ALLOWED_THUMBNAIL_TYPES,
  Course,
  CourseFilter,
  CourseLevel,
  CourseRequest,
  CourseStatus,
  COURSE_CATEGORIES,
  COURSE_LEVELS,
  MAX_THUMBNAIL_BYTES,
} from '../course.model';
import { CourseManagementService } from '../../services/course-management.service';
 
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';
 
type DropdownName = 'filter';
 
@Component({
  selector: 'app-course-management',
  // CHANGED: added OrganizeSections
  imports: [CommonModule, ReactiveFormsModule, CreateCourseModal, OrganizeSections],
  templateUrl: './course-management.html',
  styleUrl: './course-management.css',
})
export class CourseManagement {
  private readonly courseManagementService = inject(CourseManagementService);
  private readonly authService = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  // NEW: used to keep the Organize screen in sync with the URL (?organize=<courseId>)
  private readonly route = inject(ActivatedRoute);
 
  // ---------- list state ----------
  readonly courses = signal<Course[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly search = signal('');
  readonly courseFilter = signal<CourseFilter>('ALL');
  readonly courseFilterOptions: CourseFilter[] = ['ALL', 'DRAFT', 'PUBLISHED', 'ARCHIVED',];
  readonly openDropdown = signal<DropdownName | null>(null);
  // NEW: which course card's 3-dot menu is open
  readonly openCardMenuId = signal<number | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly permissionError = signal<string | null>(null);
 
  readonly filteredCourses = computed(() => {
    const term = this.search().trim().toLowerCase();
    const status = this.courseFilter();
    return this.courses().filter(course => {
      const matchesSearch = !term || course.name.toLowerCase().includes(term);
      const matchesFilter = status === 'ALL' || course.status === status;
      return matchesSearch && matchesFilter;
    });
  });
 
  // ---------- role checks ----------
  readonly isAdmin = computed(() => this.authService.user()?.role === 'ADMIN');
  readonly isLearner = computed(() => this.authService.user()?.role === 'LEARNER');
  readonly canManage = computed(() => {
    const role = this.authService.user()?.role;
    return role === 'ADMIN' || role === 'INSTRUCTOR';
  });
 
  // ---------- organize (sections) state ----------
  // CHANGED: replaces the old contentEditorOpen / editorCourse pair.
  readonly organizingCourse = signal<Course | null>(null);

  /** NEW: course id from the URL (?organize=<id>), or null when the Organize screen is closed. */
  private readonly organizeId = toSignal(
    this.route.queryParamMap.pipe(map(params => Number(params.get('organize')) || null)),
    { initialValue: null },
  );
 
  // ---------- create/edit/view modal state (rendered via <app-create-course-modal>) ----------
  readonly modalOpen = signal(false);
  readonly editingCourse = signal<Course | null>(null);
  readonly viewingCourse = signal<Course | null>(null);
  readonly categories = COURSE_CATEGORIES;
  readonly instructors = signal<{ id: number; name: string; email?: string }[]>([]);
  readonly levels = signal<CourseLevel[]>(COURSE_LEVELS);
  readonly lookupLoading = signal(false);
  readonly lookupError = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly thumbnailPreview = signal<string | null>(null);
  readonly thumbnailError = signal<string | null>(null);
  readonly formError = signal<string | null>(null);
  private selectedThumbnailFile: File | null = null;
  private thumbnailPreviewUrl: string | null = null;
 
  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(100)]],
    description: ['', [Validators.maxLength(1000)]],
    categoryId: [null as number | null, Validators.required],
    instructorId: [null as number | null, Validators.required],
    level: ['' as CourseLevel | '', Validators.required],
    status: ['' as CourseStatus | '', Validators.required],
  });
 
  // ---------- confirmation dialog state (delete / discard-unsaved-changes) ----------
  readonly confirmOpen = signal(false);
  readonly confirmTitle = signal('');
  readonly confirmMessage = signal('');
  readonly deleteTarget = signal<Course | null>(null);
 
  constructor() {
    // NEW: the URL is the source of truth for the Organize screen.
    // ?organize=<id> opens it, no param closes it (header breadcrumb / browser back).
    effect(() => {
      const id = this.organizeId();
      const course = id ? this.courses().find(c => c.id === id) ?? null : null;
      untracked(() => this.organizingCourse.set(course));
    });

    this.loadCourses();
  }
 
  // ---------- list loading ----------
  loadCourses(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.courseManagementService.getAllCourses().subscribe({
      next: courses => {
        this.courses.set(courses);
        this.loading.set(false);
        // CHANGED: if the Organize screen is open, refresh its course with the edited data
        const organizing = this.organizingCourse();
        if (organizing) {
          const fresh = courses.find(c => c.id === organizing.id);
          if (fresh) this.organizingCourse.set(fresh);
        }
      },
      error: (err: Error) => {
        // SRS Edge Case #4/#5: connection lost / server unavailable → show error, allow retry.
        this.loadError.set(err.message);
        this.loading.set(false);
      },
    });
  }
 
  updateSearch(value: string): void {
    this.search.set(value);
  }
 
  toggleDropdown(name: DropdownName): void {
    this.openDropdown.update(current => (current === name ? null : name));
  }
 
  /** NEW: 3-dot button on a course card. */
  toggleCardMenu(courseId: number, event: Event): void {
    event.stopPropagation(); // otherwise the document click handler would close it immediately
    this.openCardMenuId.update(current => (current === courseId ? null : courseId));
  }
 
  selectCourseFilter(option: CourseFilter): void {
    this.courseFilter.set(option);
    this.openDropdown.set(null);
  }
 
  @HostListener('document:click')
  closeFilterDropdown(): void {
    this.openDropdown.set(null);
    this.openCardMenuId.set(null); // NEW: click anywhere else closes the card menu
  }
 
  // ---------- unsaved-changes guard (SRS Edge Cases #2, #3, #7) ----------
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.modalOpen() && this.form.dirty && !this.viewingCourse()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
 
 
 
  // ---------- organize (sections) ----------
  /** NEW: edit (pencil) icon on a course card opens the Organize screen. */
  openOrganize(course: Course): void {
    this.organizingCourse.set(course);
    // CHANGED: also put it in the URL so the header breadcrumb can show "Organize Modules"
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { organize: course.id },
      queryParamsHandling: 'merge',
    });
  }
 
  /** NEW: Back button inside the Organize screen (also used when the header "Course List" crumb is clicked). */
  closeOrganize(): void {
    this.organizingCourse.set(null);
    // CHANGED: remove ?organize from the URL
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { organize: null },
      queryParamsHandling: 'merge',
    });
  }
 
  /**
   * NEW: "Edit course details" link inside the Organize screen → open the edit-course modal.
   * CHANGED: the Organize screen stays open behind the modal, so closing / saving the modal
   * returns the user to the same sections page instead of the course list.
   */
  editFromOrganize(): void {
    const course = this.organizingCourse();
    if (course) this.openEditModal(course);
  }
 
  // ---------- create / edit / view ----------
  openCreateModal(): void {
    this.editingCourse.set(null);
    this.viewingCourse.set(null);
    this.resetForm();
    this.modalOpen.set(true);
    this.loadLookups();
  }
 
  openEditModal(course: Course): void {
    this.editingCourse.set(course);
    this.viewingCourse.set(null);
    this.patchForm(course);
    this.modalOpen.set(true);
    this.loadLookups();
  }
 
  openViewModal(course: Course): void {
    this.editingCourse.set(null);
    this.viewingCourse.set(course);
    this.patchForm(course);
    this.modalOpen.set(true);
    // View mode shows the names the backend already resolved (see selectedCategoryName /
    // selectedInstructorName in CreateCourseModal), so lookups aren't strictly required —
    // but loading them keeps behavior consistent if the user flips into Edit from here later.
    this.loadLookups();
  }
 
  loadLookups(): void {
    this.lookupLoading.set(true);
    this.lookupError.set(null);
    this.courseManagementService.getActiveInstructors().subscribe({
      next: instructors => {
        this.instructors.set(instructors);
        this.lookupLoading.set(false);
      },
      error: (err: Error) => {
        this.lookupError.set(err.message);
        this.lookupLoading.set(false);
      },
    });
  }
 
  selectCategory(id: number): void {
    this.form.controls.categoryId.setValue(id);
    this.form.controls.categoryId.markAsDirty();
  }
 
  selectInstructor(id: number): void {
    this.form.controls.instructorId.setValue(id);
    this.form.controls.instructorId.markAsDirty();
  }
 
  selectLevel(level: CourseLevel): void {
    this.form.controls.level.setValue(level);
    this.form.controls.level.markAsDirty();
  }
 
  onThumbnailSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.thumbnailError.set(null);
 
    if (!file) {
      this.clearThumbnail();
      return;
    }
    // Field List #4 validation rules.
    if (!ALLOWED_THUMBNAIL_TYPES.includes(file.type)) {
      this.thumbnailError.set('Invalid file format.');
      input.value = '';
      return;
    }
    if (file.size > MAX_THUMBNAIL_BYTES) {
      this.thumbnailError.set('File size exceeds 5 MB');
      input.value = '';
      return;
    }
 
    this.selectedThumbnailFile = file;
    this.form.markAsDirty();
    if (this.thumbnailPreviewUrl) URL.revokeObjectURL(this.thumbnailPreviewUrl);
    this.thumbnailPreviewUrl = URL.createObjectURL(file);
    this.thumbnailPreview.set(this.thumbnailPreviewUrl);
  }
 
  private clearThumbnail(): void {
    this.selectedThumbnailFile = null;
    if (this.thumbnailPreviewUrl) URL.revokeObjectURL(this.thumbnailPreviewUrl);
    this.thumbnailPreviewUrl = null;
    this.thumbnailPreview.set(null);
  }

  /** NEW: × next to the thumbnail file name in the modal -> remove the selected image. */
  removeThumbnail(): void {
    this.clearThumbnail();
    this.thumbnailError.set(null);
    this.form.markAsDirty();
  }
 
  saveCourse(): void {
    // SRS Edge Case #1: "user clicks Save Course multiple times" → process only the first.
    if (this.submitting()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
 
    this.submitting.set(true);
    this.formError.set(null);
 
    const request: CourseRequest = {
      name: this.form.value.name!.trim(),
      description: this.form.value.description || null,
      categoryId: this.form.value.categoryId!,
      instructorId: this.form.value.instructorId!,
      level: this.form.value.level as CourseLevel,
      status: this.form.value.status as CourseStatus,
    };
 
    const editing = this.editingCourse();
    const request$ = editing
      ? this.courseManagementService.updateCourse(editing.id, request, this.selectedThumbnailFile)
      : this.courseManagementService.createCourse(request, this.selectedThumbnailFile);
 
    request$.subscribe({
      next: () => {
        this.submitting.set(false);
        this.successMessage.set(editing ? 'Course updated successfully.' : 'Course created successfully.');
        setTimeout(() => this.successMessage.set(null), 4000);
        this.closeModal();
        this.loadCourses();
      },
      error: (err: Error) => {
        this.submitting.set(false);
        // SRS Field List #1 / Edge Case #6: duplicate course name, surfaced on the field itself.
        if (/already exists/i.test(err.message)) {
          this.form.controls.name.setErrors({ duplicate: true });
          this.form.controls.name.markAsTouched();
          return;
        }
        // Anything else (server error, lost connection) → generic, retryable banner
        // (SRS Edge Cases #4 and #5).
        this.formError.set(err.message);
      },
    });
  }
 
  // ---------- close / discard-changes confirmation ----------
  requestClose(): void {
    if (this.form.dirty && !this.viewingCourse()) {
      this.deleteTarget.set(null);
      this.confirmTitle.set('Discard unsaved changes?');
      this.confirmMessage.set('You have unsaved changes. Are you sure you want to close without saving?');
      this.confirmOpen.set(true);
      return;
    }
    this.closeModal();
  }
 
  private closeModal(): void {
    this.modalOpen.set(false);
    this.editingCourse.set(null);
    this.viewingCourse.set(null);
    this.resetForm();
    this.clearThumbnail();
    this.formError.set(null);
  }
 
  private resetForm(): void {
    this.form.reset({
      name: '',
      description: '',
      categoryId: null,
      instructorId: null,
      level: '',
      status: '',
    });
    this.form.markAsPristine();
  }
 
  private patchForm(course: Course): void {
    this.form.reset({
      name: course.name,
      description: course.description ?? '',
      categoryId: course.categoryId,
      instructorId: course.instructorId,
      level: course.level,
      status: course.status,
    });
    // FIXED: course.thumbnailUrl is a backend-relative path (e.g. "/uploads/thumbnails/x.png").
    // Feeding that straight into an <img> would resolve against the Angular app's own origin,
    // not the API's — resolveThumbnailUrl() prefixes it with the backend's base URL instead.
    this.thumbnailPreview.set(this.resolveThumbnailUrl(course.thumbnailUrl));
    this.selectedThumbnailFile = null;
    this.form.markAsPristine();
  }
 
  // ---------- delete ----------
  requestDelete(course: Course): void {
    this.deleteTarget.set(course);
    this.confirmTitle.set('Delete this course?');
    this.confirmMessage.set(`"${course.name}" will be permanently removed. This action cannot be undone.`);
    this.confirmOpen.set(true);
  }
 
  answerConfirmation(confirmed: boolean): void {
    const target = this.deleteTarget();
    this.confirmOpen.set(false);
 
    if (!confirmed) {
      this.deleteTarget.set(null);
      return;
    }
 
    if (target) {
      this.courseManagementService.deleteCourse(target.id).subscribe({
        next: () => {
          this.successMessage.set('Course deleted successfully.');
          setTimeout(() => this.successMessage.set(null), 4000);
          this.deleteTarget.set(null);
          this.loadCourses();
        },
        error: (err: Error) => {
          this.loadError.set(err.message);
          this.deleteTarget.set(null);
        },
      });
      return;
    }
 
    // No delete target → this was the "discard unsaved changes" confirmation.
    this.closeModal();
  }
 
  // ---------- display helpers ----------
  cardThumbnail(course: Course): string | null {
    return this.resolveThumbnailUrl(course.thumbnailUrl);
  }
 
  /**
   * NEW: thumbnailUrl comes back from the backend as a relative path like
   * "/uploads/thumbnails/abc.png" — that only resolves correctly if it's fetched
   * from the API's own origin, not the Angular app's origin (they're different
   * ports/hosts in dev, and can be different domains in prod). A blob: URL (used
   * for a freshly-picked, not-yet-uploaded thumbnail) or an already-absolute
   * http(s) URL is passed through untouched.
   */
  private resolveThumbnailUrl(thumbnailUrl: string | null | undefined): string | null {
    if (!thumbnailUrl) return null;
    if (thumbnailUrl.startsWith('blob:') || /^https?:\/\//i.test(thumbnailUrl)) {
      return thumbnailUrl;
    }
    return `${environment.apiBaseUrl}${thumbnailUrl}`;
  }
 
  levelLabel(level: CourseLevel): string {
    return level.charAt(0) + level.slice(1).toLowerCase();
  }
 
  courseStatusLabel(status: CourseStatus): string {
    return status.charAt(0) + status.slice(1).toLowerCase();
  }
 
  /**
   * NEW: background color for the status pill shown on the card (matches the Figma's
   * Draft / Publish / Upcoming badges). We only have three real statuses on the backend
   * (DRAFT / PUBLISHED / ARCHIVED), so ARCHIVED gets a neutral slate color since the
   * Figma has no direct equivalent for it.
   */
  statusBadgeClasses(status: CourseStatus): string {
    switch (status) {
      case 'DRAFT':
        return 'bg-amber-500';
      case 'PUBLISHED':
        return 'bg-violet-600';
      case 'ARCHIVED':
        return 'bg-slate-500';
    }
    return 'bg-slate-500';
  }
 
  /**
   * NEW: placeholder for the learner-facing "Enroll" action from the Figma. No enrollment
   * API was shared yet (CourseManagementService only has CRUD + instructor lookup), so this
   * currently just opens the view modal so the learner can still see the course details.
   * TODO: replace the body with a real POST /api/courses/{id}/enroll call once that
   * endpoint exists, and show a success/already-enrolled state instead of the view modal.
   */
  enrollCourse(course: Course): void {
    this.openViewModal(course);
  }
 
  // ---------- out-of-scope entry points (other features, not part of the Create Course SRS) ----------
  manageRoles(): void {
    this.router.navigate(['/access-permission/role-management']);
  }
 
  openEnrollments(courseId: number): void {
  this.router.navigate(['/admin-dashboard', 'courses', courseId, 'enrollments']);
}
 
  openQuestionBanks(courseId: number, moduleId: unknown): void {
    this.router.navigate(['/courses', courseId, 'question-banks'], { queryParams: { moduleId } });
  }
}