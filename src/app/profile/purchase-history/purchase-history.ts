import { CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';

import {
  PurchaseHistoryItem,
  PurchaseHistoryService,
  invoiceDownloadError,
} from '../../services/purchase-history.service';

/** Profile > Purchase History: the learner's paid courses, each with its details and invoice download. */
@Component({
  selector: 'app-purchase-history',
  imports: [CurrencyPipe, DatePipe],
  templateUrl: './purchase-history.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PurchaseHistory {
  private readonly api = inject(PurchaseHistoryService);
  private readonly destroyRef = inject(DestroyRef);

  readonly items = signal<readonly PurchaseHistoryItem[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal('');
  /** Id of the invoice being downloaded (disables its button, shows the spinner). */
  readonly downloadingId = signal<number | null>(null);
  readonly downloadError = signal('');

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set('');
    this.api
      .list()
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (items) => this.items.set(items),
        error: () => this.loadError.set('Could not load your purchases. Please try again.'),
      });
  }

  download(item: PurchaseHistoryItem): void {
    if (item.invoiceId === null || item.invoiceNumber === null || this.downloadingId() !== null) return;
    this.downloadError.set('');
    this.downloadingId.set(item.invoiceId);
    this.api
      .downloadInvoice(item.invoiceId, item.invoiceNumber)
      .pipe(
        finalize(() => this.downloadingId.set(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({ error: (err) => this.downloadError.set(invoiceDownloadError(err)) });
  }

  hasTax(item: PurchaseHistoryItem): boolean {
    return (item.taxAmount ?? 0) > 0;
  }
}