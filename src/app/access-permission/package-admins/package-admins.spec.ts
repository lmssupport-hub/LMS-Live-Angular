import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PackageAdmins } from './package-admins';

describe('PackageAdmins', () => {
  let component: PackageAdmins;
  let fixture: ComponentFixture<PackageAdmins>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PackageAdmins],
    }).compileComponents();

    fixture = TestBed.createComponent(PackageAdmins);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
