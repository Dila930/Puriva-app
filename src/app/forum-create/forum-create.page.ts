import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Database, ref, push, set } from '@angular/fire/database';

@Component({
  selector: 'app-forum-create',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterModule],
  template: `
  <ion-header>
    <ion-toolbar color="primary">
      <ion-title>Tambah Diskusi</ion-title>
    </ion-toolbar>
  </ion-header>

  <ion-content class="ion-padding">
    <ion-item>
      <ion-label position="stacked">Topik</ion-label>
      <ion-input [(ngModel)]="topic" placeholder="Judul/topik diskusi"></ion-input>
    </ion-item>

    <ion-item>
      <ion-label position="stacked">Kategori</ion-label>
      <ion-select [(ngModel)]="category">
        <ion-select-option *ngFor="let c of categories" [value]="c">{{ c }}</ion-select-option>
      </ion-select>
    </ion-item>

    <ion-item lines="full">
      <ion-label position="stacked">Konten</ion-label>
      <ion-textarea [(ngModel)]="content" auto-grow="true" rows="8" placeholder="Tulis isi diskusi..."></ion-textarea>
    </ion-item>

    <ion-row class="ion-padding-top">
      <ion-col size="6">
        <ion-button expand="block" color="medium" (click)="cancel()" [disabled]="isSaving">Batal</ion-button>
      </ion-col>
      <ion-col size="6">
        <ion-button expand="block" color="primary" (click)="save()" [disabled]="isSaving">Simpan</ion-button>
      </ion-col>
    </ion-row>
  </ion-content>
  `,
  styles: [
    `.ion-padding-top { padding-top: 16px; }`
  ]
})
export class ForumCreatePage {
  topic = '';
  category = 'Umum';
  content = '';
  isSaving = false;

  categories = ['Umum', 'Teknologi', 'Kesehatan', 'Panduan'];

  constructor(private router: Router, private auth: Auth, private db: Database, private toast: ToastController) {}

  async save(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) {
      this.router.navigate(['/login']);
      return;
    }
    if (!this.topic.trim() || !this.content.trim()) {
      await this.presentToast('Topik dan konten wajib diisi', 'warning');
      return;
    }
    this.isSaving = true;
    try {
      const node = ref(this.db, `forum/discussions`);
      const keyRef = push(node);
      await set(keyRef, {
        topic: this.topic.trim(),
        category: this.category,
        content: this.content.trim(),
        createdAt: Date.now(),
        authorUid: user.uid
      });
      await this.presentToast('Diskusi berhasil dibuat', 'success');
      this.router.navigate(['/forum']);
    } catch (e) {
      console.warn('save forum failed', e);
      await this.presentToast('Gagal menyimpan diskusi', 'danger');
    } finally {
      this.isSaving = false;
    }
  }

  cancel(): void {
    this.router.navigate(['/forum']);
  }

  private async presentToast(message: string, color: 'success' | 'warning' | 'danger') {
    const t = await this.toast.create({ message, color, duration: 2200, position: 'bottom' });
    await t.present();
  }
}
