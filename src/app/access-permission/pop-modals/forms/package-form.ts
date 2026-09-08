import { AbstractControl, FormControl, FormGroup, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { AVAILABLE_PACKAGE_PATTERN, PackageRecord } from '../../../services/package.service';

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/** Enforces a trimmed string length range (SRS: Package Name 3-100 chars). */
export function trimmedLength(min: number, max: number): ValidatorFn {
  return (control: AbstractControl<string>): ValidationErrors | null => {
    const length = (control.value ?? '').trim().length;
    if (length < min) return { minlength: { requiredLength: min, actualLength: length } };
    if (length > max) return { maxlength: { requiredLength: max, actualLength: length } };
    return null;
  };
}

/** Enforces a max word count (SRS: Package Description <= 500 words). */
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

/**
 * Client-side duplicate-name check for fast feedback. The server remains the
 * source of truth — PackageManagementComponent maps a 409 response to the
 * same `packageNameExists` error, so both paths render identically.
 *
 * @param packages    lazy accessor so the validator always sees fresh data
 * @param excludedId  the package's own id, so editing doesn't flag itself
 */
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
}

/**
 * Single source of truth for the "package details" form shape + validation
 * rules (SRS Doc06 Field List #10-18). Both CreatePackageModalComponent and
 * UpdatePackageModalComponent call this instead of redeclaring the same
 * FormGroup twice, so the two forms can't drift out of sync.
 */
export function buildPackageDetailsForm(
  packages: () => readonly PackageRecord[],
  excludedId: () => number | null = () => null,
): FormGroup<PackageDetailsForm> {
  return new FormGroup<PackageDetailsForm>({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, trimmedLength(3, 100), uniquePackageName(packages, excludedId)],
    }),
    availablePackage: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(AVAILABLE_PACKAGE_PATTERN)],
    }),
    description: new FormControl('', { nonNullable: true, validators: [maxWordCount(500)] }),
    price: new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    billingCycle: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    userLimit: new FormControl<number | null>(null, [Validators.required, Validators.min(1)]),
    storageLimit: new FormControl<number | null>(null, [Validators.min(0)]),
  });
}