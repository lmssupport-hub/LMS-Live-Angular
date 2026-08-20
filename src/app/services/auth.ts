import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpInterceptorFn } from '@angular/common/http';
import { map, Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { TokenStorageService } from './token-storage.service';

export interface AuthUser {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  roles: string[];
  instructorId: number | null;
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
        })!,
      })),
      tap((response) => {
        // Remember Me: persist across browser restarts when checked,
        // otherwise keep the session scoped to the current tab.
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

  private normalizeUser(user: AuthUser | null): AuthUser | null {
    if (!user) return null;
    return {
      ...user,
      roles: user.roles?.length ? user.roles : [this.toAuthority(user.role)],
      instructorId: user.instructorId ?? null,
    };
  }

  private toAuthority(role: string): string {
    const normalized = role.trim().toUpperCase();
    return normalized.startsWith('ROLE_') ? normalized : `ROLE_${normalized}`;
  }
}


export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const token = inject(TokenStorageService).getToken();
  return next(token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request);
};