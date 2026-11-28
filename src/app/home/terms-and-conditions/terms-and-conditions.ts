import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-terms-and-conditions',
  standalone: true,
  imports: [CommonModule, ],
  templateUrl: './terms-and-conditions.html',
})
export class TermsAndConditions {
  readonly terms = [
    'All content, materials, designs, and deliverables created by Vativa Designs and Development remain the intellectual property of the company unless otherwise agreed in writing, and clients are granted usage rights strictly based on the agreed project scope. Any unauthorized reproduction, distribution, or modification is not permitted.',

    'Clients are responsible for providing accurate and complete information, reviewing and approving deliverables within agreed timelines, and ensuring that any content shared does not violate third-party rights. Delays in communication or approvals may impact project delivery timelines.',

    'All services are provided based on agreed pricing and payment terms, and any delays in payment may result in project delays or suspension. Any additional work beyond the agreed scope may incur extra charges. The project scope will be defined prior to initiation, and any changes requested later may affect timelines and costs.',

    'Both parties agree to maintain the confidentiality of all sensitive and proprietary information shared during the course of the project unless disclosure is required by law.',

    'Vativa Designs and Development will not be liable for any indirect or consequential damages or losses arising from the use or inability to use our services. While we ensure quality and accuracy, the final responsibility for usage lies with the client.',

    'Our services may include the use of third-party tools and platforms, and we are not responsible for issues arising from such external systems beyond our control.',

    'We reserve the right to suspend or terminate services in cases of violation of terms or non-payment, and clients may also terminate services as per mutually agreed conditions. These terms may be updated from time to time, and continued use of our website or services indicates acceptance of any changes.',

    'By using our services, you acknowledge that you have read, understood, and agree to the Terms and Conditions of Vativa Designs and Development.',
  ];
}