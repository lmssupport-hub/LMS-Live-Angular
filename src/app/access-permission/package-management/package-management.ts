import { Component, HostListener, inject, OnInit, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { CreatePackageModal } from '../pop-modals/create-package-modal/create-package-modal';
import { PackagePayload, PackageRecord, PackageService, PackageDraftService } from '../../services/package.service';

/** Absolute paths, matching app.routes.ts (children of 'super-admin-dashboard'). */
const PACKAGE_PERMISSIONS_PATH = '/super-admin-dashboard/package/create/permissions';
const PACKAGE_LIST_PATH = '/super-admin-dashboard/package';

const serverActionErrorMessage =
  'Unable to complete the requested action due to a server error. Please try again later.';
const isServerError = (status?: number): boolean => status === 0 || (status ?? 0) >= 500;
const isDuplicateNameError = (status: number | undefined, message: string): boolean =>
  status === 409 || /(?:package(?: name)?.*(?:same name|exists|duplicate)|(?:exists|duplicate).*package name)/i.test(message);

function extractBackendMessage(error: { error?: { detail?: string; message?: string } | string }): string {
  return typeof error.error === 'string' ? error.error : error.error?.detail ?? error.error?.message ?? '';
}

type DropdownName = 'filter';
type StatusFilter = 'All' | 'Active' | 'Inactive';

@Component({
  selector: 'app-package-management',
  imports: [CurrencyPipe, CreatePackageModal],
  templateUrl: './package-management.html',
  styleUrl: './package-management.css',
})
export class PackageManagement implements OnInit {
  private readonly packagesApi = inject(PackageService);
  private readonly router = inject(Router);
  private readonly draft = inject(PackageDraftService);

  // List state (the table rows are packages)
  protected readonly rows = signal<PackageRecord[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  protected readonly search = signal('');
  protected readonly statusFilter = signal<StatusFilter>('All');
  protected readonly totalElements = signal(0);
  protected readonly page = signal(0);
  protected readonly pageSize = 20;

  // Filter dropdown UI state
  protected readonly ddUsed = signal(false);
  protected readonly openDropdown = signal<DropdownName | null>(null);
  protected readonly filterOptions: readonly StatusFilter[] = ['All', 'Active', 'Inactive'];

  // Full package list for the create/edit modal (duplicate-name check)
  protected readonly packages = signal<PackageRecord[]>([]);

  // Create / Edit flow — ONE modal (CreatePackageModal) handles both.
  // editingPackage() === null  -> create mode
  // editingPackage() !== null  -> edit mode (modal prefilled with this package)
  protected readonly createDialogOpen = signal(false);
  protected readonly editingPackage = signal<PackageRecord | null>(null);

  // Shared UI state
  protected readonly formError = signal('');
  protected readonly successMessage = signal('');
  protected readonly deletingPackageId = signal<number | null>(null);

  ngOnInit(): void {
    this.loadPackages();
    this.loadAllPackagesForDialogs();
    this.flashSuccessIfReturningFromPermissionStep();
  }

  // ---- Filter dropdown (UI only) -----------------------------------------------------------

  protected toggleDropdown(): void {
    this.openDropdown.update((current) => (current === 'filter' ? null : 'filter'));
  }

  protected selectFilter(option: StatusFilter): void {
    this.onFilter(option);
    this.openDropdown.set(null);
  }

  @HostListener('document:click')
  protected closeFilterDropdown(): void {
    this.openDropdown.set(null);
  }

  // ---- Package list -----------------------------------------------------------

  protected loadPackages(): void {
    this.loading.set(true);
    this.loadError.set('');
    this.packagesApi
      .list({
        search: this.search() || undefined,
        status: this.statusFilter(),
        page: this.page(),
        size: this.pageSize,
      })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (result) => {
          this.rows.set(result.content);
          this.totalElements.set(result.totalElements);
        },
        error: (error) =>
          this.loadError.set(
            error?.status === 403
              ? 'You do not have permission to view this list.'
              : isServerError(error?.status)
                ? serverActionErrorMessage
                : 'List could not be loaded. Please try again.',
          ),
      });
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    this.page.set(0);
    this.loadPackages();
  }

  protected onFilter(value: StatusFilter): void {
    this.statusFilter.set(value);
    this.page.set(0);
    this.loadPackages();
  }

  /** Loads the full package list used by the create/edit modal for its duplicate-name check. */
  private loadAllPackagesForDialogs(): void {
    this.packagesApi.list({ size: 100 }).subscribe({
      next: (result) => this.packages.set(result.content),
      error: (error) => console.error('Failed to load packages for dialogs:', error),
    });
  }

  // ---- Row actions (Edit / Delete) ----------------------------------------

  /** Row "Edit" button: opens the shared create/edit modal in edit mode. */
  protected openEditPackage(item: PackageRecord): void {
    this.formError.set('');
    this.editingPackage.set(item);
    this.createDialogOpen.set(true);
  }

  protected deletePackage(item: PackageRecord): void {
    if (this.deletingPackageId() != null) return;

    const confirmed = window.confirm(`Delete package "${item.name}"? This cannot be undone.`);
    if (!confirmed) return;

    this.deletingPackageId.set(item.id);
    this.packagesApi
      .delete(item.id)
      .pipe(finalize(() => this.deletingPackageId.set(null)))
      .subscribe({
        next: () => {
          this.loadPackages();
          this.loadAllPackagesForDialogs();
          this.flashSuccess('Package deleted successfully.');
        },
        error: (error) => {
          this.handleSaveError(error, 'Package deletion failed. Please try again.');
          if (this.formError()) this.flashSuccess(this.formError());
        },
      });
  }

  // ---- Create / Edit (shared modal) -----------------------------------------------------------

  protected openCreateDialog(): void {
    this.formError.set('');
    this.editingPackage.set(null);
    this.createDialogOpen.set(true);
  }

  protected closeCreateDialog(): void {
    this.createDialogOpen.set(false);
    this.editingPackage.set(null);
  }

  /** "Next" from the modal: starts a create draft, or an edit draft when editing. */
  protected onCreateDetailsSubmitted(payload: PackagePayload): void {
    const editing = this.editingPackage();
    if (editing) {
      this.draft.startEditDraft(editing.id, payload);
    } else {
      this.draft.startDraft(payload);
    }
    this.createDialogOpen.set(false);
    this.editingPackage.set(null);
    void this.router.navigate([PACKAGE_PERMISSIONS_PATH]);
  }

  // ---- Row "Assign admin": opens its own page (package/:id/admins) -------------------------

  protected openPackageAdmins(item: PackageRecord): void {
    void this.router.navigate([PACKAGE_LIST_PATH, item.id, 'admins']);
  }

  // ---- Shared helpers -----------------------------------------------------------

  private handleSaveError(error: { status?: number; error?: unknown }, fallback: string): void {
    const backendMessage = extractBackendMessage(error as never);
    if (isServerError(error.status)) {
      this.formError.set(serverActionErrorMessage);
      return;
    }
    if (isDuplicateNameError(error.status, backendMessage)) {
      this.formError.set('A package with the same name already exists');
      return;
    }
    this.formError.set(backendMessage || fallback);
  }

  /**
   * PackagePermissionStep navigates back with
   *   { state: { packageCreated: true } }  after create, or
   *   { state: { packageUpdated: true } }  after edit.
   */
  private flashSuccessIfReturningFromPermissionStep(): void {
    const state = this.router.getCurrentNavigation()?.extras.state
      ?? (history.state as { packageCreated?: boolean; packageUpdated?: boolean } | undefined);
    if (state?.packageCreated || state?.packageUpdated) {
      this.flashSuccess(state.packageUpdated ? 'Package updated successfully.' : 'Package created successfully.');
      history.replaceState({ ...history.state, packageCreated: undefined, packageUpdated: undefined }, '');
      this.loadAllPackagesForDialogs();
    }
  }

  private flashSuccess(message: string): void {
    this.successMessage.set(message);
    setTimeout(() => this.successMessage.set(''), 3500);
  }
}