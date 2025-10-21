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
  selector: 'app-picture-round',
  standalone: true,
  imports: [CommonModule, TitleCasePipe],
  templateUrl: './picture-round.html',
  styleUrl: './picture-round.css'
})
export class PictureRound implements OnInit, OnDestroy {
  currentRound: RoundDisplayData['round'] = null;
  questions: Question[] = [];
  pollSubscription: Subscription = new Subscription();
  
  private baseUrl = 'http://localhost:3000'; 
  private expectedType = 'picture';

  constructor(private http: HttpClient, private router: Router) {}

  ngOnInit() {
    this.pollSubscription = interval(3000).pipe(
      startWith(0), 
      switchMap(() => this.http.get<RoundDisplayData>(`${this.baseUrl}/api/game/display-data`))
    ).subscribe(data => {
      
      // If MC clears display OR switches to a different round type, redirect to lobby
      if (!data.round || data.round.round_type !== this.expectedType) {
        // Lobby poller will handle redirecting the player back to the root ('/')
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
      // Ensure the URL is correctly constructed to fetch the image from the server
      return `${this.baseUrl}${path}`;
    }
    return '';
  }
}