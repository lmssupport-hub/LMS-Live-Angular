import { ComponentFixture, TestBed } from '@angular/core/testing';

import { QuestionBank } from './question-bank';

describe('QuestionBank', () => {
  let component: QuestionBank;
  let fixture: ComponentFixture<QuestionBank>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QuestionBank],
    }).compileComponents();

    fixture = TestBed.createComponent(QuestionBank);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
