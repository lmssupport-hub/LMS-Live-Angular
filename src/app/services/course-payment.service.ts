import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { ApiResponse } from '../course-module/course.model';

/** Order Summary data (GET /api/courses/{id}/checkout). Price comes straight from the database. */
export interface CourseCheckout {
  courseId: number;
  courseName: string;
  description?: string | null;
  thumbnailUrl?: string | null;
  /** Price of the course (before tax, or including it when pricesIncludeTax). */
  price: number;
  /** Tax of the course's organization; 0 = no tax line. */
  taxRate: number;
  taxAmount: number;
  pricesIncludeTax: boolean;
  /** What the learner pays. */
  total: number;
  alreadyEnrolled: boolean;
}

export interface CourseBillingPayload {
  firstName: string;
  lastName: string;
  companyName: string;
  email: string;
  address: string;
  city: string;
  postalCode: string;
  state: string;
  country: string;
}

/** Body of POST /api/courses/{id}/purchase. Card data is only validated by the server, never stored. */
export interface CoursePurchasePayload {
  cardNumber: string;
  expiry: string;
  cvc: string;
  otp: string;
  billing: CourseBillingPayload;
}

export interface CoursePurchaseResult {
  courseId: number;
  courseName: string;
  /** Total paid. */
  amount: number;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  pricesIncludeTax: boolean;
  /** null = no invoice was issued (built-in invoicing is off). */
  invoiceId: number | null;
  invoiceNumber: string | null;
  purchasedAt: string;
  enrollmentStatus: string;
}

/** Learner pays for a paid course. Separate from PackageService.purchase (company admin package). */
@Injectable({ providedIn: 'root' })
export class CoursePaymentService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/courses`;

  getCheckout(courseId: number): Observable<CourseCheckout> {
    return this.http
      .get<ApiResponse<CourseCheckout>>(`${this.baseUrl}/${courseId}/checkout`)
      .pipe(map((res) => res.data));
  }

  purchase(courseId: number, payload: CoursePurchasePayload): Observable<CoursePurchaseResult> {
    return this.http
      .post<ApiResponse<CoursePurchaseResult>>(`${this.baseUrl}/${courseId}/purchase`, payload)
      .pipe(map((res) => res.data));
  }
}