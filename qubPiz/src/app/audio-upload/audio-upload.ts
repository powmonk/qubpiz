import { Component, Output, EventEmitter, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../api.service';

@Component({
  selector: 'app-audio-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './audio-upload.html',
  styleUrl: './audio-upload.css'
})
export class AudioUpload {
  @Input() currentAudioUrl?: string;
  @Output() audioUploaded = new EventEmitter<string>();

  selectedFile: File | null = null;
  uploading = false;
  uploadError: string | null = null;

  constructor(private api: ApiService) {}

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.selectedFile = input.files[0];

      // Validate file type
      if (!this.selectedFile.type.startsWith('audio/')) {
        this.uploadError = 'Please select an audio file';
        this.selectedFile = null;
        return;
      }

      // Validate file size (10MB)
      if (this.selectedFile.size > 10 * 1024 * 1024) {
        this.uploadError = 'Audio must be less than 10MB';
        this.selectedFile = null;
        return;
      }

      this.uploadError = null;
    }
  }

  uploadAudio() {
    if (!this.selectedFile) return;

    this.uploading = true;
    this.uploadError = null;

    const formData = new FormData();
    formData.append('audio', this.selectedFile);

    this.api.post<{ audioUrl: string }>('/api/questions/upload-audio', formData)
      .subscribe({
        next: (response) => {
          this.uploading = false;
          this.audioUploaded.emit(response.audioUrl);
          this.currentAudioUrl = response.audioUrl;
        },
        error: (err) => {
          this.uploading = false;
          this.uploadError = err.error?.error || 'Upload failed';
        }
      });
  }

  clearAudio() {
    this.selectedFile = null;
    this.uploadError = null;
  }

  getAudioUrl(path: string): string {
    return `${this.api.apiBaseUrl}${path}`;
  }
}
