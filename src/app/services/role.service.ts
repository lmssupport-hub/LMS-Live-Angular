import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type RoleStatus = 'Active' | 'Inactive';
export type PermissionAction = 'create' | 'read' | 'update' | 'delete';

export interface Permission {
  create: boolean;
  read: boolean;
  update: boolean;
  delete: boolean;
}

export interface Feature {
  id: string;
  name: string;
  permissions: Permission;
}

export interface Category {
  id: string;
  name: string;
  enabled: boolean;
  features: Feature[];
}

export interface FeatureCatalogEntry {
  categoryId: string;
  categoryName: string;
  features: Feature[];
}

export interface Role {
  id: number;
  name: string;
  description?: string;
  permissions: Category[];
  status: RoleStatus;
  createdAt: string;
  updatedAt: string;
  assignedUsers?: number;
}

export interface RoleRequest {
  name: string;
  description?: string;
  permissions: Category[];
}

export interface StatusUpdateRequest {
  status: RoleStatus;
}

export interface PermissionRow {
  categoryId: string;
  categoryName: string;
  category: string | null;
  featureId: string;
  name: string;
  values: Permission;
}

@Injectable({ providedIn: 'root' })
export class RoleService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/roles`;

  getAll(): Observable<Role[]> {
    return this.http.get<Role[]>(this.baseUrl);
  }

  getActive(): Observable<Role[]> {
    return this.http.get<Role[]>(`${this.baseUrl}/active`);
  }

  getById(id: number): Observable<Role> {
    return this.http.get<Role>(`${this.baseUrl}/${id}`);
  }

  create(request: RoleRequest): Observable<Role> {
    return this.http.post<Role>(this.baseUrl, request);
  }

  update(id: number, request: RoleRequest): Observable<Role> {
    return this.http.put<Role>(`${this.baseUrl}/${id}`, request);
  }

  updateStatus(id: number, body: StatusUpdateRequest): Observable<Role> {
    return this.http.patch<Role>(`${this.baseUrl}/${id}/status`, body);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  getFeatureCatalog(): Observable<FeatureCatalogEntry[]> {
    return this.http.get<FeatureCatalogEntry[]>(`${environment.apiBaseUrl}/api/packages/features`);
  }

  /**
   * CHANGED: now hits the real /api/invites endpoint (InviteController) and
   * sends roleId (a Long on the backend) instead of a free-text category
   * name, matching InviteDto.SendRequest exactly.
   */
  invite(payload: { email: string; roleId: number }): Observable<void> {
    return this.http.post<void>(`${environment.apiBaseUrl}/api/invites`, payload);
  }
}

export function getApiErrorMessage(
  err: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { message?: string } | null;
    if (body?.message) {
      return body.message;
    }
  }
  return fallback;
}

export function getApiFieldErrors(err: unknown): Record<string, string> | null {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { data?: Record<string, string> } | null;
    if (body?.data && typeof body.data === 'object') {
      return body.data;
    }
  }
  return null;
}