import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CreateRoleModal } from './create-role-modal';

describe('CreateRoleModal', () => {
  let component: CreateRoleModal;
  let fixture: ComponentFixture<CreateRoleModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreateRoleModal],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateRoleModal);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
