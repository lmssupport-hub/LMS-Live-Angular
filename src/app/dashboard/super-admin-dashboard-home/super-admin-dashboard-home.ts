import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { EMPTY, catchError, concatMap, expand, map, mergeMap, of, reduce, toArray } from 'rxjs';

import { AuthService } from '../../services/auth';
import { PackageAdminAssignment, PackageRecord, PackageService } from '../../services/package.service';

interface RevenuePlan {
  name: string;
  value: number;
  color: string;
}

interface RevenueChartPoint {
  name: string;
  label: string;
  value: number;
  color: string;
  x: number;
  y: number;
}

interface RevenueChartGridLine {
  y: number;
  value: number;
}

/** One revenue event: a package was assigned to an admin on `date` for `amount`. */
interface RevenueEntry {
  date: string; // yyyy-MM-dd of assignedAt
  amount: number; // price of the assigned package
}

interface AssignmentResult {
  id: number;
  name: string;
  price: number;
  count: number;
  assignments: PackageAdminAssignment[];
  failed: boolean;
}

const REVENUE_PLAN_COLORS = ['#62bdcb', '#7064cc', '#a35cf1', '#e99a46', '#4b9d77', '#e15b64'];
const REVENUE_CHART_TOP = 20;
const REVENUE_CHART_BOTTOM = 220;
const REVENUE_CHART_LEFT = 76;
const REVENUE_CHART_RIGHT_PADDING = 36;

