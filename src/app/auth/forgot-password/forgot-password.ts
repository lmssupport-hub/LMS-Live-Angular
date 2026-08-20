import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-forgot-password',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.css',
  host: {
    class: 'block h-screen overflow-hidden',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForgotPassword {
  private readonly authService = inject(AuthService);

  protected submitting = false;
  protected completed = false;
  protected serverError = '';
  protected submitted = false;

  // FIXED: was a plain `protected entering = true;` boolean, mutated to
  // `false` inside a requestAnimationFrame callback. Under OnPush change
  // detection, a plain property write from an async callback does NOT mark
  // the view dirty, so the template's `[class.opacity-0]="entering"` /
  // `[class.translate-y-6]="entering"` bindings never re-evaluated - the
  // whole page stayed permanently at opacity-0, which is exactly why the
  // page rendered as a blank/white screen. Using a signal instead makes
  // Angular re-check the view automatically when the value changes,
  // regardless of change detection strategy.
  protected readonly entering = signal(true);

  protected readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email, Validators.maxLength(254)],
    }),
  });

  constructor() {
    this.form.controls.email.valueChanges.subscribe(() => {
      const emailControl = this.form.controls.email;
      if (emailControl.hasError('emailNotRegistered')) {
        const { emailNotRegistered: _, ...remainingErrors } = emailControl.errors ?? {};
        emailControl.setErrors(Object.keys(remainingErrors).length ? remainingErrors : null);
      }
      this.serverError = '';
    });

    afterNextRender(() => {
      requestAnimationFrame(() => this.entering.set(false));
    });
  }

  protected submit(): void {
    this.submitted = true;
    this.form.markAllAsTouched();
    if (this.form.invalid || this.submitting) return;

    this.submitting = true;
    this.completed = false;
    this.serverError = '';

    // FIXED: lowercased for consistency with Login/Signup, which both treat
    // email as a case-insensitive identifier client-side. The backend
    // already does this via findByEmailIgnoreCase, so behavior is unchanged
    // - this just keeps all three forms consistent with each other.
    this.authService
      .sendForgotPassword(this.form.controls.email.value.trim().toLowerCase())
      .pipe(finalize(() => (this.submitting = false)))
      .subscribe({
        next: () => (this.completed = true),
        error: (error: HttpErrorResponse) => this.handleRequestError(error),
      });
  }

  private handleRequestError(error: HttpErrorResponse): void {
    // FIXED: was `error.error?.message ?? error.error?.detail` - the
    // backend's ApiResponse (see GlobalExceptionHandler) only ever
    // populates `message`; `detail` isn't part of the contract.
    const responseMessage = String(error.error?.message ?? '');
    const emailNotRegistered =
      error.status === 404 ||
      responseMessage.toLowerCase().includes('email id is not registered');

    if (emailNotRegistered) {
      const emailControl = this.form.controls.email;
      emailControl.setErrors({
        ...(emailControl.errors ?? {}),
        emailNotRegistered: true,
      });
      return;
    }

    if (error.status === 0 || error.status >= 500) {
      this.serverError = 'Unable to process the request. Please try again later.';
      return;
    }

    this.serverError = responseMessage || 'The request could not be completed. Please try again.';
  }
}