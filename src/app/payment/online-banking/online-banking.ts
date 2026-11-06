import { Component, HostListener, OnDestroy, computed, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { A11yModule } from '@angular/cdk/a11y';

interface Bank {
  name: string;
  shortName: string;
  /** Only used to load the bank's favicon in the picker. */
  domain: string;
}

/** Banks shown before the person taps "View all banks". */
const INITIAL_BANK_COUNT = 9;
const OTP_RESEND_COOLDOWN_MS = 30_000;

const NOT_CONNECTED_MESSAGE =
  'Online banking is not connected yet. Please close this window and pay with a credit card.';

/**
 * Online banking flow: pick bank -> bank login -> OTP.
 * UI PREVIEW ONLY: no bank is contacted, nothing is sent to any server, and the
 * typed credentials are wiped as soon as a popup closes. The real purchase only
 * happens through the credit-card route (POST /api/packages/purchase).
 */
@Component({
  selector: 'app-online-banking',
  imports: [ReactiveFormsModule, A11yModule],
  templateUrl: './online-banking.html',
  styleUrl: './online-banking.css',
})
export class OnlineBanking implements OnDestroy {
  private readonly banks: readonly Bank[] = [
    { name: 'State Bank of India', shortName: 'SBI', domain: 'sbi.co.in' },
    { name: 'HDFC Bank', shortName: 'HDFC', domain: 'hdfcbank.com' },
    { name: 'ICICI Bank', shortName: 'ICICI', domain: 'icicibank.com' },
    { name: 'Axis Bank', shortName: 'Axis', domain: 'axisbank.com' },
    { name: 'Kotak Mahindra Bank', shortName: 'Kotak', domain: 'kotak.com' },
    { name: 'Punjab National Bank', shortName: 'PNB', domain: 'pnbindia.in' },
    { name: 'Bank of Baroda', shortName: 'BoB', domain: 'bankofbaroda.in' },
    { name: 'Canara Bank', shortName: 'Canara', domain: 'canarabank.com' },
    { name: 'Union Bank of India', shortName: 'Union', domain: 'unionbankofindia.co.in' },
    { name: 'IDFC FIRST Bank', shortName: 'IDFC', domain: 'idfcfirstbank.com' },
    { name: 'Yes Bank', shortName: 'Yes Bank', domain: 'yesbank.in' },
    { name: 'IndusInd Bank', shortName: 'IndusInd', domain: 'indusind.com' },
    { name: 'JPMorgan Chase', shortName: 'Chase', domain: 'chase.com' },
    { name: 'Bank of America', shortName: 'BofA', domain: 'bankofamerica.com' },
    { name: 'Wells Fargo', shortName: 'Wells Fargo', domain: 'wellsfargo.com' },
    { name: 'Citibank', shortName: 'Citi', domain: 'citi.com' },
    { name: 'HSBC', shortName: 'HSBC', domain: 'hsbc.com' },
    { name: 'Barclays', shortName: 'Barclays', domain: 'barclays.co.uk' },
  ];

  // ---- Popup state --------------------------------------------------------
  protected readonly bankSelectionOpen = signal(false);
  protected readonly bankLoginOpen = signal(false);
  protected readonly otpVerificationOpen = signal(false);

  protected readonly searchText = signal('');
  protected readonly showAllBanks = signal(false);
  protected readonly selectedBank = signal<Bank | null>(null);
  protected readonly showPassword = signal(false);
  protected readonly statusMessage = signal('');

  /** Search narrows across ALL banks; without search only the first few show until "View all banks". */
  protected readonly visibleBanks = computed(() => {
    const query = this.searchText().trim().toLowerCase();
    if (query) {
      return this.banks.filter(
        (b) => b.name.toLowerCase().includes(query) || b.shortName.toLowerCase().includes(query),
      );
    }
    return this.showAllBanks() ? this.banks : this.banks.slice(0, INITIAL_BANK_COUNT);
  });

  // ---- Forms --------------------------------------------------------------
  protected readonly bankLoginForm = new FormGroup({
    userId: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3), Validators.maxLength(50)],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(50)],
    }),
  });

  protected readonly otpForm = new FormGroup({
    code: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^\d{6}$/)] }),
  });

  private resendAvailableAt = 0;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // OTP accepts digits only (covers paste and drag-drop too).
    this.otpForm.controls.code.valueChanges.subscribe((value) => {
      const digits = value.replace(/\D/g, '').slice(0, 6);
      if (digits !== value) {
        this.otpForm.controls.code.setValue(digits, { emitEvent: false });
      }
    });
  }

  ngOnDestroy(): void {
    this.clearStatusTimer();
    this.wipeCredentials();
  }

  // ---- Step 1: choose a bank -------------------------------------------------------

  protected openBankSelection(): void {
    this.statusMessage.set('');
    this.searchText.set('');
    this.showAllBanks.set(false);
    this.bankLoginOpen.set(false);
    this.otpVerificationOpen.set(false);
    this.bankSelectionOpen.set(true);
  }

  protected updateSearch(value: string): void {
    this.searchText.set(value.slice(0, 100));
  }

  protected showAll(): void {
    this.showAllBanks.set(true);
  }

  protected chooseBank(bank: Bank): void {
    this.selectedBank.set(bank);
    this.statusMessage.set('');
    this.wipeCredentials();
    this.bankSelectionOpen.set(false);
    this.bankLoginOpen.set(true);
  }

  // ---- Step 2: bank login ---------------------------------------------------------

  protected userIdError(): string {
    const control = this.bankLoginForm.controls.userId;
    if (!control.touched || !control.invalid) return '';
    return control.hasError('required') ? 'User ID is required.' : 'User ID must be at least 3 characters.';
  }

  protected passwordError(): string {
    const control = this.bankLoginForm.controls.password;
    return control.touched && control.invalid ? 'Password is required.' : '';
  }

  protected submitBankLogin(): void {
    this.bankLoginForm.markAllAsTouched();
    if (this.bankLoginForm.invalid) return;

    // The password is not needed past this point, so it never stays in memory.
    this.bankLoginForm.reset();
    this.showPassword.set(false);
    this.statusMessage.set('');
    this.otpForm.reset();
    this.resendAvailableAt = Date.now() + OTP_RESEND_COOLDOWN_MS;
    this.bankLoginOpen.set(false);
    this.otpVerificationOpen.set(true);
  }

  protected returnToBankSelection(): void {
    this.wipeCredentials();
    this.statusMessage.set('');
    this.bankLoginOpen.set(false);
    this.searchText.set('');
    this.bankSelectionOpen.set(true);
  }

  // ---- Step 3: OTP ----------------------------------------------------------------

  protected otpError(): string {
    const control = this.otpForm.controls.code;
    return control.touched && control.invalid ? 'Enter the 6 digit OTP.' : '';
  }

  protected resendOtp(): void {
    const waitMs = this.resendAvailableAt - Date.now();
    if (waitMs > 0) {
      this.flashStatus(`Please wait ${Math.ceil(waitMs / 1000)} seconds before requesting another OTP.`);
      return;
    }
    this.resendAvailableAt = Date.now() + OTP_RESEND_COOLDOWN_MS;
    this.otpForm.reset();
    this.flashStatus(NOT_CONNECTED_MESSAGE);
  }

  protected verifyOtp(): void {
    this.otpForm.markAllAsTouched();
    if (this.otpForm.invalid) return;
    this.otpForm.reset();
    // No bank is connected, so a code can never be confirmed here.
    this.flashStatus(NOT_CONNECTED_MESSAGE);
  }

  protected returnToBankLogin(): void {
    this.otpForm.reset();
    this.statusMessage.set('');
    this.otpVerificationOpen.set(false);
    this.bankLoginOpen.set(true);
  }

  // ---- Close everything --------------------------------------------------------------

  @HostListener('document:keydown.escape')
  protected closeBankFlow(): void {
    this.wipeCredentials();
    this.clearStatusTimer();
    this.statusMessage.set('');
    this.bankSelectionOpen.set(false);
    this.bankLoginOpen.set(false);
    this.otpVerificationOpen.set(false);
    this.selectedBank.set(null);
  }

  // ---- Helpers --------------------------------------------------------------------

  private wipeCredentials(): void {
    this.bankLoginForm.reset();
    this.otpForm.reset();
    this.showPassword.set(false);
  }

  private flashStatus(message: string): void {
    this.clearStatusTimer();
    this.statusMessage.set(message);
    this.statusTimer = setTimeout(() => this.statusMessage.set(''), 6000);
  }

  private clearStatusTimer(): void {
    if (this.statusTimer !== null) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
  }
}