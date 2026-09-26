import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

import {
  Course,
  CourseCategory,
  CourseLevel,
  CourseStatus,
  COURSE_STATUSES,
  Instructor,
} from '../../course.model';

type DropdownName = 'category' | 'instructor' | 'level';

/**
 * Purely presentational: owns no course/lookup state of its own, only UI-local state
 * (which dropdown is open, whether the live preview panel is shown). All course data,
 * lookup data and submit/loading state are passed down by CourseManagement, which is
 * what actually talks to CourseManagementService.
 */
@Component({
  selector: 'app-create-course-modal',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './create-course-modal.html',
  styleUrl: './create-course-modal.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateCourseModal {
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  @Input({ required: true }) form!: FormGroup;
  @Input() categories: CourseCategory[] = [];
  @Input() instructors: Instructor[] = [];
  @Input() levels: CourseLevel[] = [];
  @Input() editing = false;
  @Input() viewOnly = false;
  @Input() viewCourse: Course | null = null;
  @Input() lookupLoading = false;
  @Input() lookupError: string | null = null;
  @Input() submitting = false;
  @Input() thumbnailPreview: string | null = null;
  @Input() thumbnailError: string | null = null;
  @Input() formError: string | null = null;

  @Output() closeRequested = new EventEmitter<void>();
  @Output() retryLookups = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();
  @Output() thumbnailSelected = new EventEmitter<Event>();
  @Output() categorySelected = new EventEmitter<number>();
  @Output() instructorSelected = new EventEmitter<number>();
  @Output() levelSelected = new EventEmitter<CourseLevel>();

  readonly courseStatuses = COURSE_STATUSES;
  readonly openDropdown = signal<DropdownName | null>(null);
  readonly previewVisible = signal(false);

  /** Field List #1 error copy. */
  private readonly nameErrorMessages: Record<string, string> = {
    required: 'Course Name is required.',
    minlength: 'Course Name must contain at least 3 characters.',
    maxlength: 'Course Name must not exceed 100 characters.',
    duplicate: 'A course with this name already exists.',
  };

  private readonly fieldErrorMessages: Record<string, Record<string, string>> = {
    name: this.nameErrorMessages,
    description: { maxlength: 'Course Description must not exceed 1000 characters.' },
    categoryId: { required: 'Course Category is required.' },
    instructorId: { required: 'Instructor selection is required.' },
    level: { required: 'Course Level is required.' },
    status: { required: 'Course Status is required.' },
  };

  /**
   * FIXED: these were `computed(() => ...)` signals that read `this.form.controls[...].value`
   * (a plain Reactive Forms value, not a signal) inside the computation. Angular's `computed()`
   * only re-runs when a *signal* it read changes - it never subscribed to form value changes,
   * so after the very first read these stayed frozen at their initial value ('Select category' /
   * 'Select instructor') no matter what the user picked in the dropdown. Category and Instructor
   * looked "stuck" while Course Level worked, because Level is read directly in the template
   * (`levelLabel(form.controls['level'].value)`) as a plain method call, which - unlike a
   * computed signal - re-evaluates on every change-detection run.
   *
   * Converting these to plain methods (same call syntax `selectedCategoryName()` in the
   * template, so no template changes needed) makes them re-evaluate every CD cycle too,
   * exactly like `levelLabel()` / `statusLabel()` already do below.
   */
  selectedCategoryName(): string {
    // In view mode the category might no longer be in `categories` (e.g. renamed/removed
    // upstream) — trust the snapshot the backend already resolved rather than re-deriving it.
    if (this.viewOnly && this.viewCourse) return this.viewCourse.categoryName;
    const id = this.form?.controls['categoryId']?.value;
    return this.categories.find(c => c.id === id)?.name ?? 'Select category';
  }

  selectedInstructorName(): string {
    // Same reasoning as above, but more important here: the dropdown only ever lists
    // ACTIVE instructors, so a course whose instructor was since deactivated would
    // otherwise show "Select instructor" while viewing/editing it.
    if (this.viewOnly && this.viewCourse) return this.viewCourse.instructorName;
    const id = this.form?.controls['instructorId']?.value;
    return this.instructors.find(i => i.id === id)?.name ?? 'Select instructor';
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.openDropdown() && !this.elementRef.nativeElement.contains(event.target as Node)) {
      this.openDropdown.set(null);
    }
  }

  togglePreview(): void {
    this.previewVisible.update(visible => !visible);
  }

  toggleDropdown(name: DropdownName): void {
    if (this.viewOnly) return;
    this.openDropdown.update(current => (current === name ? null : name));
  }

  chooseCategory(id: number): void {
    this.categorySelected.emit(id);
    this.openDropdown.set(null);
  }

  chooseInstructor(id: number): void {
    this.instructorSelected.emit(id);
    this.openDropdown.set(null);
  }

  chooseLevel(level: CourseLevel): void {
    this.levelSelected.emit(level);
    this.openDropdown.set(null);
  }

  levelLabel(level: CourseLevel | '' | null | undefined): string {
    if (!level) return 'Select level';
    return level.charAt(0) + level.slice(1).toLowerCase();
  }

  statusLabel(status: CourseStatus | '' | null | undefined): string {
    if (!status) return 'Select status';
    return status.charAt(0) + status.slice(1).toLowerCase();
  }

  /** Clicking directly on the dimmed backdrop behaves the same as the × button. */
  overlayMouseDown(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeRequested.emit();
    }
  }

  fieldError(controlName: string): string | null {
    const control = this.form?.controls[controlName];
    if (!control || !control.errors || !(control.touched || control.dirty)) return null;
    const messagesForField = this.fieldErrorMessages[controlName] ?? {};
    const firstErrorKey = Object.keys(control.errors)[0];
    return messagesForField[firstErrorKey] ?? 'This field is invalid.';
  }

  submit(): void {
    if (this.viewOnly || this.submitting) return; // guards double-submit (Edge Case #1)
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saved.emit();
  }
}