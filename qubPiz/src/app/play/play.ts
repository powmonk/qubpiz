// src/app/play/play.ts
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-play',
  standalone: true,
  imports: [],
  templateUrl: './play.html',
  styleUrl: './play.css'
})

export class Play implements OnInit {
  playerName: string = '';

  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
    this.playerName = this.route.snapshot.queryParams['name'] || 'Guest';
  }
}