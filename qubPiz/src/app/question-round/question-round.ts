import { Component, OnInit, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription, interval, Subject } from 'rxjs';
import { switchMap, startWith, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { GameStatusService } from '../game-status-service';

interface Question {
  id: number;
  question_text: string;
  image_url: string | null;
  question_order: number;
}

interface RoundDisplayData {
  round: {
    id: number;
    name: string;
    round_type: string;
  } | null;
  questions: Question[];
}

@Component({
  selector: 'app-question-round',
  standalone: true,
  imports: [CommonModule, TitleCasePipe, FormsModule],
  templateUrl: './question-round.html',
  styleUrl: './question-round.css'
})
export class QuestionRound implements OnInit, OnDestroy {
  currentRound: RoundDisplayData['round'] = null;
  questions: Question[] = [];
  pollSubscription: Subscription = new Subscription();
  
  playerAnswers: { [questionId: number]: string } = {};
  playerName: string = '';
  
  private answerChanged$ = new Subject<{ questionId: number, answer: string }>();
  private answerSubscription: Subscription = new Subscription();
  
  private baseUrl = 'http://localhost:3000'; 

  constructor(
    private http: HttpClient, 
    private router: Router,
    private gameStatusService: GameStatusService
  ) {}

  ngOnInit() {
    this.playerName = this.gameStatusService.getCurrentPlayer() || '';
    
    if (!this.playerName) {
      this.router.navigate(['/lobby']);
      return;
    }

    this.startPolling();
    this.setupAutoSave();
  }

  setupAutoSave() {
    this.answerSubscription = this.answerChanged$.pipe(
      debounceTime(1000),
      distinctUntilChanged((prev, curr) => 
        prev.questionId === curr.questionId && prev.answer === curr.answer
      )
    ).subscribe(({ questionId, answer }) => {
      this.saveAnswer(questionId, answer);
    });
  }

  startPolling() {
  this.pollSubscription = interval(3000).pipe(
    startWith(0), 
    switchMap(() => this.http.get<RoundDisplayData>(`${this.baseUrl}/api/game/display-data`))
  ).subscribe(data => {
    
    if (!data.round || data.round.round_type === 'picture') {
       this.router.navigate(['/']);
       return;
    }
    
    const roundChanged = this.currentRound?.id !== data.round.id;
    
    // Only update if round actually changed
    if (roundChanged) {
      this.currentRound = data.round;
      this.questions = data.questions;
      if (this.currentRound) {
        this.loadPlayerAnswers();
      }
    } else if (!this.currentRound) {
      // First load
      this.currentRound = data.round;
      this.questions = data.questions;
      this.loadPlayerAnswers();
    }
    
  }, error => {
    console.error('Error fetching display data:', error);
    this.router.navigate(['/lobby']);
  });
}

  ngOnDestroy() {
    if (this.pollSubscription) {
      this.pollSubscription.unsubscribe();
    }
    if (this.answerSubscription) {
      this.answerSubscription.unsubscribe();
    }
  }
  
 loadPlayerAnswers() {
  if (!this.currentRound || !this.playerName) return;
  
  this.http.get<{ answers: { [key: string]: string } }>(
    `${this.baseUrl}/api/answers/${this.playerName}/${this.currentRound.id}`
  ).subscribe(data => {
    // Only update answers that aren't currently being edited
    Object.keys(data.answers).forEach(key => {
      const questionId = parseInt(key);
      if (!this.playerAnswers[questionId]) {
        this.playerAnswers[questionId] = data.answers[key];
      }
    });
  });
}  

  trackByQuestionId(index: number, question: Question): number {
    return question.id;
  }

  onAnswerChange(questionId: number) {
    const answer = this.playerAnswers[questionId] || '';
    this.answerChanged$.next({ questionId, answer });
  }
  
  saveAnswer(questionId: number, answerText: string) {
    if (!answerText.trim()) return;
    if (!this.currentRound) return;

    this.http.post(`${this.baseUrl}/api/answers/submit`, {
      player_name: this.playerName,
      question_id: questionId,
      round_id: this.currentRound.id,
      answer_text: answerText
    }).subscribe({
      next: () => {
        console.log(`Answer saved for question ${questionId}`);
      },
      error: (err) => {
        console.error('Error saving answer:', err);
      }
    });
  }
  
  getImageUrl(path: string | null): string {
    if (path) {
      return `${this.baseUrl}${path}`;
    }
    return '';
  }
}