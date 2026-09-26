import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CreateCourseModal } from './create-course-modal';

describe('CreateCourseModal', () => {
  let component: CreateCourseModal;
  let fixture: ComponentFixture<CreateCourseModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreateCourseModal],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateCourseModal);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
