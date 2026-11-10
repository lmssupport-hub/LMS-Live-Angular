import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { PermissionAction, PermissionRow, Role } from '../../services/role.service';

export interface PermissionToggleEvent {
  rowIndex: number;
  action: PermissionAction;
  categoryId?: string;
}

@Component({
  selector: 'app-role-permission',
  imports: [],
  templateUrl: './role-permission.html',
  styleUrl: './role-permission.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RolePermission {
  /** Breadcrumb trail — last segment is rendered as the active pill. */
  readonly breadcrumb = input<string[]>([
    'Content Management',
    'Staff List',
    'Create Role',
    'Role Permission',
  ]);

  readonly role = input<Role | null>(null);
  readonly permissions = input.required<PermissionRow[]>();
  /** Categories whose category switch (left menu) is ON. Independent of the row switches below. */
  readonly enabledCategories = input<ReadonlySet<string>>(new Set());
  readonly actions = input<PermissionAction[]>(['create', 'read', 'update', 'delete']);
  readonly isEditing = input(false);
  readonly isAdmin = input(true);
  readonly submitting = input(false);
  readonly canSave = input(false);
  readonly error = input<string | null>(null);

  readonly selectedCount = computed(() => {
    const withActions = new Set<string>();
    let count = 0;
    for (const row of this.permissions()) {
      if (Object.values(row.values).some(Boolean)) {
        count++;
        withActions.add(row.categoryId);
      }
    }
    // A category switched ON with every action OFF still counts (it shows the menu).
    for (const categoryId of this.enabledCategories()) {
      if (!withActions.has(categoryId)) count++;
    }
    return count;
  });

  /** Discard-confirmation popup shown when the Cancel button is clicked. */
  protected readonly confirmOpen = signal(false);

  isToggleOnlyCategory(categoryName: string): boolean {
    return categoryName === 'Authentication';
  }

  readonly togglePermission = output<PermissionToggleEvent>();
  readonly toggleCategory = output<string>();
  readonly save = output<void>();
  readonly cancel = output<void>();
  readonly search = output<string>();
  readonly navigateBreadcrumb = output<number>();

  /** True when the admin's package allows this action for the row's feature. */
  isAllowed(row: PermissionRow, action: PermissionAction): boolean {
    return !!row.allowed?.[action];
  }

  onToggle(rowIndex: number, action: PermissionAction): void {
    if (!this.isAdmin()) return;
    const row = this.permissions()[rowIndex];
    if (!row || !this.isAllowed(row, action)) return;
    this.togglePermission.emit({ rowIndex, action });
  }

  onToggleCategory(categoryId: string): void {
    if (!this.isAdmin()) return;
    this.toggleCategory.emit(categoryId);
  }

  /** The category switch is its own value (left menu); it does not depend on the row switches below it. */
  isCategoryOn(categoryId: string): boolean {
    return this.enabledCategories().has(categoryId);
  }

  protected requestCancel(): void {
    this.confirmOpen.set(true);
  }

  protected keepEditing(): void {
    this.confirmOpen.set(false);
  }

  protected confirmDiscard(): void {
    this.confirmOpen.set(false);
    this.cancel.emit();
  }
}