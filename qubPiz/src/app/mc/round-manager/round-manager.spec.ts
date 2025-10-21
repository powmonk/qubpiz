import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RoundManager } from './round-manager';

describe('RoundManager', () => {
  let component: RoundManager;
  let fixture: ComponentFixture<RoundManager>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RoundManager]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RoundManager);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
