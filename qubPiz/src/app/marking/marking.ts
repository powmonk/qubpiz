import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { GameStatusService } from '../game-status-service';
import { ApiService } from '../api.service';
import { Assignment } from '../shared/types';

@Component({
  selector: 'app-marking',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './marking.html',
  styleUrl: './marking.css'
})
export class Marking implements OnInit, OnDestroy {
  assignments: Assignment[] = [];
  playerName: string = '';
  loading: boolean = true;
  errorMessage: string = '';
  private gameStatusSubscription?: Subscription;

  constructor(
    private api: ApiService,
    private gameStatusService: GameStatusService,
    private router: Router
  ) {}

  ngOnInit() {
    this.playerName = this.gameStatusService.getCurrentPlayer() || '';

    if (!this.playerName) {
      this.errorMessage = 'You need to join the game first';
      this.loading = false;
      return;
    }

    // Subscribe to game status to detect when marking mode is disabled
    this.gameStatusSubscription = this.gameStatusService.gameStatus$.subscribe(data => {
      if (data && !data.marking_mode) {
        // Marking mode disabled, redirect back to lobby
        this.router.navigate(['/lobby'], { replaceUrl: true });
      }
    });

    this.loadAssignments();
  }

  backToLobby() {
    this.router.navigate(['/lobby'], { replaceUrl: true });
  }

  ngOnDestroy() {
    if (this.gameStatusSubscription) {
      this.gameStatusSubscription.unsubscribe();
    }
  }

  loadAssignments() {
    // Get session code from game status service
    const sessionCode = this.gameStatusService.getCurrentSession();
    const url = sessionCode
      ? `/api/marking/assignments/${this.playerName}?session=${sessionCode}`
      : `/api/marking/assignments/${this.playerName}`;

    this.api.get<{ assignments: Assignment[] }>(url).subscribe({
      next: (data) => {
        this.assignments = data.assignments;
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading assignments:', err);
        this.errorMessage = `Failed to load marking assignments: ${err.error?.error || err.message || 'Unknown error'}`;
        this.loading = false;
      }
    });
  }

  setScore(assignmentId: number, questionId: number, score: number) {
    this.api.post('/api/marking/submit', {
      assignment_id: assignmentId,
      question_id: questionId,
      score: score
    }).subscribe({
      next: () => {
        // Update local marks
        const assignment = this.assignments.find(a => a.assignment_id === assignmentId);
        if (assignment) {
          assignment.marks[questionId] = score;
        }
      },
      error: (err) => {
        console.error('Error submitting mark:', err);
        alert('Failed to submit mark');
      }
    });
  }

  getScore(assignment: Assignment, questionId: number): number | null {
    return assignment.marks[questionId] !== undefined ? assignment.marks[questionId] : null;
  }

  getAnswer(assignment: Assignment, questionId: number): string {
    return assignment.answers[questionId] || '(No answer submitted)';
  }

  getTotalScore(assignment: Assignment): number {
    return Object.values(assignment.marks).reduce((sum, score) => sum + score, 0);
  }

  getTotalQuestions(assignment: Assignment): number {
    return assignment.questions.length;
  }

  isComplete(assignment: Assignment): boolean {
    return assignment.questions.every(q => assignment.marks[q.id] !== undefined);
  }
}
