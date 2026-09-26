import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CourseManagement } from './course-management';

describe('CourseManagement', () => {
  let component: CourseManagement;
  let fixture: ComponentFixture<CourseManagement>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CourseManagement],
    }).compileComponents();

    fixture = TestBed.createComponent(CourseManagement);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
