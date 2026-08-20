import { Component } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, ChangeDetectionStrategy, inject } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../services/auth';

const PHONE_LENGTHS_BY_COUNTRY_CODE: Record<string, readonly [number, number]> = {
  '+1': [10, 10],
  '+91': [10, 10],
  '+44': [10, 10],
  '+61': [9, 9],
  '+971': [9, 9],
  '+65': [8, 8],
  '+49': [10, 11],
  '+33': [9, 9],
  '+81': [10, 10],
  '+86': [11, 11],
};

@Component({
  selector: 'app-login-signup',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login-signup.html',
  styleUrl: './login-signup.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginSignup {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
 
  protected showPassword = false;
  protected showLoginPassword = false;
  protected submitting = false;
  protected signupCompleted = false;
  protected signupError = '';
  protected loginError = '';
  protected loggingIn = false;
 
  
 
  protected readonly loginForm = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email, Validators.maxLength(254)],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8), Validators.maxLength(16)],
    }),
    rememberMe: new FormControl(false, { nonNullable: true }),
  });
 
  protected readonly signupForm = new FormGroup(
    {
      firstName: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(/^[A-Za-z]{2,50}$/)],
      }),
      lastName: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(/^[A-Za-z]{1,50}$/)],
      }),
      email: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.email, Validators.maxLength(100)],
      }),
      countryCode: new FormControl('', {
        nonNullable: true,
        validators: Validators.required,
      }),
      phoneNumber: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, this.phoneNumberValidator],
      }),
      password: new FormControl('', {
        nonNullable: true,
        validators: [
          Validators.required,
          Validators.minLength(8),
          Validators.maxLength(16),
          // FIXED: was `\S+` at the end, which rejected any password
          // containing a space. The backend's SignUpDto pattern uses `.+`
          // (spaces allowed as long as the other character classes are
          // satisfied) - this now matches that exactly, so a password the
          // backend would accept can no longer be rejected client-side.
          Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/),
        ],
      }),
      confirmPassword: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      acceptTerms: new FormControl(false, {
        nonNullable: true,
        validators: [Validators.requiredTrue],
      }),
    },
    { validators: [this.passwordsMatch, this.passwordDiffersFromEmail] },
  );
 
  constructor() {
    this.signupForm.controls.countryCode.valueChanges.subscribe(() => {
      this.signupForm.controls.phoneNumber.updateValueAndValidity();
    });
 
    afterNextRender(() => {
      if (this.routeView() === 'login') {
        requestAnimationFrame(() => document.getElementById('login')?.scrollIntoView({ block: 'start' }));
      }
    });
  }
 
  protected get signupControls() {
    return this.signupForm.controls;
  }
 
  protected fieldError(field: keyof typeof this.signupForm.controls): string {
    const control = this.signupForm.controls[field];
    if (!control.touched || !control.errors) return '';
 
    if (control.errors['required']) {
      const labels: Record<string, string> = {
        firstName: 'First Name is required.',
        lastName: 'Last Name is required.',
        email: 'Email ID is required.',
        countryCode: 'Country Code is required.',
        phoneNumber: 'Phone Number is required.',
        password: 'Password is required.',
        confirmPassword: 'Confirm Password is required.',
        acceptTerms: 'Please accept the Terms & Conditions.',
      };
      return labels[field];
    }
    if (field === 'firstName') return 'First Name must contain only letters.';
    if (field === 'lastName') return 'Last Name must contain only letters.';
    if (field === 'email' && control.errors['emailExists']) return 'Email ID already exists.';
    if (field === 'email' && control.errors['maxlength']) return 'Email ID must not exceed 100 characters.';
    if (field === 'email') return 'Enter a valid email address.';
    if (field === 'phoneNumber' && control.errors['phoneFormat']) return 'Enter a valid phone number.';
    if (field === 'phoneNumber' && control.errors['phoneLength']) return 'Enter a phone number with a valid length for the selected country code.';
    if (field === 'password' && (control.errors['minlength'] || control.errors['maxlength'])) return 'Password must be between 8 and 16 characters.';
    if (field === 'password' && control.errors['pattern']) return 'Passwords must include at least one uppercase letter, one lowercase letter, one number, and one special character.';
    return '';
  }
 
  protected submitSignup(): void {
    this.signupForm.markAllAsTouched();
    if (this.signupForm.invalid || this.submitting) return;
 
    this.submitting = true;
    this.signupCompleted = false;
    this.signupError = '';
 
    const value = this.signupForm.getRawValue();
    this.auth
      .register({
        firstName: value.firstName.trim(),
        lastName: value.lastName.trim(),
        email: value.email.trim().toLowerCase(),
        countryCode: value.countryCode,
        phoneNumber: value.phoneNumber.trim(),
        password: value.password,
        confirmPassword: value.confirmPassword,
        acceptTerms: value.acceptTerms,
      })
      .pipe(finalize(() => (this.submitting = false)))
      .subscribe({
        next: () => {
          this.signupCompleted = true;
          this.signupForm.reset();
          void this.router
            .navigate(['/auth'], { queryParams: { view: 'login' }, replaceUrl: true })
            .then(() => this.scrollTo('login'));
        },
        error: (error: HttpErrorResponse) => {
          // FIXED: was `error?.error?.detail ?? error?.error?.message` -
          // the backend's ApiResponse (see GlobalExceptionHandler) only
          // ever populates `message`; `detail` doesn't exist in the
          // contract. Reading it first implied an API shape you don't have.
          const message = String(error?.error?.message ?? '');
          if (error.status === 0 || error.status >= 500) {
            this.signupError = 'Unable to create an account. Please try again later.';
            return;
          }
          if (error.status === 409 || /email(?: id)?.*(?:already exists|registered|taken)/i.test(message)) {
            const email = this.signupForm.controls.email;
            email.setErrors({ ...email.errors, emailExists: true });
            email.markAsTouched();
            this.signupError = '';
            return;
          }
          this.signupError = message || 'Account creation failed. Please try again.';
        },
      });
  }
 
  protected scrollTo(sectionId: 'signup' | 'login'): void {
    document.getElementById(sectionId)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }
 
  protected submitLogin(): void {
    this.loginForm.markAllAsTouched();
    if (this.loginForm.invalid || this.loggingIn) return;
    this.loggingIn = true;
    this.loginError = '';
    const value = this.loginForm.getRawValue();
    this.auth
      .login({
        email: value.email.trim().toLowerCase(),
        password: value.password,
        rememberMe: value.rememberMe,
      })
      .pipe(finalize(() => (this.loggingIn = false)))
      .subscribe({
        next: ({ user }) => {
          const route =
            user.role === 'SUPER_ADMIN'
              ? ['/super-admin-dashboard']
              : user.role === 'ADMIN'
                ? ['/admin/staff']
                : ['/courses'];
          void this.router.navigate(route);
        },
        error: (error: HttpErrorResponse) => {
          this.loginError =
            error.status === 0 || error.status >= 500
              ? 'Unable to log in. Please try again later.'
              : error.status === 401
                ? 'Invalid Email ID or Password.'
                : error.status === 403
                  ? 'Your account is inactive. Please contact support.'
                  : (error?.error?.message ?? 'Unable to log in. Please try again later.');
        },
      });
  }
 
  private routeView(): string | null {
    return this.router.parseUrl(this.router.url).queryParams['view'] ?? null;
  }
 
  private passwordsMatch(group: AbstractControl): ValidationErrors | null {
    const password = group.get('password')?.value;
    const confirmation = group.get('confirmPassword')?.value;
    return password && confirmation && password !== confirmation ? { passwordsMismatch: true } : null;
  }
 
  private passwordDiffersFromEmail(group: AbstractControl): ValidationErrors | null {
    const email = String(group.get('email')?.value ?? '').toLowerCase();
    const password = String(group.get('password')?.value ?? '').toLowerCase();
    return email && password && email === password ? { passwordMatchesEmail: true } : null;
  }
 
  private phoneNumberValidator(control: AbstractControl): ValidationErrors | null {
    const value = String(control.value ?? '');
    if (!value) return null;
    if (!/^[0-9]+$/.test(value)) return { phoneFormat: true };
 
    const countryCode = String(control.parent?.get('countryCode')?.value ?? '');
    const range = PHONE_LENGTHS_BY_COUNTRY_CODE[countryCode];
    if (!range || value.length < range[0] || value.length > range[1]) {
      return { phoneLength: true };
    }
 
    return null;
  }
}
