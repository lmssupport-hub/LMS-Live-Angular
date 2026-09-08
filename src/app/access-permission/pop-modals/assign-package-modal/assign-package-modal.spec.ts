import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AssignPackageModal } from './assign-package-modal';

describe('AssignPackageModal', () => {
  let component: AssignPackageModal;
  let fixture: ComponentFixture<AssignPackageModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AssignPackageModal],
    }).compileComponents();

    fixture = TestBed.createComponent(AssignPackageModal);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
