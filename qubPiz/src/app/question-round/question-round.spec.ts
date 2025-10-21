import { ComponentFixture, TestBed } from '@angular/core/testing';

import { QuestionRound } from './question-round';

describe('QuestionRound', () => {
  let component: QuestionRound;
  let fixture: ComponentFixture<QuestionRound>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QuestionRound]
    })
    .compileComponents();

    fixture = TestBed.createComponent(QuestionRound);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
