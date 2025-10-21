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

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadCurrentQuiz();
    this.loadAllQuizzes();
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

  onRoundSelected(round: Round) {
    this.selectedRound = round;
  }
}