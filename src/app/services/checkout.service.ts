import { Injectable, signal } from '@angular/core';

export type CheckoutCurrency = 'USD' | 'EUR' | 'INR';

/**
 * Display-only exchange rates (base currency of every package price = USD).
 * The server always charges the price stored in the database; these rates only
 * change what the page shows. Replace with a real rates API before going live.
 */
export const CURRENCY_RATES: Record<CheckoutCurrency, number> = {
  USD: 1,
  EUR: 0.92,
  INR: 83,
};

/**
 * Tiny in-memory hand-over between Subscription and Payment pages.
 * Only the package ID and display currency travel here - the Payment page
 * re-loads the package from the server, so nothing here can change the price.
 */
@Injectable({ providedIn: 'root' })
export class CheckoutService {
  readonly packageId = signal<number | null>(null);
  readonly currency = signal<CheckoutCurrency>('USD');

  start(packageId: number): void {
    this.packageId.set(packageId);
  }

  clear(): void {
    this.packageId.set(null);
  }

  convert(price: number, currency: CheckoutCurrency = this.currency()): number {
    return Math.round(price * CURRENCY_RATES[currency] * 100) / 100;
  }
}