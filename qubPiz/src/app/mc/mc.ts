import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RoundManager } from './round-manager/round-manager';
import { QuestionManager } from './question-manager/question-manager';

interface Quiz {
  id: number;
  quiz_name: string;
  quiz_date: string;
  status: string;
  created_at: string;
  current_round_id: number | null; // <--- NEW PROPERTY
}

interface Round {
  id: number;
  game_session_id: number;
  name: string;
  round_type: string;
  round_order: number;
  created_at: string;
}

@Component({
  selector: 'app-mc',
  standalone: true,
  imports: [CommonModule, FormsModule, RoundManager, QuestionManager],
  templateUrl: './mc.html',
  styleUrl: './mc.css'
})

export class Mc implements OnInit {
  currentQuiz: Quiz | null = null;
  allQuizzes: Quiz[] = [];
  selectedRound: Round | null = null;
  
  showNewQuizForm: boolean = false;
  showQuizList: boolean = false;
  newQuizName: string = '';
  newQuizDate: string = new Date().toISOString().split('T')[0];
  
  // NEW: Property to hold player list
  players: string[] = [];
  
  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadCurrentQuiz();
    this.loadAllQuizzes();
    this.loadPlayers();
    setInterval(() => this.loadPlayers(), 3000);
  }

  loadCurrentQuiz() {
    this.http.get<{quiz: Quiz | null}>('http://localhost:3000/api/quiz/current')
      .subscribe(data => {
        this.currentQuiz = data.quiz;
      });
  }

  loadAllQuizzes() {
    this.http.get<{quizzes: Quiz[]}>('http://localhost:3000/api/quizzes')
      .subscribe(data => {
        this.allQuizzes = data.quizzes;
      });
  }

  createQuiz() {
    if (!this.newQuizName.trim()) {
      alert('Please enter a quiz name');
      return;
    }

    this.http.post('http://localhost:3000/api/quiz/create', {
      quiz_name: this.newQuizName,
      quiz_date: this.newQuizDate
    }).subscribe(() => {
      this.loadCurrentQuiz();
      this.loadAllQuizzes();
      this.newQuizName = '';
      this.showNewQuizForm = false;
      this.selectedRound = null;
    });
  }

  selectQuiz(quizId: number) {
    this.http.post(`http://localhost:3000/api/quiz/select/${quizId}`, {})
      .subscribe(() => {
        this.loadCurrentQuiz();
        this.showQuizList = false;
        this.selectedRound = null;
      });
  }

  deleteQuiz(quizId: number, event: Event) {
    event.stopPropagation();
    if (confirm('Delete this quiz and all its rounds/questions?')) {
      this.http.delete(`http://localhost:3000/api/quiz/${quizId}`)
        .subscribe(() => {
          this.loadCurrentQuiz();
          this.loadAllQuizzes();
          this.selectedRound = null;
        });
    }
  }
  // NEW METHOD: Load players (from server)
  loadPlayers() {
    this.http.get<{players: string[]}>('http://localhost:3000/api/players')
      .subscribe({
        next: (data) => {
          this.players = data.players;
        },
        error: (err) => {
          // Keep players empty if API call fails
          this.players = []; 
        }
      });
  }

  // NEW METHOD: Remove individual player
  removePlayer(playerName: string) {
    if (confirm(`Are you sure you want to remove player: ${playerName}?`)) {
      this.http.delete<{players: string[]}>(`http://localhost:3000/api/player/remove/${playerName}`)
        .subscribe({
          next: (data) => {
            this.players = data.players;
            console.log(`${playerName} removed.`);
          },
          error: (err) => {
            console.error('Error removing player', err);
            alert('Error removing player: ' + (err.error?.error || 'Unknown error'));
          }
        });
    }
  }

  // NEW METHOD: Clear all players
  resetGame() {
    if (confirm('Are you sure you want to clear all players from the lobby?')) {
      this.http.post('http://localhost:3000/api/reset', {})
        .subscribe({
          next: (data: any) => {
            this.players = data.players;
            console.log('All players cleared.');
          },
          error: (err) => {
            console.error('Error resetting players', err);
            alert('Error resetting players: ' + (err.error?.error || 'Unknown error'));
          }
        });
    }
  }

  // Update toggleGameStatus to also reload players and use the updated logic
  toggleGameStatus() {
    if (!this.currentQuiz) {
      alert('No quiz selected to toggle status.');
      return;
    }

    this.http.post<{quiz: Quiz}>('http://localhost:3000/api/game/toggle-status', {})
      .subscribe({
        next: (data) => {
          this.currentQuiz = data.quiz; 
          this.loadPlayers(); 
        },
        error: (err) => {
          console.error('Error toggling game status', err);
          alert('Error toggling game status: ' + (err.error?.error || 'Unknown error'));
        }
      });
  }
  
  onRoundSelected(round: Round) {
    this.selectedRound = round;
  }
}