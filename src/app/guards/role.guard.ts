import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { AccessRequirement, AuthService } from '../services/auth';

/**
 * Where a user lands after login / when they open a page they may not see.
 * SUPER_ADMIN (app owner) has its own dashboard; Admin, Instructor, Learner and every custom role
 * share the admin dashboard - their sidebar is built from their package / role permissions.
 */
export function homeRouteFor(user: { role: string } | null | undefined): string {
  if (!user) return '/auth';
  return user.role === 'SUPER_ADMIN' ? '/super-admin-dashboard' : '/admin-dashboard';
}

/**
 * Usage: `canActivate: [roleGuard('SUPER_ADMIN')]`
 *
 * - Not logged in            -> /auth
 * - Logged in, wrong role    -> that user's own dashboard (no "access denied" flash)
 * - Logged in, allowed role  -> route opens
 *
 * NOTE: this only protects the UI. The backend enforces the same rules on every API.
 */
export const roleGuard =
  (...allowedRoles: string[]): CanActivateFn =>
  () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    const user = auth.user();
    if (!user) return router.createUrlTree(['/auth']);
    if (allowedRoles.includes(user.role)) return true;

    return router.createUrlTree([homeRouteFor(user)]);
  };

/**
 * Guards the whole /admin-dashboard area (Admin, Instructor, Learner, custom roles).
 *
 * On every entry it re-reads the user's permissions from the server, so a package change, an expired
 * package or an edited role takes effect without logging in again. If that call fails (offline) the
 * cached permissions are used - the backend still rejects anything not allowed.
 */
export const adminAreaGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const user = auth.user();
  if (!user) return router.createUrlTree(['/auth']);
  if (user.role === 'SUPER_ADMIN') return router.createUrlTree([homeRouteFor(user)]);

  return auth.refreshPermissions().pipe(
    map(() => true),
    catchError(() => of(true)),
  );
};

/** Role Management / Subscription: the company's own ADMIN only. */
export const companyAdminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.user()) return router.createUrlTree(['/auth']);
  return auth.isCompanyAdmin() ? true : router.createUrlTree(['/admin-dashboard']);
};

/**
 * Usage: `canActivate: [featureGuard([FEATURE.ENROLLED_LIST, 'read'])]` - opens when AT LEAST ONE
 * requirement is met (Admin -> package, other roles -> role); otherwise back to the dashboard home.
 */
export const featureGuard =
  (...requirements: AccessRequirement[]): CanActivateFn =>
  () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    if (!auth.user()) return router.createUrlTree(['/auth']);
    return auth.canAny(requirements) ? true : router.createUrlTree(['/admin-dashboard']);
  };
