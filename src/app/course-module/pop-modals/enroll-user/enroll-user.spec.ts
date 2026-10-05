import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EnrollUser } from './enroll-user';

describe('EnrollUser', () => {
  let component: EnrollUser;
  let fixture: ComponentFixture<EnrollUser>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EnrollUser],
    }).compileComponents();

    fixture = TestBed.createComponent(EnrollUser);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
