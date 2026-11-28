import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, concat, map, of, switchMap, timer } from 'rxjs';

import {
  AdminDashboardData,
  AdminDashboardService,
  DashboardPeriod,
  DashboardSeries,
  UserDistribution,
} from '../../services/admin-dashboard.service';
import { AuthService } from '../../services/auth';
type SeriesKey = 'logins' | 'newSignups' | 'revenue';
type RoleKey = 'admins' | 'instructors' | 'learners';

/** Optional "+12%" growth badge shown next to the legend totals (add `change` to DashboardSeries in the service). */
type SeriesWithChange = DashboardSeries & { change?: number | null };

const PERIOD_OPTIONS = [
  'Today',
  'Yesterday',
  'This Week',
  'This Month',
  'Last Week',
  'Last 7 Days',
  'Last 30 Days',
  'Last 60 Days',
  'Last 90 Days',
  'Last 180 Days',
  'Last Year',
  'Custom Date Range',
] as const;
type PeriodLabel = (typeof PERIOD_OPTIONS)[number];

interface DateRange {
  from: string;
  to: string;
}

interface DashboardRequest {
  period: PeriodLabel;
  range: DateRange | null;
  apiPeriod: DashboardPeriod;
  online: boolean;
}

interface DashboardSummary {
  userDistribution: UserDistribution | null;
  courseCompletionRate: number | null;
  onlineUsers: number | null;
  averageLearningTime: string | null;
}

type DashboardState =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'error'; message: string }
  | { status: 'invalid-range'; message: string }
  | {
      status: 'loaded';
      data: AdminDashboardData | null;
      summary: DashboardSummary;
      notice?: string;
    };

const EMPTY_DATE_RANGE_MESSAGE = 'Select a valid start and end date.';
const DATE_ORDER_ERROR_MESSAGE = 'The end date must not be earlier than the start date.';
const SUMMARY_UNAVAILABLE_MESSAGE =
  'Summary metrics are available only for the API-supported reporting periods.';

/** How often the dashboard reloads itself (the backend counts a user online for 2 minutes after a heartbeat). */
const REFRESH_MS = 30_000;

// Plot area inside the 600 x 340 viewBox of the two area charts (labels sit at y = 330).
const PLOT_LEFT = 55;
const PLOT_RIGHT = 590;
const PLOT_TOP = 20;
const PLOT_BOTTOM = 300;

/** Figma axes: 0 ... top in 6 equal steps (0, 500, 1k ... 3k / 0, 3k ... 18k). */
const AXIS_STEPS = 6;
const NICE_STEPS = [1, 2, 3, 5, 10];

// Donut (viewBox 300 x 300): ring from r = 54 to r = 126, 6px gap, 8px rounded corners.
const DONUT_CENTER = 150;
const DONUT_OUTER = 126;
const DONUT_INNER = 54;
const DONUT_GAP = 3;
const DONUT_CORNER = 8;



interface AxisScale {
  /** Highest tick - the value drawn at PLOT_TOP. */
  top: number;
  ticks: number[];
}

interface Point {
  x: number;
  y: number;
}

interface AxisLabel {
  index: number;
  label: string;
  x: number;
}

interface DonutSegment {
  key: RoleKey;
  color: string;
  path: string;
  delay: string;
}

/** "Nice" axis: AXIS_STEPS equal steps (1 / 2 / 3 / 5 x 10^n) from 0 up to a value >= max. */
function buildScale(max: number, integersOnly: boolean): AxisScale {
  const safeMax = max > 0 ? max : 1;
  const rawStep = safeMax / AXIS_STEPS;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  let step = (NICE_STEPS.find((nice) => normalized <= nice) ?? 10) * magnitude;
  if (integersOnly) step = Math.max(1, Math.ceil(step));
  const ticks = Array.from({ length: AXIS_STEPS + 1 }, (_, index) => index * step);
  return { top: step * AXIS_STEPS, ticks };
}

