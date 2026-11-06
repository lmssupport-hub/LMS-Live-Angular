import { Routes } from '@angular/router';

import { roleGuard } from './guards/role.guard';

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
    // Only SUPER_ADMIN may open this dashboard or any of its child pages.
    canActivate: [roleGuard('SUPER_ADMIN')],
    loadComponent: () =>
      import('./dashboard/super-admin-dashboard/super-admin-dashboard').then((m) => m.SuperAdminDashboard),
    title: 'Super Admin Dashboard',
    children: [

      // Landing page is now the dashboard home
        { path: '', redirectTo: 'super-admin-dashboard-home', pathMatch: 'full' },
        {
          path: 'super-admin-dashboard-home',
          loadComponent: () =>
            import('./dashboard/super-admin-dashboard-home/super-admin-dashboard-home').then(
              (m) => m.SuperAdminDashboardHome,
            ),
          title: 'Dashboard',
        },


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
      {
        path: 'package/:id/admins',
        loadComponent: () =>
          import('./access-permission/package-admins/package-admins').then(
            (m) => m.PackageAdmins,
          ),
        title: 'Assign Admin',
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
      // Subscription & Billing (company admin buys a package) + its payment step
      {
        path: 'subscription',
        loadComponent: () =>
          import('./subscription-billing/subscription/subscription').then((m) => m.Subscription),
        title: 'Subscription & Billing',
      },
      {
        path: 'subscription/payment',
        loadComponent: () =>
          import('./payment/payment-gateway/payment-gateway').then((m) => m.PaymentGateway),
        title: 'Payment Method',
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

{
        path: 'courses/:courseId/organize',
        loadComponent: () =>
          import('./course-module/course-management/course-management').then(
            (m) => m.CourseManagement,
          ),
        title: 'Organize Modules',
      },

      {
  path: 'courses/:courseId/sections/:sectionId/question-banks/:bankId',
  loadComponent: () =>
    import('./course-module/question-bank/question-bank').then(
      (m) => m.QuestionBankComponent,
    ),
  title: 'Create Question Bank',
},

{
        path: 'courses/:courseId/preview',
        loadComponent: () =>
          import('./course-module/course-preview/course-preview').then(
            (m) => m.CoursePreview,
          ),
        title: 'Course Preview',
      },

      {
  path: 'courses/:courseId/sections/:sectionId/content',
  loadComponent: () =>
    import('./course-module/course-content-viewer/course-content-viewer').then(
      (m) => m.CourseContentViewer,
    ),
  title: 'Course Content',
},

{
  path: 'edit-profile',
  loadComponent: () =>
    import('./profile/edit-profile/edit-profile').then((m) => m.EditProfile),
  title: 'Edit Profile',
},

// NEW - Change Password (opens as a modal dialog on top of the dashboard)
{
  path: 'change-password',
  loadComponent: () =>
    import('./profile/change-password/change-password').then((m) => m.ChangePassword),
  title: 'Change Password',
},

    ],
  },

  {
    path: '**',
    redirectTo: 'auth',
  },
];