import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  // Single source of truth for API base URL
  // In production, uses same host as the app (served by Nginx)
  // In development, uses localhost:3000
  private readonly baseUrl = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? '' // Use relative URLs in production (same origin)
    : 'http://localhost:3000';

  constructor(private http: HttpClient) {}

  // Helper method to construct full URLs
  getUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  // Convenience methods for common HTTP operations
  get<T>(path: string): Observable<T> {
    return this.http.get<T>(this.getUrl(path));
  }

  post<T>(path: string, body: any): Observable<T> {
    return this.http.post<T>(this.getUrl(path), body);
  }

  put<T>(path: string, body: any): Observable<T> {
    return this.http.put<T>(this.getUrl(path), body);
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(this.getUrl(path));
  }

  // Getter for components that need to construct image URLs, etc.
  get apiBaseUrl(): string {
    return this.baseUrl;
  }
}
