import axios, { AxiosRequestConfig, AxiosProgressEvent } from 'axios';
import { Injectable } from '@angular/core';

export interface CloudinaryUploadResult {
  asset_id: string;
  public_id: string;
  secure_url: string;
  url: string;
  bytes: number;
  format: string;
  width: number;
  height: number;
}

@Injectable({ providedIn: 'root' })
export class CloudinaryService {
  private readonly cloudName = 'dhmzt4naz';
  private readonly uploadPreset = 'puriva-app';

  async uploadImage(
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<CloudinaryUploadResult> {
    const endpoint = `https://api.cloudinary.com/v1_1/${this.cloudName}/image/upload`;

    const form = new FormData();
    form.append('file', file);
    form.append('upload_preset', this.uploadPreset); // unsigned preset on Cloudinary

    const config: AxiosRequestConfig = {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      onUploadProgress: (e: AxiosProgressEvent) => {
        if (!e.total) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        onProgress?.(pct);
      },
    };

    const res = await axios.post<CloudinaryUploadResult>(endpoint, form, config);
    return res.data;
  }
}
