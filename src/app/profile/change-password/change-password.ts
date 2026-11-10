import { HttpErrorResponse } from '@angular/common/http';
import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { Router } from '@angular/router';

import { AuthService } from '../../services/auth';
import { homeRouteFor } from '../../guards/role.guard';

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 16;
const STRONG_PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;
const EMOJI_PATTERN = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;

const passwordsMatchValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const newPassword = group.get('newPassword')?.value;
  const confirmPassword = group.get('confirmPassword')?.value;
  return newPassword && confirmPassword && newPassword !== confirmPassword
    ? { passwordsMismatch: true }
    : null;
};

const passwordDiffersValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const currentPassword = group.get('currentPassword')?.value;
  const newPassword = group.get('newPassword')?.value;
  return currentPassword && newPassword && currentPassword === newPassword
    ? { passwordUnchanged: true }
    : null;
};

@Component({
  selector: 'app-change-password',
  imports: [ReactiveFormsModule],
  templateUrl: './change-password.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangePassword implements AfterViewInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly passwordDialog = viewChild.required<ElementRef<HTMLDialogElement>>('passwordDialog');

  protected readonly isSubmitting = signal(false);
  protected readonly formError = signal('');
  protected readonly successMessage = signal('');
  protected readonly showCurrentPassword = signal(false);
  protected readonly showNewPassword = signal(false);
  protected readonly showConfirmPassword = signal(false);

  protected readonly passwordForm = new FormGroup(
    {
      currentPassword: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(128)],
      }),
      newPassword: new FormControl('', {
        nonNullable: true,
        validators: [
          Validators.required,
          Validators.minLength(PASSWORD_MIN_LENGTH),
          Validators.maxLength(PASSWORD_MAX_LENGTH),
          Validators.pattern(STRONG_PASSWORD_PATTERN),
          (control: AbstractControl): ValidationErrors | null =>
            EMOJI_PATTERN.test(control.value) ? { emojiNotAllowed: true } : null,
        ],
      }),
      confirmPassword: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
    },
    { validators: [passwordsMatchValidator, passwordDiffersValidator] },
  );

  ngAfterViewInit(): void {
    this.openChangePassword();
  }

  protected openChangePassword(): void {
    this.successMessage.set('');
    this.formError.set('');
    this.passwordDialog().nativeElement.showModal();
  }

  protected closeChangePassword(): void {
    this.passwordDialog().nativeElement.close();
  }

  protected submitChangePassword(): void {
    this.passwordForm.markAllAsTouched();
    if (this.passwordForm.invalid || this.isSubmitting()) return;

    this.isSubmitting.set(true);
    this.formError.set('');
    const { currentPassword, newPassword, confirmPassword } = this.passwordForm.getRawValue();

    this.auth
      .changePassword(currentPassword, newPassword, confirmPassword)
      .pipe(
        finalize(() => this.isSubmitting.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.successMessage.set('Password changed successfully.');
          this.passwordForm.reset();
          this.showCurrentPassword.set(false);
          this.showNewPassword.set(false);
          this.showConfirmPassword.set(false);
        },
        error: (error: HttpErrorResponse) => this.handleChangePasswordError(error),
      });
  }

  private handleChangePasswordError(error: HttpErrorResponse): void {
    const responseMessage: unknown = error.error?.message;
    if (typeof responseMessage === 'string' && responseMessage.trim() && responseMessage.length <= 200) {
      this.formError.set(responseMessage.trim());
      return;
    }

    this.formError.set(
      error.status === 0 || error.status >= 500
        ? 'Unable to reach the server. Please try again later.'
        : 'Unable to change your password. Check your current password and ensure both new passwords match.',
    );
  }

  protected resetPasswordForm(): void {
    this.passwordForm.reset();
    this.formError.set('');
    this.showCurrentPassword.set(false);
    this.showNewPassword.set(false);
    this.showConfirmPassword.set(false);

    // CHANGED - learner / instructor ippo login page ku poga maatanga
    const user = this.auth.user();
    const dashboardRoute = homeRouteFor(user);
    void this.router.navigateByUrl(dashboardRoute, { replaceUrl: true });
  }
}