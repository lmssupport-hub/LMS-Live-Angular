import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output, signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { buildPackageDetailsForm } from '../forms/package-form';
import {
  AVAILABLE_PACKAGE_OPTIONS,
  BILLING_CYCLE_DAYS,
  MAX_TRIAL_DAYS,
  PackagePayload,
  PackageRecord,
  TRIAL_PACKAGE,
  resolveDurationDays,
} from '../../../services/package.service';

type PackageDropdown = 'available' | 'billing';

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

  protected readonly availablePackageOptions = AVAILABLE_PACKAGE_OPTIONS;
  protected readonly billingCycleOptions = ['Monthly', 'Yearly'] as const;
  protected readonly billingDays = BILLING_CYCLE_DAYS;
  protected readonly maxTrialDays = MAX_TRIAL_DAYS;
  // excludedId: in edit mode the package must not be flagged as a duplicate of itself.
  protected readonly form = buildPackageDetailsForm(
    () => this.existingPackages,
    () => this.editing?.id ?? null,
  );

  /** Which custom dropdown (Available Package / Billing cycle) is currently open. UI state only. */
  protected readonly openDropdown = signal<PackageDropdown | null>(null);

  ngOnInit(): void {
    const item = this.editing;
    if (!item) return;
    // durationDays is the LAST control in the form, so its stored value wins over auto-fills.
    this.form.reset({
      name: item.name,
      availablePackage: item.availablePackage,
      description: item.description ?? '',
      price: item.price,
      billingCycle: item.billingCycle,
      userLimit: item.userLimit,
      storageLimit: item.storageLimit,
      durationDays: item.durationDays ?? null,
    });
  }

  protected isEdit(): boolean {
    return this.editing !== null;
  }

  protected isTrial(): boolean {
    return this.form.controls.availablePackage.value === TRIAL_PACKAGE;
  }

  protected toggleDropdown(name: PackageDropdown): void {
    this.openDropdown.update((current) => (current === name ? null : name));
  }

  /** Sets the chosen option on the form control and closes the dropdown. */
  protected chooseOption(controlName: 'availablePackage' | 'billingCycle', value: string): void {
    const control = this.form.controls[controlName];
    control.setValue(value as never);
    control.markAsDirty();
    control.markAsTouched();
    this.openDropdown.set(null);
  }

  protected descriptionCharCount(): number {
    return this.form.controls.description.value.length;
  }

  protected onSubmit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    const value = this.form.getRawValue();
    this.next.emit({
      name: value.name.trim(),
      availablePackage: value.availablePackage as PackagePayload['availablePackage'],
      description: value.description.trim() || null,
      price: value.availablePackage === TRIAL_PACKAGE ? 0 : value.price!,
      billingCycle: value.billingCycle as PackagePayload['billingCycle'],
      durationDays: resolveDurationDays(value.billingCycle, value.durationDays),
      userLimit: value.userLimit!,
      storageLimit: value.storageLimit,
      // Edit mode keeps the saved permissions; the permission step lets the user change them.
      permissions: this.editing?.permissions ?? [],
    });
  }

  reset(): void {
    this.form.reset();
    this.openDropdown.set(null);
  }

  markNameAsDuplicate(): void {
    const control = this.form.controls.name;
    control.setErrors({ ...control.errors, packageNameExists: true });
    control.markAsTouched();
  }
}