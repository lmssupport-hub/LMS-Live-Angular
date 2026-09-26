import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { ApiResponse, Course, CourseRequest, Instructor } from '../course-module/course.model';

/**
 * Talks to CourseController's REST endpoints (course CRUD) plus the active-instructor
 * lookup used by the Instructor dropdown (SRS Field List #5).
 *
 * Every write endpoint on the backend is `consumes = MULTIPART_FORM_DATA_VALUE` with two
 * parts: a JSON "course" part (@RequestPart @Valid CourseRequest) and an optional binary
 * "thumbnail" part — so createCourse/updateCourse always build FormData, never plain JSON.
 */
@Injectable({ providedIn: 'root' })
export class CourseManagementService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/courses`;

  // ---------- course CRUD ----------

  getAllCourses(): Observable<Course[]> {
    return this.http
      .get<ApiResponse<Course[]>>(this.baseUrl)
      .pipe(map(res => res.data), catchError(this.handleError));
  }

  getCourseById(courseId: number): Observable<Course> {
    return this.http
      .get<ApiResponse<Course>>(`${this.baseUrl}/${courseId}`)
      .pipe(map(res => res.data), catchError(this.handleError));
  }

  createCourse(request: CourseRequest, thumbnail: File | null): Observable<Course> {
    const formData = this.buildFormData(request, thumbnail);
    return this.http
      .post<ApiResponse<Course>>(this.baseUrl, formData)
      .pipe(map(res => res.data), catchError(this.handleError));
  }

  updateCourse(courseId: number, request: CourseRequest, thumbnail: File | null): Observable<Course> {
    const formData = this.buildFormData(request, thumbnail);
    return this.http
      .put<ApiResponse<Course>>(`${this.baseUrl}/${courseId}`, formData)
      .pipe(map(res => res.data), catchError(this.handleError));
  }

  deleteCourse(courseId: number): Observable<void> {
    return this.http
      .delete<ApiResponse<void>>(`${this.baseUrl}/${courseId}`)
      .pipe(map(() => undefined), catchError(this.handleError));
  }

  // ---------- lookups ----------

  /**
   * ASSUMPTION: the backend exposes GET /api/instructors/active returning only active
   * instructors. CourseService.java on the backend currently has resolveInstructorName()
   * stubbed with a TODO to wire a real instructor/user repository — once that's done,
   * point this at whatever the real path turns out to be.
   *
   * Categories/Levels/Statuses are NOT fetched here on purpose: the backend keeps them as
   * fixed, hardcoded lists (see CourseService.CATEGORIES and the ALLOWED_* sets), so the
   * front end mirrors them as constants in course.model.ts instead of round-tripping them.
   */
  getActiveInstructors(): Observable<Instructor[]> {
    return this.http
      .get<ApiResponse<Instructor[]>>(`${environment.apiBaseUrl}/api/instructors/active`)
      .pipe(map(res => res.data), catchError(this.handleError));
  }

  // ---------- helpers ----------

  /**
   * Builds the two-part multipart body CourseController expects.
   * NOTE: do NOT set a Content-Type header manually here — HttpClient/the browser needs to
   * generate the multipart boundary itself, or the backend's @RequestPart parsing breaks.
   */
  private buildFormData(request: CourseRequest, thumbnail: File | null): FormData {
    const formData = new FormData();
    const coursePart = new Blob([JSON.stringify(request)], { type: 'application/json' });
    formData.append('course', coursePart);
    if (thumbnail) {
      formData.append('thumbnail', thumbnail, thumbnail.name);
    }
    return formData;
  }

  /**
   * Normalizes backend errors into a single readable message.
   * - Field validation errors (400, GlobalExceptionHandler#handleValidation) come back as
   *   data: { fieldName: message }, so we surface the first one.
   * - Business errors (ApiException, e.g. duplicate name → 409) come back with `message` set.
   * - Anything else (network loss, 5xx) falls back to a generic, retry-friendly message,
   *   matching SRS Edge Cases #4 and #5.
   */
  private handleError = (error: HttpErrorResponse): Observable<never> => {
    if (error.status === 0) {
      return throwError(() => new Error('Unable to reach the server. Please check your connection and try again.'));
    }
    const body = error.error as ApiResponse<Record<string, string>> | undefined;
    if (body?.data && typeof body.data === 'object') {
      const firstFieldMessage = Object.values(body.data)[0];
      if (firstFieldMessage) {
        return throwError(() => new Error(firstFieldMessage));
      }
    }
    if (body?.message) {
      return throwError(() => new Error(body.message));
    }
    return throwError(() => new Error('Unable to complete the request due to a server error. Please try again later.'));
  };
}