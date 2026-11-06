import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { A11yModule } from '@angular/cdk/a11y';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { PackageRecord, PackageService } from '../../services/package.service';
import { CheckoutService } from '../../services/checkout.service';
// Adjust this path to where your OnlineBanking component lives (it is used as <app-online-banking /> in the template).
import { OnlineBanking } from '../online-banking/online-banking';

/** Adjust to match app.routes.ts. */
const SUBSCRIPTION_PATH = '/admin-dashboard/subscription';

const serverActionErrorMessage =
  'Unable to complete the requested action due to a server error. Please try again later.';
const isServerError = (status?: number): boolean => status === 0 || (status ?? 0) >= 500;

type PaymentMethod = 'stripe' | 'card' | 'paypal' | 'bank';
type ModalName = 'bank' | 'paypal' | 'wallet';
type PaypalStep = 'email' | 'password';

const NOT_CONNECTED_MESSAGE =
  'This payment method is not connected yet. Please pay with a credit card for now.';

/** MM/YY must be this month or later. */
function notExpired(control: AbstractControl<string>): ValidationErrors | null {
  const match = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(control.value ?? '');
  if (!match) return { format: true };
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  const now = new Date();
  const currentMonthIndex = now.getFullYear() * 12 + now.getMonth();
  return year * 12 + (month - 1) < currentMonthIndex ? { expired: true } : null;
}

/** Card number: 13-19 digits (spaces ignored). No Luhn check, so the test card 1111 1111 1111 1111 works. */
function cardNumberLength(control: AbstractControl<string>): ValidationErrors | null {
  const digits = (control.value ?? '').replace(/\D/g, '');
  return digits.length >= 13 && digits.length <= 19 ? null : { cardNumber: true };
}

@Component({
  selector: 'app-payment-gateway',
  imports: [ReactiveFormsModule, CurrencyPipe, A11yModule, OnlineBanking],
  templateUrl: './payment-gateway.html',
  styleUrl: './payment-gateway.css',
})
export class PaymentGateway implements OnInit {
  private readonly packagesApi = inject(PackageService);
  private readonly checkout = inject(CheckoutService);
  private readonly router = inject(Router);

  // ---- Page state -----------------------------------------------------------
  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  protected readonly selectedPlan = signal<PackageRecord | null>(null);
  protected readonly currency = this.checkout.currency;
  protected readonly billingCycle = computed(() => this.selectedPlan()?.billingCycle ?? '');

  /** Display amount. The server charges the price stored in the database, never this number. */
  protected readonly amountDue = computed(() => {
    const plan = this.selectedPlan();
    return plan ? this.checkout.convert(plan.price) : 0;
  });

  protected readonly paymentMethod = signal<PaymentMethod>('card');
  protected readonly expandedPaymentMethod = signal<PaymentMethod | null>('card');
  protected readonly submitting = signal(false);
  protected readonly paymentError = signal('');

