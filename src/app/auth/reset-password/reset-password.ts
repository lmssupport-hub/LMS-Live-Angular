import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { combineLatest, finalize } from 'rxjs';
import { AuthService } from '../../services/auth';

/* Same password rules as the Sign Up form */
const LIMITS = {
  passwordMin: 8,
  passwordMax: 16,
} as const;

const STRONG_PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;

@Component({
  selector: 'app-reset-password',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResetPassword {
  private readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  // Template-facing constants
  protected readonly limits = LIMITS;

  // All UI state is signals so OnPush views re-render after async callbacks.
  protected readonly token = signal('');
  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly resetLinkError = signal('');
  protected readonly requestError = signal('');
  protected readonly successMessage = signal('');
  protected readonly showNewPassword = signal(false);
  protected readonly showConfirmPassword = signal(false);

  protected readonly form = new FormGroup(
    {
      newPassword: new FormControl('', {
        nonNullable: true,
        validators: [
          Validators.required,
          Validators.minLength(LIMITS.passwordMin),
          Validators.maxLength(LIMITS.passwordMax),
          Validators.pattern(STRONG_PASSWORD_PATTERN),
        ],
      }),
      confirmPassword: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
    },
    {
      validators: this.passwordsMatchValidator,
    },
  );

  constructor() {
    combineLatest([this.route.paramMap, this.route.queryParamMap]).subscribe(
      ([pathParams, queryParams]) => {
        const token = pathParams.get('token') ?? queryParams.get('token') ?? '';
        this.token.set(token);
        this.resetLinkError.set(token ? '' : 'This reset link is invalid or has expired.');
      },
    );
  }

  protected submit(): void {
    this.submitted.set(true);
    this.form.markAllAsTouched();
    if (!this.token() || this.form.invalid || this.submitting()) return;

    this.submitting.set(true);
    this.requestError.set('');
    this.resetLinkError.set('');
    this.successMessage.set('');

    this.authService
      .resetPassword(
        this.token(),
        this.form.controls.newPassword.value,
        this.form.controls.confirmPassword.value,
      )
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: () => {
          this.successMessage.set('Password reset successfully');
          void this.router.navigate(['/auth'], {
            queryParams: { view: 'login' },
            replaceUrl: true,
          });
        },
        error: (error: HttpErrorResponse) => this.handleRequestError(error),
      });
  }

  private passwordsMatchValidator(control: AbstractControl): ValidationErrors | null {
    const newPassword = control.get('newPassword')?.value;
    const confirmPassword = control.get('confirmPassword')?.value;

    if (!newPassword || !confirmPassword) return null;
    return newPassword === confirmPassword ? null : { passwordMismatch: true };
  }

  private handleRequestError(error: HttpErrorResponse): void {
    const responseMessage = String(error.error?.message ?? '');
    const normalizedMessage = responseMessage.toLowerCase();
    const invalidResetLink =
      error.status === 410 ||
      normalizedMessage.includes('invalid or expired') ||
      normalizedMessage.includes('link has expired') ||
      normalizedMessage.includes('already been used');

    if (invalidResetLink) {
      this.resetLinkError.set('This reset link is invalid or has expired.');
      return;
    }

    if (error.status === 0 || error.status >= 500) {
      this.requestError.set('Unable to process the request. Please try again later.');
      return;
    }

    this.requestError.set(responseMessage || 'The password could not be reset. Please try again.');
  }
}