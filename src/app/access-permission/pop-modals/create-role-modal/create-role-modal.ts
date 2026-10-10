import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
 
@Component({
  selector: 'app-create-role-modal',
  imports: [ReactiveFormsModule],
  templateUrl: './create-role-modal.html',
  styleUrl: './create-role-modal.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateRoleModal {
  readonly form = input.required<FormGroup>();
  readonly submitting = input(false);
  readonly editing = input(false);
  readonly error = input<string | null>(null);
 
  readonly cancelled = output<void>();
  readonly continued = output<void>();
 
  // Suggestions only (datalist); any unique name of at least 4 letters/spaces is accepted.
  readonly acceptedRoleNames = ['Admin', 'Instructor', 'Learner', 'Content Manager', 'Support Staff'];
}
 