import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { AuthService } from '../../services/auth';

/** Home page of a LEARNER. The other learner menus (Course Management, ...) come from the learner's role. */
@Component({
  selector: 'app-learner-dashboard-home',
  imports: [],
  templateUrl: './learner-dashboard-home.html',
  styleUrl: './learner-dashboard-home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LearnerDashboardHome {
  protected readonly displayName = inject(AuthService).displayName;
}
