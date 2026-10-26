import { Component, HostListener, computed, inject, OnInit, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Router } from '@angular/router';
import { finalize, map, of, switchMap } from 'rxjs';
import { CreatePackageModal } from '../pop-modals/create-package-modal/create-package-modal';
import { AssignPackageModal, PackageAssignRequest } from '../pop-modals/assign-package-modal/assign-package-modal';
import { PackagePayload, PackageRecord, PackageService, PackageDraftService } from '../../services/package.service';
import { AdminSummary, AuthService } from '../../services/auth';

export interface AdminPackageRow {
  admin: AdminSummary;
  package: PackageRecord | null;
}

/** Absolute paths, matching app.routes.ts (children of 'super-admin-dashboard'). */
const PACKAGE_PERMISSIONS_PATH = '/super-admin-dashboard/package/create/permissions';

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
  imports: [CurrencyPipe, CreatePackageModal, AssignPackageModal],
  templateUrl: './package-management.html',
  styleUrl: './package-management.css',
})
export class PackageManagement implements OnInit {
  private readonly packagesApi = inject(PackageService);
  private readonly authApi = inject(AuthService);
  private readonly router = inject(Router);
  private readonly draft = inject(PackageDraftService);

  // List state
  protected readonly rows = signal<AdminPackageRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  protected readonly search = signal('');
  protected readonly statusFilter = signal<StatusFilter>('All');
  protected readonly totalElements = signal(0);
  protected readonly page = signal(0);
  protected readonly pageSize = 20;

  protected readonly filteredRows = computed(() => this.rows());

  // Filter dropdown UI state
  protected readonly ddUsed = signal(false);
  protected readonly openDropdown = signal<DropdownName | null>(null);
  protected readonly filterOptions: readonly StatusFilter[] = ['All', 'Active', 'Inactive'];

  protected readonly packages = signal<PackageRecord[]>([]);
  protected readonly packagesLoadError = signal('');
  protected readonly packagesLoading = signal(false);

  protected readonly admins = signal<AdminSummary[]>([]);
  protected readonly adminsLoading = signal(false);
  protected readonly adminsLoadError = signal('');

  // Create / Edit flow — ONE modal (CreatePackageModal) handles both.
  // editingPackage() === null  -> create mode
  // editingPackage() !== null  -> edit mode (modal prefilled with this package)
  protected readonly createDialogOpen = signal(false);
  protected readonly editingPackage = signal<PackageRecord | null>(null);

  // Assign flow ("Update package" in the UI)
  protected readonly assignDialogOpen = signal(false);
  protected readonly assigningAdmin = signal<AdminSummary | null>(null);

  // Shared UI state
  protected readonly submitting = signal(false);
  protected readonly formError = signal('');
  protected readonly successMessage = signal('');

  protected readonly openActionMenuId = signal<number | null>(null);
  protected readonly deletingPackageId = signal<number | null>(null);
  protected readonly viewingPackage = signal<PackageRecord | null>(null);

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

  // ---- List (Admin + Package) -----------------------------------------------------------

