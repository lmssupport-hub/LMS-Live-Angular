import { Component, DestroyRef, HostListener, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';

import { CreateRoleModal } from '../pop-modals/create-role-modal/create-role-modal';
import { buildInviteForm, buildRoleForm } from '../pop-modals/forms/role-form';
import { InvitePeopel } from '../pop-modals/invite-peopel/invite-peopel';
import { RolePermission } from '../role-permission/role-permission';

import {
  Category,
  FeatureCatalogEntry,
  Permission,
  PermissionAction,
  PermissionRow,
  Role,
  RolePageState,
  RoleRequest,
  RoleService,
  RoleUser,
  getApiErrorMessage,
  getApiFieldErrors,
} from '../../services/role.service';
import { TOGGLE_ONLY_CATEGORY_IDS } from '../../services/package.service';

type RoleFilterField = 'Role Name' | 'Status';
type DialogKind = 'invite' | 'role' | null;

const ALLOWED_PERMISSION_CATEGORIES = new Set([
  'Authentication',
  'Content Management',
  'Course Management',
  'Enrollment',
]);

@Component({
  selector: 'app-role-management',
  imports: [InvitePeopel, CreateRoleModal, RolePermission],
  templateUrl: './role-management.html',
  styleUrl: './role-management.css',
})
export class RoleManagement implements OnInit {
  private readonly roleService = inject(RoleService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);

  readonly actions: PermissionAction[] = ['create', 'read', 'update', 'delete'];
  readonly roleFilterFields: RoleFilterField[] = ['Role Name', 'Status'];

  readonly isAdmin = signal(true);

  readonly roles = signal<Role[]>([]);
  readonly activeRoles = signal<Role[]>([]);
  /** Package-filtered catalog of the logged-in admin (what the admin is allowed to hand out). */
  readonly features = signal<FeatureCatalogEntry[]>([]);
  readonly featuresLoaded = signal(false);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);

  readonly query = signal('');
  readonly roleFilterOpen = signal(false);
  readonly roleFilterDropdownUsed = signal(false);
  readonly roleFilterField = signal<RoleFilterField | null>(null);
  readonly roleFilterValue = signal<string | null>(null);

  // "View users" screen of one role
  readonly viewingRoleUsers = signal<Role | null>(null);
  readonly roleUsers = signal<RoleUser[]>([]);
  readonly roleUsersLoading = signal(false);
  readonly roleUsersError = signal<string | null>(null);

  readonly dialog = signal<DialogKind>(null);
  readonly permissionStep = signal(false);
  readonly selectedRole = signal<Role | null>(null);
  readonly permissions = signal<PermissionRow[]>([]);
  /**
   * Category ids whose category switch (left menu, e.g. "Course Management") is ON for this role.
   * Independent of the create / read / update / delete switches of the rows below the category.
   */
  readonly enabledCategories = signal<ReadonlySet<string>>(new Set());
  readonly editingId = signal<number | null>(null);

  readonly submitting = signal(false);
  readonly deletingRoleId = signal<number | null>(null);
  /** Role waiting for delete confirmation (drives the delete popup). */
  readonly deleteTarget = signal<Role | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly success = signal<string | null>(null);

  readonly roleForm: FormGroup = buildRoleForm(this.fb, () =>
    this.roles()
      .filter((role) => role.id !== this.editingId())
      .map((role) => role.name),
  );
  readonly inviteForm: FormGroup = buildInviteForm(this.fb);

  readonly filteredRoles = computed(() => {
    const q = this.query().trim().toLowerCase();
    const field = this.roleFilterField();
    const value = this.roleFilterValue();
    return this.roles().filter((role) => {
      const matchesQuery = !q || role.name.toLowerCase().includes(q);
      const matchesFilter =
        !field || !value ? true : field === 'Role Name' ? role.name === value : role.status === value;
      return matchesQuery && matchesFilter;
    });
  });

  readonly roleFilterValues = computed(() => {
    const field = this.roleFilterField();
    if (field === 'Role Name') {
      return Array.from(new Set(this.roles().map((r) => r.name))).sort();
    }
    if (field === 'Status') {
      return ['Active', 'Inactive'];
    }
    return [];
  });

  private readonly hasSelectedPermission = computed(
    () =>
      this.enabledCategories().size > 0 ||
      this.permissions().some((row) => this.actions.some((action) => row.values[action])),
  );

  private readonly initialPermissions = signal('');

  readonly canCreateRole = computed(() => this.hasSelectedPermission() && !this.submitting());

  readonly canUpdateRole = computed(
    () =>
      this.hasSelectedPermission() &&
      this.permissionSnapshot(this.permissions(), this.enabledCategories()) !== this.initialPermissions() &&
      !this.submitting(),
  );

  private readonly pageState = inject(RolePageState);

  /** The Role Permission screen (only exists while permissionStep() is true). */
  private readonly rolePermissionView = viewChild(RolePermission);

  constructor() {
    // Tell the header breadcrumb which view is showing (these views share one URL).
    effect(() => {
      this.pageState.step.set(
        this.permissionStep() ? 'permission' : this.viewingRoleUsers() ? 'assign' : null,
      );
    });

    // Let the header breadcrumb's "Role List" crumb take us back to the list.
    const unregister = this.pageState.registerBackToList(() => this.backToList());

    inject(DestroyRef).onDestroy(() => {
      unregister();
      this.pageState.step.set(null);
    });
  }

  /** Breadcrumb "Role List" click (Permission / Assign List -> Role List). */
  private backToList(): void {
    if (this.permissionStep()) {
      // Unsaved changes possible: reuse the existing "Discard changes?" popup.
      // "Discard changes" -> RolePermission emits (cancel) -> cancelPermissions() -> list.
      this.rolePermissionView()?.requestCancel();
      return;
    }
    if (this.viewingRoleUsers()) {
      this.closeRoleUsers();
    }
  }

  ngOnInit(): void {
    this.loadRoles();
    this.loadActiveRoles();
    this.loadFeatures();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.roleFilterOpen.set(false);
  }

  manageCourses(): void {
    this.router.navigateByUrl('/courses');
  }

  loadRoles(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.roleService.getAll().subscribe({
      next: (roles) => {
        this.roles.set(roles);
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(getApiErrorMessage(err, 'Unable to load roles. Please try again.'));
        this.loading.set(false);
      },
    });
  }

  private loadActiveRoles(): void {
    this.roleService.getActive().subscribe({
      next: (roles) => this.activeRoles.set(roles),
      error: () => {
        /* Non-fatal: the invite dialog remains available without role options. */
      },
    });
  }

  /** Loads ONLY the features/actions the logged-in admin's package allows. */
  private loadFeatures(): void {
    this.featuresLoaded.set(false);
    this.roleService.getFeatureCatalog().subscribe({
      next: (features) => {
        this.features.set(features);
        this.featuresLoaded.set(true);
      },
      error: () => {
        this.actionError.set(
          'Unable to load the permission list. Creating or editing role permissions may not work until this loads.',
        );
      },
    });
  }

  toggleRoleFilter(): void {
    this.roleFilterOpen.update((open) => !open);
    this.roleFilterDropdownUsed.set(true);
  }

  selectRoleFilterField(field: RoleFilterField): void {
    this.roleFilterField.set(field);
    this.roleFilterValue.set(null);
  }

  selectRoleFilterValue(value: string): void {
    this.roleFilterValue.set(value);
    this.roleFilterOpen.set(false);
  }

  clearRoleFilter(): void {
    this.roleFilterField.set(null);
    this.roleFilterValue.set(null);
    this.roleFilterOpen.set(false);
  }

  openInvite(role?: Role): void {
    this.inviteForm.reset({ email: '', roleId: role?.id ?? null });
    this.actionError.set(null);
    this.dialog.set('invite');
  }

  /** "View users" icon: opens the users list of this role and loads it from the server. */
  openRoleUsers(role: Role): void {
    this.viewingRoleUsers.set(role);
    this.roleUsers.set([]);
    this.roleUsersError.set(null);
    this.roleUsersLoading.set(true);
    this.roleService
      .getUsers(role.id)
      .pipe(finalize(() => this.roleUsersLoading.set(false)))
      .subscribe({
        next: (users) => this.roleUsers.set(users),
        error: (err) =>
          this.roleUsersError.set(getApiErrorMessage(err, 'Unable to load users. Please try again.')),
      });
  }

  closeRoleUsers(): void {
    this.viewingRoleUsers.set(null);
    this.roleUsers.set([]);
    this.roleUsersError.set(null);
  }

  openRole(role?: Role): void {
    this.editingId.set(role?.id ?? null);
    this.selectedRole.set(role ?? null);
    this.roleForm.reset({ roleName: role?.name ?? '' });
    this.actionError.set(null);
    this.dialog.set('role');
  }

  closeDialog(): void {
    if (this.dialog() === 'role') {
      this.roleForm.reset({ roleName: '' });
      this.editingId.set(null);
      this.selectedRole.set(null);
    }
    this.dialog.set(null);
    this.actionError.set(null);
  }

  sendInvite(): void {
    if (this.inviteForm.invalid) {
      this.inviteForm.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.actionError.set(null);
    const { email, roleId } = this.inviteForm.getRawValue();
    this.roleService.invite({ email, roleId: roleId as number }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.dialog.set(null);
        this.flashSuccess('Invitation sent.');
      },
      error: (err) => {
        this.submitting.set(false);
        this.actionError.set(getApiErrorMessage(err, 'Unable to send the invite. Please try again.'));
      },
    });
  }

  openRoleDetails(role: Role): void {
    this.openRole(role);
  }

  /** Delete icon click: opens the confirmation popup. */
  requestDelete(role: Role): void {
    if (!this.isAdmin() || this.deletingRoleId() !== null) return;
    this.deleteTarget.set(role);
  }

  cancelDelete(): void {
    this.deleteTarget.set(null);
  }

  confirmDelete(): void {
    const role = this.deleteTarget();
    this.deleteTarget.set(null);
    if (role) this.deleteRole(role);
  }

  private deleteRole(role: Role): void {
    if (!this.isAdmin() || this.deletingRoleId() !== null) return;
    this.deletingRoleId.set(role.id);
    this.roleService
      .delete(role.id)
      .pipe(finalize(() => this.deletingRoleId.set(null)))
      .subscribe({
        next: () => {
          this.roles.update((list) => list.filter((r) => r.id !== role.id));
          this.activeRoles.update((list) => list.filter((r) => r.id !== role.id));
          this.flashSuccess(`"${role.name}" was deleted.`);
        },
        error: (err) => {
          this.actionError.set(getApiErrorMessage(err, 'Unable to delete this role.'));
        },
      });
  }

  assignedUserCount(role: Role): number {
    return role.assignedUsers ?? 0;
  }

  relativeLastActive(role: Role): string {
    return this.relativeTime(role.updatedAt);
  }

  private relativeTime(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '—';
    const diffMs = Date.now() - then;
    const minutes = Math.round(diffMs / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.round(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.round(months / 12)}y ago`;
  }

  /**
   * Builds the permission rows from the PACKAGE-FILTERED catalog.
   * - catalog feature.permissions = what the package allows -> row.allowed
   * - features with no allowed action are skipped (not shown at all)
   * - previously saved role values are clipped to what the package still allows
   */
  private buildPermissionRows(catalog: FeatureCatalogEntry[], existing?: Category[]): PermissionRow[] {
    const savedByFeature = new Map<string, Category['features'][number]>();
    for (const category of existing ?? []) {
      for (const feature of category.features) {
        savedByFeature.set(feature.id, feature);
      }
    }

    const rows: PermissionRow[] = [];
    for (const category of catalog) {
      if (!ALLOWED_PERMISSION_CATEGORIES.has(category.categoryName)) continue;

      let isFirstInCategory = true;
      for (const feature of category.features) {
        const allowed: Permission = {
          create: !!feature.permissions?.create,
          read: !!feature.permissions?.read,
          update: !!feature.permissions?.update,
          delete: !!feature.permissions?.delete,
        };
        if (!this.actions.some((action) => allowed[action])) continue;

        const saved = savedByFeature.get(feature.id);
        rows.push({
          categoryId: category.categoryId,
          categoryName: category.categoryName,
          category: isFirstInCategory ? category.categoryName : null,
          featureId: feature.id,
          name: feature.name,
          allowed,
          values: {
            create: !!(saved?.permissions.create && allowed.create),
            read: !!(saved?.permissions.read && allowed.read),
            update: !!(saved?.permissions.update && allowed.update),
            delete: !!(saved?.permissions.delete && allowed.delete),
          },
        });
        isFirstInCategory = false;
      }
    }
    return rows;
  }

  /** Comparable snapshot of everything the admin can change on the Role Permission screen. */
  private permissionSnapshot(rows: PermissionRow[], enabled: ReadonlySet<string>): string {
    return JSON.stringify({ rows, enabled: Array.from(enabled).sort() });
  }

  private toRoleCategoryPermissions(rows: PermissionRow[]): Category[] {
    const enabledIds = this.enabledCategories();
    const byCategory = new Map<string, Category>();
    const categoryOf = (row: PermissionRow): Category => {
      let category = byCategory.get(row.categoryId);
      if (!category) {
        category = {
          id: row.categoryId,
          name: row.categoryName,
          // The category switch (left menu) is saved as its own value, not derived from the actions.
          enabled: enabledIds.has(row.categoryId),
          features: [],
        };
        byCategory.set(row.categoryId, category);
      }
      return category;
    };

    for (const row of rows) {
      if (!ALLOWED_PERMISSION_CATEGORIES.has(row.categoryName)) continue;
      // Never send an action the package does not allow (backend re-checks too).
      const permissions: Permission = {
        create: row.values.create && row.allowed.create,
        read: row.values.read && row.allowed.read,
        update: row.values.update && row.allowed.update,
        delete: row.values.delete && row.allowed.delete,
      };
      const hasAny = this.actions.some((action) => permissions[action]);
      if (!hasAny) {
        // Category switched ON with every action OFF: still saved, so the menu shows for the role.
        if (enabledIds.has(row.categoryId)) categoryOf(row);
        continue;
      }
      categoryOf(row).features.push({
        id: row.featureId,
        name: row.name,
        permissions,
      });
    }
    return Array.from(byCategory.values());
  }

  togglePermission(rowIndex: number, action: PermissionAction): void {
    if (!this.isAdmin()) return;

    this.permissions.update((rows) => {
      const next = rows.slice();
      const row = next[rowIndex];

      if (!row || !ALLOWED_PERMISSION_CATEGORIES.has(row.categoryName) || !row.allowed[action]) {
        return rows;
      }

      next[rowIndex] = {
        ...row,
        values: {
          ...row.values,
          [action]: !row.values[action],
        },
      };

      return next;
    });
  }

  /**
   * Category switch. For a normal category (Course Management ...) it ONLY decides whether the left menu
   * is shown - the create / read / update / delete switches below it are left untouched.
   * Authentication has no create / read / update / delete meaning, so its flags follow the switch.
   */
  toggleCategory(categoryId: string): void {
    if (!this.isAdmin()) return;
    if (!this.permissions().some((row) => row.categoryId === categoryId)) return;

    const turnOn = !this.enabledCategories().has(categoryId);
    this.enabledCategories.update((current) => {
      const next = new Set(current);
      if (turnOn) next.add(categoryId);
      else next.delete(categoryId);
      return next;
    });

    if (!TOGGLE_ONLY_CATEGORY_IDS.has(categoryId)) return;

    this.permissions.update((rows) =>
      rows.map((row) => {
        if (row.categoryId !== categoryId) return row;
        const values: Permission = { create: false, read: false, update: false, delete: false };
        for (const action of this.actions) {
          values[action] = row.allowed[action] ? turnOn : false;
        }
        return { ...row, values };
      }),
    );
  }

  nextToPermissions(): void {
    if (this.roleForm.invalid) {
      this.roleForm.markAllAsTouched();
      return;
    }
    const editingRole = this.editingId() === null ? null : this.selectedRole();
    if (this.editingId() !== null && !editingRole) {
      this.actionError.set('The role could not be loaded. Please start again.');
      return;
    }
    if (!this.featuresLoaded()) {
      this.actionError.set('Permissions are still loading. Please try again in a moment.');
      this.loadFeatures();
      return;
    }

    const rows = this.buildPermissionRows(this.features(), editingRole?.permissions);

    // Package has nothing enabled (no package / inactive / expired) -> stay on the modal and explain.
    if (rows.length === 0) {
      this.actionError.set('No features are enabled in your package. Please contact the app owner.');
      return;
    }

    // Category switches ON in the saved role (only categories this package still offers).
    const offeredCategoryIds = new Set(rows.map((row) => row.categoryId));
    const enabled: ReadonlySet<string> = new Set(
      (editingRole?.permissions ?? [])
        .filter((category) => category.enabled && offeredCategoryIds.has(category.id))
        .map((category) => category.id),
    );

    this.permissions.set(rows);
    this.enabledCategories.set(enabled);
    this.initialPermissions.set(this.permissionSnapshot(rows, enabled));
    this.actionError.set(null);
    this.dialog.set(null);
    this.permissionStep.set(true);
  }

  cancelPermissions(): void {
    this.permissionStep.set(false);
    this.selectedRole.set(null);
    this.editingId.set(null);
    this.permissions.set([]);
    this.enabledCategories.set(new Set());
    this.roleForm.reset({ roleName: '' });
    this.actionError.set(null);
  }

  saveRole(): void {
    const id = this.editingId();
    const name = String(this.roleForm.getRawValue().roleName ?? '').trim();
    if (!name) {
      this.actionError.set('Role name is missing. Please start again.');
      return;
    }

    const request: RoleRequest = {
      name,
      description: id !== null ? this.selectedRole()?.description : undefined,
      permissions: this.toRoleCategoryPermissions(this.permissions()),
    };

    this.submitting.set(true);
    this.actionError.set(null);

    const save$ = id !== null ? this.roleService.update(id, request) : this.roleService.create(request);

    save$.subscribe({
      next: (saved) => {
        this.submitting.set(false);
        this.roles.update((list) => this.upsert(list, saved));
        if (saved.status === 'Active') {
          this.activeRoles.update((list) => this.upsert(list, saved));
        } else {
          this.activeRoles.update((list) => list.filter((r) => r.id !== saved.id));
        }
        this.flashSuccess(id !== null ? 'Role updated.' : 'Role created.');
        this.cancelPermissions();
      },
      error: (err) => {
        this.submitting.set(false);
        const fieldErrors = getApiFieldErrors(err);
        this.actionError.set(
          fieldErrors?.['name'] ?? getApiErrorMessage(err, 'Unable to save this role. Please try again.'),
        );
      },
    });
  }

  private upsert(list: Role[], saved: Role): Role[] {
    const exists = list.some((r) => r.id === saved.id);
    return exists ? list.map((r) => (r.id === saved.id ? saved : r)) : [...list, saved];
  }

  private flashSuccess(message: string): void {
    this.success.set(message);
    setTimeout(() => this.success.set(null), 3000);
  }

  readonly pageSize = 10;
  readonly currentPage = signal(1);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredRoles().length / this.pageSize)));
  readonly visiblePage = computed(() => Math.min(this.currentPage(), this.totalPages()));
  readonly paginatedRoles = computed(() => {
    const roles = this.filteredRoles();
    const startIndex = (this.visiblePage() - 1) * this.pageSize;
    return roles.slice(startIndex, startIndex + this.pageSize);
  });
  readonly endItem = computed(() => Math.min(this.visiblePage() * this.pageSize, this.filteredRoles().length));

  nextPage(): void {
    if (this.visiblePage() < this.totalPages()) {
      this.currentPage.set(this.visiblePage() + 1);
    }
  }

  previousPage(): void {
    if (this.visiblePage() > 1) {
      this.currentPage.set(this.visiblePage() - 1);
    }
  }
}