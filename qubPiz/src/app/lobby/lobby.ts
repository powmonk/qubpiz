import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { GameStatusService } from '../game-status-service'; // Add this import

// Match updated server response
interface GameStatus {
  active: boolean;
  status: string;
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
  quizRunning: boolean = false; 

  constructor(
    private router: Router,
    private http: HttpClient,
    private gameStatusService: GameStatusService // Add this injection
  ) {}

  ngOnInit() {
    this.checkGameStatus();
    setInterval(() => this.checkGameStatus(), 3000);
  }

  checkGameStatus() {
    this.http.get<GameStatus>('http://localhost:3000/api/game/status')
      .subscribe(data => {
        
        this.gameActive = data.status === 'active'; 
        this.quizRunning = data.status === 'active' || data.status === 'closed';

        if (this.gameActive) { 
          this.loadPlayers(); 
        }
        
        if (data.current_round_id && data.current_round_type) {
          let routePath: string;
          
          if (data.current_round_type === 'picture') {
            routePath = '/round/picture';
          } else {
            routePath = '/round/question';
          }

          const currentPath = this.router.url.split('?')[0];

          if (currentPath === '/' || currentPath === '/lobby') {
            const newUrl = this.router.createUrlTree([routePath], { 
                queryParamsHandling: 'merge',
            }).toString();

            this.router.navigateByUrl(newUrl, { replaceUrl: true });
          }
        } 
        
        else if (!data.current_round_id && this.router.url.startsWith('/round/')) {
             this.router.navigate(['/'], { replaceUrl: true });
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
        // Store player name in the service
        this.gameStatusService.setCurrentPlayer(this.playerName);
        this.router.navigate(['/']); 
      });
  }
}