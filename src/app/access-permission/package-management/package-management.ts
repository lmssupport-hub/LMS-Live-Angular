import { Component, computed, inject, OnInit, signal } from '@angular/core';
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

const serverActionErrorMessage =
  'Unable to complete the requested action due to a server error. Please try again later.';
const isServerError = (status?: number): boolean => status === 0 || (status ?? 0) >= 500;
const isDuplicateNameError = (status: number | undefined, message: string): boolean =>
  status === 409 || /(?:package(?: name)?.*(?:same name|exists|duplicate)|(?:exists|duplicate).*package name)/i.test(message);

function extractBackendMessage(error: { error?: { detail?: string; message?: string } | string }): string {
  return typeof error.error === 'string' ? error.error : error.error?.detail ?? error.error?.message ?? '';
}

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
  protected readonly statusFilter = signal<'All' | 'Active' | 'Inactive'>('All');
  protected readonly totalElements = signal(0);
  protected readonly page = signal(0);
  protected readonly pageSize = 20;

  protected readonly filteredRows = computed(() => this.rows());

  protected readonly packages = signal<PackageRecord[]>([]);
  /**
   * Surfaces a failed loadAllPackagesForDialogs() call instead of silently
   * leaving the Assign modal with an empty package dropdown and no
   * indication why.
   */
  protected readonly packagesLoadError = signal('');
  /**
   * Tracks whether loadAllPackagesForDialogs() is currently in-flight, so
   * callers can distinguish "still loading" from "loaded and genuinely
   * empty" instead of flashing a false "No packages available" state.
   */
  protected readonly packagesLoading = signal(false);

  /**
   * Full admin roster used ONLY by the Assign modal's admin picker, for the
   * case where Assign is opened from the header button (no row context).
   * Loaded lazily — only when openAssignPackagePicker() actually needs it —
   * so it doesn't add an extra request to every page load.
   */
  protected readonly admins = signal<AdminSummary[]>([]);
  protected readonly adminsLoading = signal(false);
  protected readonly adminsLoadError = signal('');

  // Create flow
  protected readonly createDialogOpen = signal(false);

  // Assign flow ("Update package" in the UI) — assigningAdmin() is null
  // when opened from the header button (no row context yet); the modal
  // shows an admin search picker in that case. It's set to a specific
  // admin when opened from a row's popover.
  protected readonly assignDialogOpen = signal(false);
  protected readonly assigningAdmin = signal<AdminSummary | null>(null);

  // Shared UI state
  protected readonly submitting = signal(false);
  protected readonly formError = signal('');
  protected readonly successMessage = signal('');

  /**
   * id of the admin row whose kebab (⋮) action menu is currently open.
   * Only one row's popover can be open at a time. Track by admin.id (not
   * package.id) since Assign rows have no package yet but still need a
   * menu identity.
   */
  protected readonly openActionMenuId = signal<number | null>(null);
  /** Tracks an in-flight delete so the row's delete button can show a busy state and block double-clicks. */
  protected readonly deletingPackageId = signal<number | null>(null);

  ngOnInit(): void {
    this.loadPackages();
    this.loadAllPackagesForDialogs();
    this.flashSuccessIfReturningFromPermissionStep();
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

  protected onFilter(value: 'All' | 'Active' | 'Inactive'): void {
    this.statusFilter.set(value);
    this.page.set(0);
    this.loadPackages();
  }

  /**
   * Loads the full package catalog used by the Assign modal's dropdown.
   * Errors are surfaced via packagesLoadError() instead of being swallowed,
   * and in-flight state is tracked via packagesLoading() so callers
   * (openAssignDialog / openAssignPackagePicker) can tell "still loading"
   * apart from "loaded and empty" or "failed".
   */
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

  /** Lets the Assign modal offer a manual retry without a full page reload. */
  protected retryLoadPackagesForDialogs(): void {
    this.loadAllPackagesForDialogs();
  }

  /**
   * Loads the full admin roster for the Assign modal's admin picker. Only
   * called when Assign is opened WITHOUT row context (header button) — a
   * row-triggered Assign already knows its admin and never needs this.
   * Kept separate from loadPackages() (which is paginated/filtered for the
   * table) since the picker needs the unfiltered full list.
   */
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

  // ---- Row action menu (delete / assign) ----------------------------------------

  /** Toggles the kebab popover for a given admin row; opening one closes any other. */
  protected toggleActionMenu(adminId: number, event: MouseEvent): void {
    event.stopPropagation();
    this.openActionMenuId.set(this.openActionMenuId() === adminId ? null : adminId);
  }

  /** Closes the open popover — bound to a full-screen backdrop so an outside click dismisses it. */
  protected closeActionMenu(): void {
    this.openActionMenuId.set(null);
  }

  /**
   * Delete action from the popover. Confirms first (destructive, no undo),
   * then calls PackageService.delete(id).
   */
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

  // ---- Create -----------------------------------------------------------

  protected openCreateDialog(): void {
    this.formError.set('');
    this.createDialogOpen.set(true);
  }

  protected closeCreateDialog(): void {
    if (this.submitting()) return;
    this.createDialogOpen.set(false);
  }

  protected onCreateDetailsSubmitted(payload: PackagePayload): void {
    this.draft.startDraft(payload);
    this.createDialogOpen.set(false);
    this.router.navigate(['/package/create/permissions']);
  }

  // ---- Assign ("Update package") -----------------------------------------------------------

  /**
   * Row entry point (kebab → "+" icon). Admin is already known, so the
   * modal renders a readonly email and just needs a package chosen.
   */
  protected openAssignDialog(admin: AdminSummary): void {
    this.formError.set('');
    this.assigningAdmin.set(admin);
    this.assignDialogOpen.set(true);
    if (!this.packages().length && !this.packagesLoading()) {
      this.loadAllPackagesForDialogs();
    }
  }

  /**
   * Header entry point ("Update Package" button). No row context yet, so
   * assigningAdmin() stays null and the modal shows a searchable admin
   * picker instead of a readonly email. Lazily loads both the package list
   * and the admin roster if either hasn't been fetched yet.
   */
  protected openAssignPackagePicker(): void {
    this.formError.set('');
    this.assigningAdmin.set(null);
    this.assignDialogOpen.set(true);
    if (!this.packages().length && !this.packagesLoading()) {
      this.loadAllPackagesForDialogs();
    }
    if (!this.admins().length && !this.adminsLoading()) {
      this.loadAllAdminsForDialog();
    }
  }

  protected closeAssignDialog(): void {
    if (this.submitting()) return;
    this.assignDialogOpen.set(false);
    this.assigningAdmin.set(null);
  }

  /** Handler for AssignPackageModal's `saved` output (email + packageId — email is either the fixed row admin's or the one picked in the header-flow search combobox). */
  protected onAssignSubmitted({ email, packageId }: PackageAssignRequest): void {
    if (this.submitting()) return;

    this.submitting.set(true);
    this.formError.set('');
    this.packagesApi
      .assignToUser({ emailId: email, packageId })
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: () => {
          this.assignDialogOpen.set(false);
          this.assigningAdmin.set(null);
          this.loadPackages();
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

  private flashSuccessIfReturningFromPermissionStep(): void {
    const state = this.router.getCurrentNavigation()?.extras.state
      ?? (history.state as { packageCreated?: boolean } | undefined);
    if (state?.packageCreated) {
      this.flashSuccess('Package created successfully.');
    }
  }

  private flashSuccess(message: string): void {
    this.successMessage.set(message);
    setTimeout(() => this.successMessage.set(''), 3500);
  }
}