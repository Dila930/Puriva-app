import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { BottomNavComponent } from '../components/bottom-nav/bottom-nav.component';
import { Auth, onAuthStateChanged, User, updateProfile } from '@angular/fire/auth';
import { Database, ref, onValue, Unsubscribe, set } from '@angular/fire/database';

// Typed stat model for dashboard cards
interface ProfileStat { number: string; label: string; change?: number }

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterModule, BottomNavComponent]
})
export class ProfilePage implements OnInit, OnDestroy {
  constructor(private router: Router, private auth: Auth, private db: Database, private toast: ToastController) {}
  
  // Get current active tab based on URL
  get activeTab(): string {
    const url = this.router.url.split('/')[1];
    return url || 'home';
  }

  profile: { initials: string; name: string; role: string; stats: ProfileStat[] } = {
    initials: 'U',
    name: 'Pengguna',
    role: 'Pengguna PURIVA',
    stats: [
      { number: '0', label: 'Sterilisasi' },
      { number: '0', label: 'Diskusi' },
      { number: '0', label: 'Artikel' }
    ]
  };

  // Store current user's email to display masked variant
  userEmail: string = '';

  menuItems = [
    {
      title: 'Pengaturan Akun',
      subtitle: 'Ubah kata sandi & informasi pribadi',
      icon: 'settings-outline',
      details:
        'Kelola profil Anda: ubah nama tampilan, perbarui email, dan ganti kata sandi. Di sini juga dapat mengatur preferensi notifikasi dan privasi akun.'
    },
    {
      title: 'Riwayat Aktivitas',
      subtitle: 'Lihat riwayat sterilisasi & interaksi',
      icon: 'analytics-outline',
      details:
        'Pantau aktivitas Anda di PURIVA: jumlah sterilisasi, diskusi yang diikuti, komentar, dan artikel yang disimpan. Gunakan filter untuk melihat periode tertentu.'
    },
    {
      title: 'Pusat Bantuan',
      subtitle: 'FAQ, hubungi CS & panduan',
      icon: 'help-circle-outline',
      details:
        'Temukan jawaban cepat di FAQ, baca panduan penggunaan aplikasi, atau hubungi layanan pelanggan jika membutuhkan bantuan lebih lanjut.'
    },
    {
      title: 'Keluar',
      subtitle: 'Keluar dari akun Anda',
      icon: 'log-out-outline',
      details:
        'Akhiri sesi saat ini pada perangkat ini. Anda dapat login kembali kapan saja menggunakan email dan kata sandi yang terdaftar.'
    }
  ];

  // Help Center configuration
  helpEmail = 'fadhilahnormaghfiroh@gmail.com';
  commonIssues: string[] = [
    'Tidak bisa masuk (login)',
    'Lupa kata sandi',
    'Verifikasi email tidak diterima',
    'Aplikasi lambat atau error',
    'Data/progres tidak tersimpan',
    'Masukan dan saran fitur baru',
  ];

  onMenuClick(menu: any) {
    if (menu.title === 'Keluar') {
      this.logout();
      return;
    }
    // Navigate to profile detail pages
    switch (menu.title) {
      case 'Pengaturan Akun':
        this.router.navigate(['/profile/settings']);
        break;
      case 'Riwayat Aktivitas':
        this.router.navigate(['/profile/activity']);
        break;
      case 'Pusat Bantuan':
        this.router.navigate(['/profile/help']);
        break;
      default:
        console.log('Clicked menu:', menu.title);
    }
  }

