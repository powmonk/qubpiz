import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RoundDisplay } from './round-display';

describe('RoundDisplay', () => {
  let component: RoundDisplay;
  let fixture: ComponentFixture<RoundDisplay>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RoundDisplay]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RoundDisplay);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
