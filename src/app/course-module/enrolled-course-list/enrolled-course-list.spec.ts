import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EnrolledCourseList } from './enrolled-course-list';

describe('EnrolledCourseList', () => {
  let component: EnrolledCourseList;
  let fixture: ComponentFixture<EnrolledCourseList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EnrolledCourseList],
    }).compileComponents();

    fixture = TestBed.createComponent(EnrolledCourseList);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
