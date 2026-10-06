import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../services/auth';
import { InviteService, getInviteErrorMessage } from '../../services/invite.service';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';

/* -------------------------------------------------------------------------- */
/*  Constants (single source of truth - used by both TS and template)         */
/* -------------------------------------------------------------------------- */

const LIMITS = {
  name: 50,
  signupEmail: 100,
  loginEmail: 254,
  passwordMin: 8,
  passwordMax: 16,
  phoneInput: 14,
} as const;

const NAME_PATTERN = /^[A-Za-z]+$/;
const STRONG_PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;
// Defensive client-side check only - the server is the real authority on token validity.
const INVITE_TOKEN_PATTERN = /^\S{8,512}$/;

const PHONE_LENGTHS_BY_COUNTRY_CODE: Readonly<Record<string, readonly [number, number]>> = {
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

const COUNTRY_CODES = Object.keys(PHONE_LENGTHS_BY_COUNTRY_CODE);

const HOME_ROUTE_BY_ROLE: Readonly<Record<string, string>> = {
  SUPER_ADMIN: '/super-admin-dashboard',
  ADMIN: '/admin-dashboard',
};
const DEFAULT_HOME_ROUTE = '/courses';

type SignupField =
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'countryCode'
  | 'phoneNumber'
  | 'password'
  | 'confirmPassword'
  | 'acceptTerms';

type SectionId = 'signup' | 'login';

const REQUIRED_MESSAGES: Readonly<Record<SignupField, string>> = {
  firstName: 'First Name is required.',
  lastName: 'Last Name is required.',
  email: 'Email ID is required.',
  countryCode: 'Country Code is required.',
  phoneNumber: 'Phone Number is required.',
  password: 'Password is required.',
  confirmPassword: 'Confirm Password is required.',
  acceptTerms: 'Please accept the Terms & Conditions.',
};

const INVALID_INVITE_MESSAGE =
  'This invite link is invalid or has expired. Please ask your admin to resend it.';

/* -------------------------------------------------------------------------- */
/*  Pure helpers / validators (no `this` binding issues, easy to unit test)   */
/* -------------------------------------------------------------------------- */

const passwordsMatchValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const password = group.get('password')?.value;
  const confirmation = group.get('confirmPassword')?.value;
  return password && confirmation && password !== confirmation ? { passwordsMismatch: true } : null;
};

const passwordDiffersFromEmailValidator: ValidatorFn = (
  group: AbstractControl,
): ValidationErrors | null => {
  const email = String(group.get('email')?.value ?? '').toLowerCase();
  const password = String(group.get('password')?.value ?? '').toLowerCase();
  return email && password && email === password ? { passwordMatchesEmail: true } : null;
};

const phoneNumberValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = String(control.value ?? '');
  if (!value) return null;
  if (!/^[0-9]+$/.test(value)) return { phoneFormat: true };

  const countryCode = String(control.parent?.get('countryCode')?.value ?? '');
  const range = PHONE_LENGTHS_BY_COUNTRY_CODE[countryCode];
  if (!range || value.length < range[0] || value.length > range[1]) {
    return { phoneLength: true };
  }
  return null;
};

const isNetworkOrServerError = (error: HttpErrorResponse): boolean =>
  error.status === 0 || error.status >= 500;

/**
 * Only surfaces a backend message when it is a short plain string.
 * Rendered via Angular interpolation, so it is always HTML-escaped (XSS-safe).
 */
const safeServerMessage = (error: HttpErrorResponse, fallback: string): string => {
  const message: unknown = error?.error?.message;
  return typeof message === 'string' && message.trim() && message.length <= 200
    ? message.trim()
    : fallback;
};

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