@Component({
  selector: 'app-super-admin-dashboard-home',
  imports: [],
  templateUrl: './super-admin-dashboard-home.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SuperAdminDashboardHome implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly packagesApi = inject(PackageService);
  private readonly destroyRef = inject(DestroyRef);

  // ---------- greeting ("Hi {{ headerName() }}") ----------
  private readonly displayName = this.auth.displayName;
  readonly headerName = computed(() => this.auth.user()?.firstName?.trim() || this.displayName());

  // ---------- filter ----------
  readonly selectedPeriod = signal<'Custom Date Range' | 'Monthly' | 'Yearly'>('Monthly');
  readonly packageBillingCycle = signal<'Monthly' | 'Yearly'>('Monthly');
  readonly customStartDate = signal('');
  readonly customEndDate = signal('');
  readonly dateRangeError = signal('');
  readonly ddUsed = signal(false);
  readonly openDropdown = signal(false);
  readonly filterOptions: readonly ('Custom Date Range' | 'Monthly' | 'Yearly')[] = ['Monthly', 'Yearly', 'Custom Date Range'];

  // ---------- admins ----------
  readonly activeAdminCount = signal<number | null>(null);
  readonly inactiveAdminCount = signal<number | null>(null);
  readonly adminAnimationProgress = signal(0);
  readonly activeAdminAnimationProgress = signal(0);
  readonly inactiveAdminAnimationProgress = signal(0);
  readonly adminLoading = signal(false);
  readonly adminError = signal('');
  readonly totalAdminCount = computed(() => {
    const active = this.activeAdminCount();
    const inactive = this.inactiveAdminCount();
    return active === null || inactive === null ? null : active + inactive;
  });

  // ---------- packages / revenue ----------
  readonly packages = signal<PackageRecord[]>([]);
  readonly packageAnimationProgress = signal(0);
  readonly revenueChartProgress = signal(0);
  readonly packageLoading = signal(false);
  readonly packageError = signal('');

  /** Permanent daily revenue from the backend ledger (package_purchases), one entry per day. */
  readonly revenueEntries = signal<RevenueEntry[]>([]);
  readonly revenueLoading = signal(false);
  readonly revenueError = signal('');
  /** Chart point currently under the cursor (drives the tooltip). */
  readonly hoveredPoint = signal<RevenueChartPoint | null>(null);

  /** Revenue entries that fall inside the selected filter period. */
  readonly revenueEntriesInPeriod = computed(() => {
    const entries = this.revenueEntries();
    const period = this.selectedPeriod();

    if (period === 'Monthly' || period === 'Yearly') {
      const today = this.currentDateKey();
      const prefix = period === 'Monthly' ? today.slice(0, 7) : today.slice(0, 4);
      return entries.filter((entry) => entry.date.startsWith(prefix));
    }

    if (this.dateRangeError()) return [];
    const start = this.customStartDate();
    const end = this.customEndDate();
    if (!start && !end) return entries;

    const rangeStart = start || end;
    const rangeEnd = end || start;
    return entries.filter((entry) => entry.date >= rangeStart && entry.date <= rangeEnd);
  });

  readonly totalPlanValue = computed(() =>
    this.revenueEntriesInPeriod().reduce((total, entry) => total + entry.amount, 0),
  );

  readonly previousPeriodPlanValue = computed<number | null>(() => {
    const entries = this.revenueEntries();
    const period = this.selectedPeriod();

    if (period === 'Monthly' || period === 'Yearly') {
      const [year, month] = this.currentDateKey().split('-').map(Number);
      const previousPeriod = period === 'Monthly'
        ? new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7)
        : String(year - 1);
      return entries
        .filter((entry) => entry.date.startsWith(previousPeriod))
        .reduce((total, entry) => total + entry.amount, 0);
    }

    if (this.dateRangeError()) return null;
    const start = this.customStartDate() || this.customEndDate();
    const end = this.customEndDate() || this.customStartDate();
    if (!start || !end) return null;

    const startTime = Date.parse(`${start}T00:00:00.000Z`);
    const endTime = Date.parse(`${end}T00:00:00.000Z`);
    const periodLength = Math.floor((endTime - startTime) / 86_400_000) + 1;
    const previousEnd = new Date(startTime - 86_400_000).toISOString().slice(0, 10);
    const previousStart = new Date(startTime - periodLength * 86_400_000).toISOString().slice(0, 10);
    return entries
      .filter((entry) => entry.date >= previousStart && entry.date <= previousEnd)
      .reduce((total, entry) => total + entry.amount, 0);
  });

  readonly revenueChangePercent = computed<number | null>(() => {
    const previousValue = this.previousPeriodPlanValue();
    if (previousValue === null || previousValue === 0) return null;
    return ((this.totalPlanValue() - previousValue) / previousValue) * 100;
  });

  /** One point per assigned date: sum of the prices of all packages assigned on that date. */
  readonly revenuePlans = computed<RevenuePlan[]>(() => {
    const grouped = new Map<string, number>();
    for (const entry of this.revenueEntriesInPeriod()) {
      grouped.set(entry.date, (grouped.get(entry.date) ?? 0) + entry.amount);
    }
    return Array.from(grouped, ([date, value]) => ({ name: date, value }))
      .sort((first, second) => first.name.localeCompare(second.name))
      .map((item, index) => ({
        ...item,
        color: REVENUE_PLAN_COLORS[index % REVENUE_PLAN_COLORS.length],
      }));
  });

  readonly revenueChart = computed(() => {
    const plans = this.revenuePlans();
    const width = Math.max(1000, 150 * Math.max(plans.length - 1, 1) + REVENUE_CHART_LEFT + REVENUE_CHART_RIGHT_PADDING);
    const right = width - REVENUE_CHART_RIGHT_PADDING;
    const maximum = Math.max(0, ...plans.map((plan) => plan.value));
    const points = plans.map((plan, index): RevenueChartPoint => ({
      name: plan.name,
      label: new Date(`${plan.name}T00:00:00.000Z`).toLocaleDateString('en', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
      value: plan.value,
      color: plan.color,
      x: plans.length === 1
        ? (REVENUE_CHART_LEFT + right) / 2
        : REVENUE_CHART_LEFT + (index / (plans.length - 1)) * (right - REVENUE_CHART_LEFT),
      y: REVENUE_CHART_BOTTOM - (maximum > 0 ? (plan.value / maximum) * (REVENUE_CHART_BOTTOM - REVENUE_CHART_TOP) : 0),
    }));
    const linePath = points.length
      ? `M ${points[0].x} ${points[0].y}${points.slice(1).map((point, index) => {
        const previous = points[index];
        const midpoint = (previous.x + point.x) / 2;
        return ` C ${midpoint} ${previous.y}, ${midpoint} ${point.y}, ${point.x} ${point.y}`;
      }).join('')}`
      : '';
    const areaPath = points.length
      ? `M ${points[0].x} ${REVENUE_CHART_BOTTOM} L ${points[0].x} ${points[0].y}${points.slice(1).map((point, index) => {
        const previous = points[index];
        const midpoint = (previous.x + point.x) / 2;
        return ` C ${midpoint} ${previous.y}, ${midpoint} ${point.y}, ${point.x} ${point.y}`;
      }).join('')} L ${points[points.length - 1].x} ${REVENUE_CHART_BOTTOM} Z`
      : '';

    return {
      width,
      plotWidth: right - REVENUE_CHART_LEFT,
      linePath,
      areaPath,
      points,
      gridLines: Array.from({ length: 5 }, (_, index): RevenueChartGridLine => ({
        y: REVENUE_CHART_TOP + (index / 4) * (REVENUE_CHART_BOTTOM - REVENUE_CHART_TOP),
        value: maximum * (1 - index / 4),
      })),
      ariaLabel: `Revenue chart. ${points.map((point) => `${point.name}: ${this.formatCurrency(point.value)}`).join('; ')}.`,
    };
  });

  readonly filteredPackages = computed(() =>
    this.packages().filter((pkg) => pkg.billingCycle === this.packageBillingCycle()),
  );
  readonly packageAssignments = signal<Array<{ id: number; name: string; count: number }>>([]);
  readonly filteredPackageAssignments = computed(() => {
    const packageIds = new Set(this.filteredPackages().map((pkg) => pkg.id));
    return this.packageAssignments().filter((assignment) => packageIds.has(assignment.id));
  });
  readonly assignmentLoading = signal(false);
  readonly assignmentError = signal(false);

  readonly packageBarMetrics = computed(() => {
    const packages = this.filteredPackages();
    return [
      { label: 'Total', count: packages.length, color: '#62bdcb' },
      { label: 'Active', count: packages.filter((pkg) => pkg.status === 'Active').length, color: '#7064cc' },
      { label: 'Inactive', count: packages.filter((pkg) => pkg.status === 'Inactive').length, color: '#a35cf1' },
    ];
  });

  readonly packageBarMaximum = computed(() =>
    Math.max(1, ...this.packageBarMetrics().map((metric) => metric.count)),
  );

  readonly activeAdminArc = computed(() =>
    this.adminArc('Active', this.activeAdminAnimationProgress()),
  );

  readonly inactiveAdminArc = computed(() =>
    this.adminArc('Inactive', this.inactiveAdminAnimationProgress()),
  );

  readonly inactiveAdminArcOffset = computed(() => {
    const total = this.totalAdminCount();
    const active = this.activeAdminCount();

    return total && active !== null
      ? -((active / total) * (this.donutCircumference - this.adminDonutGap) + this.adminDonutGap)
      : 0;
  });

  private readonly donutCircumference = 515.22;
  private readonly adminDonutGap = 32;
  private adminLoadId = 0;
  private packageLoadId = 0;
  private assignmentLoadId = 0;
  private revenueLoadId = 0;
  private adminAnimationFrame: number | null = null;
  private packageAnimationFrame: number | null = null;
  private revenueChartAnimationFrame: number | null = null;

  /**
   * This component is created every time the user opens the dashboard home route
   * and destroyed when they leave, so a plain load-on-init is enough.
   */
  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      if (this.adminAnimationFrame !== null) cancelAnimationFrame(this.adminAnimationFrame);
      if (this.packageAnimationFrame !== null) cancelAnimationFrame(this.packageAnimationFrame);
      if (this.revenueChartAnimationFrame !== null) cancelAnimationFrame(this.revenueChartAnimationFrame);
    });
    this.loadAdminCounts();
    this.loadPackages();
    this.loadRevenue();
  }

  toggleDropdown(): void {
    this.openDropdown.update((current) => !current);
  }

  selectPeriod(period: 'Custom Date Range' | 'Monthly' | 'Yearly'): void {
    this.selectedPeriod.set(period);
    if (period === 'Monthly' || period === 'Yearly') this.packageBillingCycle.set(period);
    this.openDropdown.set(false);
    this.dateRangeError.set('');
    this.startRevenueChartAnimation();
    if ((period === 'Monthly' || period === 'Yearly') && !this.packageLoading() && !this.packageError()) {
      this.startPackageAnimation();
    }
  }

  @HostListener('document:click')
  closeFilterDropdown(): void {
    this.openDropdown.set(false);
  }

  onStartDateChange(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.customStartDate.set(event.target.value);
    this.validateDateRange();
    this.startRevenueChartAnimation();
  }

  onEndDateChange(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.customEndDate.set(event.target.value);
    this.validateDateRange();
    this.startRevenueChartAnimation();
  }

  private validateDateRange(): void {
    const start = this.customStartDate();
    const end = this.customEndDate();
    this.dateRangeError.set(start && end && start > end ? 'The start date must be before the end date.' : '');
  }

  private currentDateKey(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  }

  /** Converts an API date/time string into a valid yyyy-MM-dd key (or null). */
  private toDateKey(value: string | null | undefined): string | null {
    if (!value) return null;
    const date = value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    return Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date
      ? null
      : date;
  }

  retryAdminCounts(): void {
    this.loadAdminCounts();
  }

  retryPackages(): void {
    this.loadPackages();
  }

  retryAssignments(): void {
    this.loadAssignments(this.packages());
  }

  retryRevenue(): void {
    this.loadRevenue();
  }

  /** Revenue comes from the permanent purchase ledger, independent of current package assignments. */
  private loadRevenue(): void {
    const requestId = ++this.revenueLoadId;
    this.revenueLoading.set(true);
    this.revenueError.set('');
    this.packagesApi.getRevenue().subscribe({
      next: (points) => {
        if (requestId !== this.revenueLoadId) return;
        const entries: RevenueEntry[] = [];
        for (const point of points) {
          const date = this.toDateKey(point.date);
          if (date) entries.push({ date, amount: point.amount });
        }
        this.revenueEntries.set(entries);
        this.revenueLoading.set(false);
        this.startRevenueChartAnimation();
      },
      error: (error: unknown) => {
        if (requestId !== this.revenueLoadId) return;
        this.revenueError.set(this.dataErrorMessage(error, 'Revenue could not be loaded.'));
        this.revenueLoading.set(false);
      },
    });
  }

  private loadAdminCounts(): void {
    const requestId = ++this.adminLoadId;
    this.adminLoading.set(true);
    this.adminError.set('');
    this.auth.listAdmins({ status: 'Active', page: 0, size: 1 }).pipe(
      concatMap((active) =>
        this.auth.listAdmins({ status: 'Inactive', page: 0, size: 1 }).pipe(
          map((inactive) => ({ active, inactive })),
        ),
      ),
    ).subscribe({
      next: ({ active, inactive }) => {
        if (requestId !== this.adminLoadId) return;
        this.activeAdminCount.set(active.totalElements);
        this.inactiveAdminCount.set(inactive.totalElements);
        this.adminLoading.set(false);
        this.startAdminAnimation();
      },
      error: (error: unknown) => {
        if (requestId !== this.adminLoadId) return;
        this.adminError.set(this.dataErrorMessage(error, 'Admin totals could not be loaded.'));
        this.adminLoading.set(false);
      },
    });
  }

  private loadPackages(): void {
    const requestId = ++this.packageLoadId;
    this.packageLoading.set(true);
    this.packageError.set('');
    this.packagesApi.list({ page: 0, size: 100 }).pipe(
      expand((page) =>
        page.number + 1 < page.totalPages
          ? this.packagesApi.list({ page: page.number + 1, size: page.size })
          : EMPTY,
      ),
      reduce((all, page) => [...all, ...page.content], [] as PackageRecord[]),
    ).subscribe({
      next: (packages) => {
        if (requestId !== this.packageLoadId) return;
        this.packages.set(packages);
        this.packageLoading.set(false);
        this.loadAssignments(packages);
        this.startPackageAnimation();
      },
      error: (error: unknown) => {
        if (requestId !== this.packageLoadId) return;
        this.packageError.set(this.dataErrorMessage(error, 'Package totals could not be loaded.'));
        this.packageLoading.set(false);
      },
    });
  }

  /**
   * Loads, for every package, the admins assigned to it.
   * - count      -> "Admins by Package" card
   * - assignedAt -> Revenue chart (price of the package on the date it was assigned)
   */
  private loadAssignments(packages: PackageRecord[]): void {
    const requestId = ++this.assignmentLoadId;
    this.assignmentLoading.set(packages.length > 0);
    this.assignmentError.set(false);
    this.packageAssignments.set([]);

    of(...packages).pipe(
      mergeMap(
        (pkg) =>
          this.packagesApi.getAssignments(pkg.id).pipe(
            map((assignments): AssignmentResult => ({
              id: pkg.id,
              name: pkg.name,
              price: pkg.price,
              count: assignments.length,
              assignments,
              failed: false,
            })),
            catchError(() =>
              of<AssignmentResult>({
                id: pkg.id,
                name: pkg.name,
                price: pkg.price,
                count: 0,
                assignments: [],
                failed: true,
              }),
            ),
          ),
        5,
      ),
      toArray(),
    ).subscribe((results) => {
      if (requestId !== this.assignmentLoadId) return;

      this.packageAssignments.set(
        results
          .filter((result) => !result.failed)
          .map(({ id, name, count }) => ({ id, name, count })),
      );

      this.assignmentError.set(results.some((result) => result.failed));
      this.assignmentLoading.set(false);
    });
  }

  private adminArc(kind: 'Active' | 'Inactive', progress: number): string {
    const total = this.totalAdminCount();
    const count = kind === 'Active' ? this.activeAdminCount() : this.inactiveAdminCount();
    if (!total || count === null) return `0 ${this.donutCircumference}`;
    const segmentLength = Math.max(
      0,
      (count / total) * (this.donutCircumference - this.adminDonutGap) * progress,
    );
    const gapLength = this.donutCircumference - segmentLength;
    return `${segmentLength} ${gapLength}`;
  }

  barHeight(count: number): number {
    return count === 0 ? 0 : Math.max(18, (count / this.packageBarMaximum()) * 100);
  }

  adminArcLabelPosition(kind: 'Active' | 'Inactive'): { x: number; y: number } {
    const total = this.totalAdminCount();
    const active = this.activeAdminCount();
    const inactive = this.inactiveAdminCount();
    if (!total || active === null || inactive === null) return { x: 110, y: 110 };

    const drawableCircumference = this.donutCircumference - this.adminDonutGap;
    const activeLength = (active / total) * drawableCircumference;
    const inactiveLength = (inactive / total) * drawableCircumference;
    const labelOffset = kind === 'Active'
      ? activeLength / 2
      : activeLength + this.adminDonutGap + inactiveLength / 2;
    const angle = Math.PI + (labelOffset / this.donutCircumference) * Math.PI * 2;
    return {
      x: 110 + Math.sin(angle) * 82,
      y: 110 - Math.cos(angle) * 82,
    };
  }

  displayedPackageCount(count: number): number {
    return Math.round(count * this.packageAnimationProgress());
  }

  /** Keeps the 120px-wide tooltip inside the chart's left/right edges. */
  tooltipX(x: number): number {
    return Math.min(Math.max(x - 60, 4), this.revenueChart().width - 124);
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(value);
  }

  formatCompactCurrency(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  }

  formatRevenueChange(): string {
    const change = this.revenueChangePercent();
    if (change === null) return '—';
    return `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
  }

  private startRevenueChartAnimation(): void {
    if (this.revenueChartAnimationFrame !== null) {
      cancelAnimationFrame(this.revenueChartAnimationFrame);
      this.revenueChartAnimationFrame = null;
    }

    this.hoveredPoint.set(null);
    this.revenueChartProgress.set(0);

    if (
      typeof requestAnimationFrame === 'undefined' ||
      (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
    ) {
      this.revenueChartProgress.set(1);
      return;
    }

    const startedAt = performance.now();
    const duration = 1800;
    const update = (now: number): void => {
      const progress = Math.min((now - startedAt) / duration, 1);
      this.revenueChartProgress.set(1 - Math.pow(1 - progress, 3));
      this.revenueChartAnimationFrame = progress < 1 ? requestAnimationFrame(update) : null;
    };

    this.revenueChartAnimationFrame = requestAnimationFrame(update);
  }

  private startAdminAnimation(): void {
    if (this.adminAnimationFrame !== null) {
      cancelAnimationFrame(this.adminAnimationFrame);
      this.adminAnimationFrame = null;
    }

    this.adminAnimationProgress.set(0);
    this.activeAdminAnimationProgress.set(0);
    this.inactiveAdminAnimationProgress.set(0);

    if (
      typeof requestAnimationFrame === 'undefined' ||
      (typeof matchMedia !== 'undefined' &&
        matchMedia('(prefers-reduced-motion: reduce)').matches)
    ) {
      this.adminAnimationProgress.set(1);
      this.activeAdminAnimationProgress.set(1);
      this.inactiveAdminAnimationProgress.set(1);
      return;
    }

    const animateStage = (
      target: typeof this.adminAnimationProgress,
      duration: number,
      onComplete?: () => void,
    ): void => {
      const startedAt = performance.now();

      const update = (now: number): void => {
        const linearProgress = Math.min((now - startedAt) / duration, 1);

        target.set(1 - Math.pow(1 - linearProgress, 3));

        if (linearProgress < 1) {
          this.adminAnimationFrame = requestAnimationFrame(update);
        } else {
          this.adminAnimationFrame = null;
          onComplete?.();
        }
      };

      this.adminAnimationFrame = requestAnimationFrame(update);
    };

    // Stage 1: centre circle
    animateStage(this.adminAnimationProgress, 500, () => {
      // Stage 2: Active admins
      animateStage(this.activeAdminAnimationProgress, 1200, () => {
        // Stage 3: Inactive admins
        animateStage(this.inactiveAdminAnimationProgress, 1000);
      });
    });
  }

  private startPackageAnimation(): void {
    this.startProgressAnimation(this.packageAnimationProgress, 'package');
  }

  private startProgressAnimation(progress: typeof this.adminAnimationProgress, kind: 'admin' | 'package'): void {
    const currentFrame = kind === 'admin' ? this.adminAnimationFrame : this.packageAnimationFrame;
    if (currentFrame !== null) cancelAnimationFrame(currentFrame);
    progress.set(0);

    if (
      typeof requestAnimationFrame === 'undefined' ||
      (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
    ) {
      progress.set(1);
      return;
    }

    const startedAt = performance.now();
    const update = (now: number): void => {
      const linearProgress = Math.min((now - startedAt) / 900, 1);
      progress.set(1 - Math.pow(1 - linearProgress, 3));
      const frame = linearProgress < 1 ? requestAnimationFrame(update) : null;
      if (kind === 'admin') this.adminAnimationFrame = frame;
      else this.packageAnimationFrame = frame;
    };

    const frame = requestAnimationFrame(update);
    if (kind === 'admin') this.adminAnimationFrame = frame;
    else this.packageAnimationFrame = frame;
  }

  private dataErrorMessage(error: unknown, fallback: string): string {
    const status = (error as { status?: number } | null)?.status;
    if (status === 403) return 'You do not have permission to view this data.';
    if (status === 0) return 'Network connection unavailable. Check your connection and retry.';
    if (typeof status === 'number' && status >= 500) return 'The server could not load this data. Please retry.';
    return fallback;
  }
}