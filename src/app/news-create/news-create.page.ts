import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Database, ref, push, set, update, get, child } from '@angular/fire/database';
import { isAdmin } from '../utils/admin-ids';
import { ActivatedRoute } from '@angular/router';

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
  isSaving = false;
  editId?: string;
  existing: any | null = null;

  categories = ['Umum', 'Teknologi', 'Kesehatan', 'Panduan'];

  constructor(private router: Router, private auth: Auth, private db: Database, private toast: ToastController, private route: ActivatedRoute) {}

  get isEdit(): boolean { return !!this.editId; }

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
