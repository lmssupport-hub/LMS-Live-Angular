import { AccessRequirement, AuthService, FEATURE } from '../services/auth';

export type MenuIcon = 'dashboard' | 'role' | 'course' | 'subscription';


export type MenuAccess =
  | { readonly type: 'always' }
  | { readonly type: 'companyAdmin' }
  | { readonly type: 'feature'; readonly anyOf: readonly AccessRequirement[] };

export interface AdminMenuItem {
  readonly id: string;
  /** Short label under the icon. */
  readonly label: string;
  /** Tooltip. */
  readonly title: string;
  /** Route relative to /admin-dashboard. */
  readonly route: string;
  readonly icon: MenuIcon;
  readonly access: MenuAccess;
}

/** Anyone who may see / manage courses (same rule the backend uses for the Course List). */
export const COURSE_ACCESS: readonly AccessRequirement[] = [
  [FEATURE.COURSE_LIST, 'read'],
  [FEATURE.COURSE_CREATE, 'create'],
  [FEATURE.COURSE_CREATE, 'update'],
  [FEATURE.COURSE_CREATE, 'delete'],
  [FEATURE.COURSE_ORGANIZE, 'update'],
];

/** The sidebar, in display order. To add a menu: add one item here (+ its route in app.routes.ts). */
export const ADMIN_MENU: readonly AdminMenuItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    title: 'Dashboard',
    route: 'admin-dashboard-home',
    icon: 'dashboard',
    access: { type: 'always' },
  },
  {
    id: 'role',
    label: 'Role',
    title: 'Role Management',
    route: 'role',
    icon: 'role',
    access: { type: 'companyAdmin' },
  },
  {
    id: 'course',
    label: 'Course',
    title: 'Course Management',
    route: 'courses',
    icon: 'course',
    access: { type: 'feature', anyOf: COURSE_ACCESS },
  },
  {
    id: 'subscription',
    label: 'Subscription',
    title: 'Subscription & Billing',
    route: 'subscription',
    icon: 'subscription',
    access: { type: 'companyAdmin' },
  },
];

/** Reads the `user` signal through AuthService, so it can be used inside computed(). */
export function isMenuVisible(item: AdminMenuItem, auth: AuthService): boolean {
  if (!auth.user()) return false;
  switch (item.access.type) {
    case 'always':
      return true;
    case 'companyAdmin':
      return auth.isCompanyAdmin();
    case 'feature':
      return auth.canAny(item.access.anyOf);
  }
}
