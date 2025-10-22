import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GameStatusService } from '../game-status-service';
import { ApiService } from '../api.service';

interface Question {
  id: number;
  question_text: string;
  image_url: string | null;
  question_order: number;
  correct_answer: string;
}

interface Assignment {
  assignment_id: number;
  markee_name: string;
  round_id: number;
  round_name: string;
  round_type: string;
  questions: Question[];
  answers: { [questionId: number]: string };
  marks: { [questionId: number]: number };
}

@Component({
  selector: 'app-marking',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './marking.html',
  styleUrl: './marking.css'
})
export class Marking implements OnInit {
  assignments: Assignment[] = [];
  playerName: string = '';
  loading: boolean = true;
  errorMessage: string = '';

  constructor(
    private api: ApiService,
    private gameStatusService: GameStatusService
  ) {}

  ngOnInit() {
    this.playerName = this.gameStatusService.getCurrentPlayer() || '';

    if (!this.playerName) {
      this.errorMessage = 'You need to join the game first';
      this.loading = false;
      return;
    }

    this.loadAssignments();
  }

  loadAssignments() {
    console.log('Loading marking assignments for player:', this.playerName);
    this.api.get<{ assignments: Assignment[] }>(
      `/api/marking/assignments/${this.playerName}`
    ).subscribe({
      next: (data) => {
        console.log('Received assignments:', data);
        this.assignments = data.assignments;
        this.loading = false;
        if (this.assignments.length === 0) {
          console.log('No assignments found - marking may not have been triggered yet');
        }
      },
      error: (err) => {
        console.error('Error loading assignments:', err);
        console.error('Error details:', err.error);
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
