import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OrganizeSections } from './organize-sections';

describe('OrganizeSections', () => {
  let component: OrganizeSections;
  let fixture: ComponentFixture<OrganizeSections>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrganizeSections],
    }).compileComponents();

    fixture = TestBed.createComponent(OrganizeSections);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
