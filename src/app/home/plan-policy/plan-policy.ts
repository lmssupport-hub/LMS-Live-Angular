
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

type PolicySection = {
  heading: string;
  intro?: string;
  boldIntro?: string;
  points?: string[];
};

@Component({
  selector: 'app-plan-policy',
  standalone: true,
  
  templateUrl: './plan-policy.html',
})
export class PlanPolicy {
  readonly introduction =
    'At Vativa Designs and Development, our pricing is designed to be transparent, flexible, and aligned with the specific needs of each client. Since every project is unique, our pricing is customized based on the scope, complexity, and requirements of the work involved.';

  readonly sections: PolicySection[] = [
    {
      heading: 'Custom Pricing Approach',
      intro: 'All services are offered based on a project-specific pricing model.',
      boldIntro: 'Pricing depends on factors such as:',
      points: [
        'Type of service (e-learning content, LMS, digital support)',
        'Project complexity and duration',
        'Level of customization required',
        'A detailed proposal with scope, timelines, and cost breakdown will be shared before project initiation.',
      ],
    },
    {
      heading: 'Scope-Based Costing',
      points: [
        'Pricing is strictly aligned with the agreed project scope.',
        'Any additional requirements or changes beyond the scope may result in revised pricing.',
        'All changes will be communicated and approved before implementation.',
      ],
    },
    {
      heading: 'Payment Structure',
      intro: 'Payments are structured based on milestones or agreed timelines.',
      boldIntro: 'Typically, this may include:',
      points: [
        'An advance payment before project initiation',
        'Milestone-based payments during the project',
        'Final payment upon project completion',
        'Work will commence only after the initial payment is received.',
      ],
    },
    {
      heading: 'Additional Costs',
      boldIntro: 'Any services outside the agreed scope, including:',
      points: [
        'Additional revisions beyond the included limit',
        'New feature requests',
        'Content or design changes',
        'will be treated as additional work and charged separately.',
      ],
    },
    {
      heading: 'Third-Party Tools and Licensing',
      intro:
        'Costs related to third-party tools, platforms, or licenses (such as LMS subscriptions or authoring tools) are not included unless explicitly mentioned.',
      boldIntro: 'These costs will either be:',
      points: [
        'Borne directly by the client, or',
        'Included in the proposal if managed by Vativa',
      ],
    },
    {
      heading: 'Pricing Validity',
      points: [
        'All proposals and quotations are valid for a limited period, as mentioned in the proposal.',
        'Delays in confirmation may result in revised pricing based on updated scope or timelines.',
      ],
    },
    {
      heading: 'Transparency and Communication',
      points: [
        'We ensure clear communication of all costs upfront with no hidden charges.',
        'Any changes in pricing will always be discussed and approved before proceeding.',
      ],
    },
  ];
}
