import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpInterceptorFn, HttpParams } from '@angular/common/http';
import { map, Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { TokenStorageService } from './token-storage.service';
import { catchError, throwError } from 'rxjs';
import { Router } from '@angular/router';

export type AccessAction = 'create' | 'read' | 'update' | 'delete';
export type PermissionFlags = Record<AccessAction, boolean>;

/** Feature ids - the same ids the backend seeds (SystemFeatureSeeder). */
export const FEATURE = {
  COURSE_CREATE: 'COURSE_MGMT_CREATE_COURSE',
  COURSE_LIST: 'COURSE_MGMT_COURSE_LIST',
  COURSE_ORGANIZE: 'COURSE_MGMT_ORGANIZE_MODULES',
  ENROLL_UNENROLL: 'ENROLLMENT_ENROLL_UNENROLL',
  ENROLLED_LIST: 'ENROLLMENT_ENROLLED_LIST',
} as const;

export interface AuthUser {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  roles: string[];
  instructorId: number | null;
  /** True for company ADMIN / SUPER_ADMIN: every action is allowed. */
  fullAccess: boolean;
  /** What the user's role grants, keyed by feature id (empty when fullAccess). */
  permissions: Record<string, PermissionFlags>;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

interface LoginApiData {
  token: string;
  tokenType: string;
  userId: number;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  roles?: string[];
  instructorId?: number | null;
  fullAccess?: boolean;
  permissions?: PermissionGrantApi[];
}

/** One row of the backend's permission list (PermissionDto.Grant). */
interface PermissionGrantApi extends PermissionFlags {
  featureId: string;
}

/** Row shape for GET /api/profile/permissions. */
interface PermissionsApiData {
  fullAccess?: boolean;
  permissions?: PermissionGrantApi[];
}

/** Row shape for GET /api/auth/signup/admins — User-table fields only. */
export interface AdminSummary {
  id: number;
  username: string;
  email: string;
  role: string;
  status: 'Active' | 'Inactive';
  packageId: number | null;
  packageExpiresAt: string | null;
  createdAt: string;
}

export interface AdminPage {
  content: AdminSummary[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
}

export interface AdminListQuery {
  search?: string;
  status?: 'All' | 'Active' | 'Inactive';
  page?: number;
  size?: number;
}

@Injectable({ providedIn: 'root' })
export class AuthService {

  private readonly apiUrl = `${environment.apiBaseUrl}/api/auth`;

  private readonly tokenStorage = inject(TokenStorageService);

  readonly user = signal<AuthUser | null>(null);
  readonly roleResolved = signal(true);
  readonly isSuperAdmin = computed(() => this.user()?.role === 'SUPER_ADMIN');
  readonly displayName = computed(() => {
    const user = this.user();
    if (!user) return '';
    return [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email;
  });

  constructor(private readonly http: HttpClient) {
    this.user.set(this.normalizeUser(this.tokenStorage.getUser<AuthUser>()));
  }

  login(credentials: { email: string; password: string; rememberMe: boolean }): Observable<LoginResponse> {
    return this.http.post<ApiResponse<LoginApiData>>(`${this.apiUrl}/login`, credentials).pipe(
      map(({ data }) => ({
        token: data.token,
        user: this.normalizeUser({
          id: data.userId,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          role: data.role,
          roles: data.roles ?? [],
          instructorId: data.instructorId ?? null,
          fullAccess: !!data.fullAccess,
          permissions: this.toPermissionMap(data.permissions),
        })!,
      })),
      tap((response) => {
        this.tokenStorage.save(response.token, response.user, credentials.rememberMe);
        this.user.set(response.user);
      }),
    );
  }

  refreshProfile(): Observable<AuthUser> {
    this.roleResolved.set(false);
    return this.http.get<ApiResponse<LoginApiData>>(`${this.apiUrl}/me`).pipe(
      map(({ data }) =>
        this.normalizeUser({
          id: data.userId,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          role: data.role,
          roles: data.roles ?? [],
          instructorId: data.instructorId ?? null,
          fullAccess: !!data.fullAccess,
          permissions: this.toPermissionMap(data.permissions),
        })!,
      ),
      tap({
        next: (user) => {
          this.tokenStorage.updateUser(user);
          this.user.set(user);
          this.roleResolved.set(true);
        },
        error: () => {
          this.logout();
          this.roleResolved.set(true);
        },
      }),
    );
  }

  /**
   * Can the logged-in user do `action` on `featureId`? (Options a role does not grant stay disabled.)
   * Reads the `user` signal, so it works inside computed() and templates.
   */
  can(featureId: string, action: AccessAction): boolean {
    const user = this.user();
    if (!user) return false;
    // fullAccess comes from the server; the role check keeps sessions saved before it existed working.
    if (user.fullAccess || user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') return true;
    return !!user.permissions?.[featureId]?.[action];
  }

  /** GET /api/profile/permissions - re-reads the role's permissions without logging in again. */
  refreshPermissions(): Observable<AuthUser | null> {
    return this.http
      .get<ApiResponse<PermissionsApiData>>(`${environment.apiBaseUrl}/api/profile/permissions`)
      .pipe(
        map(({ data }) => {
          const current = this.user();
          if (!current) return null;
          const next: AuthUser = {
            ...current,
            fullAccess: !!data.fullAccess,
            permissions: this.toPermissionMap(data.permissions),
          };
          this.tokenStorage.updateUser(next);
          this.user.set(next);
          return next;
        }),
      );
  }

  private toPermissionMap(rows: PermissionGrantApi[] | undefined): Record<string, PermissionFlags> {
    const map: Record<string, PermissionFlags> = {};
    for (const row of rows ?? []) {
      map[row.featureId] = {
        create: !!row.create,
        read: !!row.read,
        update: !!row.update,
        delete: !!row.delete,
      };
    }
    return map;
  }

  token(): string | null {
    return this.tokenStorage.getToken();
  }

  logout(): void {
    this.tokenStorage.clear();
    this.user.set(null);
  }

  register(account: {
    firstName: string;
    lastName: string;
    email: string;
    countryCode: string;
    phoneNumber: string;
    password: string;
    confirmPassword: string;
    acceptTerms: boolean;
  }): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/signup`, account);
  }

  sendForgotPassword(email: string): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/forgot-password/send-reset-link`, { email });
  }

  resetPassword(token: string, newPassword: string, confirmPassword: string): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/forgot-password/reset-password`, {
      token,
      newPassword,
      confirmPassword,
    });
  }

  /** NEW - POST /api/auth/change-password (any logged-in user). */
  changePassword(
    currentPassword: string,
    newPassword: string,
    confirmPassword: string,
  ): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/change-password`, {
      currentPassword,
      newPassword,
      confirmPassword,
    });
  }

  /** GET /api/auth/signup/admins — User-table fields only (see PackageService for package fields). */
  listAdmins(query: AdminListQuery = {}): Observable<AdminPage> {
    let params = new HttpParams();
    if (query.search) params = params.set('search', query.search);
    if (query.status && query.status !== 'All') params = params.set('status', query.status);
    if (query.page !== undefined) params = params.set('page', query.page);
    if (query.size !== undefined) params = params.set('size', query.size);

    return this.http
      .get<ApiResponse<AdminPage>>(`${this.apiUrl}/signup/admins`, { params })
      .pipe(map(({ data }) => data));
  }

  private normalizeUser(user: AuthUser | null): AuthUser | null {
    if (!user) return null;
    return {
      ...user,
      roles: user.roles?.length ? user.roles : [this.toAuthority(user.role)],
      instructorId: user.instructorId ?? null,
      // sessions saved before permissions existed have neither field
      fullAccess: user.fullAccess ?? false,
      permissions: user.permissions ?? {},
    };
  }

  private toAuthority(role: string): string {
    const normalized = role.trim().toUpperCase();
    return normalized.startsWith('ROLE_') ? normalized : `ROLE_${normalized}`;
  }
}


export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const tokenStorage = inject(TokenStorageService);
  const router = inject(Router);
  const token = tokenStorage.getToken();
  const req = token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request;

  return next(req).pipe(
    catchError((error) => {
      // Login/signup request-ku 401 normal (wrong password), so skip pannrom.
      const isAuthCall = request.url.includes('/api/auth/login') || request.url.includes('/api/auth/signup');
      if (error?.status === 401 && token && !isAuthCall) {
        tokenStorage.clear();
        void router.navigate(['/auth'], { queryParams: { view: 'login' } });
      }
      return throwError(() => error);
    }),
  );
};