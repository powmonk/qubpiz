// powmonk/qubpiz/qubpiz-main/qubPiz/src/app/game-status-service.ts

import { Injectable, OnDestroy } from '@angular/core'; 
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, interval, Subscription, Observable } from 'rxjs'; 
import { switchMap, tap } from 'rxjs/operators'; 

export interface GameStatus { 
  active: boolean;
  status: string;
  current_round_id: number | null;
  current_round_type: string | null;
  current_round_name: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class GameStatusService implements OnDestroy {
  private baseUrl = 'http://localhost:3000'; 
  private pollSubscription: Subscription = new Subscription();
  
  public gameStatus$ = new BehaviorSubject<GameStatus | null>(null);

  constructor(
    private http: HttpClient,
    private router: Router
  ) {
    this.startPolling();
  }

  private getStatus(): Observable<GameStatus> {
      return this.http.get<GameStatus>(`${this.baseUrl}/api/game/status`);
  }

  private startPolling() {
    if (this.pollSubscription) {
      this.pollSubscription.unsubscribe();
    }

    this.pollSubscription = interval(3000).pipe(
      switchMap(() => this.getStatus()),
      tap(data => {
        this.gameStatus$.next(data);
        // FIX: Removed this.handleRedirection(data); to prevent asynchronous routing conflicts.
      })
    ).subscribe(
        null, 
        error => console.error('Game status polling error:', error)
    );
  }

  // Used for manual, immediate checks by components (e.g., Lobby.onSubmit)
  public triggerStatusCheck(): Observable<GameStatus> {
      return this.getStatus().pipe(
          tap(data => {
              this.gameStatus$.next(data);
              // FIX: Removed this.handleRedirection(data);
          })
      );
  }

  // FIX: The handleRedirection method is entirely removed as navigation logic 
  // is now the explicit responsibility of components like Lobby.ts.

  ngOnDestroy() {
    this.pollSubscription.unsubscribe();
  }
}