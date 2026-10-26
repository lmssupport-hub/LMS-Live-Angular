import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CoursePreview } from './course-preview';

describe('CoursePreview', () => {
  let component: CoursePreview;
  let fixture: ComponentFixture<CoursePreview>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CoursePreview],
    }).compileComponents();

    fixture = TestBed.createComponent(CoursePreview);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
