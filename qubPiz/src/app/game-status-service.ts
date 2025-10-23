import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, interval, Subscription } from 'rxjs';
import { switchMap, tap, shareReplay } from 'rxjs/operators';
import { ApiService } from './api.service';
import { GameStatus } from './shared/types';

@Injectable({
  providedIn: 'root'
})
export class GameStatusService {
  private pollSubscription: Subscription = new Subscription();
  private readonly STORAGE_KEY = 'qubpiz_player_name';
  private readonly SESSION_KEY = 'qubpiz_session_code';

  // Game status observable
  public gameStatus$ = new BehaviorSubject<GameStatus | null>(null);

  // Current player name observable - initialized from localStorage
  public currentPlayer$ = new BehaviorSubject<string | null>(this.getStoredPlayerName());

  // Current session code observable - initialized from localStorage
  public currentSession$ = new BehaviorSubject<string | null>(this.getStoredSession());

  constructor(
    private router: Router,
    private api: ApiService
  ) {
    this.startPolling();
  }

  // Get player name from localStorage
  private getStoredPlayerName(): string | null {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(this.STORAGE_KEY);
    }
    return null;
  }

  // Get session code from localStorage
  private getStoredSession(): string | null {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(this.SESSION_KEY);
    }
    return null;
  }

  // Set the current player (called from lobby after join)
  setCurrentPlayer(playerName: string) {
    this.currentPlayer$.next(playerName);
    // Persist to localStorage
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.STORAGE_KEY, playerName);
    }
  }

  // Clear the current player (for logout or game end)
  clearCurrentPlayer() {
    this.currentPlayer$.next(null);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.STORAGE_KEY);
    }
  }

  // Get current player name
  getCurrentPlayer(): string | null {
    return this.currentPlayer$.value;
  }

  // Set the current session (called from lobby when joining via session URL)
  setCurrentSession(sessionCode: string | null) {
    this.currentSession$.next(sessionCode);
    if (typeof localStorage !== 'undefined') {
      if (sessionCode) {
        localStorage.setItem(this.SESSION_KEY, sessionCode);
      } else {
        localStorage.removeItem(this.SESSION_KEY);
      }
    }
    // Restart polling with new session
    this.startPolling();
  }

  // Get current session code
  getCurrentSession(): string | null {
    return this.currentSession$.value;
  }

  private startPolling() {
    if (this.pollSubscription) {
      this.pollSubscription.unsubscribe();
    }

    // Fetch immediately first, then poll every 3 seconds
    // Using shareReplay to ensure multiple subscribers don't trigger multiple HTTP requests
    const fetchStatus = () => {
      // NEW: Include session parameter if present
      const sessionCode = this.getCurrentSession();
      const url = sessionCode
        ? `/api/game/status?session=${sessionCode}`
        : '/api/game/status';

      return this.api.get<GameStatus>(url).pipe(
        tap(data => {
          this.gameStatus$.next(data);
          this.handleRedirection(data);
        }),
        shareReplay(1)
      );
    };

    // Initial fetch
    fetchStatus().subscribe({
      error: (error) => console.error('Initial game status fetch error:', error)
    });

    // Then poll every 5 seconds (optimized for low-spec servers)
    this.pollSubscription = interval(5000).pipe(
      switchMap(() => fetchStatus())
    ).subscribe({
      error: (error) => console.error('Game status polling error:', error)
    });
  }

  private handleRedirection(data: GameStatus) {
    const currentPath = this.router.url.split('?')[0];
    const currentPlayer = this.getCurrentPlayer();

    // Never redirect MC - they control the game
    if (currentPath === '/mc') return;

    // If game status is 'waiting', flush player info (game has ended)
    if (data.status === 'waiting' && currentPlayer) {
      this.clearCurrentPlayer();
      // Redirect to home page if not already there
      if (currentPath !== '/' && currentPath !== '/lobby') {
        this.router.navigate(['/'], { replaceUrl: true });
      }
      return;
    }

    // Only perform redirects if player is logged in
    if (!currentPlayer) return;

    // If marking mode is enabled, redirect to marking page
    if (data.marking_mode) {
      if (currentPath !== '/marking') {
        this.router.navigate(['/marking'], { replaceUrl: true });
      }
      return;
    }

    // If marking mode was just disabled and player is on marking page, redirect them back
    if (!data.marking_mode && currentPath === '/marking') {
      if (data.current_round_id && data.current_round_type) {
        // Redirect to active round
        let routePath: string;
        if (data.current_round_type === 'picture' || data.current_round_type === 'image') {
          routePath = '/round/picture';
        } else {
          routePath = '/round/question';
        }
        this.router.navigate([routePath], { replaceUrl: true });
      } else {
        // No active round, go to lobby
        this.router.navigate(['/'], { replaceUrl: true });
      }
      return;
    }

    if (data.current_round_id && data.current_round_type) {
      let routePath: string;

      if (data.current_round_type === 'picture' || data.current_round_type === 'image') {
        routePath = '/round/picture';
      } else {
        routePath = '/round/question';
      }

      if (currentPath === '/' || currentPath === '/lobby') {
        this.router.navigateByUrl(routePath, { replaceUrl: true });
      }
    }
    // Don't redirect away from round pages between rounds
    // This prevents lobby flashing when MC switches rounds
    // else if (!data.current_round_id) {
    //   if (currentPath.startsWith('/round/')) {
    //     this.router.navigate(['/'], { replaceUrl: true });
    //   }
    // }
  }
}