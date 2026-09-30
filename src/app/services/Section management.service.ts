import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { ApiResponse } from '../course-module/course.model';

/** Mirrors SectionDto.SectionResponse on the backend. */
export interface Section {
  id: number;
  courseId: number;
  name: string;
  sectionOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors SectionDto.SectionRequest (Add Section / Edit Section body). */
export interface SectionRequest {
  name: string;
}

/** Mirrors SectionDto.ReorderItem. */
export interface ReorderItem {
  sectionId: number;
  newOrder: number;
}

/**
 * Error thrown by every SectionManagementService call.
 * `retryable` is true for lost connection (status 0) and server errors (5xx),
 * matching SRS Edge Cases #4 and #5 ("allow the user to retry").
 */
export class SectionApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'SectionApiError';
  }

  get retryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

/**
 * Talks to SectionController:
 *   GET    /api/courses/{courseId}/sections
 *   POST   /api/courses/{courseId}/sections
 *   PUT    /api/courses/{courseId}/sections/{sectionId}
 *   DELETE /api/courses/{courseId}/sections/{sectionId}
 *   PATCH  /api/courses/{courseId}/sections/reorder
 *
 * The Authorization header is attached by authInterceptor, so nothing auth-related here.
 */
@Injectable({ providedIn: 'root' })
export class SectionManagementService {
  private readonly http = inject(HttpClient);

  private url(courseId: number): string {
    return `${environment.apiBaseUrl}/api/courses/${courseId}/sections`;
  }

  getSections(courseId: number): Observable<Section[]> {
    return this.http
      .get<ApiResponse<Section[]>>(this.url(courseId))
      .pipe(map(res => res.data), catchError(this.handleError));
  }

  createSection(courseId: number, name: string): Observable<Section> {
    const body: SectionRequest = { name };
    return this.http
      .post<ApiResponse<Section>>(this.url(courseId), body)
      .pipe(map(res => res.data), catchError(this.handleError));
  }

  updateSection(courseId: number, sectionId: number, name: string): Observable<Section> {
    const body: SectionRequest = { name };
    return this.http
      .put<ApiResponse<Section>>(`${this.url(courseId)}/${sectionId}`, body)
      .pipe(map(res => res.data), catchError(this.handleError));
  }

  deleteSection(courseId: number, sectionId: number): Observable<void> {
    return this.http
      .delete<ApiResponse<void>>(`${this.url(courseId)}/${sectionId}`)
      .pipe(map(() => undefined), catchError(this.handleError));
  }

  /** Send the FULL list (every section of the course) with contiguous newOrder values 1..n. */
  reorderSections(courseId: number, items: ReorderItem[]): Observable<Section[]> {
    return this.http
      .patch<ApiResponse<Section[]>>(`${this.url(courseId)}/reorder`, { items })
      .pipe(map(res => res.data), catchError(this.handleError));
  }

  /**
   * Normalizes backend errors into SectionApiError.
   * - 400 validation (GlobalExceptionHandler#handleValidation): data = { field: message } -> first message
   * - ResponseStatusException / ApiException (404, 409, 422 ...): `message` is already user-friendly
   * - status 0 (offline) and anything unreadable: generic retry-friendly message
   */
  private handleError = (error: HttpErrorResponse): Observable<never> => {
    if (error.status === 0) {
      return throwError(
        () => new SectionApiError('Unable to reach the server. Please check your connection and try again.', 0),
      );
    }
    const body = error.error as ApiResponse<Record<string, string> | null> | undefined;
    if (body?.data && typeof body.data === 'object') {
      const firstFieldMessage = Object.values(body.data)[0];
      if (firstFieldMessage) {
        return throwError(() => new SectionApiError(firstFieldMessage, error.status));
      }
    }
    if (body?.message) {
      return throwError(() => new SectionApiError(body.message, error.status));
    }
    return throwError(
      () =>
        new SectionApiError(
          'Unable to complete the requested action due to a server error. Please try again later.',
          error.status,
        ),
    );
  };
}