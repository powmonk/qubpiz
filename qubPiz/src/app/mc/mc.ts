import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RoundManager } from './round-manager/round-manager';
import { QuestionManager } from './question-manager/question-manager';
import { GameStatusService } from '../game-status-service';
import { ApiService } from '../api.service';
import { Subscription } from 'rxjs';

interface Quiz {
  id: number;
  quiz_name: string;
  quiz_date: string;
  status: string;
  created_at: string;
  current_round_id: number | null; // Confirmed property exists
}

interface Round {
  id: number;
  game_session_id: number;
  name: string;
  round_type: string;
  round_order: number;
  created_at: string;
}

@Component({
  selector: 'app-mc',
  standalone: true,
  imports: [CommonModule, FormsModule, RoundManager, QuestionManager],
  templateUrl: './mc.html',
  styleUrl: './mc.css'
})

export class Mc implements OnInit, OnDestroy {
  currentQuiz: Quiz | null = null;
  allQuizzes: Quiz[] = [];
  selectedRound: Round | null = null;

  showNewQuizForm: boolean = false;
  showQuizList: boolean = false;
  newQuizName: string = '';
  newQuizDate: string = new Date().toISOString().split('T')[0];

  // NEW: Property to hold player list
  players: string[] = [];
  markingMode: boolean = false;
  markingResults: Array<{player: string, score: number, possible: number, markedBy: string}> = [];
  showResults: boolean = false;

  private gameStatusSubscription?: Subscription;

  constructor(
    private api: ApiService,
    private gameStatusService: GameStatusService
  ) {}

  handleDisplayStateChanged() {
    this.loadCurrentQuiz();
    this.loadPlayers(); // Good to reload player list too
  }

  ngOnInit() {
    this.loadCurrentQuiz();
    this.loadAllQuizzes();
    this.loadPlayers();

    // Subscribe to game status updates from the service instead of polling directly
    this.gameStatusSubscription = this.gameStatusService.gameStatus$.subscribe(data => {
      if (!data) return;

      // Update marking mode from game status
      this.markingMode = data.marking_mode;

      // Load players when game is active
      if (data.status === 'active' || data.status === 'closed') {
        this.loadPlayers();
      }
    });
  }

  loadCurrentQuiz() {
    this.api.get<{quiz: Quiz | null}>('/api/quiz/current')
      .subscribe(data => {
        this.currentQuiz = data.quiz;
      });
  }

  loadAllQuizzes() {
    this.api.get<{quizzes: Quiz[]}>('/api/quizzes')
      .subscribe(data => {
        this.allQuizzes = data.quizzes;
      });
  }

  createQuiz() {
    if (!this.newQuizName.trim()) {
      return;
    }

    this.api.post('/api/quiz/create', {
      quiz_name: this.newQuizName,
      quiz_date: this.newQuizDate
    }).subscribe(() => {
      this.loadCurrentQuiz();
      this.loadAllQuizzes();
      this.newQuizName = '';
      this.showNewQuizForm = false;
      this.selectedRound = null;
    });
  }

  selectQuiz(quizId: number) {
    this.api.post(`/api/quiz/select/${quizId}`, {})
      .subscribe(() => {
        this.loadCurrentQuiz();
        this.showQuizList = false;
        this.selectedRound = null;
      });
  }

  deleteQuiz(quizId: number, event: Event) {
    event.stopPropagation();
    this.api.delete(`/api/quiz/${quizId}`)
      .subscribe(() => {
        this.loadCurrentQuiz();
        this.loadAllQuizzes();
        this.selectedRound = null;
      });
  }
  // NEW METHOD: Load players (from server)
  loadPlayers() {
    this.api.get<{players: string[]}>('/api/players')
      .subscribe({
        next: (data) => {
          this.players = data.players;
        },
        error: (err) => {
          // Keep players empty if API call fails
          this.players = []; 
        }
      });
  }

  // NEW METHOD: Remove individual player
  removePlayer(playerName: string) {
    this.api.delete<{players: string[]}>(`/api/player/remove/${playerName}`)
      .subscribe({
        next: (data) => {
          this.players = data.players;
          console.log(`${playerName} removed.`);
        },
        error: (err) => {
          console.error('Error removing player', err);
        }
      });
  }

  // NEW METHOD: Clear all players
  resetGame() {
    this.api.post('/api/reset', {})
      .subscribe({
        next: (data: any) => {
          this.players = data.players;
          console.log('All players cleared.');
        },
        error: (err) => {
          console.error('Error resetting players', err);
        }
      });
  }

  // Update toggleGameStatus to also reload players and use the updated logic
  toggleGameStatus() {
    if (!this.currentQuiz) {
      return;
    }

    this.api.post<{quiz: Quiz}>('/api/game/toggle-status', {})
      .subscribe({
        next: (data) => {
          this.currentQuiz = data.quiz;
          this.loadPlayers();
        },
        error: (err) => {
          console.error('Error toggling game status', err);
        }
      });
  }
  
  onRoundSelected(round: Round) {
    this.selectedRound = round;
  }

  // Toggle between game mode and marking mode
  toggleGameAndMarking() {
    if (!this.markingMode) {
      // Ending game and starting marking
      this.api.post('/api/marking/trigger-all-rounds', {})
        .subscribe({
          next: (data: any) => {
            console.log('Rounds triggered:', data);
            // Then enable marking mode
            this.api.post('/api/marking/toggle-mode', {})
              .subscribe({
                next: (modeData: any) => {
                  this.markingMode = modeData.marking_mode;
                  console.log('Marking mode enabled');
                },
                error: (err) => {
                  console.error('Error enabling marking mode', err);
                }
              });
          },
          error: (err) => {
            console.error('Error triggering rounds', err);
          }
        });
    } else {
      // Resume game (disable marking mode)
      this.api.post('/api/marking/toggle-mode', {})
        .subscribe({
          next: (data: any) => {
            this.markingMode = data.marking_mode;
            console.log('Game resumed');
          },
          error: (err) => {
            console.error('Error toggling marking mode', err);
          }
        });
    }
  }

  // Marking-related methods
  viewMarkingResults() {
    this.api.get<{results: any[]}>('/api/marking/results')
      .subscribe({
        next: (data) => {
          if (data.results.length === 0) {
            this.markingResults = [];
            this.showResults = true;
            return;
          }

          // Group results by player and calculate totals, track marker
          const playerScores: {[player: string]: {total: number, possible: number, markedBy: string}} = {};

          data.results.forEach(result => {
            if (!playerScores[result.markee_name]) {
              playerScores[result.markee_name] = {total: 0, possible: 0, markedBy: result.marker_name};
            }
            playerScores[result.markee_name].possible += 1;
            if (result.score !== null) {
              playerScores[result.markee_name].total += parseFloat(result.score);
            }
          });

          // Convert to array and sort by score
          this.markingResults = Object.entries(playerScores)
            .map(([player, scores]) => ({
              player: player,
              score: scores.total,
              possible: scores.possible,
              markedBy: scores.markedBy
            }))
            .sort((a, b) => b.score - a.score);

          this.showResults = true;
          console.log('Detailed results:', data.results);
        },
        error: (err) => {
          console.error('Error loading marking results', err);
        }
      });
  }

  ngOnDestroy() {
    if (this.gameStatusSubscription) {
      this.gameStatusSubscription.unsubscribe();
    }
  }
}