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

// Helper interface for padded grid items
interface GridItem {
  question: Question | null;
  isBlank: boolean;
}

@Component({
  selector: 'app-picture-round',
  standalone: true,
  imports: [CommonModule, TitleCasePipe, FormsModule],
  templateUrl: './picture-round.html',
  styleUrl: './picture-round.css'
})
export class PictureRound implements OnInit, OnDestroy {
  currentRound: RoundDisplayData['round'] = null;
  questions: Question[] = [];
  pollSubscription: Subscription = new Subscription();
  
  playerAnswers: { [questionId: number]: string } = {};
  playerName: string = '';
  
  private answerChanged$ = new Subject<{ questionId: number, answer: string }>();
  private answerSubscription: Subscription = new Subscription();
  
  private baseUrl = 'http://localhost:3000'; 
  private expectedType = 'picture';

  constructor(
    private http: HttpClient, 
    private router: Router,
    private gameStatusService: GameStatusService
  ) {}

  // Get main question text (shared across all images)
  get mainQuestionText(): string {
    return this.questions.length > 0 ? this.questions[0].question_text : '';
  }

  // Pad questions array to ensure even grid with minimum 2 columns
  get paddedQuestions(): GridItem[] {
    const items: GridItem[] = this.questions.map(q => ({
      question: q,
      isBlank: false
    }));

    // Only pad if we have an odd number of questions
    if (items.length % 2 === 1) {
      items.push({ question: null, isBlank: true });
    }

    return items;
  }

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
      
      if (!data.round || data.round.round_type !== this.expectedType) {
        console.log('No round or wrong type, redirecting to lobby');
        this.router.navigate(['/'], { replaceUrl: true }); 
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
      if (error.status === 0 || error.status === 404 || error.status === 500) {
        console.log('Server may have restarted or no game active, redirecting to lobby');
      }
      this.router.navigate(['/'], { replaceUrl: true });
    });
  }

  loadPlayerAnswers() {
    if (!this.currentRound) return;

    this.http.get<{ answers: Array<{ question_id: number, answer_text: string }> }>(
      `${this.baseUrl}/api/player/${this.playerName}/round/${this.currentRound.id}/answers`
    ).subscribe({
      next: (data) => {
        this.playerAnswers = {};
        data.answers.forEach(a => {
          this.playerAnswers[a.question_id] = a.answer_text;
        });
      },
      error: (err) => {
        console.error('Error loading answers:', err);
      }
    });
  }

  onAnswerChange(questionId: number) {
    this.answerChanged$.next({
      questionId: questionId,
      answer: this.playerAnswers[questionId] || ''
    });
  }

  saveAnswer(questionId: number, answer: string) {
    if (!this.currentRound) return;

    this.http.post(`${this.baseUrl}/api/player/answer`, {
      player_name: this.playerName,
      question_id: questionId,
      answer_text: answer
    }).subscribe({
      next: () => {
        console.log(`Answer saved for question ${questionId}`);
      },
      error: (err) => {
        console.error('Error saving answer:', err);
      }
    });
  }

  trackByItem(index: number, item: GridItem): string {
    return item.isBlank ? `blank-${index}` : `question-${item.question!.id}`;
  }

  trackByQuestionId(index: number, question: Question): number {
    return question.id;
  }

  getImageUrl(path: string | null): string {
    if (path) {
      return `${this.baseUrl}${path}`;
    }
    return '';
  }

  ngOnDestroy() {
    if (this.pollSubscription) {
      this.pollSubscription.unsubscribe();
    }
    if (this.answerSubscription) {
      this.answerSubscription.unsubscribe();
    }
  }
}