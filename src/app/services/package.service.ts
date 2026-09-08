import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, computed, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export const AVAILABLE_PACKAGE_OPTIONS = ['Basic', 'Standard', 'Premium', 'Existing'] as const;
export type AvailablePackage = (typeof AVAILABLE_PACKAGE_OPTIONS)[number];
export const AVAILABLE_PACKAGE_PATTERN = /^(?:Basic|Standard|Premium|Existing)$/;

export type PermissionAction = 'create' | 'read' | 'update' | 'delete';

/**
 * Features that represent a single yes/no capability rather than a
 * CRUD-shaped permission (e.g. "does this package grant login access at
 * all", not "can it create/read/update/delete access records"). The UI
 * renders these as one switch instead of four, and the toggle helper below
 * keeps all four underlying booleans in lock-step so the data never drifts
 * into an inconsistent state like { create: true, read: false, ... }.
 *
 * Kept as an exported, named set (rather than a hardcoded string scattered
 * across components) so the update modal, the create/permission step, and
 * any future screen all agree on which features are single-toggle without
 * having to know about each other.
 */
export const SINGLE_TOGGLE_FEATURE_IDS: ReadonlySet<string> = new Set(['AUTH_USER_ACCESS']);

export function isSingleToggleFeature(featureId: string): boolean {
  return SINGLE_TOGGLE_FEATURE_IDS.has(featureId);
}

export interface PackagePermissionFeature {
  id: string;
  name: string;
  permissions: Record<PermissionAction, boolean>;
}

export interface PackagePermissionCategory {
  id: string;
  name: string;
  enabled: boolean;
  features: PackagePermissionFeature[];
}

export interface PackageRecord {
  id: number;
  name: string;
  availablePackage: AvailablePackage;
  description: string | null;
  price: number;
  billingCycle: 'Monthly' | 'Yearly';
  userLimit: number;
  storageLimit: number | null;
  status: 'Active' | 'Inactive';
  createdAt: string;
  permissions: PackagePermissionCategory[];
}

export type PackagePayload = Omit<PackageRecord, 'id' | 'status' | 'createdAt'>;

export interface PackagePage {
  content: PackageRecord[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
}

export interface PackageQuery {
  search?: string;
  status?: 'All' | 'Active' | 'Inactive';
  page?: number;
  size?: number;
}

/**
 * Matches the backend's PackageDto.FeatureCatalogEntry response shape
 * exactly (categoryId/categoryName + nested features[]). GET
 * /api/packages/features returns this nested shape, NOT a flat
 * featureId/featureName pair — keep this interface in sync with the
 * backend DTO or the Permission page will silently receive undefined
 * feature names.
 */
export interface FeatureCatalogEntry {
  categoryId: string;
  categoryName: string;
  features: {
    id: string;
    name: string;
    permissions: Record<PermissionAction, boolean>;
  }[];
}

export interface UserPackageAssignment {
  emailId: string;
  packageId: number;
}

// ---------------------------------------------------------------------
// PackageService — all HTTP communication with /api/packages/**.
// Stateless: every method is a request/response, nothing is cached or
// held in memory here. Used by the package list, create modal, update
// modal, and the permission step.
// ---------------------------------------------------------------------
@Injectable({ providedIn: 'root' })
export class PackageService {
  private readonly baseUrl = `${environment.apiBaseUrl}/api/packages`;

  constructor(private readonly http: HttpClient) {}

  list(query: PackageQuery = {}): Observable<PackagePage> {
    let params = new HttpParams();
    if (query.search) params = params.set('search', query.search);
    if (query.status && query.status !== 'All') params = params.set('status', query.status);
    if (query.page !== undefined) params = params.set('page', query.page);
    if (query.size !== undefined) params = params.set('size', query.size);
    return this.http.get<PackagePage>(this.baseUrl, { params });
  }

  getById(id: number): Observable<PackageRecord> {
    return this.http.get<PackageRecord>(`${this.baseUrl}/${id}`);
  }

