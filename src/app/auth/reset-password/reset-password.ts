import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { combineLatest, finalize } from 'rxjs';
import { AuthService } from '../../services/auth';

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
  protected token = '';
 
  protected submitting = false;
  protected submitted = false;
  protected resetLinkError = '';
  protected requestError = '';
  protected successMessage = '';
 
  protected readonly form = new FormGroup(
    {
      newPassword: new FormControl('', {
        nonNullable: true,
        validators: [
          Validators.required,
          Validators.minLength(8),
          Validators.maxLength(20),
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
        this.token = pathParams.get('token') ?? queryParams.get('token') ?? '';
        this.resetLinkError = this.token ? '' : 'This reset link is invalid or has expired.';
      },
    );
  }
 
  protected submit(): void {
    this.submitted = true;
    this.form.markAllAsTouched();
    if (!this.token || this.form.invalid || this.submitting) return;
 
    this.submitting = true;
    this.requestError = '';
    this.resetLinkError = '';
    this.successMessage = '';
    this.authService
      .resetPassword(
        this.token,
        this.form.controls.newPassword.value,
        this.form.controls.confirmPassword.value,
      )
      .pipe(finalize(() => (this.submitting = false)))
      .subscribe({
        next: () => {
          this.successMessage = 'Password reset successfully';
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
    // FIXED: was `error.error?.message ?? error.error?.detail` - the
    // backend's ApiResponse (see GlobalExceptionHandler) only ever
    // populates `message`; `detail` isn't part of the contract.
    const responseMessage = String(error.error?.message ?? '');
    const normalizedMessage = responseMessage.toLowerCase();
    const invalidResetLink =
      error.status === 410 ||
      normalizedMessage.includes('invalid or expired') ||
      normalizedMessage.includes('link has expired') ||
      normalizedMessage.includes('already been used');
 
    if (invalidResetLink) {
      this.resetLinkError = 'This reset link is invalid or has expired.';
      return;
    }
 
    if (error.status === 0 || error.status >= 500) {
      this.requestError = 'Unable to process the request. Please try again later.';
      return;
    }
 
    this.requestError = responseMessage || 'The password could not be reset. Please try again.';
  }
}

