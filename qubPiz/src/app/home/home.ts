// src/app/home/home.component.ts
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';


@Component({
  selector: 'app-home',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './home.html',
  styleUrl: './home.css'
})
export class Home{
  playerName: string = '';
  
  constructor(private router: Router) {}

  onSubmit() {
    this.router.navigate(['/play'], {
      queryParams: {name: this.playerName }
    });
  }
}