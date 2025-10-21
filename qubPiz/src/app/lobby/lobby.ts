// src/app/lobby/lobby.ts

import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';

// NEW INTERFACE: Match server response
interface GameStatus {
  active: boolean;
  status: string;
  current_round_id: number | null; 
}

@Component({
  selector: 'app-lobby',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './lobby.html',
  styleUrl: './lobby.css'
})
export class Lobby implements OnInit {
  playerName: string = '';
  players: string[] = [];
  gameActive: boolean = false;

  constructor(
    private router: Router,
    private http: HttpClient
  ) {}

  ngOnInit() {
    this.checkGameStatus();
    // Check game status every 3 seconds
    setInterval(() => this.checkGameStatus(), 3000);
  }

  checkGameStatus() {
    // UPDATED: Use new GameStatus interface
    this.http.get<GameStatus>('http://localhost:3000/api/game/status')
      .subscribe(data => {
        this.gameActive = data.active;

        if (this.gameActive) {
          this.loadPlayers();
        }
        
        // NEW REDIRECTION LOGIC: Redirect if a round is active AND player has joined
        // Note: The /round/display route needs to be added in app.routes.ts
        if (data.current_round_id && this.router.url === '/round/question') {
          // If the player is currently on the old default route after joining (e.g., from a previous session)
          this.router.navigate(['/round/display'], { 
             queryParamsHandling: 'merge' // Preserve name query param if needed
          });
        }
      });
  }

  loadPlayers() {
    this.http.get<{players: string[]}>('http://localhost:3000/api/players')
      .subscribe(data => {
        this.players = data.players;
      });
  }

  onSubmit() {
    this.http.post('http://localhost:3000/api/join', { name: this.playerName })
      .subscribe(() => {
        // UPDATED: Navigate to the new display component instead of the old one
        this.router.navigate(['/round/display'], { 
          queryParams: { name: this.playerName } 
        });
      });
  }
}