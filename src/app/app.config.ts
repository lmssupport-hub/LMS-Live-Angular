import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { NavigationEnd, Router, provideRouter, withRouterConfig } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { filter } from 'rxjs';

import { routes } from './app.routes';
import { authInterceptor } from './services/auth';

let scrollToken = 0;


function scrollToSection(id: string): void {
  const token = ++scrollToken;
  const DURATION = 700;   
  const MAX_WAIT = 1500;  
  const SETTLE = 1200;    
  const waitStart = performance.now();

  const cancel = () => { scrollToken++; };
  window.addEventListener('wheel', cancel, { passive: true, once: true });
  window.addEventListener('touchstart', cancel, { passive: true, once: true });

  const run = (el: HTMLElement) => {
    const from = window.scrollY;
    const t0 = performance.now();
    const offset = () => parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    const targetY = () => el.getBoundingClientRect().top + window.scrollY - offset();

    const step = (now: number) => {
      if (token !== scrollToken) return;
      const p = Math.min(1, (now - t0) / DURATION);
      const eased = 1 - Math.pow(1 - p, 3);
      const target = targetY();
      window.scrollTo({ top: from + (target - from) * eased, behavior: 'instant' });

      if (p < 1) {
        requestAnimationFrame(step);
      } else if (Math.abs(targetY() - window.scrollY) > 1 && now - t0 < DURATION + SETTLE) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  };

  const find = () => {
    if (token !== scrollToken) return;
    const el = document.getElementById(id);
    if (el) {
      run(el);
    } else if (performance.now() - waitStart < MAX_WAIT) {
      requestAnimationFrame(find);
    }
  };
  find();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withRouterConfig({ onSameUrlNavigation: 'reload' }),
    ),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAppInitializer(() => {
      const router = inject(Router);
      router.events
        .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
        .subscribe(() => {
          const fragment = router.parseUrl(router.url).fragment;
          if (fragment) {
            scrollToSection(fragment);
          } else {
            window.scrollTo({ top: 0, behavior: 'instant' });
          }
        });
    }),
  ],
};