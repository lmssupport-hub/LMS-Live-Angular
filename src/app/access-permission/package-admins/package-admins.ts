import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize, forkJoin } from 'rxjs';
import { PackageRecord, PackageService } from '../../services/package.service';
import { AdminSummary, AuthService } from '../../services/auth';

/** Absolute path, matching app.routes.ts (child of 'super-admin-dashboard'). */
const PACKAGE_LIST_PATH = '/super-admin-dashboard/package';

const serverActionErrorMessage =
  'Unable to complete the requested action due to a server error. Please try again later.';
const isServerError = (status?: number): boolean => status === 0 || (status ?? 0) >= 500;

/**
 * "Assign admin" page for ONE package (route: package/:id/admins).
 *  - left : admins who are already on this package
 *  - right: search + Add button to put another admin on this package
 */
@Component({
  selector: 'app-package-admins',
  templateUrl: './package-admins.html',
})
export class PackageAdmins implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly packagesApi = inject(PackageService);
  private readonly authApi = inject(AuthService);

  protected readonly pkg = signal<PackageRecord | null>(null);
  protected readonly admins = signal<AdminSummary[]>([]);
  protected readonly packages = signal<PackageRecord[]>([]);

  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  protected readonly query = signal('');
  /** Email of the admin currently being added (disables that button only). */
  protected readonly addingEmail = signal<string | null>(null);
  protected readonly formError = signal('');
  protected readonly successMessage = signal('');

  /** Admins already assigned to this package. */
  protected readonly assignedAdmins = computed(() =>
    this.admins().filter((a) => a.packageId === this.pkg()?.id));

  /** Admins NOT on this package yet, filtered by the search text. */
  protected readonly candidates = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.admins()
      .filter((a) => a.packageId !== this.pkg()?.id)
      .filter((a) => !q || a.email.toLowerCase().includes(q) || a.username.toLowerCase().includes(q));
  });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!Number.isInteger(id) || id <= 0) {
      void this.router.navigate([PACKAGE_LIST_PATH]);
      return;
    }

    this.loading.set(true);
    this.loadError.set('');
    forkJoin({
      pkg: this.packagesApi.getById(id),
      admins: this.authApi.listAdmins({ status: 'All', page: 0, size: 200 }),
      packages: this.packagesApi.list({ size: 100 }),
    })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: ({ pkg, admins, packages }) => {
          this.pkg.set(pkg);
          this.admins.set(admins.content);
          this.packages.set(packages.content);
        },
        error: (error) =>
          this.loadError.set(
            error?.status === 404
              ? 'Package not found.'
              : error?.status === 403
                ? 'You do not have permission to view this page.'
                : isServerError(error?.status)
                  ? serverActionErrorMessage
                  : 'Page could not be loaded. Please try again.',
          ),
      });
  }

  protected onSearch(value: string): void {
    this.query.set(value);
  }

  /** Name of the package the admin is on now (shown as a hint, because adding replaces it). */
  protected currentPackageName(admin: AdminSummary): string | null {
    if (admin.packageId == null) return null;
    return this.packages().find((p) => p.id === admin.packageId)?.name ?? null;
  }

  protected add(admin: AdminSummary): void {
    const pkg = this.pkg();
    if (!pkg || this.addingEmail() !== null) return;

    this.addingEmail.set(admin.email);
    this.formError.set('');
    this.packagesApi
      .assignToUser({ emailId: admin.email, packageId: pkg.id })
      .pipe(finalize(() => this.addingEmail.set(null)))
      .subscribe({
        next: () => {
          // Move the admin into the "assigned" list straight away.
          this.admins.update((list) =>
            list.map((a) => (a.id === admin.id ? { ...a, packageId: pkg.id } : a)),
          );
          this.flashSuccess('Admin added to package.');
        },
        error: (error) => {
          const backendMessage =
            typeof error?.error === 'string' ? error.error : error?.error?.detail ?? error?.error?.message ?? '';
          this.formError.set(
            isServerError(error?.status)
              ? serverActionErrorMessage
              : backendMessage || 'Admin assignment failed. Please try again.',
          );
        },
      });
  }

  protected goBack(): void {
    void this.router.navigate([PACKAGE_LIST_PATH]);
  }

  private flashSuccess(message: string): void {
    this.successMessage.set(message);
    setTimeout(() => this.successMessage.set(''), 3500);
  }
}