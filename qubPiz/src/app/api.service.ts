import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly baseUrl: string;

  constructor(private http: HttpClient) {
    // Determine base URL based on environment
    if (typeof window === 'undefined') {
      this.baseUrl = 'http://localhost:3000';
    } else {
      const hostname = window.location.hostname;

      // GitHub Codespaces - use port-forwarded URL
      if (hostname.includes('github.dev')) {
        const baseHost = hostname.replace('-4200.app.github.dev', '');
        this.baseUrl = `${window.location.protocol}//${baseHost}-3000.app.github.dev`;
      }
      // Local development
      else if (hostname === 'localhost') {
        this.baseUrl = 'http://localhost:3000';
      }
      // Production - use relative URLs (same origin via Nginx proxy)
      else {
        this.baseUrl = '';
      }
    }
  }

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
