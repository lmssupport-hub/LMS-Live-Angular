import { Component, DestroyRef, ElementRef, HostListener, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { Course } from '../course.model';
import { ApiRequestError, Enrollment, EnrollmentStatus } from '../enrollment.model';
import { EnrollUser } from '../pop-modals/enroll-user/enroll-user'; // TODO: adjust path
import { CourseManagementService } from '../../services/course-management.service';
import { EnrollmentService } from '../../services/enrollment.service';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-enrolled-course-list',
  imports: [EnrollUser],
  templateUrl: './enrolled-course-list.html',
  styleUrl: './enrolled-course-list.css',
})
export class EnrolledCourseList {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly courseService = inject(CourseManagementService);
  private readonly enrollmentService = inject(EnrollmentService);
  private readonly destroyRef = inject(DestroyRef);

  /** Restores focus after the Enroll User popup closes. */
  private readonly enrollButton = viewChild<ElementRef<HTMLButtonElement>>('enrollButton');

  private courseId: number | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  // ---------- role (SRS: Admins & Instructors only) ----------
  readonly canManage = computed(() => {
    const role = this.authService.user()?.role;
    return role === 'ADMIN' || role === 'INSTRUCTOR';
  });

  // ---------- selected course ----------
  readonly course = signal<Course | null>(null);
  readonly courseLoading = signal(false);
  readonly courseLoadError = signal<string | null>(null);

  // ---------- Enrolled Course List ----------
  readonly enrollments = signal<Enrollment[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);

  // ---------- selection / row actions ----------
  private readonly selectedIds = signal<ReadonlySet<number>>(new Set<number>());
  readonly selectedCount = computed(() => this.selectedIds().size);
  readonly allSelected = computed(() => {
    const rows = this.enrollments();
    return rows.length > 0 && rows.every(r => this.selectedIds().has(r.userId));
  });
  readonly someSelected = computed(() => this.selectedCount() > 0 && !this.allSelected());
  readonly openActionFor = signal<number | null>(null);
  readonly unenrolling = signal(false);

  // ---------- Enroll User popup ----------
  readonly enrollPopupOpen = signal(false);
  readonly eligibleUsers = signal<{ id: number; name: string; email?: string }[]>([]);
  readonly eligibleUsersLoading = signal(false);
  readonly eligibleUsersError = signal<string | null>(null);
  readonly enrolling = signal(false);

  // ---------- feedback ----------
  readonly successMessage = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(params => {
      const id = Number(params.get('courseId'));
      if (!Number.isInteger(id) || id <= 0) {
        this.courseId = null;
        this.courseLoadError.set('Course not found.');
        return;
      }
      this.courseId = id;
      this.resetState();
      this.loadCourse();
      this.loadEnrollments();
    });

