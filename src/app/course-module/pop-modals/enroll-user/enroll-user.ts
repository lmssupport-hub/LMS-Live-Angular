import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { Course } from '../../course.model';
import { EligibleUser } from '../../enrollment.model';

/**
 * Enroll User Form (popup).
 *
 * SRS validation:
 *  - User is mandatory
 *      * dropdown closed with nothing picked -> "User is required."
 *      * "Enroll Selected User(s)" with nothing picked -> "Please select at least one user"
 *  - Course is pre-filled and read-only.
 *  - Cancel closes the form without enrolling.
 *
 * NOTE: the page template uses <app-enroll-user-pop-up>, so that is this component's selector.
 */
@Component({
  selector: 'app-enroll-user-pop-up',
  imports: [ReactiveFormsModule],
  templateUrl: './enroll-user.html',
  styleUrl: './enroll-user.css',
})
export class EnrollUser implements AfterViewInit {
  private readonly fb = inject(FormBuilder);

  // ---------- inputs / outputs (match the page template bindings) ----------
  readonly course = input.required<Course>();
  readonly users = input<EligibleUser[]>([]);
  readonly loading = input(false);
  readonly loadError = input<string | null>(null);
  readonly submitting = input(false);
  readonly formError = input<string | null>(null);

  readonly closeRequested = output<void>();
  readonly retryRequested = output<void>();
  readonly submitted = output<number[]>();

  private readonly userField = viewChild.required<ElementRef<HTMLButtonElement>>('userField');
  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');

  // ---------- state ----------
  readonly form = this.fb.nonNullable.group({
    userIds: [[] as number[], [Validators.required]],
  });

  readonly optionsOpen = signal(false);
  private readonly picked = signal<number[]>([]);
  private readonly touched = signal(false);
  private readonly submitAttempted = signal(false);

  /** Picked ids that still exist in the (possibly refreshed) eligible list. */
  private readonly selectedIds = computed(() => {
    const available = new Set(this.users().map(u => u.id));
    return this.picked().filter(id => available.has(id));
  });

  readonly selectedSummary = computed(() => {
    const ids = new Set(this.selectedIds());
    const names = this.users()
      .filter(u => ids.has(u.id))
      .map(u => u.name);
    if (names.length === 0) return 'Select user(s)';
    if (names.length <= 2) return names.join(', ');
    return `${names.length} users selected`;
  });

  readonly userError = computed(() => {
    if (this.selectedIds().length) return null;
    if (this.submitAttempted()) return 'Please select at least one user';
    if (this.touched()) return 'User is required.';
    return null;
  });

  ngAfterViewInit(): void {
    this.userField().nativeElement.focus();
  }

  // ---------- dropdown ----------
  isSelected(userId: number): boolean {
    return this.selectedIds().includes(userId);
  }

  toggleUserOptions(event: Event): void {
    event.stopPropagation();
    if (this.loading() || this.submitting()) return;
    if (this.optionsOpen()) this.closeOptions();
    else this.optionsOpen.set(true);
  }

  /** Wrapper click must not bubble to the document handler (which would close the list). */
  stopOptionsClick(event: Event): void {
    event.stopPropagation();
  }

  toggleUser(userId: number): void {
    this.picked.update(ids => (ids.includes(userId) ? ids.filter(id => id !== userId) : [...ids, userId]));
    this.form.controls.userIds.setValue(this.selectedIds());
    this.form.controls.userIds.markAsDirty();
  }

  private closeOptions(): void {
    this.optionsOpen.set(false);
    this.touched.set(true);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.optionsOpen()) this.closeOptions();
  }

  // ---------- submit ----------
  submit(): void {
    if (this.submitting() || this.loading()) return; // SRS Edge Case #1: no duplicate requests
    this.submitAttempted.set(true);
    const ids = this.selectedIds();
    this.form.controls.userIds.setValue(ids);
    if (!ids.length) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitted.emit(ids);
  }

  // ---------- keyboard / unsaved changes ----------
  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (this.optionsOpen()) this.closeOptions();
      else if (!this.submitting()) this.closeRequested.emit();
      return;
    }
    if (event.key === 'Tab') this.trapFocus(event);
  }

  /** SRS Edge Cases #2 / #3: warn before a refresh / tab close discards a half-filled form. */
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.selectedIds().length && !this.submitting()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  private trapFocus(event: KeyboardEvent): void {
    const focusable = Array.from(
      this.dialog().nativeElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}