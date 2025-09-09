import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { 
  IonicModule, 
  ToastController, 
  LoadingController,
  NavController 
} from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Database, ref, push, set } from '@angular/fire/database';

@Component({
  selector: 'app-forum-create',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    IonicModule, 
    RouterModule
  ],
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
  isTopicFocused = false;
  isContentFocused = false;

  categories = [
    'Umum', 
    'Teknologi', 
    'Kesehatan', 
    'Panduan',
    'Diskusi',
    'Tanya Jawab',
    'Lainnya'
  ];
  
  quickActions = [
    { 
      title: 'Buat Berita', 
      icon: 'newspaper-outline',
      route: '/news/create'
    },
    { 
      title: 'Lihat Forum', 
      icon: 'chatbubbles-outline',
      route: '/forum'
    }
  ];

  constructor(
    private router: Router, 
    private auth: Auth, 
    private db: Database, 
    private toast: ToastController,
    private loadingCtrl: LoadingController,
    private navCtrl: NavController
  ) {}

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
    
    const loading = await this.loadingCtrl.create({
      message: 'Menyimpan diskusi...',
      duration: 3000,
      spinner: 'crescent'
    });
    
    try {
      this.isSaving = true;
      await loading.present();
      
      const node = ref(this.db, `forum/discussions`);
      const keyRef = push(node);
      
      const discussionData = {
        topic: this.topic.trim(),
        category: this.category,
        content: this.content.trim(),
        createdAt: Date.now(),
        authorUid: user.uid,
        authorName: user.displayName || 'Pengguna',
        likeCount: 0,
        commentCount: 0,
        viewCount: 0
      };
      
      await set(keyRef, discussionData);
      
      await loading.dismiss();
      await this.presentToast('Diskusi berhasil dibuat!', 'success');
      
      // Navigate to the new discussion
      this.router.navigate(['/forum']);
      
    } catch (error) {
      console.error('Error saving discussion:', error);
      await loading.dismiss();
      await this.presentToast('Gagal menyimpan diskusi. Silakan coba lagi.', 'danger');
    } finally {
      this.isSaving = false;
    }
  }

  cancel(): void {
    if (this.topic.trim() || this.content.trim()) {
      // Show confirmation if there's unsaved content
      if (confirm('Apakah Anda yakin ingin membatalkan? Perubahan yang belum disimpan akan hilang.')) {
        this.navCtrl.back();
      }
    } else {
      this.navCtrl.back();
    }
  }

  private async presentToast(
    message: string, 
    color: 'success' | 'warning' | 'danger' | 'primary' = 'primary',
    duration: number = 3000,
    position: 'top' | 'bottom' | 'middle' = 'bottom'
  ) {
    const toast = await this.toast.create({
      message,
      duration,
      position,
      color,
      buttons: [
        {
          icon: 'close',
          role: 'cancel',
          handler: () => {
            console.log('Toast dismissed');
          }
        }
      ]
    });
    
    await toast.present();
    return toast.onDidDismiss();
  }
}
