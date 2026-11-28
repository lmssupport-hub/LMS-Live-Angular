
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-refund-cancellation',
  standalone: true,
  imports: [CommonModule,],
  templateUrl: './refund-cancellation.html',
})
export class RefundCancellation {
  readonly sections = [
    {
      heading: 'Project Cancellation',
      points: [
        'Clients may request cancellation of a project by providing written communication.',
        'If the project is cancelled after initiation, charges will apply for the work completed up to that stage, including planning, design, and development efforts.',
        'Advance payments made are non-refundable once the project has started, as resources are allocated and work begins immediately.',
        'In cases where the project is delayed or put on hold for an extended period by the client, Vativa reserves the right to reassess timelines, scope, and pricing upon restart.',
      ],
    },
    {
      heading: 'Refund Policy',
      points: [
        'Refunds are not applicable for completed work, approved deliverables, or achieved milestones.',
        'If a project is discontinued midway, any refund request will be reviewed based on the percentage of work completed, resources utilized, and effort invested.',
        'No refunds will be issued for delays caused by lack of communication, delayed approvals, or incomplete inputs from the client.',
      ],
    },
    {
      heading: 'Revisions Policy',
      points: [
        'Each project includes up to 3 revisions within the originally agreed scope to ensure quality and alignment.',
        'Revisions refer to minor changes, content updates, or design adjustments that do not alter the core structure or concept.',
        'Any revisions beyond the included limit will be treated as additional requests and will incur extra charges.',
        'Major changes, including content restructuring, redesign, or new feature additions, will be considered scope changes and priced separately.',
      ],
    },
    {
      heading: 'Payment Terms',
      points: [
        'Payments must be made as per the agreed schedule or milestone plan.',
        'Delayed payments may result in temporary suspension of work or delayed delivery timelines.',
        'Final deliverables may be withheld until full payment is received.',
      ],
    },
    {
      heading: 'Delays and Client Responsibility',
      points: [
        'Clients are expected to provide timely inputs, feedback, and approvals to ensure smooth project execution.',
        'Any delays from the client’s side may lead to adjustments in timelines and delivery schedules.',
        'Vativa is not responsible for delays caused due to incomplete information or late communication.',
      ],
    },
    {
      heading: 'Final Delivery and Approval',
      points: [
        'Once the final deliverables are shared, clients are expected to review and provide approval within the agreed timeframe.',
        'Upon final approval, the project will be considered completed, and no further refunds or major revisions will be applicable.',
      ],
    },
    {
      heading: 'Exceptional Cases',
      points: [
        'Any exceptions to this policy will be handled on a case-by-case basis, at the sole discretion of Vativa Designs and Development, ensuring fairness to both parties.',
      ],
    },
  ];
}
