import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ImageUpload } from '../../image-upload/image-upload';
import { AudioUpload } from '../../audio-upload/audio-upload';
import { ApiService } from '../../api.service';
import { Round, Question } from '../../shared/types';

@Component({
  selector: 'app-question-manager',
  standalone: true,
  imports: [CommonModule, FormsModule, ImageUpload, AudioUpload],
  templateUrl: './question-manager.html',
  styleUrl: './question-manager.css'
})
export class QuestionManager implements OnInit, OnChanges {
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

  // For multiple choice rounds - question with 3 options
  newMultipleChoice = {
    text: '',
    correctAnswer: '',
    wrongAnswer1: '',
    wrongAnswer2: ''
  };

  // For music rounds - one question text, multiple audio/answer pairs
  musicRoundQuestion = '';
  newMusicItem = {
    audioUrl: '',
    answer: ''
  };

  constructor(private api: ApiService) {}

  ngOnInit() {
    if (this.currentRound) {
      this.loadQuestions();
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['currentRound'] && this.currentRound) {
      this.loadQuestions();
      this.resetForms();
    }
  }

  // FIXED: Check for 'picture' instead of 'image'
  get isImageRound(): boolean {
    return this.currentRound?.round_type === 'picture';
  }

  get isTextRound(): boolean {
    return this.currentRound?.round_type === 'text';
  }

  get isMultipleChoiceRound(): boolean {
    return this.currentRound?.round_type === 'multiple_choice';
  }

  get isMusicRound(): boolean {
    return this.currentRound?.round_type === 'music';
  }

  loadQuestions() {
    if (!this.currentRound) return;
    
    this.api.get<{ questions: Question[] }>(
      `/api/rounds/${this.currentRound.id}/questions`
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

  onAudioUploaded(audioUrl: string) {
    this.newMusicItem.audioUrl = audioUrl;
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

    this.api.post('/api/questions', {
      round_id: this.currentRound!.id,
      question_text: this.newTextQuestion.text,
      answer: this.newTextQuestion.answer,
      image_url: null
    }).subscribe({
      next: () => {
        this.loadQuestions();
        this.newTextQuestion = { text: '', answer: '' };
      },
      error: (err) => {
        console.error('Error saving question:', err);
        alert('Error saving question: ' + (err.error?.error || 'Unknown error'));
      }
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
    this.api.post('/api/questions', {
      round_id: this.currentRound!.id,
      question_text: this.imageRoundQuestion,
      answer: this.newImageItem.answer,
      image_url: this.newImageItem.imageUrl
    }).subscribe({
      next: () => {
        this.loadQuestions();
        this.newImageItem = { imageUrl: '', answer: '' };
      },
      error: (err) => {
        console.error('Error adding image:', err);
        alert('Error adding image: ' + (err.error?.error || 'Unknown error'));
      }
    });
  }

  deleteQuestion(questionId: number) {
    if (confirm('Delete this question?')) {
      this.api.delete(`/api/questions/${questionId}`)
        .subscribe({
          next: () => {
            this.loadQuestions();
          },
          error: (err) => {
            console.error('Error deleting question:', err);
            alert('Error deleting question: ' + (err.error?.error || 'Unknown error'));
          }
        });
    }
  }

  getImageUrl(path: string | null): string {
    if (path) {
      return `${this.api.apiBaseUrl}${path}`;
    }
    return '';
  }

  // For music rounds - add audio with answer to the shared question
  addMusicItem() {
    if (!this.musicRoundQuestion.trim()) {
      console.log('Please enter the main question for this music round');
      return;
    }

    if (!this.newMusicItem.audioUrl) {
      console.log('Please upload an audio file');
      return;
    }

    if (!this.newMusicItem.answer.trim()) {
      console.log('Please enter an answer for this audio');
      return;
    }

    // All audio files in the round share the same question_text
    this.api.post('/api/questions', {
      round_id: this.currentRound!.id,
      question_text: this.musicRoundQuestion,
      answer: this.newMusicItem.answer,
      image_url: null,
      audio_url: this.newMusicItem.audioUrl
    }).subscribe({
      next: () => {
        this.loadQuestions();
        this.newMusicItem = { audioUrl: '', answer: '' };
      },
      error: (err) => {
        console.error('Error adding audio:', err);
      }
    });
  }

  // For multiple choice rounds - add question with 3 options
  saveMultipleChoice() {
    if (!this.newMultipleChoice.text.trim()) {
      console.log('Please enter a question');
      return;
    }

    if (!this.newMultipleChoice.correctAnswer.trim()) {
      console.log('Please enter the correct answer');
      return;
    }

    if (!this.newMultipleChoice.wrongAnswer1.trim() ||
        !this.newMultipleChoice.wrongAnswer2.trim()) {
      console.log('Please enter all 2 wrong answers');
      return;
    }

    // Build options array: correct answer first (order 0), then wrong answers (order 1-2)
    const options = [
      this.newMultipleChoice.correctAnswer,
      this.newMultipleChoice.wrongAnswer1,
      this.newMultipleChoice.wrongAnswer2
    ];

    this.api.post('/api/questions', {
      round_id: this.currentRound!.id,
      question_text: this.newMultipleChoice.text,
      answer: this.newMultipleChoice.correctAnswer,  // Store correct answer for validation
      image_url: null,
      options: options
    }).subscribe({
      next: () => {
        this.loadQuestions();
        this.newMultipleChoice = {
          text: '',
          correctAnswer: '',
          wrongAnswer1: '',
          wrongAnswer2: ''
        };
      },
      error: (err) => {
        console.error('Error saving multiple choice question:', err);
      }
    });
  }

  getAudioUrl(path: string | null | undefined): string {
    if (path) {
      return `${this.api.apiBaseUrl}${path}`;
    }
    return '';
  }

  resetForms() {
    this.newTextQuestion = { text: '', answer: '' };
    this.newImageItem = { imageUrl: '', answer: '' };
    this.imageRoundQuestion = '';
    this.newMusicItem = { audioUrl: '', answer: '' };
    this.musicRoundQuestion = '';
    this.newMultipleChoice = {
      text: '',
      correctAnswer: '',
      wrongAnswer1: '',
      wrongAnswer2: ''
    };
  }
}