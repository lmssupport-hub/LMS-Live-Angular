import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
 
import { CreateRoleModal } from '../pop-modals/create-role-modal/create-role-modal';
import { buildInviteForm, buildRoleForm } from '../pop-modals/forms/role-form';
import { InvitePeopel } from '../pop-modals/invite-peopel/invite-peopel';
import { RolePermission } from '../role-permission/role-permission';
 
import {
  Category,
  FeatureCatalogEntry,
  PermissionAction,
  PermissionRow,
  Role,
  RoleRequest,
  RoleService,
  getApiErrorMessage,
  getApiFieldErrors,
} from '../../services/role.service';
 
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
  readonly features = signal<FeatureCatalogEntry[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
 
  readonly query = signal('');
  readonly roleFilterOpen = signal(false);
  readonly roleFilterField = signal<RoleFilterField | null>(null);
  readonly roleFilterValue = signal<string | null>(null);
 
  readonly dialog = signal<DialogKind>(null);
  readonly permissionStep = signal(false);
  readonly selectedRole = signal<Role | null>(null);
  readonly permissions = signal<PermissionRow[]>([]);
  readonly editingId = signal<number | null>(null);
 
  readonly submitting = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly success = signal<string | null>(null);
 
  readonly roleForm: FormGroup = buildRoleForm(this.fb, () => this.roles().map((r) => r.name));
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
 
  private readonly hasSelectedPermission = computed(() =>
    this.permissions().some((row) => this.actions.some((action) => row.values[action])),
  );
 
  readonly canCreateRole = computed(() => this.hasSelectedPermission() && !this.submitting());
  readonly canUpdateRole = computed(() => this.hasSelectedPermission() && !this.submitting());
 
  ngOnInit(): void {
    this.loadRoles();
    this.loadActiveRoles();
    this.loadFeatures();
  }
 
  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.roleFilterOpen()) {
      this.roleFilterOpen.set(false);
    }
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
        /* non-fatal — the "Available Roles" dropdown just stays empty */
      },
    });
  }
 
  private loadFeatures(): void {
    this.roleService.getFeatureCatalog().subscribe({
      next: (features) => this.features.set(features),
      error: () => {
        this.actionError.set(
          'Unable to load the permission list. Creating or editing role permissions may not work until this loads.',
        );
      },
    });
  }
 
  toggleRoleFilter(): void {
    this.roleFilterOpen.update((open) => !open);
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
 
  openInvite(): void {
    // CHANGED: reset with roleId (was category) to match buildInviteForm.
    this.inviteForm.reset({ email: '', roleId: null });
    this.actionError.set(null);
    this.dialog.set('invite');
  }
 
  openRole(): void {
    this.roleForm.reset({ roleName: '' });
    this.editingId.set(null);
    this.actionError.set(null);
    this.dialog.set('role');
  }
 
  closeDialog(): void {
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
 
    // CHANGED: payload is now { email, roleId } - matches InviteDto.SendRequest.
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
    this.enterPermissionScreen(role);
  }
 
  selectAvailableRole(value: string): void {
    if (!value) return;
    const role = this.activeRoles().find((r) => String(r.id) === value);
    if (role) {
      this.enterPermissionScreen(role);
    }
  }
 
  private enterPermissionScreen(role: Role): void {
    this.selectedRole.set(role);
    this.editingId.set(role.id);
    this.permissions.set(this.buildPermissionRows(this.features(), role.permissions));
    this.actionError.set(null);
    this.permissionStep.set(true);
  }
 
  deleteRole(role: Role): void {
    if (!this.isAdmin()) return;
    const confirmed = window.confirm(`Delete role "${role.name}"? This cannot be undone.`);
    if (!confirmed) return;
    this.roleService.delete(role.id).subscribe({
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
        const saved = savedByFeature.get(feature.id);
        const isEnrollment = category.categoryName === 'Enrollment';
        rows.push({
          categoryId: category.categoryId,
          categoryName: category.categoryName,
          category: isFirstInCategory ? category.categoryName : null,
          featureId: feature.id,
          name: feature.name,
          values: {
            create: saved?.permissions.create ?? false,
            read: isEnrollment ? false : saved?.permissions.read ?? false,
            update: isEnrollment ? false : saved?.permissions.update ?? false,
            delete: isEnrollment ? false : saved?.permissions.delete ?? false,
          },
        });
        isFirstInCategory = false;
      }
    }
    return rows;
  }
 
  private toRoleCategoryPermissions(rows: PermissionRow[]): Category[] {
    const byCategory = new Map<string, Category>();
    for (const row of rows) {
      if (!ALLOWED_PERMISSION_CATEGORIES.has(row.categoryName)) continue;
      const isEnrollment = row.categoryName === 'Enrollment';
      const permissions = {
        create: row.values.create,
        read: isEnrollment ? false : row.values.read,
        update: isEnrollment ? false : row.values.update,
        delete: isEnrollment ? false : row.values.delete,
      };
      const hasAny = this.actions.some((action) => permissions[action]);
      if (!hasAny) continue;
      let category = byCategory.get(row.categoryId);
      if (!category) {
        category = { id: row.categoryId, name: row.categoryName, enabled: true, features: [] };
        byCategory.set(row.categoryId, category);
      }
      category.features.push({
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
      if (!row || !ALLOWED_PERMISSION_CATEGORIES.has(row.categoryName)) return rows;
      if (row.categoryName === 'Enrollment' && action !== 'create') return rows;
      next[rowIndex] = { ...row, values: { ...row.values, [action]: !row.values[action] } };
      return next;
    });
  }
 
  nextToPermissions(): void {
    if (this.roleForm.invalid) {
      this.roleForm.markAllAsTouched();
      return;
    }
    this.selectedRole.set(null);
    this.editingId.set(null);
    this.permissions.set(this.buildPermissionRows(this.features()));
    this.actionError.set(null);
    this.dialog.set(null);
    this.permissionStep.set(true);
  }
 
  cancelPermissions(): void {
    this.permissionStep.set(false);
    this.selectedRole.set(null);
    this.editingId.set(null);
    this.permissions.set([]);
    this.actionError.set(null);
  }
 
  saveRole(): void {
    const id = this.editingId();
    const name = id !== null ? this.selectedRole()?.name : (this.roleForm.value.roleName as string);
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
 