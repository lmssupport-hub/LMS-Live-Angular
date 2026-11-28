import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';


@Component({
  selector: 'app-contact-us',
  standalone: true,
    imports: [CommonModule, FormsModule],
  templateUrl: './contact-us.html'
})
export class ContactUs {

  contact = {
    name: '',
    location: '',
    phone: ''
  };

  submitted = false;

  onSubmit(form: NgForm): void {
    if (form.invalid) {
      form.control.markAllAsTouched();
      return;
    }

    console.log('Contact Details:', this.contact);

    this.submitted = true;

    form.resetForm();
  }
}