  /**
   * Bulk lookup — used by the Admin List page to resolve each admin's
   * packageId (from AuthService.listAdmins) into full package details
   * (name/price/billingCycle) in one call.
   */
  getByIds(ids: number[]): Observable<PackageRecord[]> {
    if (!ids.length) return new Observable((sub) => { sub.next([]); sub.complete(); });
    const params = new HttpParams().set('ids', ids.join(','));
    return this.http.get<PackageRecord[]>(`${this.baseUrl}/by-ids`, { params });
  }

  create(payload: PackagePayload, idempotencyKey: string): Observable<PackageRecord> {
    const headers = new HttpHeaders({ 'Idempotency-Key': idempotencyKey });
    return this.http.post<PackageRecord>(this.baseUrl, payload, { headers });
  }

  update(id: number, payload: PackagePayload): Observable<PackageRecord> {
    return this.http.put<PackageRecord>(`${this.baseUrl}/${id}`, payload);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  getFeatureCatalog(): Observable<FeatureCatalogEntry[]> {
    return this.http.get<FeatureCatalogEntry[]>(`${this.baseUrl}/features`);
  }

  assignToUser(payload: UserPackageAssignment): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/assign`, payload);
  }
}

// ---------------------------------------------------------------------
// PackageDraftService — in-memory state for the "Create Package" wizard
// only (package details + permission matrix), held across the route
// boundary between the details modal and the standalone Permission page.
//
// Deliberately a SEPARATE Injectable from PackageService even though it
// lives in the same file: PackageService is stateless HTTP, this is
// stateful UI state — merging them into one class would mean every
// consumer of HTTP calls also drags along wizard state it doesn't need.
//
// Not persisted anywhere (no localStorage/sessionStorage) — a hard
// refresh mid-wizard intentionally drops the draft, same as most
// multi-step admin wizards.
// ---------------------------------------------------------------------
@Injectable({ providedIn: 'root' })
export class PackageDraftService {
  private readonly _pendingPayload = signal<PackagePayload | null>(null);
  private readonly _categories = signal<PackagePermissionCategory[]>([]);

  readonly pendingPayload = this._pendingPayload.asReadonly();
  readonly categories = this._categories.asReadonly();
  readonly hasDraft = computed(() => this._pendingPayload() !== null);

  /** Called once, right after GET /api/packages/features resolves. */
  setSeedCategories(categories: PackagePermissionCategory[]): void {
    this._categories.set(
      categories.map((category) => ({
        ...category,
        enabled: false,
        features: category.features.map((feature) => ({
          ...feature,
          permissions: { create: false, read: false, update: false, delete: false },
        })),
      })),
    );
  }

  startDraft(payload: PackagePayload): void {
    this._pendingPayload.set(payload);
  }

  clearDraft(): void {
    this._pendingPayload.set(null);
    this._categories.set([]);
  }

  /**
   * Flips a single permission cell. For a single-toggle feature (see
   * SINGLE_TOGGLE_FEATURE_IDS above), any of the four action buttons acts
   * as one switch: flipping it sets all four underlying flags to the same
   * value, so a feature like "User Authentication & Access" can never end
   * up half-on (e.g. create: true, read: false).
   */
  toggle(categoryId: string, featureId: string, action: PermissionAction): void {
    this._categories.update((categories) =>
      categories.map((category) => {
        if (category.id !== categoryId) return category;
        const features: PackagePermissionFeature[] = category.features.map((feature) => {
          if (feature.id !== featureId) return feature;
          if (isSingleToggleFeature(feature.id)) {
            const next = !feature.permissions[action];
            return { ...feature, permissions: { create: next, read: next, update: next, delete: next } };
          }
          return { ...feature, permissions: { ...feature.permissions, [action]: !feature.permissions[action] } };
        });
        return { ...category, enabled: features.some((f) => Object.values(f.permissions).some(Boolean)), features };
      }),
    );
  }

  hasAnyPermissionEnabled(): boolean {
    return this._categories().some((category) =>
      category.features.some((feature) => Object.values(feature.permissions).some(Boolean)));
  }

  asPayloadPermissions(): PackagePermissionCategory[] {
    return this._categories();
  }
}