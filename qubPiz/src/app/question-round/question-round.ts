import { Component, OnInit, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription, interval } from 'rxjs';
import { switchMap, startWith } from 'rxjs/operators';

interface Question {
  id: number;
  question_text: string;
  image_url: string | null;
  question_order: number;
}

interface RoundDisplayData {
  round: {
    id: number;
    name: string;
    round_type: string;
  } | null;
  questions: Question[];
}

@Component({
  selector: 'app-question-round',
  standalone: true,
  imports: [CommonModule, TitleCasePipe],
  templateUrl: './question-round.html',
  styleUrl: './question-round.css'
})
export class QuestionRound implements OnInit, OnDestroy {
  currentRound: RoundDisplayData['round'] = null;
  questions: Question[] = [];
  pollSubscription: Subscription = new Subscription();
  
  private baseUrl = 'http://localhost:3000'; 

  constructor(private http: HttpClient, private router: Router) {}

  ngOnInit() {
    this.pollSubscription = interval(3000).pipe(
      startWith(0), 
      switchMap(() => this.http.get<RoundDisplayData>(`${this.baseUrl}/api/game/display-data`))
    ).subscribe(data => {
      
      // If MC clears display OR switches to a picture round, redirect to lobby
      if (!data.round || data.round.round_type === 'picture') {
         this.router.navigate(['/lobby']);
         return;
      }
      
      this.currentRound = data.round;
      this.questions = data.questions;
      
    }, error => {
      console.error('Error fetching display data:', error);
      this.router.navigate(['/lobby']);
    });
  }

  ngOnDestroy() {
    if (this.pollSubscription) {
      this.pollSubscription.unsubscribe();
    }
  }
  
  getImageUrl(path: string | null): string {
    if (path) {
      return `${this.baseUrl}${path}`;
    }
    return '';
  }
}