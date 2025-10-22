import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription, interval, Subject } from 'rxjs';
import { switchMap, startWith, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { GameStatusService } from '../game-status-service';
import { ApiService } from '../api.service';

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
  
  
  private expectedType = 'picture';

  constructor(
    private api: ApiService, 
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
      debounceTime(300), // Reduced from 1000ms to 300ms for faster saving
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
      switchMap(() => this.api.get<RoundDisplayData>(`/api/game/display-data`))
    ).subscribe(data => {
      
      if (!data.round || data.round.round_type !== this.expectedType) {
        console.log('No round or wrong type, redirecting to lobby');
        this.router.navigate(['/'], { replaceUrl: true }); 
        return;
      }
      
      const roundChanged = this.currentRound?.id !== data.round.id;

      // Only update if round actually changed
      if (roundChanged) {
        console.log('Picture round changed from', this.currentRound?.id, 'to', data.round.id);
        // Save all current answers immediately before switching rounds
        this.saveAllPendingAnswers();
        console.log('Clearing playerAnswers, current state:', this.playerAnswers);
        this.currentRound = data.round;
        this.questions = data.questions;
        this.playerAnswers = {}; // Clear answers when round changes
        console.log('playerAnswers cleared:', this.playerAnswers);
        if (this.currentRound) {
          this.loadPlayerAnswers();
        }
      } else if (!this.currentRound) {
        // First load
        console.log('First load of picture round', data.round.id);
        this.currentRound = data.round;
        this.questions = data.questions;
        this.playerAnswers = {}; // Clear answers on first load
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
    if (!this.currentRound || !this.playerName) return;

    console.log('Loading answers for picture round:', this.currentRound.id, 'player:', this.playerName);

    this.api.get<{ answers: { [key: string]: string } }>(
      `/api/answers/${this.playerName}/${this.currentRound.id}`
    ).subscribe({
      next: (data) => {
        console.log('Received answers from server:', data.answers);
        this.playerAnswers = {};
        Object.keys(data.answers).forEach(key => {
          const questionId = parseInt(key);
          this.playerAnswers[questionId] = data.answers[key];
        });
        console.log('playerAnswers after loading:', this.playerAnswers);
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

  saveAnswer(questionId: number, answerText: string) {
    if (!answerText.trim()) return;
    if (!this.currentRound) return;

    this.api.post(`/api/answers/submit`, {
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

  saveAllPendingAnswers() {
    if (!this.currentRound) return;

    console.log('Saving all pending answers before picture round change');
    // Save all current answers immediately
    Object.keys(this.playerAnswers).forEach(key => {
      const questionId = parseInt(key);
      const answer = this.playerAnswers[questionId];
      if (answer && answer.trim()) {
        this.saveAnswer(questionId, answer);
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
      return `${this.api.apiBaseUrl}${path}`;
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