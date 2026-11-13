import { ComponentFixture, TestBed } from '@angular/core/testing';

import { QuizAttempt } from './quiz-attempt';

describe('QuizAttempt', () => {
  let component: QuizAttempt;
  let fixture: ComponentFixture<QuizAttempt>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QuizAttempt],
    }).compileComponents();

    fixture = TestBed.createComponent(QuizAttempt);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
