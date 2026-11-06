import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { MyBilling, MySubscription, PackageRecord, PackageService } from '../../services/package.service';
import { CheckoutCurrency, CheckoutService, CURRENCY_RATES } from '../../services/checkout.service';

/** Adjust to match app.routes.ts. */
const ADMIN_HOME_PATH = '/admin-dashboard';
const PAYMENT_PATH = '/admin-dashboard/subscription/payment';

const serverActionErrorMessage =
  'Unable to complete the requested action due to a server error. Please try again later.';
const isServerError = (status?: number): boolean => status === 0 || (status ?? 0) >= 500;

type BillingPeriod = 'Monthly' | 'Yearly';
type DetailsTab = 'subscription' | 'billing';

/**
 * Subscription & Billing page (company admin).
 * Shows ONLY packages the Super Admin published: Active + "Price" + "Show on website".
 * The backend already filters for ADMIN users; the filter here is a second safety net.
 *
 * "Manage Details" popup shows the admin's CURRENT plan (name, start date, due date)
 * and the billing details they entered when they subscribed.
 */
@Component({
  selector: 'app-subscription',
  imports: [CurrencyPipe],
  templateUrl: './subscription.html',
  styleUrl: './subscription.css',
})
export class Subscription implements OnInit {
  private readonly packagesApi = inject(PackageService);
  private readonly checkout = inject(CheckoutService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  protected readonly actionMessage = signal('');

  protected readonly packages = signal<PackageRecord[]>([]);
  protected readonly billingCycle = signal<BillingPeriod>('Monthly');
  protected readonly currency = this.checkout.currency;

  // Details popup
  protected readonly detailsOpen = signal(false);
  protected readonly detailsTab = signal<DetailsTab>('subscription');
  protected readonly selectedPackage = signal<PackageRecord | null>(null);

  // Manage Details data: the admin's current subscription + saved billing details
  protected readonly mySubscription = signal<MySubscription | null>(null);
  protected readonly myBilling = signal<MyBilling | null>(null);

  /** One-line billing address: "street, city, state, postal code, country". */
  protected readonly billingAddress = computed(() => {
    const b = this.myBilling();
    if (!b?.address) return '';
    return [b.address, b.city, b.state, b.postalCode, b.country].filter((part) => !!part).join(', ');
  });

  /** Plans shown on the page: published, Active, paid, and matching the Monthly / Yearly toggle. */
  protected readonly visiblePackages = computed(() =>
    this.packages()
      .filter((p) => p.showOnWebsite && p.status === 'Active' && p.availablePackage === 'Price')
      .filter((p) => p.billingCycle === this.billingCycle())
      .sort((a, b) => a.price - b.price));

  /** The plan with the most features gets the "Popular Plan" badge (only when there is a choice). */
  private readonly popularId = computed(() => {
    const plans = this.visiblePackages();
    if (plans.length < 2) return null;
    return plans.reduce((best, p) => (this.featureCount(p) > this.featureCount(best) ? p : best)).id;
  });

  ngOnInit(): void {
    this.load();
    this.loadAccountDetails();
    this.flashIfReturningFromPayment();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set('');
    this.packagesApi
      .list({ size: 100 })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (result) => this.packages.set(result.content),
        error: (error) =>
          this.loadError.set(
            error?.status === 403
              ? 'You do not have permission to view this page.'
              : isServerError(error?.status)
                ? serverActionErrorMessage
                : 'Plans could not be loaded. Please try again.',
          ),
      });
  }

  /**
   * Current plan dates + saved billing details for the Manage Details popup.
   * A failure just leaves the popup on "Not available"; it must not break the plans page.
   */
  private loadAccountDetails(): void {
    this.packagesApi.getMySubscription().subscribe({
      next: (value) => this.mySubscription.set(value),
      error: () => this.mySubscription.set(null),
    });
    this.packagesApi.getMyBilling().subscribe({
      next: (value) => this.myBilling.set(value),
      error: () => this.myBilling.set(null),
    });
  }

  // ---- Toggles -----------------------------------------------------------

  protected setBillingCycle(cycle: BillingPeriod): void {
    this.billingCycle.set(cycle);
  }

  protected setCurrency(value: string): void {
    if (value in CURRENCY_RATES) {
      this.currency.set(value as CheckoutCurrency);
    }
  }

  protected convertedPrice(price: number): number {
    return this.checkout.convert(price);
  }

  // ---- Plan card helpers ---------------------------------------------------------

  protected isPopular(plan: PackageRecord): boolean {
    return this.popularId() === plan.id;
  }

  /** Bullet list on a plan card: limits + every feature that has at least one action enabled. */
  protected featuresFor(plan: PackageRecord): string[] {
    const list: string[] = [`${plan.userLimit} user${plan.userLimit === 1 ? '' : 's'}`, `${this.packageStorageLimit(plan)} storage`];
    for (const category of plan.permissions ?? []) {
      for (const feature of category.features ?? []) {
        if (Object.values(feature.permissions ?? {}).some(Boolean)) {
          list.push(feature.name);
        }
      }
    }
    return list;
  }

  private featureCount(plan: PackageRecord): number {
    return (plan.permissions ?? []).reduce(
      (total, c) => total + (c.features ?? []).filter((f) => Object.values(f.permissions ?? {}).some(Boolean)).length,
      0,
    );
  }

  protected packageStorageLimit(plan: PackageRecord): string {
    return plan.storageLimit == null ? 'Unlimited' : `${plan.storageLimit} GB`;
  }

  // ---- Manage Details formatting ----------------------------------------------------

  /** "06 Nov 2026", or "Not available" when there is no date. */
  protected formatDate(value: string | null | undefined): string {
    if (!value) return 'Not available';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? 'Not available'
      : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /** True when the current plan's due date has passed (shown in red). */
  protected isPlanExpired(): boolean {
    const expiresAt = this.mySubscription()?.expiresAt;
    return !!expiresAt && new Date(expiresAt).getTime() <= Date.now();
  }

  // ---- Details popup -----------------------------------------------------------

  protected openPackageDetails(plan: PackageRecord): void {
    this.selectedPackage.set(plan);
    this.detailsTab.set('subscription');
    this.detailsOpen.set(true);
  }

  /** "Manage Details" button: current subscription / billing info (no plan selected). */
  protected openManageDetails(): void {
    this.selectedPackage.set(null);
    this.detailsTab.set('subscription');
    this.detailsOpen.set(true);
    // Refresh every time, so a plan bought a moment ago always shows.
    this.loadAccountDetails();
  }

  protected openDetails(tab: DetailsTab): void {
    this.detailsTab.set(tab);
  }

  protected closeDetails(): void {
    this.detailsOpen.set(false);
  }

  // ---- Buy ---------------------------------------------------------------------

  /** "Buy Plan": only the plan ID is handed over; the Payment page re-loads it from the server. */
  protected selectPlan(plan: PackageRecord): void {
    this.checkout.start(plan.id);
    void this.router.navigate([PAYMENT_PATH]);
  }

  protected goBack(): void {
    void this.router.navigate([ADMIN_HOME_PATH]);
  }

  /** The Payment page navigates back with { state: { purchased: true } } after a successful purchase. */
  private flashIfReturningFromPayment(): void {
    const state = this.router.getCurrentNavigation()?.extras.state
      ?? (history.state as { purchased?: boolean; planName?: string } | undefined);
    if (state?.purchased) {
      this.actionMessage.set(
        state.planName ? `${state.planName} package purchased and assigned to your account.` : 'Package purchased successfully.',
      );
      history.replaceState({ ...history.state, purchased: undefined, planName: undefined }, '');
      setTimeout(() => this.actionMessage.set(''), 5000);
    }
  }
}