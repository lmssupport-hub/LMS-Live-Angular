
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { PackageService, PackageRecord } from '../../services/package.service';


type Plan = {
  id: number;
  name: string;
  price: number;
  description: string;
  features: string[];
  highlighted: boolean;
};

@Component({
  selector: 'app-plans',
  standalone: true,
    imports: [CommonModule],
  templateUrl: './plans.html',
})
export class Plans implements OnInit {
  private readonly packageService = inject(PackageService);

  selectedBilling: 'monthly' | 'yearly' = 'monthly';
  selectedPlan = '';
  plans: Plan[] = [];
  loading = false;
  errorMessage = '';

  ngOnInit(): void {
    this.loadPlans();
  }

  loadPlans(): void {
    this.loading = true;
    this.errorMessage = '';

    this.packageService.list({ page: 0, size: 100 }).subscribe({
      next: (response) => {
        console.log('API Packages:', response.content);
        this.plans = (response.content ?? [])
          .filter(
            (item) =>
              item.availablePackage === 'Price' &&
              item.showOnWebsite &&
              item.status === 'Active' &&
              item.billingCycle ===
                (this.selectedBilling === 'monthly' ? 'Monthly' : 'Yearly')
          )
          .map((item, index) => this.mapPackage(item, index));

        this.loading = false;
      },
      error: (error) => {
        console.error('Failed to load plans:', error);
        this.errorMessage = 'Unable to load plans. Please try again later.';
        this.loading = false;
      },
    });
  }

  private mapPackage(item: PackageRecord, index: number): Plan {
    const features = (item.permissions ?? [])
      .filter((category) => category.enabled)
      .flatMap((category) =>
        category.features
          .filter((feature) =>
            Object.values(feature.permissions).some(Boolean)
          )
          .map((feature) => feature.name)
      );

    return {
      id: item.id,
      name: item.name,
      price: item.price,
      description: item.description ?? '',
      features: [
        ...features,
        `User Limit: ${item.userLimit}`,
        `Storage Limit: ${item.storageLimit ?? 'Unlimited'}`,
      ],
      highlighted: index === 2,
    };
  }

  selectBilling(type: 'monthly' | 'yearly'): void {
    this.selectedBilling = type;
    this.selectedPlan = '';
    this.loadPlans();
  }

  buyPlan(plan: Plan): void {
    this.selectedPlan = plan.name;
  }
}
