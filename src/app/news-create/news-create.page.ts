import { Component, OnInit, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Database, ref, push, set, update, get, child } from '@angular/fire/database';
import { isAdmin } from '../utils/admin-ids';
import { ActivatedRoute } from '@angular/router';
import { CloudinaryService } from '../services/cloudinary.service';

@Component({
  selector: 'app-news-create',
  templateUrl: './news-create.page.html',
  styleUrls: ['./news-create.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterModule]
})
export class NewsCreatePage implements OnInit {
  title = '';
  category = 'Umum';
  content = '';
  imageUrl = '';
  isSaving = false;
  // upload state
  isUploading = false;
  uploadProgress = 0;
  editId?: string;
  existing: any | null = null;
  readonly maxUploadSize = 1 * 1024 * 1024; // 1MB
  readonly allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

  // Form interaction state for styling (success/error) in SCSS
  touchedTitle = false;
  touchedCategory = false;
  touchedContent = false;

  categories = ['Umum', 'Teknologi', 'Kesehatan', 'Panduan'];

  constructor(
    private router: Router,
    private auth: Auth,
    private db: Database,
    private toast: ToastController,
    private route: ActivatedRoute,
    private zone: NgZone,
    private cloud: CloudinaryService,
  ) {}

  get isEdit(): boolean { return !!this.editId; }

  // Field validity getters used by template classes
  get titleValid(): boolean { return this.title.trim().length > 0; }
  get categoryValid(): boolean { return !!this.category && this.category.trim().length > 0; }
  get contentValid(): boolean { return this.content.trim().length > 0; }
  get formValid(): boolean { return this.titleValid && this.categoryValid && this.contentValid; }

  async ngOnInit(): Promise<void> {
    this.editId = this.route.snapshot.paramMap.get('id') || undefined;
    if (this.isEdit) {
      try {
        const snap = await get(ref(this.db, `news/items/${this.editId}`));
        const val = snap.val();
        if (val) {
          this.existing = val;
          this.title = val.title || '';
          this.category = val.category || 'Umum';
          this.content = val.content || '';
          this.imageUrl = val.thumbnail || '';
        }
      } catch (e) {
        console.warn('failed load news for edit', e);
        await this.presentToast('Gagal memuat data berita', 'danger');
      }
    }
  }

  async save(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) {
      this.router.navigate(['/login']);
      return;
    }
    if (!isAdmin(this.auth)) {
      await this.presentToast('Hanya admin yang dapat menambah berita', 'danger');
      return;
    }
    if (!this.title.trim() || !this.content.trim()) {
      await this.presentToast('Judul dan konten wajib diisi', 'warning');
      return;
    }
    this.isSaving = true;
    try {
      if (this.isEdit) {
        const path = `news/items/${this.editId}`;
        await update(ref(this.db, path), {
          title: this.title.trim(),
          category: this.category,
          content: this.content.trim(),
          thumbnail: (this.imageUrl || '').trim(),
          updatedAt: Date.now(),
        });
        await this.presentToast('Berita berhasil diperbarui', 'success');
        this.router.navigate(['/news']);
      } else {
        const node = ref(this.db, `news/items`);
        const keyRef = push(node);
        const id = keyRef.key as string;
        await set(keyRef, {
          id,
          title: this.title.trim(),
          category: this.category,
          content: this.content.trim(),
          thumbnail: (this.imageUrl || '').trim(),
          createdAt: Date.now(),
          authorUid: user.uid,
          authorEmail: user.email || null,
          authorMaskedEmail: user.email ? this.maskEmail(user.email) : null
        });
        await this.presentToast('Berita berhasil ditambahkan', 'success');
        this.router.navigate(['/news']);
      }
    } catch (e) {
      console.warn('save news failed', e);
      await this.presentToast('Gagal menyimpan berita', 'danger');
    } finally {
      this.isSaving = false;
    }
  }

  onSubmit(): void {
    // Mark as touched to trigger SCSS success/error classes
    this.touchedTitle = true;
    this.touchedCategory = true;
    this.touchedContent = true;

    if (this.isUploading) {
      // Prevent saving while upload in progress
      return;
    }
    if (!this.formValid) {
      return;
    }
    void this.save();
  }

  async onFileSelected(evt: Event): Promise<void> {
    const input = evt.target as HTMLInputElement;
    const file = input?.files && input.files[0];
    if (!file) return;
    // Validate type
    if (!this.allowedTypes.includes(file.type)) {
      await this.presentToast('Format tidak didukung. Gunakan JPG, PNG, atau WebP.', 'warning');
      if (input) input.value = '';
      return;
    }
    // Validate size
    if (file.size > this.maxUploadSize) {
      const mb = (this.maxUploadSize / (1024*1024)).toFixed(0);
      await this.presentToast(`Ukuran terlalu besar. Maksimal ${mb}MB.`, 'warning');
      if (input) input.value = '';
      return;
    }
    const user = this.auth.currentUser;
    if (!user) {
      await this.presentToast('Harap login untuk mengunggah gambar', 'warning');
      this.router.navigate(['/login']);
      return;
    }

    try {
      this.isUploading = true;
      this.uploadProgress = 0;
      const result = await this.cloud.uploadImage(file, (pct) => {
        this.zone.run(() => { this.uploadProgress = pct; });
      });
      this.zone.run(() => { this.imageUrl = result.secure_url || result.url; this.uploadProgress = 100; });
      await this.presentToast('Gambar berhasil diunggah', 'success');
    } catch (e) {
      console.warn('upload image failed', e);
      await this.presentToast('Gagal mengunggah gambar', 'danger');
    } finally {
      this.zone.run(() => { this.isUploading = false; });
      if (input) input.value = '';
    }
  }

  cancel(): void {
    this.router.navigate(['/news']);
  }

  private async presentToast(message: string, color: 'success' | 'warning' | 'danger') {
    const t = await this.toast.create({ message, color, duration: 2200, position: 'bottom' });
    await t.present();
  }

  private maskEmail(email: string): string {
    if (!email || !email.includes('@')) return '';
    const [local, domain] = email.split('@');
    const first = local.charAt(0) || '';
    return `${first}***@${domain}`;
  }
}