  protected loadPackages(): void {
    this.loading.set(true);
    this.loadError.set('');
    this.authApi
      .listAdmins({ search: this.search() || undefined, status: this.statusFilter(), page: this.page(), size: this.pageSize })
      .pipe(
        switchMap((adminPage) => {
          const ids = [...new Set(
            adminPage.content.map((a) => a.packageId).filter((id): id is number => id != null),
          )];
          return ids.length
            ? this.packagesApi.getByIds(ids).pipe(map((pkgs) => ({ adminPage, pkgs })))
            : of({ adminPage, pkgs: [] as PackageRecord[] });
        }),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: ({ adminPage, pkgs }) => {
          const pkgById = new Map(pkgs.map((p) => [p.id, p]));
          this.rows.set(
            adminPage.content.map((admin) => ({
              admin,
              package: admin.packageId != null ? pkgById.get(admin.packageId) ?? null : null,
            })),
          );
          this.totalElements.set(adminPage.totalElements);
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

  private loadAllPackagesForDialogs(): void {
    this.packagesLoadError.set('');
    this.packagesLoading.set(true);
    this.packagesApi
      .list({ size: 100 })
      .pipe(finalize(() => this.packagesLoading.set(false)))
      .subscribe({
        next: (result) => this.packages.set(result.content),
        error: (error) => {
          console.error('Failed to load packages for dialogs:', error);
          this.packagesLoadError.set(
            error?.status === 403
              ? 'You do not have permission to view packages.'
              : isServerError(error?.status)
                ? serverActionErrorMessage
                : 'Could not load package list. Please refresh and try again.',
          );
        },
      });
  }

  protected retryLoadPackagesForDialogs(): void {
    this.loadAllPackagesForDialogs();
  }

  private loadAllAdminsForDialog(): void {
    this.adminsLoadError.set('');
    this.adminsLoading.set(true);
    this.authApi
      .listAdmins({ status: 'All', page: 0, size: 200 })
      .pipe(finalize(() => this.adminsLoading.set(false)))
      .subscribe({
        next: (result) => this.admins.set(result.content),
        error: (error) => {
          console.error('Failed to load admins for assign dialog:', error);
          this.adminsLoadError.set(
            error?.status === 403
              ? 'You do not have permission to view admins.'
              : isServerError(error?.status)
                ? serverActionErrorMessage
                : 'Could not load admin list. Please refresh and try again.',
          );
        },
      });
  }

  // ---- Row action menu ----------------------------------------

  protected toggleActionMenu(adminId: number, event: MouseEvent): void {
    event.stopPropagation();
    this.openActionMenuId.set(this.openActionMenuId() === adminId ? null : adminId);
  }

  protected closeActionMenu(): void {
    this.openActionMenuId.set(null);
  }

  protected openViewPackage(item: PackageRecord | null, event: MouseEvent): void {
    event.stopPropagation();
    this.closeActionMenu();
    if (item) this.viewingPackage.set(item);
  }

  protected closeViewPackage(): void {
    this.viewingPackage.set(null);
  }

  /** Row "Edit" button: just opens the shared create/edit modal in edit mode. */
  protected openEditPackage(item: PackageRecord | null, event: MouseEvent): void {
    event.stopPropagation();
    this.closeActionMenu();
    if (!item) return;
    this.formError.set('');
    this.editingPackage.set(item);
    this.createDialogOpen.set(true);
  }

  protected deletePackageFromMenu(item: PackageRecord, event: MouseEvent): void {
    event.stopPropagation();
    this.closeActionMenu();
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
        error: (error) => this.handleSaveError(error, 'Package deletion failed. Please try again.'),
      });
  }

  // ---- Create / Edit (shared modal) -----------------------------------------------------------

  protected openCreateDialog(): void {
    this.formError.set('');
    this.editingPackage.set(null);
    this.createDialogOpen.set(true);
  }

  protected closeCreateDialog(): void {
    if (this.submitting()) return;
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

  // ---- Assign ("Update package") -----------------------------------------------------------

  protected openAssignDialog(admin: AdminSummary): void {
    this.formError.set('');
    this.assigningAdmin.set(admin);
    this.assignDialogOpen.set(true);
    if (!this.packages().length && !this.packagesLoading()) {
      this.loadAllPackagesForDialogs();
    }
  }

    protected openAssignPackagePicker(): void {
    this.formError.set('');
    this.assigningAdmin.set(null);
    this.assignDialogOpen.set(true);
    if (!this.packages().length && !this.packagesLoading()) {
      this.loadAllPackagesForDialogs();
    }
    // Always refresh: another assignment/edit may have changed admins' packages since the last load.
    if (!this.adminsLoading()) {
      this.loadAllAdminsForDialog();
    }
  }

  protected closeAssignDialog(): void {
    if (this.submitting()) return;
    this.assignDialogOpen.set(false);
    this.assigningAdmin.set(null);
  }

  protected onAssignSubmitted({ email, packageId }: PackageAssignRequest): void {
    if (this.submitting()) return;

    this.submitting.set(true);
    this.formError.set('');
    this.packagesApi
      .assignToUser({ emailId: email, packageId })
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
               next: () => {
          // Keep the picker's admin list in sync so reopening it shows the NEW package.
          this.admins.update((list) =>
            list.map((a) => (a.email.toLowerCase() === email.toLowerCase() ? { ...a, packageId } : a)),
          );
          this.assignDialogOpen.set(false);
          this.assigningAdmin.set(null);
          this.loadPackages();
          this.loadAllAdminsForDialog();
          this.flashSuccess('Package assigned successfully.');
        },
        error: (error) => this.handleSaveError(error, 'Package assignment failed. Please try again.'),
      });
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