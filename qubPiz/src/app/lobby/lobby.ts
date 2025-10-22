import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { GameStatusService } from '../game-status-service';
import { ApiService } from '../api.service';
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
  private gameStatusSubscription?: Subscription;

  constructor(
    private router: Router,
    private api: ApiService,
    private gameStatusService: GameStatusService
  ) {}

  ngOnInit() {
    // Check if player is already logged in (from localStorage)
    const existingPlayer = this.gameStatusService.getCurrentPlayer();
    if (existingPlayer) {
      // Verify the player still exists on the server
      this.api.get<{players: string[]}>('/api/players')
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

      this.gameActive = data.status === 'active';
      this.quizRunning = data.status === 'active' || data.status === 'closed';

      if (this.gameActive) {
        this.loadPlayers();
      }
    });
  }

  loadPlayers() {
    this.api.get<{players: string[]}>('/api/players')
      .subscribe(data => {
        this.players = data.players;
      });
  }

  onSubmit() {
    this.api.post('/api/join', { name: this.playerName })
      .subscribe(() => {
        // Store player name in the service (and localStorage)
        this.gameStatusService.setCurrentPlayer(this.playerName);
        this.isPlayerLoggedIn = true;
        this.router.navigate(['/']);
      });
  }

  // Optional: Add logout functionality
  logout() {
    this.gameStatusService.clearCurrentPlayer();
    this.isPlayerLoggedIn = false;
    this.playerName = '';
  }

  ngOnDestroy() {
    if (this.gameStatusSubscription) {
      this.gameStatusSubscription.unsubscribe();
    }
  }
}