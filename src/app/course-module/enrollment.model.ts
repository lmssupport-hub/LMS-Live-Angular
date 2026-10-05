// Place next to course.model.ts (src/app/course-module/enrollment.model.ts)

export type EnrollmentStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

/** Row shown in the Enrolled Course List table. */
export interface Enrollment {
  id: number;
  userId: number;
  username: string;
  enrollmentDate: string | null; // yyyy-MM-dd
  completionDate: string | null;
  expirationDate: string | null;
  progress: number | null; // 0-100
  status: EnrollmentStatus;
  score: number | null; // 0-100
  completion: string | null;
}

/** Option in the Enroll User form's multi-select. */
export interface EligibleUser {
  id: number;
  name: string;
  email?: string;
}

/** Error that keeps the HTTP status so components can react to 401 / 409. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

// ---------- backend DTO shapes (EnrollmentDto.java) ----------

export interface EnrolledLearnerDto {
  enrollmentId: number;
  userId: number;
  userName: string;
  enrollmentDate: string | null;
  completionDate: string | null;
  expirationDate: string | null;
  progressPercent: number | null;
  status: string; // "Not Started" | "In Progress" | "Completed"
  scorePercent: number | null;
  completion: string | null;
}

export interface EligibleUserDto {
  id: number;
  name: string;
  email: string;
}

export interface EnrollmentActionDto {
  courseId: number;
  affectedCount: number;
}

/** Spring Page, tolerant of both the classic and the VIA_DTO serialization shapes. */
export interface PageDto<T> {
  content: T[];
  number?: number;
  totalPages?: number;
  page?: { number: number; totalPages: number };
}