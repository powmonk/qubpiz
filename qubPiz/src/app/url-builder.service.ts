import { Injectable } from '@angular/core';
import { GameStatusService } from './game-status-service';

@Injectable({
  providedIn: 'root'
})
export class UrlBuilderService {
  constructor(private gameStatusService: GameStatusService) {}

  /**
   * Builds a URL with the current session parameter if available
   * @param path The base API path (e.g., '/api/players')
   * @param includeSession Whether to include the session parameter (default: true)
   * @returns The URL with session parameter appended if session exists
   *
   * @example
   * buildUrl('/api/players') // Returns '/api/players?session=ABC' if session exists
   * buildUrl('/api/players', false) // Returns '/api/players' (no session)
   */
  buildUrl(path: string, includeSession: boolean = true): string {
    if (!includeSession) {
      return path;
    }

    const session = this.gameStatusService.getCurrentSession();
    if (!session) {
      return path;
    }

    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}session=${session}`;
  }
}