/** Smooth line through the points (horizontal tangents, so the curve never dips below its data). */
function linePath(points: Point[]): string {
  if (!points.length) return '';
  const [first, ...rest] = points;
  const segments = rest.map((point, index) => {
    const previous = points[index];
    const middle = (previous.x + point.x) / 2;
    return ` C ${middle} ${previous.y}, ${middle} ${point.y}, ${point.x} ${point.y}`;
  });
  return `M ${first.x} ${first.y}${segments.join('')}`;
}

function areaPath(points: Point[]): string {
  if (!points.length) return '';
  const last = points[points.length - 1];
  return `${linePath(points)} L ${last.x} ${PLOT_BOTTOM} L ${points[0].x} ${PLOT_BOTTOM} Z`;
}

function polar(radius: number, degrees: number): Point {
  const radians = ((degrees - 90) * Math.PI) / 180; // 0deg = 12 o'clock, clockwise
  return {
    x: DONUT_CENTER + radius * Math.cos(radians),
    y: DONUT_CENTER + radius * Math.sin(radians),
  };
}

/**
 * Ring segment with rounded corners and a gap to its neighbours.
 * The shape is inset by DONUT_CORNER and the template strokes it with a (2 x DONUT_CORNER) round-joined
 * stroke in the same colour, which rounds every corner.
 */