  // Open Gmail compose with prefilled subject & body
  openHelp(issue: string): void {
    const to = encodeURIComponent(this.helpEmail);
    const subject = encodeURIComponent(`[PURIVA] Bantuan: ${issue}`);
    const userInfo = this.userEmail ? `\n\nEmail terdaftar: ${this.userEmail}` : '';
    const bodyText = `Halo Tim PURIVA,\n\nSaya mengalami masalah terkait: ${issue}.\n\nMohon bantuannya.${userInfo}\n\nTerima kasih.`;
    const body = encodeURIComponent(bodyText);
    const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${subject}&body=${body}`;
    try {
      window.open(url, '_blank');
    } catch {
      // no-op if pop-up blocked; user can try again
    }
  }

  // Prompt user for custom issue and open Gmail
  openHelpOther(): void {
    const other = window.prompt('Jelaskan masalah Anda:');
    if (other && other.trim()) {
      this.openHelp(other.trim());
    }
  }

  // Bottom nav navigations
  goToHome(): void {
    this.router.navigate(['/home']);
  }

  goToControl(): void {
    this.router.navigate(['/control']);
  }

  goToEducation(): void {
    this.router.navigate(['/news']);
  }

  goToForum(): void {
    this.router.navigate(['/forum']);
  }

  goToProfile(): void {
    this.router.navigate(['/profile']);
  }

  goToNotifications(): void {
    this.router.navigate(['/notifikasi']);
  }

  // ===== Firebase bindings =====
  private authUnsub?: Unsubscribe;
  private steriUnsub?: Unsubscribe;
  private prefUnsub?: Unsubscribe;

  // Settings state
  settings: { displayName: string; emailNotifications: boolean } = {
    displayName: '',
    emailNotifications: true,
  };

  isSaving = false;

  ngOnInit(): void {
    this.authUnsub = onAuthStateChanged(this.auth as any, (user: User | null) => {
      // Clear previous listener
      if (this.steriUnsub) { try { this.steriUnsub(); } catch {} }
      this.steriUnsub = undefined;
      if (this.prefUnsub) { try { this.prefUnsub(); } catch {} }
      this.prefUnsub = undefined;

      if (!user) {
        this.profile.name = 'Pengguna';
        this.profile.initials = 'U';
        this.profile.stats[0].number = '0';
        this.settings.displayName = '';
        this.settings.emailNotifications = true;
        this.userEmail = '';
        return;
      }
      const name = user.displayName || user.email || 'Pengguna';
      this.profile.name = name;
      this.profile.initials = this.computeInitials(name);
      this.settings.displayName = user.displayName || '';
      this.userEmail = user.email || '';

      // Listen total sterilizations today (same source as Home)
      const nodeRef = ref(this.db, `users/${user.uid}/stats/totalToday`);
      this.steriUnsub = onValue(nodeRef, (snap) => {
        const val = snap.val();
        const total = typeof val === 'number' ? val : 0;
        this.profile.stats[0].number = String(total);
      });

      // Listen preference email notifications
      const prefRef = ref(this.db, `users/${user.uid}/preferences/emailNotifications`);
      this.prefUnsub = onValue(prefRef, (snap) => {
        const val = snap.val();
        this.settings.emailNotifications = typeof val === 'boolean' ? val : true;
      });
    });
  }

  ngOnDestroy(): void {
    if (this.steriUnsub) { try { this.steriUnsub(); } catch {} }
    if (this.authUnsub) { try { (this.authUnsub as any)(); } catch {} }
    if (this.prefUnsub) { try { this.prefUnsub(); } catch {} }
  }

  private computeInitials(nameOrEmail: string): string {
    const src = (nameOrEmail || '').trim();
    if (!src) return 'U';
    const clean = src.includes('@') ? src.split('@')[0] : src;
    const parts = clean.split(/[\s._-]+/).filter(Boolean);
    const first = parts[0]?.[0] || 'U';
    const second = parts.length > 1 ? parts[1][0] : '';
    return (first + second).toUpperCase();
  }

  // Mask email as: first char + ***** + last char + @gmail.com
  get maskedEmail(): string {
    const local = (this.userEmail || '').split('@')[0] || '';
    if (!local) return 'x*****x@gmail.com';
    const first = local[0];
    const last = local[local.length - 1];
    return `${first}*****${last}@gmail.com`;
  }

  async logout(): Promise<void> {
    try {
      // signOut imported from @angular/fire/auth is not used here to keep minimal imports.
      // Use dynamic import to avoid top-level import churn.
      const { signOut } = await import('@angular/fire/auth');
      await signOut(this.auth);
      this.router.navigate(['/login']);
    } catch (e) {
      console.warn('Logout failed', e);
    }
  }

  async saveSettings(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) {
      await this.presentToast('Silakan login terlebih dahulu.', 'warning');
      return;
    }
    this.isSaving = true;
    try {
      const displayName = (this.settings.displayName || '').trim();
      await updateProfile(user, { displayName: displayName || undefined });

      const prefRef = ref(this.db, `users/${user.uid}/preferences/emailNotifications`);
      await set(prefRef, !!this.settings.emailNotifications);

      await this.presentToast('Pengaturan berhasil disimpan.', 'success');
    } catch (e) {
      console.warn('saveSettings failed', e);
      await this.presentToast('Gagal menyimpan pengaturan. Coba lagi.', 'danger');
    } finally {
      this.isSaving = false;
    }
  }

  private async presentToast(message: string, color: 'success' | 'warning' | 'danger') {
    const t = await this.toast.create({ message, color, duration: 2200, position: 'bottom' });
    await t.present();
  }
}