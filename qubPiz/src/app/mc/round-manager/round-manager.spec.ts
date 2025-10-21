// powmonk/qubpiz/qubpiz-main/qubPiz/src/app/mc/round-manager/round-manager.ts

import { Component, OnInit, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface Round {
  id: number;
  game_session_id: number;
  name: string;
  round_type: string;
  round_order: number;
  created_at: string;
}

@Component({
  selector: 'app-round-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './round-manager.html',
  styleUrl: './round-manager.css'
})
export class RoundManager implements OnInit, OnChanges {
  @Input() currentQuizId: number | null = null;
  // NEW INPUT: The ID of the round currently being displayed to players
  @Input() currentDisplayedRoundId: number | null = null;

  @Output() roundSelected = new EventEmitter<Round>();

  rounds: Round[] = [];
  selectedRound: Round | null = null;
  newRoundName: string = '';
  newRoundType: string = 'text'; // Default round type
  
  showNewRoundForm: boolean = false;

  constructor(private http: HttpClient) {}

  ngOnInit() {
    if (this.currentQuizId) {
      this.loadRounds();
    }
  }
  
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['currentQuizId'] && this.currentQuizId) {
      this.loadRounds();
      this.selectedRound = null;
      this.roundSelected.emit(null!);
    }
  }

  loadRounds() {
    if (!this.currentQuizId) return;

    this.http.get<{rounds: Round[]}>(`http://localhost:3000/api/rounds?quizId=${this.currentQuizId}`)
      .subscribe(data => {
        this.rounds = data.rounds;
      });
  }

  createRound() {
    // ... existing implementation ...
  }

  deleteRound(roundId: number, event: Event) {
    // ... existing implementation ...
  }

  selectRound(round: Round) {
    this.selectedRound = round;
    this.roundSelected.emit(round);
  }

  // NEW METHOD: Set a round to be displayed to players
  setDisplayRound(round: Round | null) {
    // Use 0 to signify clearing the display (handled by server logic)
    const roundId = round ? round.id : 0; 

    this.http.post(`http://localhost:3000/api/game/set-round/${roundId}`, {})
      .subscribe({
        next: () => {
          // The Mc component will reload current quiz state, 
          // automatically updating currentDisplayedRoundId in the UI via Input binding.
        },
        error: (err) => {
          console.error('Error setting round display', err);
          alert('Error setting round display.');
        }
      });
  }
}