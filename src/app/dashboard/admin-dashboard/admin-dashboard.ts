import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';

import { AuthService } from '../../services/auth';

/** One item of the header breadcrumb. `link: null` = current page (not clickable). */
interface Breadcrumb {
  label: string;
  link: string[] | null;
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
   * Only nested pages that need one return items; every other page returns [] (nothing rendered).
   * To add another page later, add one more `if` here.
   */
  readonly breadcrumbs = computed<Breadcrumb[]>(() => {
    const path = this.currentUrl().split(/[?#]/)[0];

    // /admin-dashboard/courses/:courseId/enrollments
    if (/^\/admin-dashboard\/courses\/\d+\/enrollments\/?$/.test(path)) {
      const courseList = ['/admin-dashboard', 'courses'];
      return [
        { label: 'Course Module', link: courseList },
        { label: 'Course List', link: courseList },
        { label: 'Enrolled Course List', link: null },
      ];
    }
    return [];
  });

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