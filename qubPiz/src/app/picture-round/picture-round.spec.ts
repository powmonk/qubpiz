import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PictureRound } from './picture-round';

describe('PictureRound', () => {
  let component: PictureRound;
  let fixture: ComponentFixture<PictureRound>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PictureRound]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PictureRound);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
