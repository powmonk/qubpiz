import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RoundManager } from './round-manager/round-manager';
import { QuestionManager } from './question-manager/question-manager';
import { GameStatusService } from '../game-status-service';
import { ApiService } from '../api.service';
import { UrlBuilderService } from '../url-builder.service';
import { Subscription, interval } from 'rxjs';
import { switchMap, startWith } from 'rxjs/operators';
import { Quiz, Round, GameSession } from '../shared/types';

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
  archivedQuizzes: Quiz[] = [];
  selectedRound: Round | null = null;

  showNewQuizForm: boolean = false;
  showQuizList: boolean = false;
  showArchivedQuizzes: boolean = false;
  newQuizName: string = '';
  newQuizDate: string = new Date().toISOString().split('T')[0];

  // NEW: Property to hold player list
  players: string[] = [];
  markingMode: boolean = false;
  markingResults: Array<{player: string, score: number, possible: number, markedBy: string}> = [];

  // NEW: Session management properties
  activeSessions: GameSession[] = [];
  showSessionManagement: boolean = false;
  currentSessionCode: string | null = null; // The session MC is currently managing
  ownerId: string = ''; // UUID identifying this MC
  viewMode: 'session-lobby' | 'session-control' = 'session-lobby';
  mySessions: GameSession[] = [];
  selectedSession: GameSession | null = null;
  currentRoundId: number | null = null; // Track current round from game status

  // Authentication properties
  isLoggedIn: boolean = false;
  showRegisterForm: boolean = false;
  loginUsername: string = '';
  loginPassword: string = '';
  confirmPassword: string = '';
  currentUser: { id: number; username: string } | null = null;
  loginError: string = '';

  private gameStatusSubscription?: Subscription;
  private markingResultsSubscription?: Subscription;
  private readonly OWNER_ID_KEY = 'qubpiz_mc_owner_id';
  private readonly USER_KEY = 'qubpiz_mc_user';

  constructor(
    private api: ApiService,
    private gameStatusService: GameStatusService,
    private urlBuilder: UrlBuilderService
  ) {
    // Generate or retrieve MC owner ID
    this.ownerId = this.getOrCreateOwnerId();
  }

  private getOrCreateOwnerId(): string {
    if (typeof localStorage !== 'undefined') {
      let ownerId = localStorage.getItem(this.OWNER_ID_KEY);
      if (!ownerId) {
        // Generate UUID v4
        ownerId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
        localStorage.setItem(this.OWNER_ID_KEY, ownerId);
      }
      return ownerId;
    }
    return 'temp-owner-id';
  }

  handleDisplayStateChanged() {
    // For sessions, reload quiz data from the session
    if (this.currentSessionCode && this.selectedSession) {
      this.api.get<{quiz: Quiz}>(`/api/quiz/${this.selectedSession.quiz_id}`)
        .subscribe({
          next: (data) => {
            this.currentQuiz = data.quiz;
          },
          error: (err) => {
            console.error('Error reloading quiz', err);
          }
        });
      this.loadPlayersForSession();
    } else {
      // OLD SYSTEM: Fallback for backward compatibility
      this.loadCurrentQuiz();
      this.loadPlayers();
    }
  }

  ngOnInit() {
    // Check if user is already logged in
    this.checkLoginStatus();

    // Only load data if logged in
    if (this.isLoggedIn) {
      // Load MC's sessions and quizzes
      this.loadMySessions();
      this.loadAllQuizzes();
    }

    // Subscribe to game status updates from the service instead of polling directly
    this.gameStatusSubscription = this.gameStatusService.gameStatus$.subscribe(data => {
      if (!data) return;

      // Update marking mode and current round from game status
      const wasMarkingMode = this.markingMode;
      this.markingMode = data.marking_mode;
      this.currentRoundId = data.current_round_id;

      // Start/stop marking results polling based on marking mode
      if (this.markingMode && !wasMarkingMode) {
        this.startMarkingResultsPolling();
      } else if (!this.markingMode && wasMarkingMode) {
        this.stopMarkingResultsPolling();
      }

      // Load players when in a session
      if (this.currentSessionCode) {
        this.loadPlayersForSession();
      }
    });
  }

  checkLoginStatus() {
    if (typeof localStorage !== 'undefined') {
      const userJson = localStorage.getItem(this.USER_KEY);
      if (userJson) {
        this.currentUser = JSON.parse(userJson);
        this.isLoggedIn = true;
      }
    }
  }

  login() {
    this.loginError = '';

    if (!this.loginUsername.trim() || !this.loginPassword.trim()) {
      this.loginError = 'Username and password required';
      return;
    }

    this.api.post<{success: boolean, user: {id: number, username: string}}>('/api/mc/login', {
      username: this.loginUsername,
      password: this.loginPassword
    }).subscribe({
      next: (data) => {
        this.currentUser = data.user;
        this.isLoggedIn = true;
        this.loginPassword = '';

        // Store in localStorage
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(this.USER_KEY, JSON.stringify(data.user));
        }

        // Load data after login
        this.loadMySessions();
        this.loadAllQuizzes();
      },
      error: (err) => {
        this.loginError = err.error?.error || 'Login failed';
        this.loginPassword = '';
      }
    });
  }

  logout() {
    this.isLoggedIn = false;
    this.currentUser = null;
    this.loginUsername = '';
    this.loginPassword = '';
    this.confirmPassword = '';
    this.loginError = '';
    this.allQuizzes = [];
    this.currentQuiz = null;
    this.showRegisterForm = false;

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.USER_KEY);
    }
  }

  toggleRegisterForm() {
    this.showRegisterForm = !this.showRegisterForm;
    this.loginError = '';
    this.loginPassword = '';
    this.confirmPassword = '';
  }

  register() {
    this.loginError = '';

    if (!this.loginUsername.trim() || !this.loginPassword.trim()) {
      this.loginError = 'Username and password required';
      return;
    }

    if (this.loginUsername.length < 3) {
      this.loginError = 'Username must be at least 3 characters';
      return;
    }

    if (this.loginPassword.length < 6) {
      this.loginError = 'Password must be at least 6 characters';
      return;
    }

    if (this.loginPassword !== this.confirmPassword) {
      this.loginError = 'Passwords do not match';
      return;
    }

    this.api.post<{success: boolean, user: {id: number, username: string}}>('/api/mc/register', {
      username: this.loginUsername,
      password: this.loginPassword
    }).subscribe({
      next: (data) => {
        this.currentUser = data.user;
        this.isLoggedIn = true;
        this.loginPassword = '';
        this.confirmPassword = '';
        this.showRegisterForm = false;

        // Store in localStorage
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(this.USER_KEY, JSON.stringify(data.user));
        }

        // Load data after registration
        this.loadMySessions();
        this.loadAllQuizzes();
      },
      error: (err) => {
        this.loginError = err.error?.error || 'Registration failed';
        this.loginPassword = '';
        this.confirmPassword = '';
      }
    });
  }

  startMarkingResultsPolling() {
    // Clear any existing subscription
    this.stopMarkingResultsPolling();

    // Poll every 3 seconds for real-time updates
    this.markingResultsSubscription = interval(3000).pipe(
      startWith(0),
      switchMap(() => {
        const url = this.urlBuilder.buildUrl('/api/marking/results');
        return this.api.get<{results: any[]}>(url);
      })
    ).subscribe({
      next: (data) => {
        if (data.results.length === 0) {
          this.markingResults = [];
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
      },
      error: (err) => {
        console.error('Error loading marking results', err);
      }
    });
  }

  stopMarkingResultsPolling() {
    if (this.markingResultsSubscription) {
      this.markingResultsSubscription.unsubscribe();
      this.markingResultsSubscription = undefined;
    }
    this.markingResults = [];
  }

  // NEW: Load MC's own sessions
  loadMySessions() {
    this.api.get<{sessions: any[]}>(`/api/sessions/my-sessions?owner_id=${this.ownerId}`)
      .subscribe({
        next: (data) => {
          this.mySessions = data.sessions;
          console.log('Loaded my sessions:', this.mySessions);
        },
        error: (err) => {
          console.error('Error loading my sessions', err);
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
    if (!this.currentUser) return;

    this.api.get<{quizzes: Quiz[]}>(`/api/quizzes?user_id=${this.currentUser.id}&username=${this.currentUser.username}`)
      .subscribe(data => {
        this.allQuizzes = data.quizzes;
      });
  }

  createQuiz() {
    if (!this.newQuizName.trim() || !this.currentUser) {
      return;
    }

    this.api.post('/api/quiz/create', {
      quiz_name: this.newQuizName,
      quiz_date: this.newQuizDate,
      user_id: this.currentUser.id
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

  renameQuiz(quizId: number, event: Event) {
    event.stopPropagation();

    // Find the current quiz name
    const quiz = this.allQuizzes.find(q => q.id === quizId);
    if (!quiz) return;

    const newName = prompt('Enter new quiz name:', quiz.quiz_name);
    if (!newName || newName.trim() === '' || newName === quiz.quiz_name) {
      return;
    }

    this.api.put(`/api/quiz/${quizId}/rename`, { name: newName.trim() })
      .subscribe({
        next: () => {
          this.loadAllQuizzes();
          if (this.currentQuiz && this.currentQuiz.id === quizId) {
            this.currentQuiz.quiz_name = newName.trim();
          }
          console.log('Quiz renamed successfully');
        },
        error: (err) => {
          console.error('Error renaming quiz:', err);
        }
      });
  }

  deleteQuiz(quizId: number, event: Event) {
    event.stopPropagation();

    // Find the quiz name for the confirmation message
    const quiz = this.allQuizzes.find(q => q.id === quizId);
    const quizName = quiz ? quiz.quiz_name : 'this quiz';

    if (!confirm(`Are you sure you want to delete "${quizName}"? This action cannot be undone.`)) {
      return;
    }

    this.api.delete(`/api/quiz/${quizId}`)
      .subscribe(() => {
        this.loadCurrentQuiz();
        this.loadAllQuizzes();
        this.selectedRound = null;
      });
  }

  loadArchivedQuizzes() {
    this.api.get<{quizzes: Quiz[]}>('/api/quizzes/archived')
      .subscribe(data => {
        this.archivedQuizzes = data.quizzes;
      });
  }

  restoreQuiz(quizId: number, event: Event) {
    event.stopPropagation();
    this.api.post(`/api/quiz/${quizId}/restore`, {})
      .subscribe(() => {
        this.loadAllQuizzes();
        this.loadArchivedQuizzes();
      });
  }

  toggleArchivedQuizzes() {
    this.showArchivedQuizzes = !this.showArchivedQuizzes;
    if (this.showArchivedQuizzes) {
      this.loadArchivedQuizzes();
    }
  }
  // NEW METHOD: Load players for session
  loadPlayersForSession() {
    if (!this.currentSessionCode) {
      this.players = [];
      return;
    }

    const url = this.urlBuilder.buildUrl('/api/players');
    this.api.get<{players: string[]}>(url)
      .subscribe({
        next: (data) => {
          this.players = data.players;
        },
        error: (err) => {
          console.error('Error loading players', err);
          this.players = [];
        }
      });
  }

  // OLD: Load players (for backwards compatibility)
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
    // Session is now REQUIRED
    if (!this.currentSessionCode) {
      console.error('Cannot remove player: No session code');
      return;
    }

    if (!confirm(`Remove "${playerName}" from the game?`)) {
      return;
    }

    const url = this.urlBuilder.buildUrl(`/api/player/remove/${playerName}`);
    this.api.delete<{players: string[]}>(url)
      .subscribe({
        next: (data) => {
          this.players = data.players;
        },
        error: (err) => {
          console.error('Error removing player', err);
        }
      });
  }

  // NEW METHOD: Clear all players
  resetGame() {
    if (!confirm(`Remove ALL ${this.players.length} players from the game? This will clear the entire player list.`)) {
      return;
    }

    this.api.post('/api/reset', {})
      .subscribe({
        next: (data: any) => {
          this.players = data.players;
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

    // Session is now REQUIRED
    if (!this.currentSessionCode) {
      console.error('Cannot toggle game status: No session code');
      return;
    }

    const url = this.urlBuilder.buildUrl('/api/game/toggle-status');
    this.api.post<{quiz?: Quiz, session?: GameSession}>(url, {})
      .subscribe({
        next: (data) => {
          // For sessions, we don't update currentQuiz (it's a template)
          // For old system, update currentQuiz
          if (data.quiz) {
            this.currentQuiz = data.quiz;
          }

          this.loadPlayersForSession();

          // Clear marking data when appropriate
          // Note: Status is now tracked in game status, not Quiz object
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
    const triggerUrl = this.urlBuilder.buildUrl('/api/marking/trigger-all-rounds');
    const toggleUrl = this.urlBuilder.buildUrl('/api/marking/toggle-mode');

    if (!this.markingMode) {
      // Ending game and starting marking
      this.api.post(triggerUrl, {})
        .subscribe({
          next: () => {
            // Then enable marking mode
            this.api.post(toggleUrl, {})
              .subscribe({
                next: (modeData: any) => {
                  this.markingMode = modeData.marking_mode;
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
      this.api.post(toggleUrl, {})
        .subscribe({
          next: (data: any) => {
            this.markingMode = data.marking_mode;
          },
          error: (err) => {
            console.error('Error toggling marking mode', err);
          }
        });
    }
  }

  // Marking-related methods
  enableMarkingMode() {
    // Toggle marking mode
    const url = this.urlBuilder.buildUrl('/api/marking/toggle-mode');
    this.api.post(url, {})
      .subscribe({
        next: (data: any) => {
          this.markingMode = data.marking_mode;
        },
        error: (err) => {
          console.error('Error toggling marking mode', err);
        }
      });
  }

  triggerMarking() {
    // Trigger marking for all rounds
    const url = this.urlBuilder.buildUrl('/api/marking/trigger-all-rounds');
    this.api.post(url, {})
      .subscribe({
        next: () => {
          console.log('All rounds assigned for marking');
        },
        error: (err) => {
          console.error('Error triggering rounds', err);
        }
      });
  }

  // ============= SESSION MANAGEMENT METHODS (NEW) =============

  // NEW: Create session directly from quiz object (from session lobby)
  createGameSessionFromQuiz(quiz: Quiz) {
    this.api.post('/api/sessions/create', { quiz_id: quiz.id, owner_id: this.ownerId })
      .subscribe({
        next: (data: any) => {
          console.log('Session created:', data.sessionCode);
          console.log('Session data:', data.session);
          console.log('Quiz data:', data.quiz);

          // Set the quiz immediately from the response (no need to fetch again)
          this.currentQuiz = data.quiz;

          // Automatically enter this session
          this.enterSession(data.session);

          // Hide the quiz list
          this.showQuizList = false;
          // Reload sessions list
          this.loadMySessions();
        },
        error: (err) => {
          console.error('Error creating session', err);
        }
      });
  }

  // OLD: Create session from current quiz (for backwards compatibility)
  createGameSession() {
    if (!this.currentQuiz) {
      console.error('No quiz selected');
      return;
    }

    this.api.post('/api/sessions/create', { quiz_id: this.currentQuiz.id, owner_id: this.ownerId })
      .subscribe({
        next: (data: any) => {
          console.log('Session created:', data.sessionCode);
          // Automatically enter this session
          this.enterSession(data.session);
        },
        error: (err) => {
          console.error('Error creating session', err);
        }
      });
  }

  // NEW: Enter a session (switch to session control panel)
  enterSession(session: any) {
    this.selectedSession = session;
    this.currentSessionCode = session.session_code;
    this.viewMode = 'session-control';
    console.log('Entered session:', this.currentSessionCode);
    console.log('Current quiz when entering session:', this.currentQuiz);

    // Load the quiz for this session (only if not already loaded)
    if (!this.currentQuiz || this.currentQuiz.id !== session.quiz_id) {
      this.api.get<{quiz: Quiz}>(`/api/quiz/${session.quiz_id}`)
        .subscribe({
          next: (data) => {
            this.currentQuiz = data.quiz;
            console.log('Quiz loaded:', this.currentQuiz);
            // Load players for this session
            this.loadPlayersForSession();
          },
          error: (err) => {
            console.error('Error loading quiz for session', err);
          }
        });
    } else {
      console.log('Quiz already loaded, skipping fetch');
      // Quiz already loaded, just load players
      this.loadPlayersForSession();
    }

    // Set this session as the active one for game status polling
    this.gameStatusService.setCurrentSession(this.currentSessionCode);
  }

  // NEW: Exit session (back to session lobby)
  exitSession() {
    this.selectedSession = null;
    this.currentSessionCode = null;
    this.currentQuiz = null;
    this.selectedRound = null;
    this.viewMode = 'session-lobby';

    // Clear the session from game status polling
    this.gameStatusService.setCurrentSession(null);

    // Reload the sessions list
    this.loadMySessions();
  }

  loadActiveSessions() {
    this.api.get<{sessions: any[]}>('/api/sessions/active/all')
      .subscribe({
        next: (data) => {
          this.activeSessions = data.sessions;
        },
        error: (err) => {
          console.error('Error loading active sessions', err);
          this.activeSessions = [];
        }
      });
  }


  endSession(sessionCode: string) {
    if (!confirm(`End session "${sessionCode}"? This will close the session for all players. This action cannot be undone.`)) {
      return;
    }

    this.api.post(`/api/sessions/${sessionCode}/end`, {})
      .subscribe({
        next: () => {
          console.log('Session ended:', sessionCode);
          // Exit session and return to lobby
          this.exitSession();
        },
        error: (err) => {
          console.error('Error ending session', err);
        }
      });
  }

  ngOnDestroy() {
    if (this.gameStatusSubscription) {
      this.gameStatusSubscription.unsubscribe();
    }
    this.stopMarkingResultsPolling();
  }
}