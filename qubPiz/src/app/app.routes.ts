// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { Lobby } from './lobby/lobby';
import { Mc } from './mc/mc';
import { RoundComponent } from './round/round';
import { Marking } from './marking/marking';

export const routes: Routes = [
  { path: '', component: Lobby },
  { path: 'lobby', component: Lobby },
  { path: 'mc', component: Mc },
  { path: 'round/picture', component: RoundComponent, data: { roundType: 'picture' } },
  { path: 'round/music', component: RoundComponent, data: { roundType: 'music' } },
  { path: 'round/question', component: RoundComponent, data: { roundType: 'question' } },
  { path: 'marking', component: Marking }
];