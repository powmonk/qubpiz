// powmonk/qubpiz/qubpiz-main/qubPiz/src/app/game-status.service.ts

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
  
  // Expose the raw status data for other components to read
  public gameStatus$ = new BehaviorSubject<GameStatus | null>(null);

  constructor(
    private http: HttpClient,
    private router: Router
  ) {
    this.startPolling();
  }

  private startPolling() {
    if (this.pollSubscription) {
      this.pollSubscription.unsubscribe();
    }

    this.pollSubscription = interval(3000).pipe(
      // Start immediately on initialization
      switchMap(() => this.http.get<GameStatus>(`${this.baseUrl}/api/game/status`)),
      tap(data => {
        this.gameStatus$.next(data);
        this.handleRedirection(data); // Navigation logic is now here
      })
    ).subscribe(
        // Error handling for the poll
        null, 
        error => console.error('Game status polling error:', error)
    );
  }

  private handleRedirection(data: GameStatus) {
    const currentPath = this.router.url.split('?')[0];

    // --- LOGIC 1: Redirect TO a round if one is active ---
    if (data.current_round_id && data.current_round_type) {
      let routePath: string;
      
      if (data.current_round_type === 'picture') {
        routePath = '/round/picture';
      } else {
        routePath = '/round/question';
      }

      // Only navigate if the player is currently in the Lobby or on the root path
      if (currentPath === '/' || currentPath === '/lobby') {
        const newUrl = this.router.createUrlTree([routePath], { 
            queryParamsHandling: 'merge',
        }).toString();

        // Use navigateByUrl to force the navigation
        this.router.navigateByUrl(newUrl, { replaceUrl: true });
      }
    } 
    
    // --- LOGIC 2: Redirect TO lobby if the display is cleared while player is on a round page ---
    else if (!data.current_round_id) {
      // If the URL starts with a round path AND the MC has cleared it
      if (currentPath.startsWith('/round/')) {
           this.router.navigate(['/'], { replaceUrl: true }); // Navigate back to the root path (Lobby)
      }
    }
  }

  ngOnDestroy() {
    this.pollSubscription.unsubscribe();
  }
}