@Component({
  selector: 'app-login-signup',
  imports: [ReactiveFormsModule, RouterLink,NgTemplateOutlet],
  templateUrl: './login-signup.html',
  styleUrl: './login-signup.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginSignup {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly inviteService = inject(InviteService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);

  /* ---- Template-facing constants ---- */
  protected readonly limits = LIMITS;
  protected readonly countryCodes = COUNTRY_CODES;

  /* ---- UI state (signals => OnPush-safe, async updates re-render automatically) ---- */
  protected readonly showSignupPassword = signal(false);
  // CHANGED: separate visibility state for the Confirm Password field (was sharing showSignupPassword)
  protected readonly showSignupConfirmPassword = signal(false);
  protected readonly showLoginPassword = signal(false);

  protected readonly submitting = signal(false);
  protected readonly signupCompleted = signal(false);
  protected readonly signupError = signal('');
  protected readonly emailTaken = signal(false);

  protected readonly loggingIn = signal(false);
  protected readonly loginError = signal('');

  /* ---- Invite-signup state ---- */
  protected readonly inviteToken = signal<string | null>(null);
  protected readonly inviteRoleName = signal('');
  protected readonly inviteLoading = signal(false);
  protected readonly inviteError = signal('');

  protected readonly loginForm = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email, Validators.maxLength(LIMITS.loginEmail)],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(LIMITS.passwordMin),
        Validators.maxLength(LIMITS.passwordMax),
      ],
    }),
    rememberMe: new FormControl(false, { nonNullable: true }),
  });

  protected readonly signupForm = new FormGroup(
    {
      firstName: new FormControl('', {
        nonNullable: true,
        validators: [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(LIMITS.name),
          Validators.pattern(NAME_PATTERN),
        ],
      }),
      lastName: new FormControl('', {
        nonNullable: true,
        validators: [
          Validators.required,
          Validators.maxLength(LIMITS.name),
          Validators.pattern(NAME_PATTERN),
        ],
      }),
      email: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.email, Validators.maxLength(LIMITS.signupEmail)],
      }),
      countryCode: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      phoneNumber: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, phoneNumberValidator],
      }),
      password: new FormControl('', {
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
      acceptTerms: new FormControl(false, {
        nonNullable: true,
        validators: [Validators.requiredTrue],
      }),
    },
    { validators: [passwordsMatchValidator, passwordDiffersFromEmailValidator] },
  );

  protected get signupControls() {
    return this.signupForm.controls;
  }

  constructor() {
    // Phone length rules depend on the selected country code.
    this.signupForm.controls.countryCode.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.signupForm.controls.phoneNumber.updateValueAndValidity());

    // Any edit to the email clears the stale "already exists" server error.
    this.signupForm.controls.email.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.emailTaken.set(false));

    afterNextRender(() => this.initialiseFromRoute());
  }

  /* ------------------------------------------------------------------------ */
  /*  Template helpers                                                        */
  /* ------------------------------------------------------------------------ */

  protected toggleSignupPassword(): void {
    this.showSignupPassword.update((visible) => !visible);
  }

  // CHANGED: new toggle for the Confirm Password field only
  protected toggleSignupConfirmPassword(): void {
    this.showSignupConfirmPassword.update((visible) => !visible);
  }

  protected toggleLoginPassword(): void {
    this.showLoginPassword.update((visible) => !visible);
  }

  protected scrollTo(sectionId: SectionId, behavior: ScrollBehavior = 'smooth'): void {
    this.document.getElementById(sectionId)?.scrollIntoView({ behavior, block: 'start' });
  }

  protected fieldError(field: SignupField): string {
    if (field === 'email' && this.emailTaken()) return 'Email ID already exists.';

    const control = this.signupForm.controls[field];
    const errors = control.errors;
    if (!control.touched || !errors) return '';

    if (errors['required']) return REQUIRED_MESSAGES[field];

    switch (field) {
      case 'firstName':
      case 'lastName': {
        const label = field === 'firstName' ? 'First Name' : 'Last Name';
        if (errors['minlength']) return `${label} must be between 2 and ${LIMITS.name} characters.`;
        if (errors['maxlength']) return `${label} must not exceed ${LIMITS.name} characters.`;
        if (errors['pattern']) return `${label} must contain only letters.`;
        return '';
      }
      case 'email':
        if (errors['maxlength']) return `Email ID must not exceed ${LIMITS.signupEmail} characters.`;
        return 'Enter a valid email address.';
      case 'phoneNumber':
        if (errors['phoneFormat']) return 'Enter a valid phone number.';
        if (errors['phoneLength']) {
          return 'Enter a phone number with a valid length for the selected country code.';
        }
        return '';
      case 'password':
        if (errors['minlength'] || errors['maxlength']) {
          return `Password must be between ${LIMITS.passwordMin} and ${LIMITS.passwordMax} characters.`;
        }
        if (errors['pattern']) {
          return 'Passwords Must include uppercase, lowercase, number, and special character.';
        }
        return '';
      default:
        return '';
    }
  }

  /* ------------------------------------------------------------------------ */
  /*  Signup                                                                  */
  /* ------------------------------------------------------------------------ */

  protected submitSignup(): void {
    this.signupForm.markAllAsTouched();
    if (this.signupForm.invalid || this.submitting()) return;

    this.submitting.set(true);
    this.signupCompleted.set(false);
    this.signupError.set('');

    // getRawValue() so the disabled (invite-locked) email is included.
    const value = this.signupForm.getRawValue();
    const payload = {
      firstName: value.firstName.trim(),
      lastName: value.lastName.trim(),
      countryCode: value.countryCode,
      phoneNumber: value.phoneNumber.trim(),
      password: value.password, // never trim / log passwords
      confirmPassword: value.confirmPassword,
      acceptTerms: value.acceptTerms,
    };

    const token = this.inviteToken();
    if (token) {
      this.inviteService
        .accept(token, payload)
        .pipe(
          finalize(() => this.submitting.set(false)),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe({
          next: () => this.onSignupSuccess(),
          error: (error: HttpErrorResponse) =>
            this.signupError.set(
              getInviteErrorMessage(error, 'Unable to complete signup. Please try again.'),
            ),
        });
      return;
    }

    this.auth
      .register({ ...payload, email: value.email.trim().toLowerCase() })
      .pipe(
        finalize(() => this.submitting.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => this.onSignupSuccess(),
        error: (error: HttpErrorResponse) => this.onRegisterError(error),
      });
  }

  private onRegisterError(error: HttpErrorResponse): void {
    if (isNetworkOrServerError(error)) {
      this.signupError.set('Unable to create an account. Please try again later.');
      return;
    }

    const rawMessage = String(error?.error?.message ?? '');
    if (error.status === 409 || /email(?: id)?.*(?:already exists|registered|taken)/i.test(rawMessage)) {
      this.signupForm.controls.email.markAsTouched();
      this.emailTaken.set(true);
      return;
    }

    this.signupError.set(safeServerMessage(error, 'Account creation failed. Please try again.'));
  }

  private onSignupSuccess(): void {
    this.signupCompleted.set(true);
    this.clearInviteState();
    this.signupForm.reset();

    void this.router
      .navigate(['/auth'], { queryParams: { view: 'login' }, replaceUrl: true })
      .then(() => this.scrollTo('login'));
  }

  /* ------------------------------------------------------------------------ */
  /*  Invite flow                                                             */
  /* ------------------------------------------------------------------------ */

  private initialiseFromRoute(): void {
    const params = this.route.snapshot.queryParamMap;
    const token = params.get('invite');

    if (token) {
      this.loadInvite(token);
      requestAnimationFrame(() => this.scrollTo('signup', 'auto'));
      return;
    }

    if (params.get('view') === 'login') {
      requestAnimationFrame(() => this.scrollTo('login', 'auto'));
    }
  }

  /** Fetches invite details, locks the email field and shows the role banner. */
  private loadInvite(token: string): void {
    if (!INVITE_TOKEN_PATTERN.test(token)) {
      this.inviteError.set(INVALID_INVITE_MESSAGE);
      return;
    }

    this.inviteLoading.set(true);
    this.inviteError.set('');

    this.inviteService
      .getDetails(token)
      .pipe(
        finalize(() => this.inviteLoading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (details) => {
          this.inviteToken.set(token);
          this.inviteRoleName.set(details.roleName);
          this.signupForm.controls.email.setValue(details.email);
          this.signupForm.controls.email.disable();
        },
        error: (error: HttpErrorResponse) => {
          this.inviteToken.set(null);
          this.inviteError.set(getInviteErrorMessage(error, INVALID_INVITE_MESSAGE));
        },
      });
  }

  /** Leaves invite mode so the form is a normal signup form again. */
  private clearInviteState(): void {
    this.inviteToken.set(null);
    this.inviteRoleName.set('');
    this.signupForm.controls.email.enable();
  }

  /* ------------------------------------------------------------------------ */
  /*  Login                                                                   */
  /* ------------------------------------------------------------------------ */

  protected submitLogin(): void {
    this.loginForm.markAllAsTouched();
    if (this.loginForm.invalid || this.loggingIn()) return;

    this.loggingIn.set(true);
    this.loginError.set('');

    const value = this.loginForm.getRawValue();

    this.auth
      .login({
        email: value.email.trim().toLowerCase(),
        password: value.password,
        rememberMe: value.rememberMe,
      })
      .pipe(
        finalize(() => this.loggingIn.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ user }) => {
          void this.router.navigate([HOME_ROUTE_BY_ROLE[user.role] ?? DEFAULT_HOME_ROUTE]);
        },
        error: (error: HttpErrorResponse) => this.loginError.set(this.toLoginMessage(error)),
      });
  }

  /**
   * Fixed messages only - never echo backend text on login (OWASP: avoid
   * information disclosure / account enumeration).
   */
  private toLoginMessage(error: HttpErrorResponse): string {
    if (isNetworkOrServerError(error)) return 'Unable to log in. Please try again later.';
    switch (error.status) {
      case 401:
        return 'Invalid Email ID or Password.';
      case 403:
        return 'Your account is inactive. Please contact support.';
      case 429:
        return 'Too many attempts. Please wait a moment and try again.';
      default:
        return 'Unable to log in. Please try again later.';
    }
  }
}