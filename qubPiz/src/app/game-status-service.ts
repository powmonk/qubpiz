import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, interval, Subscription } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';

interface GameStatus {
  active: boolean;
  status: string;
  current_round_id: number | null;
  current_round_type: string | null;
  current_round_name: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class GameStatusService {
  private baseUrl = 'http://localhost:3000'; 
  private pollSubscription: Subscription = new Subscription();
  
  // Game status observable
  public gameStatus$ = new BehaviorSubject<GameStatus | null>(null);
  
  // Current player name observable
  public currentPlayer$ = new BehaviorSubject<string | null>(null);

  constructor(
    private http: HttpClient,
    private router: Router
  ) {
    this.startPolling();
  }

  // Set the current player (called from lobby after join)
  setCurrentPlayer(playerName: string) {
    this.currentPlayer$.next(playerName);
  }

  // Get current player name
  getCurrentPlayer(): string | null {
    return this.currentPlayer$.value;
  }

  private startPolling() {
    if (this.pollSubscription) {
      this.pollSubscription.unsubscribe();
    }

    this.pollSubscription = interval(3000).pipe(
      switchMap(() => this.http.get<GameStatus>(`${this.baseUrl}/api/game/status`)),
      tap(data => {
        this.gameStatus$.next(data);
        this.handleRedirection(data);
      })
    ).subscribe(
      null, 
      error => console.error('Game status polling error:', error)
    );
  }

  private handleRedirection(data: GameStatus) {
    const currentPath = this.router.url.split('?')[0];
    const currentPlayer = this.getCurrentPlayer();

    // Only perform redirects if player is logged in
    if (!currentPlayer) return;

    if (data.current_round_id && data.current_round_type) {
      let routePath: string;
      
      if (data.current_round_type === 'picture') {
        routePath = '/round/picture';
      } else {
        routePath = '/round/question';
      }

      if (currentPath === '/' || currentPath === '/lobby') {
        this.router.navigateByUrl(routePath, { replaceUrl: true });
      }
    } 
    else if (!data.current_round_id) {
      if (currentPath.startsWith('/round/')) {
        this.router.navigate(['/'], { replaceUrl: true });
      }
    }
  }

  ngOnDestroy() {
    this.pollSubscription.unsubscribe();
  }
}