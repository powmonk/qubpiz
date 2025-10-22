// powmonk/qubpiz/qubpiz-main/qubPiz/src/app/mc/round-manager/round-manager.ts

import { Component, OnInit, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../api.service';
import { Round } from '../../shared/types';

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
  @Output() displayStateChanged = new EventEmitter<void>();

  rounds: Round[] = [];
  selectedRound: Round | null = null;
  newRoundName: string = ''; // Property restored
  newRoundType: string = 'text'; // Default round type, property restored
  
  showNewRoundForm: boolean = false; // Property restored

  constructor(private api: ApiService) {}

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

    this.api.get<{rounds: Round[]}>(`/api/rounds?quizId=${this.currentQuizId}`)
      .subscribe(data => {
        this.rounds = data.rounds;
      });
  }

  createRound() {
    if (!this.newRoundName.trim()) {
      alert('Please enter a round name');
      return;
    }

    this.api.post('/api/rounds', {
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
      this.api.delete(`/api/rounds/${roundId}`)
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

  // In round-manager.ts
setDisplayRound(round: Round | null) {
  const roundId = round ? round.id : 0; 

  // SELECT the round so the question manager appears
  if (round) {
    this.selectRound(round);
  }

  this.api.post(`/api/game/set-round/${roundId}`, {})
    .subscribe({
      next: () => {
        // Fire event to tell the parent Mc component to refresh currentQuiz
        this.displayStateChanged.emit();
      },
      error: (err) => {
        console.error('Error setting round display', err);
        alert('Error setting round display.');
      }
    });
  }
}