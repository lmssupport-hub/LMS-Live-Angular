import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MultimediaUpload } from './multimedia-upload';

describe('MultimediaUpload', () => {
  let component: MultimediaUpload;
  let fixture: ComponentFixture<MultimediaUpload>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MultimediaUpload],
    }).compileComponents();

    fixture = TestBed.createComponent(MultimediaUpload);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
