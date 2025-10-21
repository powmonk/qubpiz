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
  // The ID of the round currently being displayed to players (from MC parent)
  @Input() currentDisplayedRoundId: number | null = null;

  @Output() roundSelected = new EventEmitter<Round>();

  rounds: Round[] = [];
  selectedRound: Round | null = null;
  newRoundName: string = ''; // Property restored
  newRoundType: string = 'text'; // Default round type, property restored
  
  showNewRoundForm: boolean = false; // Property restored

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
      // Emit null or undefined to clear question manager when quiz changes
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
    if (!this.newRoundName.trim()) {
      alert('Please enter a round name');
      return;
    }

    this.http.post('http://localhost:3000/api/rounds', {
      name: this.newRoundName,
      round_type: this.newRoundType
    }).subscribe(() => {
      this.loadRounds();
      this.newRoundName = '';
      this.showNewRoundForm = false;
    });
  }

  deleteRound(roundId: number, event: Event) {
    event.stopPropagation();
    if (confirm('Delete this round and all its questions?')) {
      this.http.delete(`http://localhost:3000/api/rounds/${roundId}`)
        .subscribe(() => {
          this.loadRounds();
          this.selectedRound = null;
          this.roundSelected.emit(null!);
        });
    }
  }

  selectRound(round: Round) {
    this.selectedRound = round;
    this.roundSelected.emit(round);
  }

  // FIXED METHOD: Set a round to be displayed to players (syntax is now correct)
  setDisplayRound(round: Round | null) {
    // Use 0 to signify clearing the display (handled by server logic)
    const roundId = round ? round.id : 0; 

    this.http.post(`http://localhost:3000/api/game/set-round/${roundId}`, {})
      .subscribe({
        next: () => {
          // This relies on the Mc parent component to reload the Quiz state 
          // and automatically pass the updated currentDisplayedRoundId back here.
        },
        error: (err) => {
          console.error('Error setting round display', err);
          alert('Error setting round display.');
        }
      });
  }
}