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
    // token arrives as a route param, e.g. /reset-password/abc123 (from the email link)
    path: 'reset-password/:token',
    loadComponent: () =>
      import('./auth/reset-password/reset-password').then((m) => m.ResetPassword),
    title: 'Reset Password',
  },
  {
    // fallback if the token comes as a query param instead: /reset-password?token=abc123
    path: 'reset-password',
    loadComponent: () =>
      import('./auth/reset-password/reset-password').then((m) => m.ResetPassword),
    title: 'Reset Password',
  },

 {
  path: 'super-admin-dashboard',
  loadComponent: () =>
    import('./dashboard/super-admin-dashboard/super-admin-dashboard').then((m) => m.SuperAdminDashboard),
  title: 'Super Admin Dashboard',
},

  {
    path: '**',
    redirectTo: 'auth',
  },
];