    this.destroyRef.onDestroy(() => {
      if (this.flashTimer) clearTimeout(this.flashTimer);
    });
  }

  // ---------- navigation ----------
  backToCourses(): void {
    this.router.navigate(['/admin-dashboard', 'courses']);
  }

  @HostListener('document:click')
  closeActionMenu(): void {
    this.openActionFor.set(null);
  }

  // ---------- loading ----------
  loadCourse(): void {
    if (this.courseId === null) return;
    this.courseLoading.set(true);
    this.courseLoadError.set(null);
    this.courseService.getCourseById(this.courseId).subscribe({
      next: course => {
        this.course.set(course);
        this.courseLoading.set(false);
      },
      error: (err: Error) => {
        this.courseLoadError.set(err.message);
        this.courseLoading.set(false);
      },
    });
  }

  /** Always shows the latest data (SRS Edge Case #10); keeps current rows visible while reloading. */
  loadEnrollments(): void {
    if (this.courseId === null) return;
    this.loading.set(true);
    this.loadError.set(null);
    this.enrollmentService.getEnrollments(this.courseId).subscribe({
      next: rows => {
        this.enrollments.set(rows);
        // Drop selections for users who are no longer enrolled (changed by someone else).
        const stillEnrolled = new Set(rows.map(r => r.userId));
        this.selectedIds.update(sel => new Set([...sel].filter(id => stillEnrolled.has(id))));
        this.loading.set(false);
      },
      error: (err: unknown) => {
        // SRS Edge Case #8: unexpected load error -> message + reload option.
        this.loadError.set(this.handleApiError(err, false));
        this.loading.set(false);
      },
    });
  }

  // ---------- selection ----------
  isSelected(userId: number): boolean {
    return this.selectedIds().has(userId);
  }

  toggleSelection(userId: number): void {
    this.selectedIds.update(sel => {
      const next = new Set(sel);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  toggleAll(checked: boolean): void {
    this.selectedIds.set(checked ? new Set(this.enrollments().map(r => r.userId)) : new Set());
  }

  // ---------- More Actions (⋮) -> Unenroll ----------
  /**
   * The menu always acts on the current selection. If the user opens ⋮ on a row that is not
   * ticked, that row becomes the selection, so the menu label and the action never disagree.
   */
  toggleActionMenu(event: Event, userId: number): void {
    event.stopPropagation();
    if (this.openActionFor() === userId) {
      this.openActionFor.set(null);
      return;
    }
    if (!this.selectedIds().has(userId)) {
      this.selectedIds.set(new Set([userId]));
    }
    this.openActionFor.set(userId);
  }

  unenrollSelectedUsers(event: Event): void {
    event.stopPropagation();
    if (this.unenrolling() || this.courseId === null) return; // double-click guard
    const userIds = [...this.selectedIds()];
    if (!userIds.length) {
      this.actionError.set('Please select at least one user');
      this.openActionFor.set(null);
      return;
    }

    this.unenrolling.set(true);
    this.actionError.set(null);
    this.enrollmentService.unenrollUsers(this.courseId, userIds).subscribe({
      next: () => {
        this.unenrolling.set(false);
        this.openActionFor.set(null);
        this.selectedIds.set(new Set());
        this.flash('User(s) unenrolled successfully.');
        this.loadEnrollments();
      },
      error: (err: unknown) => {
        this.unenrolling.set(false);
        this.openActionFor.set(null);
        this.actionError.set(this.handleApiError(err, true));
      },
    });
  }

  // ---------- Enroll User popup ----------
  openEnrollPopup(): void {
    if (this.enrollPopupOpen() || !this.course()) return; // SRS Edge Case #1: only one form
    this.actionError.set(null);
    this.enrollPopupOpen.set(true);
    this.loadEligibleUsers();
  }

  closeEnrollPopup(): void {
    if (this.enrolling()) return;
    this.enrollPopupOpen.set(false);
    this.actionError.set(null);
    this.eligibleUsersError.set(null);
    queueMicrotask(() => this.enrollButton()?.nativeElement.focus());
  }

  loadEligibleUsers(): void {
    if (this.courseId === null) return;
    this.eligibleUsersLoading.set(true);
    this.eligibleUsersError.set(null);
    this.enrollmentService.getEligibleUsers(this.courseId).subscribe({
      next: users => {
        this.eligibleUsers.set(users);
        this.eligibleUsersLoading.set(false);
      },
      error: (err: unknown) => {
        this.eligibleUsersError.set(this.handleApiError(err, false));
        this.eligibleUsersLoading.set(false);
      },
    });
  }

  enrollSelectedUsers(userIds: number[]): void {
    if (this.enrolling() || this.courseId === null) return; // double-click guard
    if (!userIds.length) {
      this.actionError.set('Please select at least one user');
      return;
    }

    this.enrolling.set(true);
    this.actionError.set(null);
    this.enrollmentService.enrollUsers(this.courseId, userIds).subscribe({
      next: () => {
        this.enrolling.set(false);
        this.enrollPopupOpen.set(false);
        this.flash('User(s) enrolled successfully.');
        this.loadEnrollments();
        queueMicrotask(() => this.enrollButton()?.nativeElement.focus());
      },
      error: (err: unknown) => {
        this.enrolling.set(false);
        // Popup stays open so the user keeps their selection; error shows inside it.
        this.actionError.set(this.handleApiError(err, true));
      },
    });
  }

  // ---------- display helpers (used by the template) ----------
  formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const [y, m, d] = value.split('-').map(Number);
    if (!y || !m || !d) return '—';
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  progressLabel(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : `${Math.round(value)}%`;
  }

  statusLabel(status: EnrollmentStatus): string {
    switch (status) {
      case 'IN_PROGRESS':
        return 'In Progress';
      case 'COMPLETED':
        return 'Completed';
      default:
        return 'Not Started';
    }
  }

  // ---------- internals ----------
  private resetState(): void {
    this.course.set(null);
    this.enrollments.set([]);
    this.selectedIds.set(new Set());
    this.openActionFor.set(null);
    this.enrollPopupOpen.set(false);
    this.actionError.set(null);
  }

  private flash(message: string): void {
    this.successMessage.set(message);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.successMessage.set(null), 4000);
  }

  /**
   * Central API error policy:
   *  - 401 -> session expired: go to Login (SRS Edge Case #6)
   *  - 409 -> data changed under us: refresh list (+ eligible users if the popup is open) (Edge Cases #7, #10)
   */
  private handleApiError(err: unknown, refreshOnConflict: boolean): string {
    if (err instanceof ApiRequestError) {
      if (err.status === 401) {
        this.router.navigate(['/auth']);
      } else if (err.status === 409 && refreshOnConflict) {
        this.loadEnrollments();
        if (this.enrollPopupOpen()) this.loadEligibleUsers();
      }
      return err.message;
    }
    return err instanceof Error
      ? err.message
      : 'Unable to complete the request due to a server error. Please try again later.';
  }
}