import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import {
  PackageService,
  PackagePermissionCategory,
  PermissionAction,
  PackageDraftService,
  isSingleToggleFeature,
} from '../../services/package.service';

@Component({
  selector: 'app-package-permission-step',
  standalone: true,
  templateUrl: './package-permission-step.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PackagePermissionStep implements OnInit {
  private readonly router = inject(Router);
  private readonly packagesApi = inject(PackageService);
  protected readonly draft = inject(PackageDraftService);

  protected readonly permissionActions: readonly PermissionAction[] = ['create', 'read', 'update', 'delete'];
  protected readonly isSingleToggleFeature = isSingleToggleFeature;

  protected readonly featuresLoading = signal(true);
  protected readonly featuresLoaded = signal(false);
  protected readonly featuresError = signal('');
  protected readonly submitting = signal(false);
  protected readonly formError = signal('');

  protected readonly permissionFeatures = computed(() =>
    this.draft.categories().flatMap((category) =>
      category.features.map((feature) => ({ categoryId: category.id, feature }))));

  /** Live count so it's obvious in the UI whether a toggle click actually registered. */
  protected readonly selectedCount = computed(() =>
    this.draft.categories().reduce(
      (total, category) =>
        total +
        category.features.reduce(
          (t, f) => t + (Object.values(f.permissions).some(Boolean) ? 1 : 0),
          0,
        ),
      0,
    ));

  ngOnInit(): void {
    if (!this.draft.hasDraft()) {
      this.router.navigate(['/package']);
      return;
    }
    this.loadFeatures();
  }

  protected loadFeatures(): void {
    this.featuresLoading.set(true);
    this.featuresLoaded.set(false);
    this.featuresError.set('');
    this.packagesApi
      .getFeatureCatalog()
      .pipe(finalize(() => this.featuresLoading.set(false)))
      .subscribe({
        next: (entries) => {
          const categories: PackagePermissionCategory[] = entries.map((entry) => ({
            id: entry.categoryId,
            name: entry.categoryName,
            enabled: false,
            features: entry.features.map((f) => ({
              id: f.id,
              name: f.name,
              permissions: { create: false, read: false, update: false, delete: false },
            })),
          }));
          this.draft.setSeedCategories(categories);
          this.featuresLoaded.set(true);
        },
        error: (error) =>
          this.featuresError.set(
            (error?.status === 0 || error?.status >= 500)
              ? 'Unable to complete the requested action due to a server error. Please try again later.'
              : 'System features could not be loaded. Please try again.',
          ),
      });
  }

  protected togglePermission(categoryId: string, featureId: string, action: PermissionAction): void {
    if (!this.featuresLoaded()) return;
    this.draft.toggle(categoryId, featureId, action);
  }

  protected cancelPermissionStep(): void {
    this.draft.clearDraft();
    this.router.navigate(['/package']);
  }

  protected savePackageWithPermissions(): void {
    const payload = this.draft.pendingPayload();
    if (!payload || this.submitting() || !this.featuresLoaded()) return;

    if (!this.draft.hasAnyPermissionEnabled()) {
      this.formError.set('Please configure required permissions before saving.');
      return;
    }

    this.submitting.set(true);
    this.formError.set('');
    const idempotencyKey = crypto.randomUUID();

    this.packagesApi
      .create({ ...payload, permissions: this.draft.asPayloadPermissions() }, idempotencyKey)
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: () => {
          this.draft.clearDraft();
          this.router.navigate(['/package'], { state: { packageCreated: true } });
        },
        error: (error) => {
          const backendMessage =
            typeof error?.error === 'string' ? error.error : error?.error?.detail ?? error?.error?.message ?? '';
          if (error?.status === 0 || error?.status >= 500) {
  this.formError.set('Unable to complete the requested action due to a server error. Please try again later.');
          } else if (error?.status === 409 || /duplicate|exists/i.test(backendMessage)) {
            this.formError.set('A package with the same name already exists');
          } else {
            this.formError.set(backendMessage || 'Package creation failed. Please check the details and try again.');
          }
        },
      });
  }
}