  // ---- Card + OTP -----------------------------------------------------------
  protected readonly cardForm = new FormGroup({
    number: new FormControl('', { nonNullable: true, validators: [Validators.required, cardNumberLength] }),
    expiry: new FormControl('', { nonNullable: true, validators: [Validators.required, notExpired] }),
    cvc: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^\d{3,4}$/)] }),
    firstName: new FormControl('', { nonNullable: true }),
    lastName: new FormControl('', { nonNullable: true }),
  });
  protected readonly verificationForm = new FormGroup({
    code: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^\d{4,8}$/)] }),
  });
  protected readonly otpRequested = signal(false);
  protected readonly otpVerified = signal(false);
  protected readonly otpMessage = signal('');

  // ---- Billing & receipt ----------------------------------------------------------
  protected readonly countryOptions = [
    { code: 'IN', name: 'India' },
    { code: 'US', name: 'United States' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'DE', name: 'Germany' },
    { code: 'FR', name: 'France' },
    { code: 'AE', name: 'United Arab Emirates' },
    { code: 'SG', name: 'Singapore' },
    { code: 'AU', name: 'Australia' },
    { code: 'CA', name: 'Canada' },
  ] as const;

  protected readonly billingForm = new FormGroup({
    country: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email, Validators.maxLength(100)] }),
    firstName: new FormControl('', { nonNullable: true }),
    lastName: new FormControl('', { nonNullable: true }),
    companyName: new FormControl('', { nonNullable: true }),
    address: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(200)] }),
    city: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    postalCode: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    state: new FormControl('', { nonNullable: true }),
    acceptedTerms: new FormControl(false, { nonNullable: true, validators: [Validators.requiredTrue] }),
  });

  private readonly billingMessages: Record<string, Record<string, string>> = {
    country: { required: 'Please select a country.' },
    email: { required: 'Billing email is required.', email: 'Enter a valid email address.' },
    address: { required: 'Billing address is required.' },
    city: { required: 'City is required.' },
    postalCode: { required: 'Postal code is required.' },
    acceptedTerms: { required: 'You must accept the Terms of Service and Privacy Policy.' },
  };

  // ---- Discount ------------------------------------------------------------
  protected readonly discountCode = new FormControl('', { nonNullable: true });
  protected readonly discountMessage = signal('');

  // ---- Wallet / bank / PayPal popups (UI preview only) ------------------------------
  protected readonly modal = signal<ModalName | null>(null);
  protected readonly walletProvider = signal('');
  protected readonly showBankPassword = signal(false);
  protected readonly paypalStep = signal<PaypalStep>('email');
  protected readonly bankForm = new FormGroup({
    userId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
  protected readonly paypalForm = new FormGroup({
    emailOrMobile: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(5)] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  ngOnInit(): void {
    const packageId = this.checkout.packageId();
    if (packageId == null) {
      // Hard refresh / direct URL: the in-memory choice is gone.
      this.goBack();
      return;
    }
    // Re-load from the server: the plan, price and duration shown here are the real ones,
    // and a plan that was hidden or deactivated meanwhile comes back as 404.
    this.packagesApi
      .getById(packageId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (plan) => {
          if (!plan.showOnWebsite || plan.status !== 'Active' || plan.availablePackage !== 'Price') {
            this.loadError.set('This plan is no longer available.');
            return;
          }
          this.selectedPlan.set(plan);
        },
        error: (error) =>
          this.loadError.set(
            error?.status === 404
              ? 'This plan is no longer available.'
              : isServerError(error?.status)
                ? serverActionErrorMessage
                : 'Checkout could not be loaded. Please try again.',
          ),
      });
  }

  // ---- Payment method list ----------------------------------------------------------

  protected selectPaymentMethod(method: PaymentMethod): void {
    this.paymentMethod.set(method);
    this.expandedPaymentMethod.set(method);
    this.paymentError.set('');
  }

  protected togglePaymentMethod(method: PaymentMethod): void {
    this.expandedPaymentMethod.update((current) => (current === method ? null : method));
  }

  // ---- Card inputs --------------------------------------------------------------

  /** Digits only, grouped as 1234 5678 9012 3456. */
  protected formatCardNumber(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 19);
    const grouped = digits.replace(/(.{4})/g, '$1 ').trim();
    input.value = grouped;
    this.cardForm.controls.number.setValue(grouped);
    this.resetOtp();
  }

  /** Digits only, auto-inserts the "/" -> MM/YY. */
  protected formatExpiry(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 4);
    const formatted = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
    input.value = formatted;
    this.cardForm.controls.expiry.setValue(formatted);
    this.resetOtp();
  }

  /** Changing the card invalidates an OTP that was already entered. */
  private resetOtp(): void {
    if (this.otpVerified()) {
      this.otpVerified.set(false);
      this.otpMessage.set('');
    }
  }

  protected sendOtp(): void {
    this.paymentError.set('');
    this.cardForm.markAllAsTouched();
    if (this.cardForm.invalid) {
      this.otpMessage.set('Fill in valid card details first.');
      return;
    }
    this.otpRequested.set(true);
    this.otpVerified.set(false);
    this.verificationForm.reset();
    // TEMP (test mode): no SMS is sent yet. Remove this hint when a real gateway sends the code.
    this.otpMessage.set('Test mode: enter the test verification code to continue.');
  }

  /**
   * Only checks the code's format. The real check happens on the server when you press Pay,
   * so the correct code is never hard-coded in the browser.
   */
  protected verifyOtp(): void {
    this.verificationForm.markAllAsTouched();
    if (this.verificationForm.invalid) {
      this.otpVerified.set(false);
      this.otpMessage.set('');
      return;
    }
    this.otpVerified.set(true);
    this.otpMessage.set('Code accepted. Press Pay to complete your purchase.');
  }

  // ---- Billing helpers -----------------------------------------------------------

  protected controlError(name: 'country' | 'email' | 'address' | 'city' | 'postalCode' | 'acceptedTerms'): string {
    const control = this.billingForm.controls[name];
    if (!control.touched || !control.invalid) return '';
    const key = Object.keys(control.errors ?? {})[0];
    return this.billingMessages[name]?.[key] ?? 'This value is not valid.';
  }

  protected applyDiscountCode(): void {
    const code = this.discountCode.value.trim();
    // No coupon service exists yet. The server charges the full package price either way.
    this.discountMessage.set(code ? 'Discount codes are not available yet.' : 'Enter a discount code.');
  }

  // ---- Pay ---------------------------------------------------------------------

  protected submitPayment(): void {
    if (this.submitting()) return;
    const plan = this.selectedPlan();
    if (!plan) return;
    this.paymentError.set('');

    if (this.paymentMethod() !== 'card') {
      this.paymentError.set(NOT_CONNECTED_MESSAGE);
      return;
    }

    this.cardForm.markAllAsTouched();
    this.billingForm.markAllAsTouched();
    if (this.cardForm.invalid || this.billingForm.invalid) {
      this.paymentError.set('Please complete the required card and billing details.');
      return;
    }
    if (!this.otpVerified()) {
      this.paymentError.set('Please request and enter the verification code before paying.');
      return;
    }

    const card = this.cardForm.getRawValue();
    const billing = this.billingForm.getRawValue();
    // The form stores the country code (IN); save the readable name (India) for Manage Details.
    const countryName = this.countryOptions.find((c) => c.code === billing.country)?.name ?? billing.country;

    this.submitting.set(true);
    this.packagesApi
      .purchase({
        packageId: plan.id,
        cardNumber: card.number.replace(/\s/g, ''),
        expiry: card.expiry,
        cvc: card.cvc,
        otp: this.verificationForm.controls.code.value,
        billing: {
          // Billing name = billing first/last name, else the name typed on the card form.
          firstName: billing.firstName.trim() || card.firstName.trim(),
          lastName: billing.lastName.trim() || card.lastName.trim(),
          companyName: billing.companyName.trim(),
          email: billing.email.trim(),
          address: billing.address.trim(),
          city: billing.city.trim(),
          postalCode: billing.postalCode.trim(),
          state: billing.state.trim(),
          country: countryName,
        },
      })
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: () => {
          this.wipeSensitiveData();
          this.checkout.clear();
          void this.router.navigate([SUBSCRIPTION_PATH], { state: { purchased: true, planName: plan.name } });
        },
        error: (error) => {
          // The server answers { success:false, message } for validation / payment errors.
          const body = error?.error as { message?: string; detail?: string } | string | undefined;
          const backendMessage = typeof body === 'string' ? body : body?.message ?? body?.detail ?? '';
          this.paymentError.set(
            error?.status === 401 || error?.status === 403
              ? 'Your session cannot make this purchase. Please log in again.'
              : isServerError(error?.status) && error?.status !== 503
                ? serverActionErrorMessage
                : backendMessage || 'Payment failed. Please try again.',
          );
          // A failed attempt needs a fresh code.
          this.cardForm.controls.cvc.reset('');
          this.verificationForm.reset();
          this.otpVerified.set(false);
        },
      });
  }

  /** Card data never stays in memory after the request finishes. */
  private wipeSensitiveData(): void {
    this.cardForm.reset();
    this.verificationForm.reset();
    this.bankForm.reset();
    this.paypalForm.reset();
    this.otpRequested.set(false);
    this.otpVerified.set(false);
  }

  protected goBack(): void {
    this.checkout.clear();
    void this.router.navigate([SUBSCRIPTION_PATH]);
  }

  // ---- Popups (bank / PayPal / wallet are UI previews, not connected) -------------------

  protected openModal(name: ModalName): void {
    this.paypalStep.set('email');
    this.modal.set(name);
  }

  protected openWallet(provider: string): void {
    this.walletProvider.set(provider);
    this.modal.set('wallet');
  }

  protected closeModal(): void {
    this.modal.set(null);
    this.showBankPassword.set(false);
    this.paypalStep.set('email');
    this.bankForm.reset();
    this.paypalForm.reset();
  }

  protected continueBankLogin(): void {
    this.bankForm.markAllAsTouched();
    if (this.bankForm.invalid) return;
    this.closeModal();
    this.paymentError.set(NOT_CONNECTED_MESSAGE);
  }

  protected continuePaypal(): void {
    const { emailOrMobile, password } = this.paypalForm.controls;
    if (this.paypalStep() === 'email') {
      emailOrMobile.markAsTouched();
      if (emailOrMobile.invalid) return;
      this.paypalStep.set('password');
      return;
    }
    password.markAsTouched();
    if (password.invalid) return;
    this.closeModal();
    this.paymentError.set(NOT_CONNECTED_MESSAGE);
  }

  protected showPaypalRecovery(): void {
    this.closeModal();
    this.paymentError.set('PayPal account recovery is not available in this preview.');
  }

  protected showPaypalCreateAccount(): void {
    this.closeModal();
    this.paymentError.set('PayPal account creation is not available in this preview.');
  }

  protected continueWalletPayment(): void {
    this.closeModal();
    this.paymentError.set(NOT_CONNECTED_MESSAGE);
  }
}