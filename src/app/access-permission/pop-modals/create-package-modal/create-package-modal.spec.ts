import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CreatePackageModal } from './create-package-modal';

describe('CreatePackageModal', () => {
  let component: CreatePackageModal;
  let fixture: ComponentFixture<CreatePackageModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreatePackageModal],
    }).compileComponents();

    fixture = TestBed.createComponent(CreatePackageModal);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
