import { HttpClient, HttpErrorResponse, HttpEvent, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError, filter, map } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { ApiResponse } from '../course-module/course.model';
import {
  MultimediaRequest,
  MultimediaResource,
  UploadEvent,
} from '../course-module/multimedia.model';

const GENERIC_ERROR =
  'Unable to complete the requested action due to a server error. Please try again later.';

/**
 * Error thrown by every MultimediaManagementService call.
 * `retryable` is true for a lost connection (status 0) and server errors (5xx) - SRS Edge Cases #4 / #5.
 */
export class MultimediaApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'MultimediaApiError';
  }

  get retryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

/**
 * Talks to MultimediaController:
 *   GET    /api/courses/{courseId}/sections/{sectionId}/multimedia
 *   GET    /api/courses/{courseId}/sections/{sectionId}/multimedia/{resourceId}
 *   POST   /api/courses/{courseId}/sections/{sectionId}/multimedia          (multipart: resource + file)
 *   PUT    /api/courses/{courseId}/sections/{sectionId}/multimedia/{id}     (multipart: resource + optional file)
 *   DELETE /api/courses/{courseId}/sections/{sectionId}/multimedia/{id}
 *
 * The Authorization header is attached by authInterceptor - nothing auth-related here.
 */
@Injectable({ providedIn: 'root' })
export class MultimediaManagementService {
  private readonly http = inject(HttpClient);

  // ---------- read ----------

  getResources(courseId: number, sectionId: number): Observable<MultimediaResource[]> {
    return this.http
      .get<ApiResponse<MultimediaResource[]>>(this.url(courseId, sectionId))
      .pipe(map(res => res.data ?? []), catchError(this.handleError));
  }

  getResource(courseId: number, sectionId: number, resourceId: number): Observable<MultimediaResource> {
    return this.http
      .get<ApiResponse<MultimediaResource>>(`${this.url(courseId, sectionId)}/${this.id(resourceId)}`)
      .pipe(map(res => res.data), catchError(this.handleError));
  }

  // ---------- write ----------

  /** Emits `progress` events while the file uploads, then a single `done` event. Unsubscribe to abort. */
  uploadResource(
    courseId: number,
    sectionId: number,
    request: MultimediaRequest,
    file: File,
  ): Observable<UploadEvent> {
    return this.send('POST', this.url(courseId, sectionId), request, file);
  }

  /** `file` is optional on edit - only sent when the file is being replaced. */
  updateResource(
    courseId: number,
    sectionId: number,
    resourceId: number,
    request: MultimediaRequest,
    file: File | null,
  ): Observable<UploadEvent> {
    return this.send('PUT', `${this.url(courseId, sectionId)}/${this.id(resourceId)}`, request, file);
  }

  deleteResource(courseId: number, sectionId: number, resourceId: number): Observable<void> {
    return this.http
      .delete<ApiResponse<void>>(`${this.url(courseId, sectionId)}/${this.id(resourceId)}`)
      .pipe(map(() => undefined), catchError(this.handleError));
  }

  // ---------- helpers ----------

  private send(
    method: 'POST' | 'PUT',
    url: string,
    request: MultimediaRequest,
    file: File | null,
  ): Observable<UploadEvent> {
    return this.http
      .request<ApiResponse<MultimediaResource>>(method, url, {
        body: this.buildFormData(request, file),
        observe: 'events',
        reportProgress: true,
      })
      .pipe(
        map(event => this.toUploadEvent(event)),
        filter((event): event is UploadEvent => event !== null),
        catchError(this.handleError),
      );
  }

  /**
   * Two-part multipart body MultimediaController expects.
   * Do NOT set Content-Type manually - the browser must generate the multipart boundary.
   */
  private buildFormData(request: MultimediaRequest, file: File | null): FormData {
    const formData = new FormData();
    formData.append('resource', new Blob([JSON.stringify(request)], { type: 'application/json' }));
    if (file) {
      formData.append('file', file, file.name);
    }
    return formData;
  }

  private toUploadEvent(event: HttpEvent<ApiResponse<MultimediaResource>>): UploadEvent | null {
    switch (event.type) {
      case HttpEventType.UploadProgress:
        return {
          kind: 'progress',
          percent: event.total ? Math.min(100, Math.round((event.loaded / event.total) * 100)) : 0,
        };
      case HttpEventType.Response:
        if (!event.body?.data) {
          throw new MultimediaApiError(GENERIC_ERROR, event.status);
        }
        return { kind: 'done', resource: event.body.data };
      default:
        return null;
    }
  }

  private url(courseId: number, sectionId: number): string {
    return `${environment.apiBaseUrl}/api/courses/${this.id(courseId)}/sections/${this.id(sectionId)}/multimedia`;
  }

  /** Path segments must be positive integers - never interpolate anything else into the URL. */
  private id(value: number): number {
    if (!Number.isInteger(value) || value <= 0) {
      throw new MultimediaApiError('Invalid identifier.', 400);
    }
    return value;
  }

  private readonly handleError = (error: unknown): Observable<never> =>
    throwError(() => {
      if (error instanceof MultimediaApiError) return error;
      if (error instanceof HttpErrorResponse) return this.toApiError(error);
      return new MultimediaApiError(GENERIC_ERROR, 500);
    });

  /**
   * Normalises backend errors into MultimediaApiError.
   * - status 0: offline / CORS / aborted network
   * - 401: session expired (SRS Edge Case #7); 413: proxy-level size rejection
   * - 400 validation map / ApiException: `message` (or first field message) is already user-friendly
   * Only strings from the JSON body are surfaced - never raw HTML from a proxy.
   */
  private toApiError(error: HttpErrorResponse): MultimediaApiError {
    switch (error.status) {
      case 0:
        return new MultimediaApiError('Unable to reach the server. Please check your connection and try again.', 0);
      case 401:
        return new MultimediaApiError('Your session has expired. Please log in again.', 401);
      case 413:
        return new MultimediaApiError('File size exceeds maximum limit.', 413);
    }

    const body = error.error !== null && typeof error.error === 'object' ? (error.error as Record<string, unknown>) : null;

    const data = body?.['data'];
    if (data !== null && typeof data === 'object') {
      const firstFieldMessage = Object.values(data).find((v): v is string => typeof v === 'string' && v.length > 0);
      if (firstFieldMessage) return new MultimediaApiError(firstFieldMessage.slice(0, 300), error.status);
    }

    const message = body?.['message'];
    if (typeof message === 'string' && message.length > 0) {
      return new MultimediaApiError(message.slice(0, 300), error.status);
    }
    return new MultimediaApiError(GENERIC_ERROR, error.status);
  }
}