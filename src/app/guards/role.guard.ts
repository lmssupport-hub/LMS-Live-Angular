import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { AccessRequirement, AuthService } from '../services/auth';

/** Route of the learner's own dashboard home (inside the shared /admin-dashboard shell and sidebar). */
export const LEARNER_HOME_ROUTE = '/admin-dashboard/learner-dashboard-home';

/**
 * Where a user lands after login / when they open a page they may not see.
 * SUPER_ADMIN (app owner) has its own dashboard. A LEARNER lands on learner-dashboard-home.
 * Admin, Instructor and every other custom role land on admin-dashboard-home. All of them (except
 * SUPER_ADMIN) share the /admin-dashboard shell - the sidebar is built from package / role permissions.
 */
export function homeRouteFor(user: { role: string } | null | undefined): string {
  if (!user) return '/auth';
  const role = user.role?.trim().toUpperCase();
  if (role === 'SUPER_ADMIN') return '/super-admin-dashboard';
  if (role === 'LEARNER') return LEARNER_HOME_ROUTE;
  return '/admin-dashboard';
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
  return auth.isCompanyAdmin() ? true : router.createUrlTree([homeRouteFor(auth.user())]);
};

/** Admin dashboard home: everyone except a learner. A learner is sent to learner-dashboard-home. */
export const adminHomeGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const user = auth.user();
  if (!user) return router.createUrlTree(['/auth']);
  return auth.isLearner() ? router.createUrlTree([LEARNER_HOME_ROUTE]) : true;
};

/** Learner dashboard home: learners only. Everyone else goes back to their own home. */
export const learnerHomeGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const user = auth.user();
  if (!user) return router.createUrlTree(['/auth']);
  return auth.isLearner() ? true : router.createUrlTree([homeRouteFor(user)]);
};

/**
 * Usage: `canActivate: [menuGuard(MENU.COURSE)]` - opens only when the category switch (e.g. Course
 * Management) is ON for the user. The create / read / update / delete flags are NOT checked here;
 * they only control the buttons and data inside the page.
 */
export const menuGuard =
  (categoryId: string): CanActivateFn =>
  () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    if (!auth.user()) return router.createUrlTree(['/auth']);
    return auth.hasMenu(categoryId) ? true : router.createUrlTree([homeRouteFor(auth.user())]);
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
    return auth.canAny(requirements) ? true : router.createUrlTree([homeRouteFor(auth.user())]);
  };
