import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { ApiResponse } from '../course-module/course.model';
import { saveBlob } from './download';

/** One paid course of the logged-in learner (GET /api/my-purchases). */
export interface PurchaseHistoryItem {
  purchaseId: number;
  courseId: number;
  courseName: string;
  /** ISO date-time. */
  purchasedAt: string;
  /** Total paid. */
  total: number;
  /** null for purchases made before tax existed. */
  subtotal: number | null;
  taxRate: number | null;
  taxAmount: number | null;
  pricesIncludeTax: boolean;
  /** null = no invoice was issued for this purchase. */
  invoiceId: number | null;
  invoiceNumber: string | null;
}

/** Purchase history + invoice PDF download of the logged-in learner. */
@Injectable({ providedIn: 'root' })
export class PurchaseHistoryService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api`;

  list(): Observable<PurchaseHistoryItem[]> {
    return this.http
      .get<ApiResponse<PurchaseHistoryItem[]>>(`${this.baseUrl}/my-purchases`)
      .pipe(map((res) => res.data ?? []));
  }

  /** Gets the PDF the server draws from the saved invoice and saves it as "<invoice number>.pdf". */
  downloadInvoice(invoiceId: number, invoiceNumber: string): Observable<void> {
    return this.http
      .get(`${this.baseUrl}/invoices/${invoiceId}/pdf`, { responseType: 'blob' })
      .pipe(map((blob) => saveBlob(blob, `${invoiceNumber.replace(/[^A-Za-z0-9._-]/g, '_') || 'invoice'}.pdf`)));
  }
}

/** The text shown when a download fails (the error body of a blob request is not readable JSON). */
export function invoiceDownloadError(error: unknown): string {
  const status = (error as HttpErrorResponse)?.status;
  if (status === 404) return 'This invoice could not be found.';
  if (status === 401 || status === 403) return 'Please log in again to download your invoice.';
  return 'Could not download the invoice. Please try again.';
}