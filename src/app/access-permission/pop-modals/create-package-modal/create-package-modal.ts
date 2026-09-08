import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { buildPackageDetailsForm, wordCountOf } from '../forms/package-form';
import { AVAILABLE_PACKAGE_OPTIONS, PackagePayload, PackageRecord } from '../../../services/package.service';


@Component({
  selector: 'app-create-package-modal',
  imports: [ReactiveFormsModule],
  templateUrl: './create-package-modal.html',
  styleUrl: './create-package-modal.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreatePackageModal {
  /** Existing packages, for the client-side duplicate-name check. */
  @Input({ required: true }) existingPackages: readonly PackageRecord[] = [];
  @Output() readonly cancelled = new EventEmitter<void>();
  @Output() readonly next = new EventEmitter<PackagePayload>();

  protected readonly availablePackageOptions = AVAILABLE_PACKAGE_OPTIONS;
  protected readonly form = buildPackageDetailsForm(() => this.existingPackages);

  protected descriptionWordCount(): number {
    return wordCountOf(this.form.controls.description.value);
  }

  protected onSubmit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    const value = this.form.getRawValue();
    this.next.emit({
      name: value.name.trim(),
      availablePackage: value.availablePackage as PackagePayload['availablePackage'],
      description: value.description.trim() || null,
      price: value.price!,
      billingCycle: value.billingCycle as PackagePayload['billingCycle'],
      userLimit: value.userLimit!,
      storageLimit: value.storageLimit,
      permissions: [],
    });
  }

  /** Called by the container after a successful create, or on reopen. */
  reset(): void {
    this.form.reset();
  }

  /**
   * Surfaces a server-side 409 (duplicate name) back onto the name field
   * without the component needing to know anything about HTTP.
   */
  markNameAsDuplicate(): void {
    const control = this.form.controls.name;
    control.setErrors({ ...control.errors, packageNameExists: true });
    control.markAsTouched();
  }
}