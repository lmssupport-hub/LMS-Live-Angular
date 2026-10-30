import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { EMPTY, interval, timer } from 'rxjs';
import { catchError, filter, map, startWith, switchMap } from 'rxjs/operators';

import { AuthService } from '../../services/auth';
import { PackageService } from '../../services/package.service';

/** One item of the header breadcrumb. `link: null` = not clickable (current page or plain parent). */
interface Breadcrumb {
  label: string;
  link: string[] | null;
  /** Query params for the link, e.g. { organize: '12' } to open "Organize Modules" of course 12. */
  queryParams?: Record<string, string>;
  /** true = plain text style (no pill), used for simple 2-level crumbs */
  plain?: boolean;
}

@Component({
  selector: 'app-admin-dashboard',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDashboard {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly packagesApi = inject(PackageService);

  // ---------- header: identity ----------
  // Single source of truth lives in AuthService (firstName + lastName, falls
  // back to email) - kept DRY instead of re-deriving it here.
  readonly displayName = this.auth.displayName;
  readonly roleLabel = computed(() => this.auth.user()?.role ?? '');

  /** Short form for the header bar itself (limited width) - falls back to the
   *  full display name (e.g. the email) when firstName isn't available. */
  readonly headerName = computed(() => this.auth.user()?.firstName?.trim() || this.displayName());

  /** Two-letter avatar initials, e.g. "Maxx Doe" -> "MD". Safe against an empty/blank name. */
  readonly initials = computed(() => {
    const parts = this.displayName().trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    const first = parts[0].charAt(0);
    const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
    return (first + last).toUpperCase();
  });

  // ---------- header: package "days left" countdown ----------
  /** Reads the admin's package expiry now and every 5 minutes (so an unassign / new assign shows without re-login). */
  private readonly subscription = toSignal(
    timer(0, 5 * 60_000).pipe(
      switchMap(() =>
        this.packagesApi.getMySubscription().pipe(
          map((s) => ({ s, fetchedAt: Date.now() })),
          catchError((err) => {
  console.error('my-subscription failed', err);
  return EMPTY;
}),
        ),
      ),
    ),
    { initialValue: null },
  );

  /** Ticks every second so the countdown re-renders. */
  private readonly nowMs = toSignal(
    interval(1000).pipe(map(() => Date.now()), startWith(Date.now())),
    { initialValue: Date.now() },
  );

  /** null = admin has no package (pill hidden). Example: { daysLabel: '05 days', hours: '120:00:00' }. */
  readonly packageCountdown = computed(() => {
    const data = this.subscription();
    const expiresAt = data?.s.expiresAt;
    if (!data || !expiresAt) return null;
    const { s, fetchedAt } = data;
    // expiresAt and serverTime are both server-clock values, so their difference is timezone-safe.
    const msLeftAtFetch = new Date(expiresAt).getTime() - new Date(s.serverTime).getTime();
    const msLeft = Math.max(0, msLeftAtFetch - (this.nowMs() - fetchedAt));
    const totalSeconds = Math.floor(msLeft / 1000);
    const days = Math.floor(totalSeconds / 86_400);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return {
      expired: msLeft <= 0,
      expiringSoon: msLeft > 0 && days < 3,
      packageName: s.packageName,
      daysLabel: `${pad(days)} ${days === 1 ? 'day' : 'days'}`,
      // Total hours (can pass 24, e.g. 120:00:00), then minutes and seconds.
      hours: `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(totalSeconds % 60)}`,
    };
  });

  // ---------- header: breadcrumb ----------
  /** Current URL, kept in sync on every completed navigation. */
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(event => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /**
   * Breadcrumb shown in the header, right after the logo.
   * Only pages that need one return items; every other page returns [] (nothing rendered).
   * To add another page later, add one more `if` here.
   */
  readonly breadcrumbs = computed<Breadcrumb[]>(() => {
    const [path, query = ''] = this.currentUrl().split('#')[0].split('?');
    const params = new URLSearchParams(query);
    const courseList = ['/admin-dashboard', 'courses'];

    if (/^\/admin-dashboard\/courses\/?$/.test(path)) {
      if (params.has('organize')) {
        return [
          { label: 'Content Management', link: null, plain: true },
          { label: 'Course List', link: courseList, plain: true },
          { label: 'Organize Modules', link: null, plain: true },
        ];
      }
      return [
        { label: 'Content Management', link: null, plain: true },
        { label: 'Course List', link: null, plain: true },
      ];
    }

    // /admin-dashboard/courses/:courseId/enrollments
    if (/^\/admin-dashboard\/courses\/\d+\/enrollments\/?$/.test(path)) {
      return [
        { label: 'Course Module', link: courseList, plain: true },
        { label: 'Course List', link: courseList, plain: true },
        { label: 'Enrolled Course List', link: null, plain: true },
      ];
    }

    // Course Preview (/courses/:courseId/preview) and its content page (/courses/:courseId/sections/:sectionId/content)
    // Flow: Content Management > Course List > Organize Modules > Course Preview
    const previewMatch =
      /^\/admin-dashboard\/courses\/(\d+)\/preview\/?$/.exec(path) ??
      /^\/admin-dashboard\/courses\/(\d+)\/sections\/\d+\/content\/?$/.exec(path);
    if (previewMatch) {
      return [
        { label: 'Content Management', link: null, plain: true },
        { label: 'Course List', link: courseList, plain: true },
        {
          label: 'Organize Modules',
          link: courseList,
          queryParams: { organize: previewMatch[1] },
          plain: true,
        },
        { label: 'Course Preview', link: null, plain: true },
      ];
    }

    // Question Bank page (any route under /admin-dashboard that contains "question-bank" / "questionbank").
    // Flow: Content Management > Course List > Organize Modules > Question Bank
    if (/^\/admin-dashboard\/.*question-?bank/i.test(path)) {
      // Read courseId the same way the Question Bank page does: route param `courseId`, else ?courseId=.
      // (Reading the real route params works for ANY route shape, unlike parsing the URL text.)
      const courseId = this.findParam('courseId') ?? params.get('courseId');
      return [
        { label: 'Content Management', link: null, plain: true },
        { label: 'Course List', link: courseList, plain: true },
        {
          label: 'Organize Modules',
          link: courseList,
          queryParams: courseId ? { organize: courseId } : undefined,
          plain: true,
        },
        { label: 'Question Bank', link: null, plain: true },
      ];
    }
    return [];
  });

  /** Finds a route param (e.g. `courseId`) anywhere in the activated route tree, falling back to the query string. */
  private findParam(name: string): string | null {
    const root = this.router.routerState.snapshot.root;
    let route: ActivatedRouteSnapshot | null = root;
    while (route) {
      const value = route.paramMap.get(name);
      if (value) return value;
      route = route.firstChild;
    }
    return root.queryParamMap.get(name);
  }

  // ---------- header: account dropdown ----------
  readonly accountMenuOpen = signal(false);

  @HostListener('document:click')
  closeAccountMenu(): void {
    this.accountMenuOpen.set(false);
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/auth']);
  }

  // ---------- header: notification badge ----------
  // TODO: replace with a real unread count once a notifications endpoint exists.
  readonly unreadNotifications = signal(0);

  // ---------- header: action stubs ----------
  // Kept as real methods (not dead hrefs) so the template never needs to
  // change when these are wired up to their actual features.
  openNotifications(): void {
    // TODO: open the notifications panel once the backend endpoint is available.
  }

  openMessages(): void {
    // TODO: open the messages panel once that feature ships.
  }

  openSettings(): void {
    // TODO: navigate to account/organization settings once that route exists.
  }

  onGlobalSearch(term: string): void {
    // TODO: wire to a global search endpoint once one exists. Intentionally
    // NOT coupled to CourseManagement's/RoleManagement's own local search
    // state - those are page-level concerns owned by their own components.
    void term;
  }
}