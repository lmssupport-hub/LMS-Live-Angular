export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

export type CourseLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
export type CourseStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type CourseFilter = 'ALL' | CourseStatus;

export interface CourseCategory {
  id: number;
  name: string;
}

export interface Instructor {
  id: number;
  name: string;
  email?: string;
}

export interface Course {
  id: number;
  name: string;
  description?: string | null;
  categoryId: number;
  categoryName: string;
  instructorId: number;
  instructorName: string;
  level: CourseLevel;
  status: CourseStatus;
  /** NEW: Free / Paid course. */
  paid: boolean;
  /** NEW: price in USD. Always 0 for a free course. */
  price: number;
  thumbnailUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Learner view: true = enrolled (show "Start course"), false = not yet (show "Enroll"). Null/absent for managers. */
  enrolled?: boolean | null;
  /** NEW: learner view, only when enrolled: drives the Start Course / Completed bar. */
  enrollmentStatus?: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | null;
}

export interface CourseRequest {
  name: string;
  description: string | null;
  categoryId: number | null;
  instructorId: number | null;
  level: CourseLevel | '';
  status: CourseStatus | '';
  /** NEW */
  paid: boolean;
  /** NEW: send 0 when the course is free. */
  price: number | null;
}

export const COURSE_CATEGORIES: CourseCategory[] = [
  { id: 1, name: 'Technical' },
  { id: 2, name: 'Soft Skills' },
  { id: 3, name: 'Compliance' },
  { id: 4, name: 'Leadership' },
];

export const COURSE_LEVELS: CourseLevel[] = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];
export const COURSE_STATUSES: CourseStatus[] = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];

export const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
export const ALLOWED_THUMBNAIL_TYPES = ['image/jpeg', 'image/png'];
export const ALLOWED_THUMBNAIL_EXTENSIONS = ['.jpg', '.jpeg', '.png'];

export function emptyCourseRequest(): CourseRequest {
  return {
    name: '',
    description: '',
    categoryId: null,
    instructorId: null,
    level: '',
    status: '',
    paid: false,
    price: null,
  };
}