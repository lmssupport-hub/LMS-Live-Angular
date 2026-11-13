import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { ApiResponse } from '../course-module/course.model';

export type SectionProgressStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export interface SectionProgressItem {
  sectionId: number;
  status: SectionProgressStatus;
  /** 0-100: how much of the module is done (fills the ring). */
  percent: number;
}

/** tracked = false for admins / instructors (no rings shown); true for an enrolled learner. */
export interface CourseProgress {
  tracked: boolean;
  progressPercent: number;
  completedCount: number;
  totalCount: number;
  sections: SectionProgressItem[];
}

/** Learner module progress (rings on Course Preview). */
@Injectable({ providedIn: 'root' })
export class SectionProgressService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/courses`;

  getProgress(courseId: number): Observable<CourseProgress> {
    return this.http
      .get<ApiResponse<CourseProgress>>(`${this.baseUrl}/${courseId}/progress`)
      .pipe(map((res) => res.data));
  }

  /**
   * Module opened -> { status: 'IN_PROGRESS' }, "Mark as completed" -> { status: 'COMPLETED' },
   * content viewed -> { percent }. The server only ever raises a module's percent.
   */
  update(
    courseId: number,
    sectionId: number,
    body: { status?: 'IN_PROGRESS' | 'COMPLETED'; percent?: number },
  ): Observable<CourseProgress> {
    return this.http
      .post<ApiResponse<CourseProgress>>(`${this.baseUrl}/${courseId}/sections/${sectionId}/progress`, body)
      .pipe(map((res) => res.data));
  }
}