import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InvitePeopel } from './invite-peopel';

describe('InvitePeopel', () => {
  let component: InvitePeopel;
  let fixture: ComponentFixture<InvitePeopel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InvitePeopel],
    }).compileComponents();

    fixture = TestBed.createComponent(InvitePeopel);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
