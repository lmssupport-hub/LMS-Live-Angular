import { Injectable, signal } from '@angular/core';

/**
 * Tiny in-memory hand-over between the learner Course List and the course Payment page.
 * Only the course id travels here - the Payment page re-loads the course from the server,
 * so nothing here can change the price. (Separate from CheckoutService, which is the
 * company-admin package checkout.)
 */
@Injectable({ providedIn: 'root' })
export class CourseCheckoutService {
  readonly courseId = signal<number | null>(null);

  start(courseId: number): void {
    this.courseId.set(courseId);
  }

  clear(): void {
    this.courseId.set(null);
  }
}