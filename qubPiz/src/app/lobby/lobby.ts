import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { GameStatusService } from '../game-status-service';
import { ApiService } from '../api.service';
import { UrlBuilderService } from '../url-builder.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-lobby',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './lobby.html',
  styleUrl: './lobby.css'
})
export class Lobby implements OnInit, OnDestroy {
  playerName: string = '';
  players: string[] = [];
  gameActive: boolean = false;
  quizRunning: boolean = false;
  isPlayerLoggedIn: boolean = false;

  // NEW: Session support
  sessionCode: string | null = null;
  sessionInfo: any = null;
  sessionQuiz: any = null;
  sessionError: string | null = null;
  enteredSessionCode: string = ''; // For manual session code entry

  private gameStatusSubscription?: Subscription;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private api: ApiService,
    private gameStatusService: GameStatusService,
    private urlBuilder: UrlBuilderService
  ) {}

  ngOnInit() {
    // NEW: Check for session parameter in URL
    this.route.queryParams.subscribe(params => {
      this.sessionCode = params['session'] || null;
      console.log('Lobby ngOnInit - sessionCode:', this.sessionCode);
      console.log('Lobby ngOnInit - all params:', params);

      if (this.sessionCode) {
        // Load session information
        console.log('Loading session info for:', this.sessionCode);
        this.loadSessionInfo();
      } else {
        // OLD SYSTEM: No session, use regular flow
        console.log('No session code, using old system');
        // Clear any stored session code
        this.gameStatusService.setCurrentSession(null);
        this.initializeOldSystem();
      }
    });
  }

  // NEW: Load session information
  loadSessionInfo() {
    console.log('loadSessionInfo called with sessionCode:', this.sessionCode);
    this.api.get(`/api/sessions/${this.sessionCode}`)
      .subscribe({
        next: (data: any) => {
          console.log('Session API response:', data);
          this.sessionInfo = data.session;
          this.sessionQuiz = data.quiz;
          console.log('Session loaded successfully');
          console.log('Session status:', data.session.status);

          // NEW: Store session code in GameStatusService for polling
          this.gameStatusService.setCurrentSession(this.sessionCode);

          // Set game state based on session status
          this.gameActive = data.session.status === 'active' || data.session.status === 'waiting';
          this.quizRunning = data.session.status === 'active' || data.session.status === 'closed';
          console.log('gameActive set to:', this.gameActive);
          console.log('quizRunning set to:', this.quizRunning);

          // Load players for this session
          this.loadPlayers();

          // Session is valid, proceed with initialization
          this.initializeOldSystem(); // Reuse same logic for now
        },
        error: (err) => {
          console.error('Session error:', err);
          this.sessionError = 'Session not found or expired. Please check your lobby URL.';
        }
      });
  }

  // Initialize the old system (or works with sessions too)
  initializeOldSystem() {
    // Check if player is already logged in (from localStorage)
    const existingPlayer = this.gameStatusService.getCurrentPlayer();
    if (existingPlayer) {
      // Verify the player still exists on the server
      const url = this.urlBuilder.buildUrl('/api/players');
      this.api.get<{players: string[]}>(url)
        .subscribe(data => {
          if (data.players.includes(existingPlayer)) {
            // Player exists on server, they're still logged in
            this.isPlayerLoggedIn = true;
            this.playerName = existingPlayer;
          } else {
            // Player was cleared from server, clear local storage
            this.gameStatusService.clearCurrentPlayer();
            this.isPlayerLoggedIn = false;
            this.playerName = '';
          }
        });
    }

    // Subscribe to game status updates from the service instead of polling directly
    this.gameStatusSubscription = this.gameStatusService.gameStatus$.subscribe(data => {
      if (!data) return;

      // MARKING MODE: Redirect to marking page if marking mode is active
      if (data.marking_mode && this.isPlayerLoggedIn) {
        this.router.navigate(['/marking'], { replaceUrl: true });
        return;
      }

      // NEW: For sessions, 'waiting' status should show the lobby
      if (this.sessionCode) {
        this.gameActive = data.status === 'active' || data.status === 'waiting';
        this.quizRunning = data.status === 'active' || data.status === 'closed';
      } else {
        // OLD SYSTEM: waiting means no game
        this.gameActive = data.status === 'active';
        this.quizRunning = data.status === 'active' || data.status === 'closed';
      }

      if (this.gameActive) {
        this.loadPlayers();
      }
    });
  }

  loadPlayers() {
    const url = this.urlBuilder.buildUrl('/api/players');
    this.api.get<{players: string[]}>(url)
      .subscribe(data => {
        this.players = data.players;
      });
  }

  onSubmit() {
    const url = this.urlBuilder.buildUrl('/api/join');
    this.api.post(url, { name: this.playerName })
      .subscribe(() => {
        // Store player name in the service (and localStorage)
        this.gameStatusService.setCurrentPlayer(this.playerName);
        this.isPlayerLoggedIn = true;

        // NEW: Stay on lobby page if in a session, otherwise go home
        if (this.sessionCode) {
          // Just reload the player list, don't navigate away
          this.loadPlayers();
        } else {
          // OLD SYSTEM: Navigate to home
          this.router.navigate(['/']);
        }
      });
  }

  // Optional: Add logout functionality
  logout() {
    this.gameStatusService.clearCurrentPlayer();
    this.isPlayerLoggedIn = false;
    this.playerName = '';
  }

  // NEW: Join session by manually entered code
  joinSessionByCode() {
    if (!this.enteredSessionCode.trim()) {
      return;
    }

    // Convert to uppercase and trim
    const sessionCode = this.enteredSessionCode.trim().toUpperCase();

    // Navigate to lobby with session parameter
    this.router.navigate(['/lobby'], {
      queryParams: { session: sessionCode }
    });
  }

  ngOnDestroy() {
    if (this.gameStatusSubscription) {
      this.gameStatusSubscription.unsubscribe();
    }
  }
}