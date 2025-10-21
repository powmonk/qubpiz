// src/app/lobby/lobby.ts
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';

// NEW INTERFACE: Match updated server response
interface GameStatus {
  active: boolean; // Lobby status (true if 'active')
  status: string; // The game session status ('waiting', 'active', 'closed')
  current_round_id: number | null;
  current_round_type: string | null;
  current_round_name: string | null;
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
    this.http.get<GameStatus>('http://localhost:3000/api/game/status') //
      .subscribe(data => {
        // Use 'active' flag from server for showing the join form
        this.gameActive = data.active; //

        if (this.gameActive) { //
          this.loadPlayers(); //
        }
        
        // NEW REDIRECTION LOGIC: Redirect if a round is active for display
        if (data.current_round_id && data.current_round_type) {
          let routePath: string;
          
          if (data.current_round_type === 'picture') {
            routePath = '/round/picture';
          } else {
            // All non-picture types go to QuestionRound
            routePath = '/round/question';
          }

          // Redirect player if they are currently on the lobby or root path
          if (this.router.url === '/' || this.router.url === '/lobby') {
            this.router.navigate([routePath], { 
              queryParamsHandling: 'merge' // Preserve name query param
            });
          }
        } 
        
        // Return to lobby if the display is cleared while player is on a round page
        else if (!data.current_round_id && (this.router.url.startsWith('/round/picture') || this.router.url.startsWith('/round/question'))) {
             this.router.navigate(['/']); // Navigate back to the root path (which is Lobby per your routes)
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
        // UPDATED: Navigate to the root path. 
        // The polling in checkGameStatus will immediately redirect to the correct round if one is active.
        this.router.navigate(['/']); 
      });
  }
}