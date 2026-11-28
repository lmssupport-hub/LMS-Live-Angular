import { Routes } from '@angular/router';
import {
  adminAreaGuard,
  adminHomeGuard,
  companyAdminGuard,
  featureGuard,
  learnerHomeGuard,
  menuGuard,
  roleGuard,
} from './guards/role.guard';
import { COURSE_ACCESS } from './config/admin-menu';
import { FEATURE, MENU } from './services/auth';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'vativa-home',
    pathMatch: 'full',
  },
  {
    path: 'auth',
    loadComponent: () =>
      import('./auth/login-signup/login-signup').then((m) => m.LoginSignup),
    title: 'Sign Up / Login',
  },

  // ---------- Public website (Vativa home) ----------
  {
    path: '',
    loadComponent: () =>
      import('./home/public-layout/public-layout').then((m) => m.PublicLayout),
    children: [
      {
        path: 'vativa-home',
        loadComponent: () => import('./home/vativa-home/vativa-home').then((m) => m.VativaHome),
        title: 'Vativa Home',
      },
      {
        path: 'about-us',
        loadComponent: () => import('./home/about-us/about-us').then((m) => m.AboutUs),
        title: 'About Us',
      },
      {
        path: 'plans',
        loadComponent: () => import('./home/plans/plans').then((m) => m.Plans),
        title: 'Plans',
      },
      {
        path: 'contact-us',
        loadComponent: () => import('./home/contact-us/contact-us').then((m) => m.ContactUs),
        title: 'Contact Us',
      },
      {
        path: 'terms-and-conditions',
        loadComponent: () =>
          import('./home/terms-and-conditions/terms-and-conditions').then((m) => m.TermsAndConditions),
        title: 'Terms & Conditions',
      },
      {
        path: 'privacy-policy',
        loadComponent: () =>
          import('./home/privacy-policy/privacy-policy').then((m) => m.PrivacyPolicy),
        title: 'Privacy Policy',
      },
      {
        path: 'refund-cancellation',
        loadComponent: () =>
          import('./home/refund-cancellation/refund-cancellation').then((m) => m.RefundCancellation),
        title: 'Refund & Cancellation',
      },
      {
        path: 'plan-policy',
        loadComponent: () => import('./home/plan-policy/plan-policy').then((m) => m.PlanPolicy),
        title: 'Plan Policy',
      },
    ],
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
      // Admins: company admin list + status control (More Action)
      {
        path: 'admins',
        loadComponent: () =>
          import('./all-admins/admin-list/admin-list').then((m) => m.AdminList),
        title: 'Admins',
      },
      // Admins -> More Action -> Edit Profile: the same EditProfile screen, loaded for :userId
      {
        path: 'admins/:userId/edit-profile',
        data: { profileScope: 'super-admin' },
        loadComponent: () =>
          import('./profile/edit-profile/edit-profile').then((m) => m.EditProfile),
        title: 'Edit Profile',
      },
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
  // Admin, Instructor, Learner and every custom role open this dashboard. The sidebar and each page
  // are limited to what the Admin's PACKAGE / the other roles' ROLE allows.
  {
    path: 'admin-dashboard',
    canActivate: [adminAreaGuard],
    loadComponent: () =>
      import('./dashboard/admin-dashboard/admin-dashboard').then((m) => m.AdminDashboard),
    title: 'Admin Dashboard',
    children: [
      { path: '', redirectTo: 'admin-dashboard-home', pathMatch: 'full' },
      {
        path: 'admin-dashboard-home',
        // A learner has its own home (learner-dashboard-home); the guard redirects them there.
        canActivate: [adminHomeGuard],
        loadComponent: () =>
          import('./dashboard/admin-dashboard-home/admin-dashboard-home').then((m) => m.AdminDashboardHome),
        title: 'Dashboard',
      },
      // Learner dashboard home - learners only
      {
        path: 'learner-dashboard-home',
        canActivate: [learnerHomeGuard],
        loadComponent: () =>
          import('./dashboard/learner-dashboard-home/learner-dashboard-home').then(
            (m) => m.LearnerDashboardHome,
          ),
        title: 'Dashboard',
      },
      // Role Management - company ADMIN only
      {
        path: 'role',
        canActivate: [companyAdminGuard],
        loadComponent: () =>
          import('./access-permission/role-management/role-management').then(
            (m) => m.RoleManagement,
          ),
        title: 'Role Management',
      },

      {
        path: 'users',
        canActivate: [menuGuard(MENU.USERS)],
        loadComponent: () =>
          import('./all-users/user-management/user-management').then((m) => m.UserManagement),
        title: 'All Users',
      },

      // All Users -> row menu -> Edit Profile: the same EditProfile screen, loaded for :userId
      {
        path: 'users/:userId/edit-profile',
        canActivate: [featureGuard([FEATURE.USER_ALL, 'update'])],
        loadComponent: () =>
          import('./profile/edit-profile/edit-profile').then((m) => m.EditProfile),
        title: 'Edit Profile',
      },

      {
  path: 'certificate-template',
  canActivate: [menuGuard(MENU.CERTIFICATE)],
  loadComponent: () =>
    import('./certificate-module/certificate-designer/certificate-designer').then(
      (m) => m.CertificateDesigner,
    ),
  title: 'Certificate Template',
},
      // Subscription & Billing (company admin buys a package) + its payment step
      {
        path: 'subscription',
        canActivate: [companyAdminGuard],
        loadComponent: () =>
          import('./subscription-billing/subscription/subscription').then((m) => m.Subscription),
        title: 'Subscription & Billing',
      },
      {
        path: 'subscription/payment',
        canActivate: [companyAdminGuard],
        loadComponent: () =>
          import('./payment/payment-gateway/payment-gateway').then((m) => m.PaymentGateway),
        title: 'Payment Method',
      },
      {
        path: 'courses',
        // Opens when the Course Management switch is ON. Create / edit / delete / view are checked
        // separately inside the page, so the menu can be visible with every action OFF.
        canActivate: [menuGuard(MENU.COURSE)],
        loadComponent: () =>
          import('./course-module/course-management/course-management').then(
            (m) => m.CourseManagement,
          ),
        title: 'Course Management',
      },

      // Reports (sidebar "Report"): Course Report + Learner Report. Same rule as the backend (course managers).
      {
        path: 'course-report',
        canActivate: [featureGuard(...COURSE_ACCESS)],
        loadComponent: () =>
          import('./report/course-report/course-report').then((m) => m.CourseReport),
        title: 'Course Report',
      },
      {
        path: 'learner-report',
        canActivate: [featureGuard(...COURSE_ACCESS)],
        loadComponent: () =>
          import('./report/learner-report/learner-report').then((m) => m.LearnerReport),
        title: 'Learner Report',
      },

      // NEW - learner pays for a paid course (same Payment page design, separate from Subscription payment)
      {
        path: 'courses/:courseId/payment',
        canActivate: [menuGuard(MENU.COURSE)],
        loadComponent: () =>
          import('./course-module/course-payment/course-payment').then((m) => m.CoursePayment),
        title: 'Payment Method',
      },

      {
  path: 'courses/:courseId/enrollments',
  canActivate: [featureGuard([FEATURE.ENROLLED_LIST, 'read'])],
  loadComponent: () =>
    import('./course-module/enrolled-course-list/enrolled-course-list').then((m) => m.EnrolledCourseList),
  title: 'Enrolled Course List',
},

{
        path: 'courses/:courseId/organize',
        canActivate: [featureGuard([FEATURE.COURSE_ORGANIZE, 'update'])],
        loadComponent: () =>
          import('./course-module/course-management/course-management').then(
            (m) => m.CourseManagement,
          ),
        title: 'Organize Modules',
      },

      // NEW - learner "Attempt Quiz" (the route below is the instructor's Question Bank editor)
      {
        path: 'courses/:courseId/sections/:sectionId/question-banks/:bankId/attempt',
        canActivate: [featureGuard(...COURSE_ACCESS)],
        loadComponent: () =>
          import('./course-module/quiz-attempt/quiz-attempt').then((m) => m.QuizAttemptPage),
        title: 'Quiz',
      },

      // Edit a saved ebook (the pencil / row of an Ebook activity in Organize Modules)
      {
        path: 'courses/:courseId/sections/:sectionId/ebook/:ebookId',
        canActivate: [featureGuard([FEATURE.EBOOK, 'update'])],
        loadComponent: () =>
          import('./course-module/ebook/ebook-editor/ebook-editor').then((m) => m.EbookEditor),
        title: 'Ebook',
      },
      // Add Activity -> Ebook (a new ebook)
      {
        path: 'courses/:courseId/sections/:sectionId/ebook',
        canActivate: [featureGuard([FEATURE.EBOOK, 'create'])],
        loadComponent: () =>
          import('./course-module/ebook/ebook-editor/ebook-editor').then((m) => m.EbookEditor),
        title: 'Ebook',
      },

      {
  path: 'courses/:courseId/sections/:sectionId/question-banks/:bankId',
  canActivate: [featureGuard([FEATURE.COURSE_ORGANIZE, 'update'])],
  loadComponent: () =>
    import('./course-module/question-bank/question-bank').then(
      (m) => m.QuestionBankComponent,
    ),
  title: 'Create Question Bank',
},

{
        path: 'courses/:courseId/preview',
        canActivate: [featureGuard(...COURSE_ACCESS)],
        loadComponent: () =>
          import('./course-module/course-preview/course-preview').then(
            (m) => m.CoursePreview,
          ),
        title: 'Course Preview',
      },

      {
  path: 'courses/:courseId/sections/:sectionId/content',
  canActivate: [featureGuard(...COURSE_ACCESS)],
  loadComponent: () =>
    import('./course-module/course-content-viewer/course-content-viewer').then(
      (m) => m.CourseContentViewer,
    ),
  title: 'Course Content',
},

// Learner profile -> My Certificate (the certificates earned by completing courses) - learners only
{
  path: 'my-certificate',
  canActivate: [learnerHomeGuard],
  loadComponent: () =>
    import('./certificate-module/my-certificate/my-certificate').then((m) => m.MyCertificate),
  title: 'My Certificate',
},

// Learner profile -> Purchase History (paid courses + invoice download) - learners only
{
  path: 'purchase-history',
  canActivate: [learnerHomeGuard],
  loadComponent: () =>
    import('./profile/purchase-history/purchase-history').then((m) => m.PurchaseHistory),
  title: 'Purchase History',
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

{
  path: 'settings',
  loadComponent: () =>
    import('./profile/settings/settings-menu/settings-menu').then((m) => m.SettingsMenu),
  title: 'Settings',
},

    ],
  },

  {
    path: '**',
    redirectTo: 'vativa-home',
  },
];