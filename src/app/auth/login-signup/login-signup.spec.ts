import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LoginSignup } from './login-signup';

describe('LoginSignup', () => {
  let component: LoginSignup;
  let fixture: ComponentFixture<LoginSignup>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginSignup],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginSignup);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
