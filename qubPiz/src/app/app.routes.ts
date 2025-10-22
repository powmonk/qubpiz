// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { Lobby } from './lobby/lobby';
import { Mc } from './mc/mc';
import { PictureRound } from './picture-round/picture-round';
import { QuestionRound } from './question-round/question-round';
import { Marking } from './marking/marking';

export const routes: Routes = [
  { path: '', component: Lobby },  // Changed from Home to Lobby
  { path: 'mc', component: Mc },
  { path: 'round/picture', component: PictureRound },
  { path: 'round/question', component: QuestionRound },
  { path: 'marking', component: Marking }
];