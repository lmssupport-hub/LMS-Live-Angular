import { AbstractControl, FormControl, FormGroup, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import {
  AVAILABLE_PACKAGE_PATTERN,
  BILLING_CYCLE_DAYS,
  CUSTOM_BILLING_CYCLE,
  MAX_TRIAL_DAYS,
  PackageRecord,
  TRIAL_PACKAGE,
} from '../../../services/package.service';

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

export function trimmedLength(min: number, max: number): ValidatorFn {
  return (control: AbstractControl<string>): ValidationErrors | null => {
    const length = (control.value ?? '').trim().length;
    if (length < min) return { minlength: { requiredLength: min, actualLength: length } };
    if (length > max) return { maxlength: { requiredLength: max, actualLength: length } };
    return null;
  };
}

export function maxWordCount(limit: number): ValidatorFn {
  return (control: AbstractControl<string>): ValidationErrors | null => {
    const text = (control.value ?? '').trim();
    const count = text ? text.split(/\s+/).length : 0;
    return count <= limit ? null : { maxWordCount: { limit, actual: count } };
  };
}

export function wordCountOf(value: string | null | undefined): number {
  const text = (value ?? '').trim();
  return text ? text.split(/\s+/).length : 0;
}

export function uniquePackageName(
  packages: () => readonly PackageRecord[],
  excludedId: () => number | null = () => null,
): ValidatorFn {
  return (control: AbstractControl<string>): ValidationErrors | null => {
    const name = (control.value ?? '').trim().toLocaleLowerCase();
    if (!name) return null;
    const duplicate = packages().some(
      (item) => item.id !== excludedId() && item.name.trim().toLocaleLowerCase() === name,
    );
    return duplicate ? { packageNameExists: true } : null;
  };
}

/**
 * Days are mandatory ONLY when the Available Package is Trial.
 */
export function trialDaysValidator(): ValidatorFn {
  return (control: AbstractControl<number | null>): ValidationErrors | null => {
    if (control.parent?.get('availablePackage')?.value !== TRIAL_PACKAGE) return null;
    const value = control.value;
    if (value === null || value === undefined || (value as unknown) === '') return { required: true };
    if (!Number.isInteger(Number(value))) return { integer: true };
    if (Number(value) < 1) return { min: { min: 1, actual: value } };
    if (Number(value) > MAX_TRIAL_DAYS) return { max: { max: MAX_TRIAL_DAYS, actual: value } };
    return null;
  };
}

/**
 * Price rule:
 *  - Trial  -> always 0 (set automatically, read-only in the UI)
 *  - Others -> required and must be greater than zero
 */
export function priceValidator(): ValidatorFn {
  return (control: AbstractControl<number | null>): ValidationErrors | null => {
    const value = control.value;
    const isTrial = control.parent?.get('availablePackage')?.value === TRIAL_PACKAGE;
    if (isTrial) return null;
    if (value === null || value === undefined || (value as unknown) === '') return { required: true };
    if (Number(value) < 0.01) return { min: { min: 0.01, actual: value } };
    return null;
  };
}

// ---------------------------------------------------------------------------
// Form shape + factory
// ---------------------------------------------------------------------------

export interface PackageDetailsForm {
  name: FormControl<string>;
  availablePackage: FormControl<string>;
  description: FormControl<string>;
  price: FormControl<number | null>;
  billingCycle: FormControl<string>;
  userLimit: FormControl<number | null>;
  storageLimit: FormControl<number | null>;
  /** KEEP LAST: FormGroup.reset() applies controls in order, so the stored value wins. */
  durationDays: FormControl<number | null>;
}

export function buildPackageDetailsForm(
  packages: () => readonly PackageRecord[],
  excludedId: () => number | null = () => null,
): FormGroup<PackageDetailsForm> {
  const form = new FormGroup<PackageDetailsForm>({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, trimmedLength(3, 100), uniquePackageName(packages, excludedId)],
    }),
    availablePackage: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(AVAILABLE_PACKAGE_PATTERN)],
    }),
    description: new FormControl('', { nonNullable: true, validators: [maxWordCount(500)] }),
    // KEEP AFTER availablePackage: reset() applies in order, so a stored price wins over the Trial auto-0.
    price: new FormControl<number | null>(null, [priceValidator()]),
    billingCycle: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    userLimit: new FormControl<number | null>(null, [Validators.required, Validators.min(1)]),
    storageLimit: new FormControl<number | null>(null, [Validators.min(0)]),
    durationDays: new FormControl<number | null>(null, [trialDaysValidator()]),
  });

  const { availablePackage, billingCycle, durationDays, price } = form.controls;

  // Trial  -> billing cycle "Custom", price 0, days entered by user.
  // Others -> "Custom" cleared, and the auto 0 price cleared so the user must enter a real price.
  availablePackage.valueChanges.subscribe((pkg) => {
    if (pkg === TRIAL_PACKAGE) {
      billingCycle.setValue(CUSTOM_BILLING_CYCLE, { emitEvent: false });
      durationDays.setValue(null, { emitEvent: false });
      price.setValue(0, { emitEvent: false });
    } else {
      if (billingCycle.value === CUSTOM_BILLING_CYCLE) {
        billingCycle.setValue('', { emitEvent: false });
        durationDays.setValue(null, { emitEvent: false });
      }
      if (price.value === 0) {
        price.setValue(null, { emitEvent: false });
      }
    }
    durationDays.updateValueAndValidity({ emitEvent: false });
    price.updateValueAndValidity({ emitEvent: false });
  });

  // Monthly -> 30 days, Yearly -> 365 days (automatic).
  billingCycle.valueChanges.subscribe((cycle) => {
    if (cycle === 'Monthly' || cycle === 'Yearly') {
      durationDays.setValue(BILLING_CYCLE_DAYS[cycle], { emitEvent: false });
    }
  });

  return form;
}