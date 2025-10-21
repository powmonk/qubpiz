// powmonk/qubpiz/qubpiz-main/qubPiz/src/app/lobby/lobby.ts
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';

// Match updated server response
interface GameStatus {
  active: boolean; // Lobby join status (true if 'active')
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
  // Flag to track if the quiz is running (active or closed)
  quizRunning: boolean = false; 

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
    this.http.get<GameStatus>('http://localhost:3000/api/game/status')
      .subscribe(data => {
        
        // FIX 1: 'gameActive' determines if the Join form should be visible. Only 'active' works.
        this.gameActive = data.status === 'active'; 

        // FIX 2: 'quizRunning' determines if the game is IN PROGRESS (lobby closed or open).
        this.quizRunning = data.status === 'active' || data.status === 'closed';

        if (this.gameActive) { 
          this.loadPlayers(); 
        }
        
        // REDIRECTION LOGIC: Force navigation to the active round if one is set.
        if (data.current_round_id && data.current_round_type) {
          let routePath: string;
          
          if (data.current_round_type === 'picture') {
            routePath = '/round/picture';
          } else {
            routePath = '/round/question';
          }

          // CRITICAL FIX: Get the current path without query parameters.
          const currentPath = this.router.url.split('?')[0];

          // Only navigate if the current path is the root ('/') or '/lobby'.
          if (currentPath === '/' || currentPath === '/lobby') {
            
            // Use createUrlTree and navigateByUrl to force Angular routing execution
            const newUrl = this.router.createUrlTree([routePath], { 
                queryParamsHandling: 'merge', // Keep parameters like name=...
            }).toString();

            // Force navigation execution and prevent history stacking
            this.router.navigateByUrl(newUrl, { replaceUrl: true });
          }
        } 
        
        // Return to lobby if the display is cleared while player is on a round page
        else if (!data.current_round_id && this.router.url.startsWith('/round/')) {
             this.router.navigate(['/'], { replaceUrl: true }); // Navigate back to the root path
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
        // Navigate to root. The next poll will immediately pick up the active round and redirect.
        this.router.navigate(['/']); 
      });
  }
}