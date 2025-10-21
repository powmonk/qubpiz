import { ComponentFixture, TestBed } from '@angular/core/testing';

import { QuestionManager } from './question-manager';

describe('QuestionManager', () => {
  let component: QuestionManager;
  let fixture: ComponentFixture<QuestionManager>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QuestionManager]
    })
    .compileComponents();

    fixture = TestBed.createComponent(QuestionManager);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
