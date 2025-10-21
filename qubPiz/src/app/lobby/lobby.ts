// src/app/lobby/lobby.ts
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';

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
    this.http.get<{active: boolean}>('http://localhost:3000/api/game/status')
      .subscribe(data => {
        this.gameActive = data.active;
        if (this.gameActive) {
          this.loadPlayers();
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
        this.router.navigate(['/round/question'], { 
          queryParams: { name: this.playerName } 
        });
      });
  }
}