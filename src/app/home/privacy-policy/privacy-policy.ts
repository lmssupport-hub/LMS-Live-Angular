
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-privacy-policy',
  standalone: true,
  imports: [CommonModule,],
  templateUrl: './privacy-policy.html',
})
export class PrivacyPolicy {
  readonly sections = [
    {
      heading: 'Information We Collect',
      points: [
        'We may collect basic client details such as name, email address, phone number, and company name.',
        'This information is collected only for communication and project-related purposes.',
      ],
    },
    {
      heading: 'Use of Information',
      points: [
        'Client email IDs and phone numbers are used only for communication, approvals, and project coordination.',
        'We do not use client information for marketing or share it with external parties without consent.',
      ],
    },
    {
      heading: 'Handling of Credentials and Sensitive Information',
      points: [
        'Any credentials shared by the client are securely stored and handled with strict confidentiality.',
        'Access is given only to authorized team members involved in the project.',
        'All team members handling such data are verified through ID proof and are bound by Non-Disclosure Agreements (NDAs).',
        'Clients are informed about who has access to their information when required.',
      ],
    },
    {
      heading: 'Data Security',
      points: [
        'We implement appropriate measures to protect client data from unauthorized access, misuse, or disclosure.',
        'Access to sensitive information is restricted and monitored within the team.',
      ],
    },
    {
      heading: 'Data Sharing',
      points: [
        'We do not sell, rent, or share client data with third parties.',
        'Data may only be shared when required for project execution and strictly with trusted and authorized individuals.',
      ],
    },
    {
      heading: 'Data Retention',
      points: [
        'Client data is retained only for the duration necessary to complete the project and for record-keeping purposes.',
        'Sensitive data such as credentials can be removed upon client request after project completion.',
      ],
    },
    {
      heading: 'Client Responsibility',
      points: [
        'Clients are responsible for ensuring that the information and credentials shared with us are accurate and authorized for use.',
      ],
    },
    {
      heading: 'Updates to This Policy',
      points: [
        'This Privacy Policy may be updated from time to time to reflect changes in our practices.',
        'Continued use of our services indicates acceptance of the updated policy.',
      ],
    },
    {
      heading: 'Contact',
      points: [
        'For any questions regarding this Privacy Policy, clients can reach out to us through official communication channels.',
      ],
    },
  ];
}
