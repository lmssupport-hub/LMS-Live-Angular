import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable, throwError } from 'rxjs';
import { catchError, expand, map, reduce } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { ApiResponse } from '../course-module/course.model';
import {
  ApiRequestError,
  EligibleUser,
  EligibleUserDto,
  Enrollment,
  EnrollmentActionDto,
  EnrollmentStatus,
  EnrolledLearnerDto,
  PageDto,
} from '../course-module/enrollment.model';

/**
 * Talks to EnrollmentController:
 *   GET  /api/courses/{id}/enrollments            -> Enrolled Course List (paged)
 *   GET  /api/courses/{id}/eligible-users         -> options for the Enroll User form
 *   POST /api/courses/{id}/enrollments            -> Enroll Selected User(s)
 *   POST /api/courses/{id}/enrollments/unenroll   -> More Actions -> Unenroll
 */
@Injectable({ providedIn: 'root' })
export class EnrollmentService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/courses`;

  /** Backend caps page size at 100. */
  private static readonly PAGE_SIZE = 100;
  /** Safety valve so a runaway course can never trigger unbounded requests. */
  private static readonly MAX_PAGES = 50;

  // ---------- Enrolled Course List ----------

  /** Loads every page (the UI has no pager) and maps it to the table model. */
  getEnrollments(courseId: number): Observable<Enrollment[]> {
    return this.fetchPage(courseId, 0).pipe(
      expand(page => {
        const current = page.number ?? page.page?.number ?? 0;
        const total = page.totalPages ?? page.page?.totalPages ?? 1;
        const next = current + 1;
        return next < total && next < EnrollmentService.MAX_PAGES
          ? this.fetchPage(courseId, next)
          : EMPTY;
      }),
      reduce(
        (all, page) => all.concat(page.content.map(row => this.toEnrollment(row))),
        [] as Enrollment[],
      ),
      catchError(this.handleError),
    );
  }

  // ---------- Enroll User form ----------

  getEligibleUsers(courseId: number, search = '', limit = 100): Observable<EligibleUser[]> {
    let params = new HttpParams().set('limit', limit);
    if (search.trim()) params = params.set('search', search.trim());
    return this.http
      .get<ApiResponse<EligibleUserDto[]>>(`${this.baseUrl}/${courseId}/eligible-users`, { params })
      .pipe(
        map(res => res.data.map(u => ({ id: u.id, name: u.name, email: u.email }))),
        catchError(this.handleError),
      );
  }

  /** Returns how many users were enrolled. */
  enrollUsers(courseId: number, userIds: number[]): Observable<number> {
    return this.http
      .post<ApiResponse<EnrollmentActionDto>>(`${this.baseUrl}/${courseId}/enrollments`, { userIds })
      .pipe(map(res => res.data.affectedCount), catchError(this.handleError));
  }

  /** Returns how many users were unenrolled. */
  unenrollUsers(courseId: number, userIds: number[]): Observable<number> {
    return this.http
      .post<ApiResponse<EnrollmentActionDto>>(`${this.baseUrl}/${courseId}/enrollments/unenroll`, {
        userIds,
      })
      .pipe(map(res => res.data.affectedCount), catchError(this.handleError));
  }

  // ---------- helpers ----------

  private fetchPage(courseId: number, page: number): Observable<PageDto<EnrolledLearnerDto>> {
    const params = new HttpParams().set('page', page).set('size', EnrollmentService.PAGE_SIZE);
    return this.http
      .get<ApiResponse<PageDto<EnrolledLearnerDto>>>(`${this.baseUrl}/${courseId}/enrollments`, { params })
      .pipe(map(res => res.data));
  }

  private toEnrollment(row: EnrolledLearnerDto): Enrollment {
    return {
      id: row.enrollmentId,
      userId: row.userId,
      username: row.userName,
      enrollmentDate: row.enrollmentDate,
      completionDate: row.completionDate,
      expirationDate: row.expirationDate,
      progress: row.progressPercent,
      status: this.toStatus(row.status),
      score: row.scorePercent,
      completion: row.completion,
    };
  }

  private toStatus(label: string): EnrollmentStatus {
    switch (label) {
      case 'In Progress':
        return 'IN_PROGRESS';
      case 'Completed':
        return 'COMPLETED';
      default:
        return 'NOT_STARTED';
    }
  }

  /**
   * Same normalisation as CourseManagementService, but keeps the HTTP status:
   *  - 400 validation  -> first field message (GlobalExceptionHandler#handleValidation)
   *  - ApiException    -> body.message (404 / 409 / 400 business rules)
   *  - status 0        -> connection lost
   *  - anything else   -> generic retry-friendly message (SRS Edge Cases #4, #5, #9)
   */
  private handleError = (error: HttpErrorResponse): Observable<never> => {
    if (error.status === 0) {
      return throwError(
        () =>
          new ApiRequestError(
            'Unable to reach the server. Please check your connection and try again.',
            0,
          ),
      );
    }
    const body = error.error as ApiResponse<Record<string, string> | null> | undefined;
    if (body?.data && typeof body.data === 'object') {
      const firstFieldMessage = Object.values(body.data)[0];
      if (firstFieldMessage) {
        return throwError(() => new ApiRequestError(firstFieldMessage, error.status));
      }
    }
    if (body?.message) {
      return throwError(() => new ApiRequestError(body.message, error.status));
    }
    return throwError(
      () =>
        new ApiRequestError(
          'Unable to complete the request due to a server error. Please try again later.',
          error.status,
        ),
    );
  };
}