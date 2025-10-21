import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Mc } from './mc';

describe('Mc', () => {
  let component: Mc;
  let fixture: ComponentFixture<Mc>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Mc]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Mc);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
