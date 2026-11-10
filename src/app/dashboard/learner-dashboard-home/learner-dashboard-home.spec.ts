import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LearnerDashboardHome } from './learner-dashboard-home';

describe('LearnerDashboardHome', () => {
  let component: LearnerDashboardHome;
  let fixture: ComponentFixture<LearnerDashboardHome>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LearnerDashboardHome],
    }).compileComponents();

    fixture = TestBed.createComponent(LearnerDashboardHome);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
