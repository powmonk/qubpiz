import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
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
export class RoundManager implements OnInit {
  @Input() currentQuizId: number | null = null;
  @Output() roundSelected = new EventEmitter<Round>();
  
  rounds: Round[] = [];
  selectedRound: Round | null = null;
  showNewRoundForm = false;
  
  newRound = {
    name: '',
    type: 'text'
  };

  constructor(private http: HttpClient) {}

  ngOnInit() {
    if (this.currentQuizId) {
      this.loadRounds();
    }
  }

  ngOnChanges() {
    if (this.currentQuizId) {
      this.loadRounds();
      this.selectedRound = null;
    }
  }

  loadRounds() {
    this.http.get<{ rounds: Round[] }>('http://localhost:3000/api/rounds')
      .subscribe(data => {
        this.rounds = data.rounds;
      });
  }

  createRound() {
    if (!this.newRound.name.trim()) {
      alert('Please enter a round name');
      return;
    }

    this.http.post<Round>('http://localhost:3000/api/rounds', {
      name: this.newRound.name,
      round_type: this.newRound.type
    }).subscribe((round) => {
      this.loadRounds();
      this.newRound = { name: '', type: 'text' };
      this.showNewRoundForm = false;
      // Auto-select the newly created round
      this.selectRound(round);
    });
  }

  selectRound(round: Round) {
    this.selectedRound = round;
    this.roundSelected.emit(round);
  }

  deleteRound(roundId: number, event: Event) {
    event.stopPropagation();
    if (confirm('Delete this round and all its questions?')) {
      this.http.delete(`http://localhost:3000/api/rounds/${roundId}`)
        .subscribe(() => {
          this.loadRounds();
          if (this.selectedRound?.id === roundId) {
            this.selectedRound = null;
            this.roundSelected.emit(null as any);
          }
        });
    }
  }
}