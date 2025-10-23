import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription, interval, Subject } from 'rxjs';
import { switchMap, startWith, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { GameStatusService } from '../game-status-service';
import { ApiService } from '../api.service';
import { PlayerQuestion, RoundDisplayData, GridItem } from '../shared/types';

@Component({
  selector: 'app-round',
  standalone: true,
  imports: [CommonModule, TitleCasePipe, FormsModule],
  templateUrl: './round.html',
  styleUrl: './round.css'
})
export class RoundComponent implements OnInit, OnDestroy {
  roundType: 'picture' | 'question' = 'question';

  currentRound: RoundDisplayData['round'] = null;
  questions: PlayerQuestion[] = [];
  pollSubscription: Subscription = new Subscription();

  playerAnswers: { [questionId: number]: string } = {};
  playerName: string = '';

  private answerChanged$ = new Subject<{ questionId: number, answer: string }>();
  private answerSubscription: Subscription = new Subscription();

  constructor(
    private api: ApiService,
    private router: Router,
    private route: ActivatedRoute,
    private gameStatusService: GameStatusService
  ) {}

  // Get main question text (picture rounds - shared across all images)
  get mainQuestionText(): string {
    return this.questions.length > 0 ? this.questions[0].question_text : '';
  }

  // Pad questions array for even grid (picture rounds only)
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

  get isPictureRound(): boolean {
    return this.roundType === 'picture';
  }

  ngOnInit() {
    // Get roundType from route data
    this.roundType = this.route.snapshot.data['roundType'] || 'question';

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
      debounceTime(300),
      distinctUntilChanged((prev, curr) =>
        prev.questionId === curr.questionId && prev.answer === curr.answer
      )
    ).subscribe(({ questionId, answer }) => {
      this.saveAnswer(questionId, answer);
    });
  }

  backToLobby() {
    this.router.navigate(['/'], { replaceUrl: true });
  }

  startPolling() {
    // Poll every 2 seconds for responsive gameplay
    this.pollSubscription = interval(2000).pipe(
      startWith(0),
      switchMap(() => {
        // Get session from game status service
        const session = this.gameStatusService.getCurrentSession();
        const url = session
          ? `/api/game/display-data?session=${session}`
          : `/api/game/display-data`;
        return this.api.get<RoundDisplayData>(url);
      })
    ).subscribe(data => {

      // MARKING MODE: Check if marking mode is enabled via game status service
      this.gameStatusService.gameStatus$.subscribe(statusData => {
        if (statusData && statusData.marking_mode) {
          // Redirect to marking page
          this.router.navigate(['/marking'], { replaceUrl: true });
        }
      });

      // Check if round type matches expected type
      // Note: 'text' and 'question' are treated as the same type
      const isQuestionRound = data.round?.round_type === 'question' || data.round?.round_type === 'text';
      const isPictureRound = data.round?.round_type === 'picture' || data.round?.round_type === 'image';
      const expectedQuestion = this.roundType === 'question';
      const expectedPicture = this.roundType === 'picture';

      // If no round data, just wait - don't redirect
      // This prevents lobby flashing when MC switches rounds
      if (!data.round) {
        return;
      }

      // If wrong round type, redirect DIRECTLY to correct round page
      // This prevents lobby flashing when switching between round types
      if ((expectedQuestion && !isQuestionRound) || (expectedPicture && !isPictureRound)) {
        const correctPath = isPictureRound ? '/round/picture' : '/round/question';
        this.router.navigate([correctPath], { replaceUrl: true });
        return;
      }

      const roundChanged = this.currentRound?.id !== data.round.id;

      // Only update if round actually changed
      if (roundChanged) {
        // Save all current answers immediately before switching rounds
        this.saveAllPendingAnswers();
        this.currentRound = data.round;
        this.questions = data.questions;
        this.playerAnswers = {}; // Clear answers when round changes
        if (this.currentRound) {
          this.loadPlayerAnswers();
        }
      } else if (!this.currentRound) {
        // First load
        this.currentRound = data.round;
        this.questions = data.questions;
        this.playerAnswers = {}; // Clear answers on first load
        this.loadPlayerAnswers();
      }

    }, error => {
      console.error('Error fetching display data:', error);
      this.router.navigate(['/'], { replaceUrl: true });
    });
  }

  loadPlayerAnswers() {
    if (!this.currentRound || !this.playerName) return;

    const sessionCode = this.gameStatusService.getCurrentSession();
    const url = sessionCode
      ? `/api/answers/${this.playerName}/${this.currentRound.id}?session=${sessionCode}`
      : `/api/answers/${this.playerName}/${this.currentRound.id}`;

    this.api.get<{ answers: { [key: string]: string } }>(url).subscribe({
      next: (data) => {
        this.playerAnswers = {};
        Object.keys(data.answers).forEach(key => {
          const questionId = parseInt(key);
          this.playerAnswers[questionId] = data.answers[key];
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

  saveAnswer(questionId: number, answerText: string) {
    if (!answerText.trim()) return;
    if (!this.currentRound) return;

    const sessionCode = this.gameStatusService.getCurrentSession();
    const url = sessionCode
      ? `/api/answers/submit?session=${sessionCode}`
      : '/api/answers/submit';

    this.api.post(url, {
      player_name: this.playerName,
      question_id: questionId,
      round_id: this.currentRound.id,
      answer_text: answerText
    }).subscribe({
      next: () => {
        // Answer saved successfully
      },
      error: (err) => {
        console.error('Error saving answer:', err);
      }
    });
  }

  saveAllPendingAnswers() {
    if (!this.currentRound) return;

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

  trackByQuestionId(index: number, question: PlayerQuestion): number {
    return question.id;
  }

  getImageUrl(path: string | null): string {
    if (path) {
      const fullUrl = `${this.api.apiBaseUrl}${path}`;
      console.log('Image URL:', fullUrl); // Debug logging
      return fullUrl;
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
