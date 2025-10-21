import { Component, OnInit, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
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
  selector: 'app-round-display',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './round-display.html',
  styleUrl: './round-display.css'
})
export class RoundDisplayComponent implements OnInit, OnDestroy {
  currentRound: RoundDisplayData['round'] = null;
  questions: Question[] = [];
  pollSubscription: Subscription = new Subscription();
  
  private baseUrl = 'http://localhost:3000'; 

  constructor(private http: HttpClient) {}

  ngOnInit() {
    // Poll the server every 3 seconds for the currently displayed round data
    this.pollSubscription = interval(3000).pipe(
      startWith(0), // Trigger immediately on load
      switchMap(() => this.http.get<RoundDisplayData>(`${this.baseUrl}/api/game/display-data`))
    ).subscribe(data => {
      this.currentRound = data.round;
      this.questions = data.questions;
      
      // Clear questions if the MC clears the display
      if (!this.currentRound) {
         this.questions = [];
      }
    }, error => {
      console.error('Error fetching display data:', error);
      // In a real app, you might redirect back to the lobby on error or MC clears game
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