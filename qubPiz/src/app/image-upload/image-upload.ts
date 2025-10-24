import { Component, Output, EventEmitter, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../api.service';

@Component({
  selector: 'app-image-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './image-upload.html',
  styleUrl: './image-upload.css'
})
export class ImageUpload {
  @Input() currentImageUrl?: string;
  @Output() imageUploaded = new EventEmitter<string>();

  selectedFile: File | null = null;
  previewUrl: string | null = null;
  uploading = false;
  uploadError: string | null = null;

  constructor(private api: ApiService) {}

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.selectedFile = input.files[0];
      
      // Validate file type
      if (!this.selectedFile.type.startsWith('image/')) {
        this.uploadError = 'Please select an image file';
        this.selectedFile = null;
        return;
      }
      
      // Validate file size (5MB)
      if (this.selectedFile.size > 5 * 1024 * 1024) {
        this.uploadError = 'Image must be less than 5MB';
        this.selectedFile = null;
        return;
      }
      
      this.uploadError = null;
      
      // Create preview
      const reader = new FileReader();
      reader.onload = () => {
        this.previewUrl = reader.result as string;
      };
      reader.readAsDataURL(this.selectedFile);
    }
  }

  uploadImage() {
    if (!this.selectedFile) return;

    this.uploading = true;
    this.uploadError = null;

    const formData = new FormData();
    formData.append('image', this.selectedFile);

    this.api.post<{ imageUrl: string }>('/api/questions/upload-image', formData)
      .subscribe({
        next: (response) => {
          this.uploading = false;
          this.imageUploaded.emit(response.imageUrl);
          this.currentImageUrl = response.imageUrl;
        },
        error: (err) => {
          this.uploading = false;
          this.uploadError = err.error?.error || 'Upload failed';
        }
      });
  }

  clearImage() {
    this.selectedFile = null;
    this.previewUrl = null;
    this.uploadError = null;
  }

  getImageUrl(path: string): string {
    return `${this.api.apiBaseUrl}${path}`;
  }
}