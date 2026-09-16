import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

export interface InviteDetails {
  email: string;
  roleName: string;
  expiresAt: string;
}

export interface AcceptInvitePayload {
  firstName: string;
  lastName: string;
  countryCode: string;
  phoneNumber: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
}

@Injectable({ providedIn: 'root' })
export class InviteService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/invites`;

  // Public endpoint - no auth token exists yet for an invited user.
  getDetails(token: string): Observable<InviteDetails> {
    return new Observable((subscriber) => {
      this.http.get<ApiResponse<InviteDetails>>(`${this.baseUrl}/${token}`).subscribe({
        next: (res) => {
          subscriber.next(res.data);
          subscriber.complete();
        },
        error: (err) => subscriber.error(err),
      });
    });
  }

  accept(token: string, payload: AcceptInvitePayload): Observable<void> {
    return new Observable((subscriber) => {
      this.http.post<ApiResponse<void>>(`${this.baseUrl}/${token}/accept`, payload).subscribe({
        next: () => {
          subscriber.next();
          subscriber.complete();
        },
        error: (err) => subscriber.error(err),
      });
    });
  }
}

export function getInviteErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { message?: string } | null;
    if (body?.message) return body.message;
  }
  return fallback;
}