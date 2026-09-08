import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, SimpleChanges, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PackageRecord } from '../../../services/package.service';
import { AdminSummary } from '../../../services/auth';

export interface PackageAssignRequest {
  email: string;
  packageId: number;
}


@Component({
  selector: 'app-assign-package-modal',
  imports: [FormsModule],
  templateUrl: './assign-package-modal.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssignPackageModal implements OnChanges {
  @Input() admin: AdminSummary | null = null;
  @Input() admins: readonly AdminSummary[] = [];
  @Input({ required: true }) packages: readonly PackageRecord[] = [];
  @Input() loading = false;
  @Input() submitting = false;
  @Input() serverError = '';

  @Output() readonly cancelled = new EventEmitter<void>();
  @Output() readonly retryLoadPackages = new EventEmitter<void>();
  @Output() readonly saved = new EventEmitter<PackageAssignRequest>();

  /** How many admins to show in the combobox before the user has typed anything. */
  private readonly defaultVisibleCount = 3;
  /** Cap on how many matches to show once the user is actively searching, so the list doesn't get unwieldy. */
  private readonly maxSearchResults = 8;

  protected emailDropdownOpen = false;
  protected emailSearchQuery = '';
  protected selectedAdminId: number | null = null;
  protected selectedPackageId: number | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    // Reset/reseed selections whenever the modal is (re)opened with a
    // different admin/row context, so a stale choice from a previous open
    // never lingers.
    if (changes['admin']) {
      this.selectedAdminId = null;
      // ROW MODE: admin is already known — if they already have a package,
      // pre-select it instead of leaving the field empty. If they don't
      // (packageId is null/undefined), leave selectedPackageId null as
      // before, same as a fresh assign.
      this.selectedPackageId = this.admin?.packageId ?? null;
      this.emailSearchQuery = '';
      this.emailDropdownOpen = false;
    }
  }

  /** Admins shown in the combobox: first N by default, or search matches once the user types. */
  protected get filteredAdmins(): readonly AdminSummary[] {
    const query = this.emailSearchQuery.trim().toLowerCase();
    if (!query) return this.admins.slice(0, this.defaultVisibleCount);
    return this.admins
      .filter((a) => a.email.toLowerCase().includes(query) || a.username.toLowerCase().includes(query))
      .slice(0, this.maxSearchResults);
  }

  protected get resolvedEmail(): string | null {
    if (this.admin) return this.admin.email;
    return this.admins.find((a) => a.id === this.selectedAdminId)?.email ?? null;
  }

  protected get canSubmit(): boolean {
    return !this.submitting && !this.loading && this.selectedPackageId != null && !!this.resolvedEmail;
  }

  protected toggleEmailDropdown(): void {
    if (this.admin) return; // row mode: email is fixed, nothing to open
    this.emailDropdownOpen = !this.emailDropdownOpen;
    if (this.emailDropdownOpen) this.emailSearchQuery = '';
  }

  /** Clicking anywhere else inside the modal closes the combobox without dismissing the whole dialog. */
  protected closeEmailDropdown(): void {
    this.emailDropdownOpen = false;
  }

  protected selectAdmin(a: AdminSummary): void {
    this.selectedAdminId = a.id;
    // PICKER MODE: same rule as row mode — if the picked admin already has
    // a package, show it pre-selected so the dropdown reflects their
    // current state instead of looking unassigned. If they have none
    // (packageId null/undefined), the package field stays empty as usual.
    this.selectedPackageId = a.packageId ?? null;
    this.emailDropdownOpen = false;
    this.emailSearchQuery = '';
  }

  protected onSubmit(): void {
    const email = this.resolvedEmail;
    if (!email || this.selectedPackageId == null || this.submitting) return;
    this.saved.emit({ email, packageId: this.selectedPackageId });
  }
}