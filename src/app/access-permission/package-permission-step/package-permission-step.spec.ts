import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PackagePermissionStep } from './package-permission-step';

describe('PackagePermissionStep', () => {
  let component: PackagePermissionStep;
  let fixture: ComponentFixture<PackagePermissionStep>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PackagePermissionStep],
    }).compileComponents();

    fixture = TestBed.createComponent(PackagePermissionStep);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
