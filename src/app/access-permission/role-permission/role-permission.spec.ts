import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RolePermission } from './role-permission';

describe('RolePermission', () => {
  let component: RolePermission;
  let fixture: ComponentFixture<RolePermission>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RolePermission],
    }).compileComponents();

    fixture = TestBed.createComponent(RolePermission);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
