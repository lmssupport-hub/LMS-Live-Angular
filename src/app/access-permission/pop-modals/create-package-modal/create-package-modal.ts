import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output, signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { buildPackageDetailsForm } from '../forms/package-form';
import {
  AVAILABLE_PACKAGE_OPTIONS,
  AvailablePackage,
  BILLING_CYCLE_DAYS,
  FREE_PACKAGE,
  MAX_TRIAL_DAYS,
  PackagePayload,
  PackageRecord,
  resolveDurationDays,
} from '../../../services/package.service';

/** Only the Billing cycle dropdown is left; the package type is now Price / Free buttons. */
type PackageDropdown = 'billing';

/**
 * One modal for BOTH "Create package" and "Edit package".
 * Pass [editing]="packageRecord" to open it in edit mode (form is prefilled);
 * leave it null for create mode.
 */
@Component({
  selector: 'app-create-package-modal',
  imports: [ReactiveFormsModule],
  templateUrl: './create-package-modal.html',
  styleUrl: './create-package-modal.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreatePackageModal implements OnInit {
  /** Existing packages, for the client-side duplicate-name check. */
  @Input({ required: true }) existingPackages: readonly PackageRecord[] = [];
  /** When set, the modal works in edit mode for this package. */
  @Input() editing: PackageRecord | null = null;

  @Output() readonly cancelled = new EventEmitter<void>();
  @Output() readonly next = new EventEmitter<PackagePayload>();

  protected readonly packageTypeOptions = AVAILABLE_PACKAGE_OPTIONS;
  protected readonly billingCycleOptions = ['Monthly', 'Yearly'] as const;
  protected readonly billingDays = BILLING_CYCLE_DAYS;
  protected readonly maxTrialDays = MAX_TRIAL_DAYS;
  // excludedId: in edit mode the package must not be flagged as a duplicate of itself.
  protected readonly form = buildPackageDetailsForm(
    () => this.existingPackages,
    () => this.editing?.id ?? null,
  );

  /** Which custom dropdown (Billing cycle) is currently open. UI state only. */
  protected readonly openDropdown = signal<PackageDropdown | null>(null);

  /** Shows the "Discard changes?" confirmation popup. */
  protected readonly confirmCancelOpen = signal(false);

  ngOnInit(): void {
    const item = this.editing;
    if (!item) return;
    // Old rows used 'Trial' (and Basic/Standard/Premium/Existing). Map them to the new Free / Price types.
    const legacyType = item.availablePackage as string;
    const packageType: AvailablePackage = legacyType === 'Free' || legacyType === 'Trial' ? 'Free' : 'Price';
    // durationDays is the LAST control in the form, so its stored value wins over auto-fills.
    this.form.reset({
      name: item.name,
      availablePackage: packageType,
      description: item.description ?? '',
      price: item.price,
      billingCycle: item.billingCycle,
      userLimit: item.userLimit,
      storageLimit: item.storageLimit,
      autoAssignOnSignup: item.autoAssignOnSignup ?? false,
      showOnWebsite: item.showOnWebsite ?? false,
      isActive: item.status !== 'Inactive',
      durationDays: item.durationDays ?? null,
    });
  }

  protected isEdit(): boolean {
    return this.editing !== null;
  }

  protected isFree(): boolean {
    return this.form.controls.availablePackage.value === FREE_PACKAGE;
  }

  protected isPrice(): boolean {
    return this.form.controls.availablePackage.value === 'Price';
  }

  protected typeButtonClass(option: AvailablePackage): string {
    const selected = this.form.controls.availablePackage.value === option;
    return selected
      ? 'bg-[#4694A4] text-white shadow-sm'
      : 'bg-transparent text-[#505050] hover:bg-[#eaeaea]';
  }

  protected toggleDropdown(name: PackageDropdown): void {
    this.openDropdown.update((current) => (current === name ? null : name));
  }

  /** Picks Price or Free. Re-clicking the already selected type does nothing (keeps typed days/price). */
  protected chooseType(value: AvailablePackage): void {
    this.openDropdown.set(null);
    const control = this.form.controls.availablePackage;
    if (control.value === value) return;
    control.setValue(value);
    control.markAsDirty();
    control.markAsTouched();
  }

  /** Sets the chosen option on the form control and closes the dropdown. */
  protected chooseOption(controlName: 'billingCycle', value: string): void {
    const control = this.form.controls[controlName];
    control.setValue(value as never);
    control.markAsDirty();
    control.markAsTouched();
    this.openDropdown.set(null);
  }

  /** Active / Inactive switch (same toggle in create and edit). */
  protected toggleActive(): void {
    const control = this.form.controls.isActive;
    control.setValue(!control.value);
    control.markAsDirty();
  }

  protected descriptionCharCount(): number {
    return this.form.controls.description.value.length;
  }

  /** Package Name: letters only. Strips digits, spaces and symbols as the user types or pastes. */
  protected onNameInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const cleaned = input.value.replace(/[^A-Za-z]/g, '');
    if (cleaned !== input.value) {
      input.value = cleaned;
      this.form.controls.name.setValue(cleaned);
    }
  }

  /** Cancel button, close (X) icon and backdrop click all ask for confirmation first. */
  protected requestCancel(): void {
    this.openDropdown.set(null);
    this.confirmCancelOpen.set(true);
  }

  /** "No, keep editing": close the popup, stay in the form. */
  protected keepEditing(): void {
    this.confirmCancelOpen.set(false);
  }

  /** "Yes, discard": close the popup and the whole modal. */
  protected confirmDiscard(): void {
    this.confirmCancelOpen.set(false);
    this.cancelled.emit();
  }

  protected onSubmit(): void {
    // Re-run validation first: when Price/Free swaps fields, a hidden control can keep a stale error.
    Object.values(this.form.controls).forEach((control) => control.updateValueAndValidity({ emitEvent: false }));
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    const value = this.form.getRawValue();
    const free = value.availablePackage === FREE_PACKAGE;
    this.next.emit({
      name: value.name.trim(),
      availablePackage: value.availablePackage as PackagePayload['availablePackage'],
      description: value.description.trim() || null,
      price: free ? 0 : value.price!,
      billingCycle: value.billingCycle as PackagePayload['billingCycle'],
      durationDays: resolveDurationDays(value.billingCycle, value.durationDays),
      userLimit: value.userLimit!,
      storageLimit: value.storageLimit,
      autoAssignOnSignup: free ? value.autoAssignOnSignup : false,
      showOnWebsite: free ? false : value.showOnWebsite,
      status: value.isActive ? 'Active' : 'Inactive',
      // Edit mode keeps the saved permissions; the permission step lets the user change them.
      permissions: this.editing?.permissions ?? [],
    });
  }

  reset(): void {
    this.form.reset();
    this.openDropdown.set(null);
    this.confirmCancelOpen.set(false);
  }

  markNameAsDuplicate(): void {
    const control = this.form.controls.name;
    control.setErrors({ ...control.errors, packageNameExists: true });
    control.markAsTouched();
  }
}