import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'auth',
    pathMatch: 'full',
  },
  {
    path: 'auth',
    loadComponent: () =>
      import('./auth/login-signup/login-signup').then((m) => m.LoginSignup),
    title: 'Sign Up / Login',
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./auth/forgot-password/forgot-password').then((m) => m.ForgotPassword),
    title: 'Forgot Password',
  },
  {
    path: 'reset-password/:token',
    loadComponent: () =>
      import('./auth/reset-password/reset-password').then((m) => m.ResetPassword),
    title: 'Reset Password',
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./auth/reset-password/reset-password').then((m) => m.ResetPassword),
    title: 'Reset Password',
  },

  // ---------- Super-admin-dashboard ----------
  {
    path: 'super-admin-dashboard',
    loadComponent: () =>
      import('./dashboard/super-admin-dashboard/super-admin-dashboard').then((m) => m.SuperAdminDashboard),
    title: 'Super Admin Dashboard',
    children: [
      // Super admin only has Package Management, so that's the landing page too.
      { path: '', redirectTo: 'package', pathMatch: 'full' },
      {
        path: 'package',
        loadComponent: () =>
          import('./access-permission/package-management/package-management').then(
            (m) => m.PackageManagement,
          ),
        title: 'Package Management',
      },
      {
        path: 'package/create/permissions',
        loadComponent: () =>
          import('./access-permission/package-permission-step/package-permission-step').then(
            (m) => m.PackagePermissionStep,
          ),
        title: 'Configure Permissions',
      },
    ],
  },

  // ---------- admin-dashboard ----------
  {
    path: 'admin-dashboard',
    loadComponent: () =>
      import('./dashboard/admin-dashboard/admin-dashboard').then((m) => m.AdminDashboard),
    title: 'Admin Dashboard',
    children: [
      { path: '', redirectTo: 'admin-dashboard-home', pathMatch: 'full' },
      {
        path: 'admin-dashboard-home',
        loadComponent: () =>
          import('./dashboard/admin-dashboard-home/admin-dashboard-home').then((m) => m.AdminDashboardHome),
        title: 'Dashboard',
      },
      {
        path: 'role',
        loadComponent: () =>
          import('./access-permission/role-management/role-management').then(
            (m) => m.RoleManagement,
          ),
        title: 'Role Management',
      },
      {
        path: 'courses',
        loadComponent: () =>
          import('./course-module/course-management/course-management').then(
            (m) => m.CourseManagement,
          ),
        title: 'Course Management',
      },

      {
  path: 'courses/:courseId/enrollments',
  loadComponent: () =>
    import('./course-module/enrolled-course-list/enrolled-course-list').then((m) => m.EnrolledCourseList),
  title: 'Enrolled Course List',
},

    ],
  },

  {
    path: '**',
    redirectTo: 'auth',
  },
];