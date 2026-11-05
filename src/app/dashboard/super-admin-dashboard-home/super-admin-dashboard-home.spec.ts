import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SuperAdminDashboardHome } from './super-admin-dashboard-home';

describe('SuperAdminDashboardHome', () => {
  let component: SuperAdminDashboardHome;
  let fixture: ComponentFixture<SuperAdminDashboardHome>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SuperAdminDashboardHome],
    }).compileComponents();

    fixture = TestBed.createComponent(SuperAdminDashboardHome);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
