import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize, TimeoutError, timeout } from 'rxjs';
import { AuthService } from '../../services/auth';

const RESEND_COOLDOWN_SECONDS = 30;
const REQUEST_TIMEOUT_MS = 15000;

@Component({
  selector: 'app-forgot-password',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.css',
  host: {
    class: 'block',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForgotPassword {
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private cooldownTimer: ReturnType<typeof setInterval> | undefined;

  // All UI state is signals so OnPush views re-render after async callbacks.
  protected readonly submitting = signal(false);
  protected readonly completed = signal(false);
  protected readonly serverError = signal('');
  protected readonly submitted = signal(false);
  protected readonly entering = signal(true);
  protected readonly resendCooldown = signal(0);

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
      this.serverError.set('');
      this.completed.set(false);
    });

    afterNextRender(() => {
      requestAnimationFrame(() => this.entering.set(false));
    });

    this.destroyRef.onDestroy(() => clearInterval(this.cooldownTimer));
  }

  protected submit(): void {
    this.submitted.set(true);
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.send();
  }

  protected resend(): void {
    if (this.resendCooldown() > 0) return;
    this.send();
  }

  private send(): void {
    if (this.submitting()) return;

    this.submitting.set(true);
    this.completed.set(false);
    this.serverError.set('');

    this.authService
      .sendForgotPassword(this.form.controls.email.value.trim().toLowerCase())
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        finalize(() => this.submitting.set(false)),
      )
      .subscribe({
        next: () => {
          this.completed.set(true);
          this.startCooldown();
        },
        error: (error: unknown) => this.handleRequestError(error),
      });
  }

  private startCooldown(): void {
    clearInterval(this.cooldownTimer);
    this.resendCooldown.set(RESEND_COOLDOWN_SECONDS);
    this.cooldownTimer = setInterval(() => {
      const next = this.resendCooldown() - 1;
      this.resendCooldown.set(Math.max(next, 0));
      if (next <= 0) clearInterval(this.cooldownTimer);
    }, 1000);
  }

  private handleRequestError(error: unknown): void {
    if (error instanceof TimeoutError) {
      this.serverError.set(
        'This is taking longer than expected. Please check your inbox or try again.',
      );
      return;
    }

    const httpError = error as HttpErrorResponse;
    const responseMessage = String(httpError.error?.message ?? '');
    const emailNotRegistered =
      httpError.status === 404 ||
      responseMessage.toLowerCase().includes('email id is not registered');

    if (emailNotRegistered) {
      const emailControl = this.form.controls.email;
      emailControl.setErrors({
        ...(emailControl.errors ?? {}),
        emailNotRegistered: true,
      });
      return;
    }

    if (httpError.status === 0 || httpError.status >= 500) {
      this.serverError.set('Unable to process the request. Please try again later.');
      return;
    }

    this.serverError.set(
      responseMessage || 'The request could not be completed. Please try again.',
    );
  }
}