function sectorPath(startDeg: number, endDeg: number, gapped: boolean): string {
  const outer = DONUT_OUTER - DONUT_CORNER;
  const inner = DONUT_INNER + DONUT_CORNER;

  if (endDeg - startDeg >= 359.99) {
    const ring = (radius: number): string =>
      `M ${DONUT_CENTER - radius} ${DONUT_CENTER} a ${radius} ${radius} 0 1 0 ${2 * radius} 0 a ${radius} ${radius} 0 1 0 ${-2 * radius} 0 Z`;
    return `${ring(outer)} ${ring(inner)}`;
  }

  // Each edge is a line parallel to the radial line, `offset` px inside the segment,
  // so the white gap between neighbours has the same width at every radius.
  const offset = (gapped ? DONUT_GAP / 2 : 0) + DONUT_CORNER;
  const toDeg = (rad: number): number => (rad * 180) / Math.PI;
  const outerPad = toDeg(Math.asin(offset / outer));
  const innerPad = toDeg(Math.asin(offset / inner));

  const outerFrom = startDeg + outerPad;
  const outerTo = endDeg - outerPad;
  const innerFrom = startDeg + innerPad;
  const innerTo = endDeg - innerPad;
  if (outerTo <= outerFrom || innerTo <= innerFrom) return '';

  const a = polar(outer, outerFrom);
  const b = polar(outer, outerTo);
  const c = polar(inner, innerTo);
  const d = polar(inner, innerFrom);
  const largeOuter = outerTo - outerFrom > 180 ? 1 : 0;
  const largeInner = innerTo - innerFrom > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${outer} ${outer} 0 ${largeOuter} 1 ${b.x} ${b.y} L ${c.x} ${c.y} A ${inner} ${inner} 0 ${largeInner} 0 ${d.x} ${d.y} Z`;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateAtUtc(year: number, monthIndex: number, day: number): Date {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, monthIndex, day);
  return date;
}

function shiftDateKey(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = dateAtUtc(year, month - 1, day + days);
  return date.toISOString().slice(0, 10);
}

function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = dateAtUtc(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateRangeForPeriod(period: PeriodLabel, from: string, to: string): DateRange | null {
  const today = dateKey(new Date());
  const previousDay = shiftDateKey(today, -1);
  const [year, month, day] = today.split('-').map(Number);
  const daysSinceMonday = (dateAtUtc(year, month - 1, day).getUTCDay() + 6) % 7;

  switch (period) {
    case 'Today':
      return { from: today, to: today };
    case 'Yesterday':
      return { from: previousDay, to: previousDay };
    case 'This Week':
      return { from: shiftDateKey(today, -daysSinceMonday), to: today };
    case 'This Month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'Last Week': {
      const thisWeekStart = shiftDateKey(today, -daysSinceMonday);
      return { from: shiftDateKey(thisWeekStart, -7), to: shiftDateKey(thisWeekStart, -1) };
    }
    case 'Last 7 Days':
      return { from: shiftDateKey(today, -6), to: today };
    case 'Last 30 Days':
      return { from: shiftDateKey(today, -29), to: today };
    case 'Last 60 Days':
      return { from: shiftDateKey(today, -59), to: today };
    case 'Last 90 Days':
      return { from: shiftDateKey(today, -89), to: today };
    case 'Last 180 Days':
      return { from: shiftDateKey(today, -179), to: today };
    case 'Last Year': {
      const [year, month, day] = today.split('-').map(Number);
      return {
        from: dateAtUtc(year - 1, month - 1, day).toISOString().slice(0, 10),
        to: today,
      };
    }
    case 'Custom Date Range':
      return isValidDateKey(from) && isValidDateKey(to) && from <= to ? { from, to } : null;
  }
}

function daysBetween(range: DateRange): number {
  const [fromYear, fromMonth, fromDay] = range.from.split('-').map(Number);
  const [toYear, toMonth, toDay] = range.to.split('-').map(Number);
  const from = dateAtUtc(fromYear, fromMonth - 1, fromDay).getTime();
  const to = dateAtUtc(toYear, toMonth - 1, toDay).getTime();
  return Math.floor((to - from) / 86_400_000) + 1;
}

function apiPeriodForRange(range: DateRange): DashboardPeriod {
  const days = daysBetween(range);
  if (days <= 7) return 'WEEK';
  if (days <= 30) return 'MONTH';
  return 'YEAR';
}

function formatDateLabel(value: string, includeYear: boolean): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    ...(includeYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(dateAtUtc(year, month - 1, day));
}

function filterDailySeries(series: DashboardSeries, range: DateRange): DashboardSeries | null {
  if (series.labels.length !== series.values.length) return null;
  if (series.labels.length === 0 || daysBetween(range) > 366) return null;

  const countsByDate = new Map<string, number>();
  for (let index = 0; index < series.labels.length; index += 1) {
    const label = series.labels[index];
    const value = series.values[index];
    if (!isValidDateKey(label) || !Number.isFinite(value)) return null;
    countsByDate.set(label, (countsByDate.get(label) ?? 0) + value);
  }
  const sourceDates = [...countsByDate.keys()].sort();
  if (sourceDates.some((date, index) => index > 0 && shiftDateKey(sourceDates[index - 1], 1) !== date)) {
    return null;
  }

  const dates = Array.from({ length: daysBetween(range) }, (_, index) =>
    shiftDateKey(range.from, index),
  );
  if (!dates.every((date) => countsByDate.has(date))) return null;

  const values = dates.map((date) => countsByDate.get(date) ?? 0);
  const includeYear = range.from.slice(0, 4) !== range.to.slice(0, 4);
  return {
    labels: dates.map((date) => formatDateLabel(date, includeYear)),
    values,
    total: values.reduce((sum, value) => sum + value, 0),
  };
}

@Component({
  selector: 'app-admin-dashboard-home',
  templateUrl: './admin-dashboard-home.html',
  styleUrl: './admin-dashboard-home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:offline)': 'onNetworkOffline()',
    '(window:online)': 'onNetworkOnline()',
    '(document:click)': 'closePeriodControls()',
  },
  imports: [],
})
export class AdminDashboardHome {
  private readonly auth = inject(AuthService);
  private readonly api = inject(AdminDashboardService);

  // ---------- greeting ----------
  readonly userName = computed(() => this.auth.user()?.firstName?.trim() || this.auth.displayName());

  // ---------- period filter ----------
  readonly timePeriods = PERIOD_OPTIONS;
  private readonly period = signal<PeriodLabel>('Last 7 Days');
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly draftFromDate = signal('');
  readonly draftToDate = signal('');
  readonly openPeriodDropdown = signal(false);
  readonly periodDropdownUsed = signal(false);
  readonly customDatePickerOpen = signal(false);
  private readonly online = signal(typeof navigator === 'undefined' || navigator.onLine);
  private readonly retryCount = signal(0);

  /** Read by the template as a plain property: `[value]="selectedPeriod"`. */
  get selectedPeriod(): PeriodLabel {
    return this.period();
  }

  get selectedPeriodLabel(): string {
    if (this.period() !== 'Custom Date Range') return 'Time Period';
    const includeYear = this.fromDate().slice(0, 4) !== this.toDate().slice(0, 4);
    return `${formatDateLabel(this.fromDate(), includeYear)} - ${formatDateLabel(this.toDate(), includeYear)}`;
  }

  get customDateRangeError(): string {
    const start = this.draftFromDate();
    const end = this.draftToDate();
    if (start && end && start > end) return DATE_ORDER_ERROR_MESSAGE;
    return '';
  }

  get canApplyCustomDateRange(): boolean {
    const start = this.draftFromDate();
    const end = this.draftToDate();
    return isValidDateKey(start) && isValidDateKey(end) && start <= end;
  }

  togglePeriodDropdown(): void {
    this.openPeriodDropdown.update((open) => !open);
    this.periodDropdownUsed.set(true);
    this.customDatePickerOpen.set(false);
  }

  selectPeriod(label: PeriodLabel): void {
    this.openPeriodDropdown.set(false);
    if (label === 'Custom Date Range') {
      this.draftFromDate.set(this.fromDate());
      this.draftToDate.set(this.toDate());
      this.customDatePickerOpen.set(true);
      return;
    }
    this.customDatePickerOpen.set(false);
    this.fromDate.set('');
    this.toDate.set('');
    this.period.set(label);
  }

  onFromDateChange(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.draftFromDate.set(event.target.value);
  }

  onToDateChange(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.draftToDate.set(event.target.value);
  }

  applyCustomDateRange(): void {
    if (!this.canApplyCustomDateRange) return;
    this.fromDate.set(this.draftFromDate());
    this.toDate.set(this.draftToDate());
    this.period.set('Custom Date Range');
    this.customDatePickerOpen.set(false);
  }

  cancelCustomDateRange(): void {
    this.draftFromDate.set(this.fromDate());
    this.draftToDate.set(this.toDate());
    this.customDatePickerOpen.set(false);
  }

  closePeriodControls(): void {
    this.openPeriodDropdown.set(false);
    this.customDatePickerOpen.set(false);
  }

  onNetworkOffline(): void {
    this.online.set(false);
  }

  onNetworkOnline(): void {
    this.online.set(true);
  }

  retryDashboardLoad(): void {
    this.retryCount.update((count) => count + 1);
  }

  // ---------- data ----------
  private readonly request = computed(() => {
    const period = this.period();
    const range = dateRangeForPeriod(period, this.fromDate(), this.toDate());
    return {
      period,
      range,
      apiPeriod: range ? apiPeriodForRange(range) : 'WEEK',
      online: this.online(),
      retryCount: this.retryCount(),
    } satisfies DashboardRequest & { retryCount: number };
  });

  private readonly state = toSignal(
    toObservable(this.request).pipe(
      switchMap((request) => {
        if (!request.range) {
          return of<DashboardState>({
            status: 'invalid-range',
            message: EMPTY_DATE_RANGE_MESSAGE,
          });
        }
        if (!request.online) return of<DashboardState>({ status: 'offline' });

        return concat(
          of<DashboardState>({ status: 'loading' }),
          this.api.getAdminDashboard(request.apiPeriod).pipe(
            switchMap((data) =>
              concat(
                of(this.toLoadedState(data, request)),
                timer(REFRESH_MS, REFRESH_MS).pipe(
                  switchMap(() =>
                    this.api.getAdminDashboard(request.apiPeriod).pipe(
                      map((updatedData) => this.toLoadedState(updatedData, request)),
                      catchError((error: unknown) =>
                        of(this.toErrorState(error, request.online)),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            catchError((error: unknown) =>
              of(this.toErrorState(error, request.online)),
            ),
          ),
        );
      }),
    ),
    { initialValue: { status: 'loading' } as DashboardState },
  );

  /** Read by the template as a plain property: `dashboardData?.logins?.total`. */
  get dashboardData(): AdminDashboardData | null {
    const state = this.state();
    return state.status === 'loaded' ? state.data : null;
  }

  get summaryData(): DashboardSummary | null {
    const state = this.state();
    return state.status === 'loaded' ? state.summary : null;
  }

  get dashboardStatus(): DashboardState['status'] {
    return this.state().status;
  }

  get dashboardStateMessage(): string {
    const state = this.state();
    if (state.status === 'error') return state.message;
    if (state.status === 'offline') return 'Network connection unavailable. Check your connection and try again.';
    if (state.status === 'invalid-range') return state.message;
    return 'Loading dashboard data...';
  }

  get dateFilterNotice(): string {
    const state = this.state();
    return state.status === 'loaded' ? (state.notice ?? '') : '';
  }

  get canRetryDashboardLoad(): boolean {
    const status = this.state().status;
    return status === 'error' || status === 'offline';
  }

  get summaryUnavailableMessage(): string {
    const state = this.state();
    return state.status === 'loaded' &&
      state.data &&
      (!state.summary.userDistribution ||
        state.summary.onlineUsers === null ||
        state.summary.averageLearningTime === null)
      ? SUMMARY_UNAVAILABLE_MESSAGE
      : '';
  }

  hasChartData(key: SeriesKey): boolean {
    return (this.dashboardData?.[key]?.values ?? []).some((value) => value > 0);
  }

  /** Growth badge ("+12%") next to a legend total; null when the API doesn't send one. */
  getChange(key: 'logins' | 'newSignups'): number | null {
    return (this.dashboardData?.[key] as SeriesWithChange | undefined)?.change ?? null;
  }

  formatChange(value: number | null): string {
    if (value === null || Number.isNaN(value)) return '';
    const rounded = Number.isInteger(value) ? value : Number(value.toFixed(1));
    return `${rounded > 0 ? '+' : ''}${rounded}%`;
  }

  // ---------- x axis: Apr 1, Apr 5, Apr 10 ... (not every label) ----------
  private readonly axisLabels = computed(() => {
    const data = this.dashboardData;
    const build = (series: DashboardSeries | undefined): AxisLabel[] => {
      const labels = series?.labels ?? [];
      const step = labels.length <= 8 ? 1 : Math.ceil(labels.length / 7);
      return labels
        .map((label, index) => ({ index, label, x: this.xAt(index, labels.length) }))
        .filter(({ index }) => step === 1 || index === 0 || ((index + 1) % step === 0 && index >= 3));
    };
    return {
      logins: build(data?.logins),
      newSignups: build(data?.newSignups),
      revenue: build(data?.revenue),
    };
  });

  getVisibleLabels(key: SeriesKey): AxisLabel[] {
    return this.axisLabels()[key];
  }

  // ---------- Login's & Sign up's chart (both lines share one y-axis) ----------
  private readonly loginScale = computed(() => {
    const data = this.dashboardData;
    const max = Math.max(0, ...(data?.logins?.values ?? []), ...(data?.newSignups?.values ?? []));
    return buildScale(max, true);
  });

  private readonly revenueScale = computed(() =>
    buildScale(Math.max(0, ...(this.dashboardData?.revenue?.values ?? [])), false),
  );

  get loginTicks(): number[] {
    return this.loginScale().ticks;
  }

  get revenueTicks(): number[] {
    return this.revenueScale().ticks;
  }

  getLoginY(value: number): number {
    return this.yAt(value, this.loginScale());
  }

  getRevenueY(value: number): number {
    return this.yAt(value, this.revenueScale());
  }

  private readonly charts = computed(() => {
    const data = this.dashboardData;
    const loginScale = this.loginScale();
    const revenueScale = this.revenueScale();
    const plot = (series: DashboardSeries | undefined, scale: AxisScale): Point[] =>
      (series?.values ?? []).map((value, index, all) => ({
        x: this.xAt(index, all.length),
        y: this.yAt(value, scale),
      }));

    const logins = plot(data?.logins, loginScale);
    const signups = plot(data?.newSignups, loginScale);
    const revenue = plot(data?.revenue, revenueScale);
    return {
      loginPath: linePath(logins),
      loginAreaPath: areaPath(logins),
      signupPath: linePath(signups),
      signupAreaPath: areaPath(signups),
      revenuePath: linePath(revenue),
      revenueAreaPath: areaPath(revenue),
    };
  });

  get loginPath(): string {
    return this.charts().loginPath;
  }
  get loginAreaPath(): string {
    return this.charts().loginAreaPath;
  }
  get signupPath(): string {
    return this.charts().signupPath;
  }
  get signupAreaPath(): string {
    return this.charts().signupAreaPath;
  }
  get revenuePath(): string {
    return this.charts().revenuePath;
  }
  get revenueAreaPath(): string {
    return this.charts().revenueAreaPath;
  }

  // ---------- user distribution donut ----------
  readonly roles: { key: RoleKey; label: string; bar: string }[] = [
    { key: 'admins', label: 'Admins', bar: 'bg-purple-500' },
    { key: 'instructors', label: 'Instructors', bar: 'bg-amber-400' },
    { key: 'learners', label: 'Learners', bar: 'bg-blue-500' },
  ];

  private readonly donut = computed(() => {
    const distribution = this.summaryData?.userDistribution;
    const all: { key: RoleKey; color: string; count: number }[] = [
      { key: 'admins', color: '#a96bfa', count: distribution?.admins ?? 0 },
      { key: 'instructors', color: '#ffcf5e', count: distribution?.instructors ?? 0 },
      { key: 'learners', color: '#7b8fe6', count: distribution?.learners ?? 0 },
    ];
    const entries = all.filter((entry) => entry.count > 0);

    const total = entries.reduce((sum, entry) => sum + entry.count, 0);
    let start = 0;
    const segments: DonutSegment[] = entries.map((entry, index) => {
      const sweep = (entry.count / total) * 360;
      const path = sectorPath(start, start + sweep, entries.length > 1);
      start += sweep;
      return { key: entry.key, color: entry.color, path, delay: `${220 + index * 100}ms` };
    });
    return { total, segments };
  });

  get hasUserDistribution(): boolean {
    return this.donut().total > 0;
  }

  get donutSegments(): DonutSegment[] {
    return this.donut().segments;
  }

  getRolePercentage(role: RoleKey): string {
    const distribution = this.summaryData?.userDistribution;
    const total = this.donut().total;
    if (!distribution || !total) return '—';

    const roles: RoleKey[] = ['admins', 'instructors', 'learners'];
    const percentages = roles.map((key) => {
      const exact = (distribution[key] / total) * 100;
      return { key, roundedDown: Math.floor(exact), remainder: exact - Math.floor(exact) };
    });
    const remaining = 100 - percentages.reduce((sum, item) => sum + item.roundedDown, 0);
    percentages
      .slice()
      .sort((left, right) => right.remainder - left.remainder)
      .slice(0, remaining)
      .forEach((item) => {
        const percentage = percentages.find((entry) => entry.key === item.key);
        if (percentage) percentage.roundedDown += 1;
      });
    return `${percentages.find((item) => item.key === role)?.roundedDown ?? 0}%`;
  }

  getRoleCount(role: RoleKey): string {
    const count = this.summaryData?.userDistribution?.[role];
    return count === undefined ? '—' : this.formatNumber(count);
  }

  // ---------- formatting ----------
  formatNumber(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('en', {
      notation: Math.abs(value) >= 10_000 ? 'compact' : 'standard',
      maximumFractionDigits: 1,
    }).format(value);
  }

  formatPercentage(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const rate = value;
    return `${Number.isInteger(rate) ? rate : rate.toFixed(1)}%`;
  }

  get hasCourseCompletionRate(): boolean {
    return this.summaryData?.courseCompletionRate !== null &&
      this.summaryData?.courseCompletionRate !== undefined;
  }

  get hasOnlineUserCount(): boolean {
    return this.summaryData?.onlineUsers !== null && this.summaryData?.onlineUsers !== undefined;
  }

  get hasAverageLearningTime(): boolean {
    return !!this.summaryData?.averageLearningTime;
  }

  getCourseCompletionDisplay(): string {
    return this.formatPercentage(this.summaryData?.courseCompletionRate);
  }

  getAverageLearningTimeDisplay(): string {
    return this.summaryData?.averageLearningTime || '—';
  }

  // ---------- helpers ----------
  private xAt(index: number, count: number): number {
    return count <= 1
      ? (PLOT_LEFT + PLOT_RIGHT) / 2
      : PLOT_LEFT + (index / (count - 1)) * (PLOT_RIGHT - PLOT_LEFT);
  }

  private yAt(value: number, scale: AxisScale): number {
    return PLOT_BOTTOM - (Math.min(value, scale.top) / scale.top) * (PLOT_BOTTOM - PLOT_TOP);
  }

  private toLoadedState(
    data: AdminDashboardData | null,
    request: DashboardRequest,
  ): DashboardState {
    const summary: DashboardSummary = {
      userDistribution: data?.userDistribution ?? null,
      courseCompletionRate: data?.courseCompletionRate ?? null,
      onlineUsers: data?.onlineUsers ?? null,
      averageLearningTime: data?.averageLearningTime ?? null,
    };

    if (
      request.period === 'Last 7 Days' ||
      request.period === 'Last 30 Days' ||
      request.period === 'Last Year' ||
      request.period === 'This Week' ||
      request.period === 'This Month'
    ) {
      return { status: 'loaded', data, summary };
    }
    if (!data || !request.range) return { status: 'loaded', data, summary };

    const logins = filterDailySeries(data.logins, request.range);
    const newSignups = filterDailySeries(data.newSignups, request.range);
    const revenue =
      data.revenue.labels.length === 0 && data.revenue.values.length === 0
        ? { labels: [], values: [], total: 0 }
        : filterDailySeries(data.revenue, request.range);
    if (!logins || !newSignups || !revenue) {
      return {
        status: 'loaded',
        data,
        summary,
        notice:
          `The dashboard API returned a ${data.period} report without daily records for this selection. ` +
          `Showing the available ${data.period} report.`,
      };
    }
    return {
      status: 'loaded',
      data: { ...data, logins, newSignups, revenue },
      summary: {
        userDistribution: null,
        courseCompletionRate: null,
        onlineUsers: null,
        averageLearningTime: null,
      },
    };
  }

  private toErrorState(error: unknown, online: boolean): DashboardState {
    if (!online) return { status: 'offline' };
    if (error instanceof HttpErrorResponse && error.status === 0) {
      return {
        status: 'error',
        message: 'Unable to connect to the Dashboard API. Please try again.',
      };
    }
    return {
      status: 'error',
      message: 'Dashboard data could not be loaded. Please try again.',
    };
  }
}