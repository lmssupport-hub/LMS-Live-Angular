import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CourseContentViewer } from './course-content-viewer';

describe('CourseContentViewer', () => {
  let component: CourseContentViewer;
  let fixture: ComponentFixture<CourseContentViewer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CourseContentViewer],
    }).compileComponents();

    fixture = TestBed.createComponent(CourseContentViewer);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
