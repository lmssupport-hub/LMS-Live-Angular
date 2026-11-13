import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CoursePayment } from './course-payment';

describe('CoursePayment', () => {
  let component: CoursePayment;
  let fixture: ComponentFixture<CoursePayment>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CoursePayment],
    }).compileComponents();

    fixture = TestBed.createComponent(CoursePayment);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
