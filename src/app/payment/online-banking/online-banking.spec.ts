import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OnlineBanking } from './online-banking';

describe('OnlineBanking', () => {
  let component: OnlineBanking;
  let fixture: ComponentFixture<OnlineBanking>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OnlineBanking],
    }).compileComponents();

    fixture = TestBed.createComponent(OnlineBanking);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
