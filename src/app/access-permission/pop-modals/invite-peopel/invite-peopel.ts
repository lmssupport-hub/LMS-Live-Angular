import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Role } from '../../../services/role.service';
 
@Component({
  selector: 'app-invite-peopel',
  imports: [ReactiveFormsModule],
  templateUrl: './invite-peopel.html',
  styleUrl: './invite-peopel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvitePeopel {
  readonly form = input.required<FormGroup>();
  readonly submitting = input(false);
  readonly error = input<string | null>(null);
 
  /** Active roles only - you shouldn't be able to invite someone into a
   *  role that's currently Inactive. Pass activeRoles(), not roles(). */
  readonly roles = input<Role[]>([]);
 
  readonly cancelled = output<void>();
  readonly submitted = output<void>();
  protected readonly roleDropdownOpen = signal(false);
 
  protected selectedRoleName(): string | null {
    const id = this.form().value.roleId as number | null;
    if (id == null) return null;
    return this.roles().find((r) => r.id === id)?.name ?? null;
  }
 
  protected toggleRoleDropdown(): void {
    this.roleDropdownOpen.update((open) => !open);
  }
 
  protected closeRoleDropdown(): void {
    this.roleDropdownOpen.set(false);
  }
 
  protected selectRole(roleId: number): void {
    const roleControl = this.form().controls['roleId'];
    roleControl.setValue(roleId);
    roleControl.markAsDirty();
    roleControl.markAsTouched();
    this.closeRoleDropdown();
  }
}
 