import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AdminDashboardHome } from './admin-dashboard-home';

describe('AdminDashboardHome', () => {
  let component: AdminDashboardHome;
  let fixture: ComponentFixture<AdminDashboardHome>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminDashboardHome],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminDashboardHome);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
