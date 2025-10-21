import { Component, Input, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ImageUpload } from '../../image-upload/image-upload';

interface Round {
  id: number;
  game_session_id: number;
  name: string;
  round_type: string;
  round_order: number;
  created_at: string;
}

interface Question {
  id: number;
  round_id: number;
  question_text: string;
  answer: string;
  image_url: string | null;
  question_order: number;
  created_at: string;
}

@Component({
  selector: 'app-question-manager',
  standalone: true,
  imports: [CommonModule, FormsModule, ImageUpload],
  templateUrl: './question-manager.html',
  styleUrl: './question-manager.css'
})
export class QuestionManager implements OnInit {
  @Input() currentRound: Round | null = null;
  
  questions: Question[] = [];
  
  // For text rounds - separate question/answer pairs
  newTextQuestion = {
    text: '',
    answer: ''
  };
  
  // For image rounds - one question text, multiple image/answer pairs
  imageRoundQuestion = '';
  newImageItem = {
    imageUrl: '',
    answer: ''
  };

  constructor(private http: HttpClient) {}

  ngOnInit() {
    if (this.currentRound) {
      this.loadQuestions();
    }
  }

  ngOnChanges() {
    if (this.currentRound) {
      this.loadQuestions();
      this.resetForms();
    }
  }

  get isImageRound(): boolean {
    return this.currentRound?.round_type === 'image';
  }

  get isTextRound(): boolean {
    return this.currentRound?.round_type === 'text';
  }

  loadQuestions() {
    if (!this.currentRound) return;
    
    this.http.get<{ questions: Question[] }>(
      `http://localhost:3000/api/rounds/${this.currentRound.id}/questions`
    ).subscribe(data => {
      this.questions = data.questions;
      // For image rounds, use the first question's text as the round question
      if (this.isImageRound && this.questions.length > 0) {
        this.imageRoundQuestion = this.questions[0].question_text;
      }
    });
  }

  onImageUploaded(imageUrl: string) {
    this.newImageItem.imageUrl = imageUrl;
  }

  // For text rounds - traditional Q&A
  saveTextQuestion() {
    if (!this.newTextQuestion.text.trim()) {
      alert('Please enter a question');
      return;
    }

    if (!this.newTextQuestion.answer.trim()) {
      alert('Please enter an answer');
      return;
    }

    this.http.post('http://localhost:3000/api/questions', {
      round_id: this.currentRound!.id,
      question_text: this.newTextQuestion.text,
      answer: this.newTextQuestion.answer,
      image_url: null
    }).subscribe(() => {
      this.loadQuestions();
      this.newTextQuestion = { text: '', answer: '' };
    });
  }

  // For image rounds - add image with answer to the shared question
  addImageItem() {
    if (!this.imageRoundQuestion.trim()) {
      alert('Please enter the main question for this picture round');
      return;
    }

    if (!this.newImageItem.imageUrl) {
      alert('Please upload an image');
      return;
    }

    if (!this.newImageItem.answer.trim()) {
      alert('Please enter an answer for this image');
      return;
    }

    // All images in the round share the same question_text
    this.http.post('http://localhost:3000/api/questions', {
      round_id: this.currentRound!.id,
      question_text: this.imageRoundQuestion,
      answer: this.newImageItem.answer,
      image_url: this.newImageItem.imageUrl
    }).subscribe(() => {
      this.loadQuestions();
      this.newImageItem = { imageUrl: '', answer: '' };
    });
  }

  deleteQuestion(questionId: number) {
    if (confirm('Delete this question?')) {
      // TODO: Add delete endpoint to backend
      console.log('Delete question:', questionId);
    }
  }

  resetForms() {
    this.newTextQuestion = { text: '', answer: '' };
    this.newImageItem = { imageUrl: '', answer: '' };
    this.imageRoundQuestion = '';
  }
}