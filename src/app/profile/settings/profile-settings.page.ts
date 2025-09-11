import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlertController, IonicModule, ToastController, NavController } from '@ionic/angular';
import { Auth, updateProfile } from '@angular/fire/auth';
import { Database, ref, onValue, set, update as rtdbUpdate } from '@angular/fire/database';
import { Firestore, collection, getDocs, query, where, updateDoc, doc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { CloudinaryService } from '../../services/cloudinary.service';

@Component({
  selector: 'app-profile-settings',
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  templateUrl: './profile-settings.page.html',
  styleUrls: ['./profile-settings.page.scss']
})
export class ProfileSettingsPage implements OnInit {
  notifEmail = true;
  isSaving = false;
  // For coordinating with SCSS utilities (e.g., .fade-in on first render)
  isPageReady = false;
  // Privacy modal state
  isPrivacyOpen = false;
  privacy: { profileVisibility: 'public' | 'private'; showEmail: boolean; shareUsage: boolean; activityVisibility: 'everyone' | 'friends' | 'only_me' } = {
    profileVisibility: 'public',
    showEmail: false,
    shareUsage: true,
    activityVisibility: 'everyone',
  };

  // Photo state
  photoPreviewUrl: string | null = null;
  isUploadingPhoto = false;
  photoUploadProgress = 0;
  readonly allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  readonly maxUploadSize = 2 * 1024 * 1024; // 2MB

  // Password state (untuk user Google yang belum punya password)
  isGoogleUser = false;
  hasPassword = false;
  maskedPassword: string | null = null;
  newPassword = '';
  isSavingPassword = false;

  constructor(
    private alertCtrl: AlertController,
    private toast: ToastController,
    private auth: Auth,
    private db: Database,
    private firestore: Firestore,
    private navCtrl: NavController,
    private cloud: CloudinaryService,
  ) {}

  ngOnInit(): void {
    // Load existing notifEmail preference once if logged in
    const user = this.auth.currentUser;
    if (!user) return;
    try {
      const r = ref(this.db, `users/${user.uid}/settings/notifEmail`);
      onValue(r, (snap) => {
        const v = snap.val();
        if (typeof v === 'boolean') {
          this.notifEmail = v;
        }
        // Trigger fade-in once initial data is ready
        this.markPageReady();
      }, { onlyOnce: true } as any);
    } catch { /* ignore */ }
    // Load privacy settings once
    try {
      const privRef = ref(this.db, `users/${user.uid}/privacy`);
      onValue(privRef, (snap) => {
        const v = snap.val() || {};
        this.privacy.profileVisibility = (v.profileVisibility === 'private') ? 'private' : 'public';
        this.privacy.showEmail = !!v.showEmail;
        this.privacy.shareUsage = v.shareUsage !== false;
        const av = v.activityVisibility;
        this.privacy.activityVisibility = (av === 'friends' || av === 'only_me') ? av : 'everyone';
      }, { onlyOnce: true } as any);
    } catch {}
    // Load current photoURL for preview (from RTDB users/{uid}/photoURL or auth)
    try {
      const pRef = ref(this.db, `users/${user.uid}/photoURL`);
      onValue(pRef, (snap) => {
        const url = snap.val() || this.auth.currentUser?.photoURL || null;
        this.photoPreviewUrl = url ? String(url) : null;
      }, { onlyOnce: true } as any);
    } catch {}
    // Fallback to ensure fade-in even if no data is fetched
    setTimeout(() => this.markPageReady(), 0);

    // Tentukan apakah user login via Google dan cek status password terdaftar
    try {
      this.isGoogleUser = Array.isArray(user.providerData) && user.providerData.some((p: any) => p?.providerId === 'google.com');
    } catch { this.isGoogleUser = false; }
    // Muat status password (ada/tidak) dari Firestore
    void this.loadPasswordStatus(user.uid);
  }

  // Handle file input change
  async onPhotoSelected(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement | null;
    const file = input?.files && input.files[0] ? input.files[0] : null;
    if (!file) return;
    // Validate type & size
    if (!this.allowedTypes.includes(file.type)) {
      await this.presentToast('Format tidak didukung. Gunakan JPG, PNG, atau WebP.', 'warning');
      if (input) input.value = '';
      return;
    }
    if (file.size > this.maxUploadSize) {
      await this.presentToast('Ukuran terlalu besar. Maksimal 2MB.', 'warning');
      if (input) input.value = '';
      return;
    }
    await this.uploadProfilePhoto(file);
    // reset input value to allow re-select same file later
    if (input) input.value = '';
  }

  // Upload to Storage and update references
  private async uploadProfilePhoto(file: File): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) { await this.presentToast('Silakan login', 'warning'); return; }
    this.isUploadingPhoto = true;
    this.photoUploadProgress = 0;
    try {
      // Upload to Cloudinary (same as news)
      const result = await this.cloud.uploadImage(file, (pct) => { this.photoUploadProgress = pct; });
      const url = result.secure_url || result.url;
      this.photoPreviewUrl = url;
      // Update Auth profile
      try { await updateProfile(user as any, { photoURL: url }); } catch {}
      // Save to RTDB profile for app usage
      try { await set(ref(this.db, `users/${user.uid}/photoURL`), url); } catch {}
      // Sync to Firestore register as photoURL
      try { await this.updateRegisterDocs(user.uid, { photoURL: url, email: user.email }); } catch {}
      await this.presentToast('Foto profil diperbarui', 'success');
    } catch (e) {
      console.warn('uploadProfilePhoto failed', e);
      await this.presentToast('Gagal mengunggah foto', 'danger');
    } finally {
      this.isUploadingPhoto = false;
    }
  }

  // For template usage (avoid accessing private auth directly)
  get displayInitial(): string {
    const name = this.auth.currentUser?.displayName || 'U';
    return name.charAt(0).toUpperCase();
  }

  async changeDisplayName(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Ubah Nama Tampilan',
      inputs: [{ name: 'displayName', type: 'text', placeholder: 'Nama baru' }],
      buttons: [
        { text: 'Batal', role: 'cancel' },
        {
          text: 'Simpan',
          handler: async (data) => {
            const user = this.auth.currentUser;
            if (!user) { this.presentToast('Silakan login', 'warning'); return; }
            try {
              const newName = (data?.displayName || '').trim();
              if (!newName) { this.presentToast('Nama tidak boleh kosong', 'warning'); return; }
              await updateProfile(user as any, { displayName: newName });
              // Persist ke Realtime DB untuk sinkronisasi UI lainnya
              try { await rtdbUpdate(ref(this.db, `users/${user.uid}`), { username: newName, updatedAt: Date.now() } as any); } catch {}
              // Best-effort: update Firestore users doc (abaikan error permission)
              try { await updateDoc(doc(this.firestore as any, 'users', user.uid), { username: newName, updatedAt: serverTimestamp() } as any); } catch {}
              // Per permintaan: kirim ke koleksi 'register' (sertakan email) — best effort, jangan tampilkan peringatan jika gagal
              await this.updateRegisterDocs(user.uid, { username: newName, email: user.email });
              this.presentToast('Nama tampilan diperbarui', 'success');
            } catch {
              this.presentToast('Gagal memperbarui nama', 'danger');
            }
          }
        }
      ]
    });
    await alert.present();
  }

  // changePassword dihapus sesuai permintaan

  // Open privacy modal
  async openPrivacy(): Promise<void> {
    this.isPrivacyOpen = true;
  }

  // Close privacy modal
  closePrivacy(): void {
    this.isPrivacyOpen = false;
  }

  // Save privacy settings to RTDB
  async savePrivacy(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) { await this.presentToast('Silakan login', 'warning'); return; }
    this.isSaving = true;
    try {
      await rtdbUpdate(ref(this.db, `users/${user.uid}/privacy`), {
        profileVisibility: this.privacy.profileVisibility,
        showEmail: !!this.privacy.showEmail,
        shareUsage: !!this.privacy.shareUsage,
        activityVisibility: this.privacy.activityVisibility,
        updatedAt: Date.now(),
      } as any);
      await this.presentToast('Privasi disimpan', 'success');
      this.isPrivacyOpen = false;
    } catch {
      await this.presentToast('Gagal menyimpan privasi', 'danger');
    } finally {
      this.isSaving = false;
    }
  }

  // Export user's data as JSON (basic set)
  async exportMyData(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) { await this.presentToast('Silakan login', 'warning'); return; }
    try {
      // Gather RTDB user profile
      const { get, child } = await import('@angular/fire/database');
      const profileSnap = await get(child(ref(this.db), `users/${user.uid}`) as any);
      const profileData = profileSnap.val() || {};
      // Gather authored news and forum contributions (basic)
      const newsSnap = await get(child(ref(this.db), 'news/items') as any);
      const forumSnap = await get(child(ref(this.db), 'forum/discussions') as any);
      const allNews = (newsSnap.val() || {}) as Record<string, any>;
      const allForum = (forumSnap.val() || {}) as Record<string, any>;
      const myNews = Object.values(allNews).filter((n: any) => n?.authorUid === user.uid || (n?.authorEmail && n.authorEmail === user.email));
      const myThreads: any[] = []; const myComments: any[] = [];
      for (const v of Object.values<any>(allForum)) {
        if ((v?.authorUid || '') === user.uid) myThreads.push(v);
        const cs = v?.comments;
        if (cs && typeof cs === 'object') {
          for (const c of Object.values<any>(cs)) if ((c?.authorUid || '') === user.uid) myComments.push(c);
        } else if (Array.isArray(cs)) {
          for (const c of cs) if ((c?.authorUid || '') === user.uid) myComments.push(c);
        }
      }
      const dump = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        profile: profileData,
        privacy: this.privacy,
        activity: { threads: myThreads, comments: myComments },
        news: myNews,
        exportedAt: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `puriva-data-${user.uid}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      await this.presentToast('Data diunduh', 'success');
    } catch (e) {
      console.warn('exportMyData failed', e);
      await this.presentToast('Gagal mengekspor data', 'danger');
    }
  }

  onNotifEmailChange(ev?: any): void {
    // Persisting preference can be added here if needed
    const enabled = this.notifEmail === true;
    void this.saveNotifPreference(enabled);
  }

  // Refresh aplikasi: arahkan ke Home jika sudah login, selain itu ke Login; lalu reload penuh
  refreshApp(): void {
    try {
      const isLoggedIn = !!this.auth.currentUser;
      const target = isLoggedIn ? '/home' : '/login';
      // Navigate within Ionic first so upon reload the initial screen is Home/Login accordingly
      this.navCtrl.navigateRoot(target).then(() => {
        // Give a tick for navigation to settle, then hard reload to clear any buggy state
        setTimeout(() => {
          try { window.location.reload(); } catch { /* ignore */ }
        }, 50);
      });
    } catch {
      // Fallback: try hard reload
      try { window.location.reload(); } catch {}
    }
  }

  private async saveNotifPreference(enabled: boolean): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) { await this.presentToast('Silakan login', 'warning'); return; }
    this.isSaving = true;
    try {
      await set(ref(this.db, `users/${user.uid}/settings/notifEmail`), enabled);
      await this.presentToast(`Notifikasi email ${enabled ? 'aktif' : 'nonaktif'}`, 'success');
    } catch {
      await this.presentToast('Gagal menyimpan preferensi', 'danger');
    } finally {
      this.isSaving = false;
    }
  }

  // Utility to coordinate with SCSS .fade-in usage
  private markPageReady(): void {
    if (this.isPageReady) return;
    // schedule on next frame for smoother animation
    requestAnimationFrame(() => this.isPageReady = true);
  }

  private async presentToast(message: string, color: 'success' | 'warning' | 'danger') {
    const t = await this.toast.create({ message, duration: 1500, color });
    await t.present();
  }

  // ===== Password helpers =====
  private maskPassword(pw: string): string {
    const s = (pw || '').toString();
    if (s.length <= 2) return '*'.repeat(Math.max(1, s.length));
    return `${s[0]}${'*'.repeat(Math.max(1, s.length - 2))}${s[s.length - 1]}`;
  }

  private async loadPasswordStatus(uid: string): Promise<void> {
    try {
      // Cek koleksi 'register' untuk password/kodeAkses
      const colRef = collection(this.firestore, 'register');
      const q1 = query(colRef as any, where('uid', '==', uid));
      const q2 = query(colRef as any, where('userId', '==', uid));
      const q3 = query(colRef as any, where('userID', '==', uid));
      const [r1, r2, r3] = await Promise.all([getDocs(q1 as any), getDocs(q2 as any), getDocs(q3 as any)]);
      const docs: any[] = Array.from(new Set([...(r1?.docs || []), ...(r2?.docs || []), ...(r3?.docs || [])] as any)) as any[];
      let found: any = null;
      if (docs.length > 0) {
        // Prioritaskan field 'kodeAkses' lalu 'password'
        for (const d of docs) {
          const data = (d as any).data() || {};
          const val = (data.kodeAkses || data.password || '').toString();
          if (val) { found = val; break; }
        }
      }
      // Jika belum ditemukan, cek dokumen 'users/{uid}' untuk 'kodeAkses'
      if (!found) {
        try {
          const uref = doc(this.firestore as any, 'users', uid);
          const { getDoc } = await import('@angular/fire/firestore');
          const snap = await getDoc(uref as any);
          const data = snap?.data() || {} as any;
          const val = (data?.kodeAkses || data?.password || '').toString();
          if (val) found = val;
        } catch {}
      }
      if (found) {
        this.hasPassword = true;
        this.maskedPassword = this.maskPassword(found);
      } else {
        this.hasPassword = false;
        this.maskedPassword = null;
      }
    } catch {
      // Diamkan error agar UI tetap jalan
    }
  }

  async addPassword(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) { await this.presentToast('Silakan login', 'warning'); return; }
    const pw = (this.newPassword || '').trim();
    if (pw.length < 6) { await this.presentToast('Password minimal 6 karakter', 'warning'); return; }
    this.isSavingPassword = true;
    try {
      // Simpan ke koleksi 'register' dan mirror ke 'kodeAkses'
      await this.updateRegisterDocs(user.uid, { password: pw });
      // Best-effort: simpan juga ke dokumen 'users/{uid}'
      try { await updateDoc(doc(this.firestore as any, 'users', user.uid), { kodeAkses: pw, updatedAt: serverTimestamp() } as any); } catch {}
      this.newPassword = '';
      await this.loadPasswordStatus(user.uid);
      await this.presentToast('Password berhasil ditambahkan', 'success');
    } catch {
      await this.presentToast('Gagal menyimpan password', 'danger');
    } finally {
      this.isSavingPassword = false;
    }
  }

  // Cari dan perbarui dokumen di koleksi Firestore 'register' milik uid saat ini.
  // Kriteria: where uid == uid atau userId/userID == uid. Jika tidak ada, buat doc baru dengan id = uid.
  // Selalu sertakan email (jika tersedia) dan jika payload mengandung 'password', mirror ke 'kodeAkses' juga.
  private async updateRegisterDocs(uid: string, payload: Record<string, any>): Promise<boolean> {
    try {
      const user = this.auth.currentUser;
      const enriched: Record<string, any> = { ...payload };
      if (user?.email && !('email' in enriched)) enriched['email'] = user.email;
      if (user?.displayName && !('username' in enriched)) enriched['username'] = user.displayName;
      if (typeof enriched['password'] === 'string' && !('kodeAkses' in enriched)) {
        enriched['kodeAkses'] = enriched['password'];
      }
      // Always bump updatedAt on any write
      enriched['updatedAt'] = serverTimestamp();
      const colRef = collection(this.firestore, 'register');
      const q1 = query(colRef as any, where('uid', '==', uid));
      const q2 = query(colRef as any, where('userId', '==', uid));
      const q3 = query(colRef as any, where('userID', '==', uid));
      const [r1, r2, r3] = await Promise.all([getDocs(q1 as any), getDocs(q2 as any), getDocs(q3 as any)]);
      const targets = Array.from(new Set([...(r1?.docs || []), ...(r2?.docs || []), ...(r3?.docs || [])] as any));
      if (targets.length > 0) {
        await Promise.all(targets.map((d: any) => updateDoc(d.ref, enriched as any)));
      } else {
        // Fallback: buat dokumen baru dengan id uid
        const docRef = doc(this.firestore as any, 'register', uid);
        const base: Record<string, any> = {
          uid,
          email: enriched['email'] || null,
          username: enriched['username'] || null,
          password: enriched['password'] || null,
          kodeAkses: enriched['kodeAkses'] || enriched['password'] || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          source: 'profile-update'
        };
        await setDoc(docRef as any, { ...base, ...enriched }, { merge: true } as any);
      }
      return true;
    } catch (e) {
      // Log senyap agar tidak mengganggu UX
      console.warn('updateRegisterDocs failed', e);
      return false;
    }
  }
}
