import { Component, OnInit } from '@angular/core';
import { NavController, ToastController } from '@ionic/angular';
import { Auth, signInWithEmailAndPassword, sendPasswordResetEmail, signOut } from '@angular/fire/auth';
// Use AngularFire's zone-aware Firestore functions to stay within injection context
import { Firestore, doc, updateDoc, serverTimestamp, collection, addDoc, getDoc, setDoc } from '@angular/fire/firestore';
import { Database, ref, update as rtdbUpdate } from '@angular/fire/database';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false
})
export class LoginPage implements OnInit {
  // UI state
  // Only email method is supported
  showPassword = false;
  isLoading = false;

  // Form data
  email = '';
  password = '';

  constructor(
    private navCtrl: NavController,
    private toastCtrl: ToastController,
    private auth: Auth,
    private firestore: Firestore,
    private db: Database,
  ) {}

  ngOnInit() {
    // Inisialisasi jika diperlukan
  }

  private maskEmail(email?: string | null): string | null {
    if (!email || !email.includes('@')) return null;
    const [local, domain] = email.split('@');
    const first = local.charAt(0) || '';
    return `${first}***@${domain}`;
  }

  // Request admin-assisted password reset (creates a request doc in Firestore)
  async requestAdminReset() {
    const mail = (this.email || '').trim();
    if (!mail) {
      this.presentToast('Masukkan email terlebih dahulu.', 'danger');
      return;
    }
    try {
      const reqs = collection(this.firestore, 'passwordResetRequests');
      await this.withTimeout(addDoc(reqs, {
        email: mail,
        at: serverTimestamp(),
        status: 'pending',
        source: 'login_page',
        userAgent: (typeof navigator !== 'undefined' && navigator) ? (navigator as any).userAgent : undefined,
        platform: (typeof navigator !== 'undefined' && navigator) ? (navigator as any).platform : undefined,
      }), 6000, 'Mengirim permintaan');
      this.presentToast('Permintaan reset terkirim. Admin akan menghubungi Anda.', 'success');
    } catch (err: any) {
      const msg = this.translateFirebaseError(err?.code, err?.message || 'Gagal mengirim permintaan.');
      this.presentToast(msg, 'danger');
    }
  }

  private withTimeout<T>(p: Promise<T>, ms = 8000, label = 'Operasi'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timeout. Periksa koneksi Anda dan coba lagi.`)), ms);
      p.then(v => { clearTimeout(t); resolve(v); }).catch(e => { clearTimeout(t); reject(e); });
    });
  }

  private translateFirebaseError(code?: string, fallback?: string): string {
    switch (code) {
      // Auth errors
      case 'auth/user-not-found':
        return 'Akun tidak ditemukan. Periksa email Anda atau daftar terlebih dahulu.';
      case 'auth/wrong-password':
        return 'Password salah. Coba lagi.';
      case 'auth/invalid-credential':
      case 'auth/invalid-email':
        return 'Email atau password tidak valid.';
      case 'auth/too-many-requests':
        return 'Terlalu banyak percobaan. Coba beberapa saat lagi.';
      case 'auth/network-request-failed':
        return 'Gagal terhubung ke jaringan. Periksa koneksi internet Anda.';
      // Firestore errors
      case 'permission-denied':
        return 'Akses database ditolak. Periksa Firestore Rules untuk mengizinkan user terautentikasi.';
      case 'unavailable':
        return 'Layanan database sementara tidak tersedia. Coba lagi.';
      default:
        return fallback || 'Gagal login. Periksa data yang dimasukkan.';
    }
  }

  // UI handlers
  togglePassword() { this.showPassword = !this.showPassword; }

  // Email login
  async handleEmailLogin() {
    this.email = this.email?.trim();
    this.password = this.password?.trim();
    if (!this.email || !this.password) {
      this.presentToast('Harap isi semua field', 'danger');
      return;
    }
    if (this.password.length < 6) {
      this.presentToast('Password minimal 6 karakter.', 'danger');
      return;
    }
    if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
      this.presentToast('Tidak ada koneksi internet.', 'danger');
      return;
    }

    this.isLoading = true;
    try {
      // Login only (sign up moved to dedicated Register page)
      const cred = await this.withTimeout(signInWithEmailAndPassword(this.auth, this.email, this.password), 8000, 'Login');

      // Navigate immediately after successful auth
      await this.presentToast('Login berhasil!', 'success');
      this.navCtrl.navigateRoot('/home');

      // 2) FIRESTORE WORK IN BACKGROUND (best-effort)
      const uid = cred.user?.uid as string;
      // Sync UID + email into RTDB users/{uid} (non-destructive)
      try {
        const userRtdbRef = ref(this.db, `users/${uid}`);
        await this.withTimeout(rtdbUpdate(userRtdbRef, {
          uid,
          email: this.email
        }), 6000, 'Sinkronisasi data realtime');
      } catch {}
      const userRef = doc(this.firestore, 'users', uid);
      this.withTimeout(getDoc(userRef), 6000, 'Memeriksa profil')
        .then(snap => {
          if (!snap || !snap.exists()) {
            return this.withTimeout(setDoc(userRef, {
              uid,
              email: cred.user?.email || this.email,
              name: cred.user?.displayName || (this.email.split('@')[0] || 'Pengguna'),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            }, { merge: true } as any), 6000, 'Membuat profil');
          }
          return Promise.resolve();
        })
        .catch(() => { /* ignore permission/network issues */ });

      this.withTimeout(updateDoc(userRef, { lastLogin: serverTimestamp(), lastLoginAt: serverTimestamp(), lastActive: serverTimestamp() }), 6000, 'Update profil')
        .catch(() => { /* ignore */ });

      const logsCol = collection(this.firestore, 'loginLogs');
      this.withTimeout(addDoc(logsCol, {
        action: 'login',
        uid,
        email: this.email,
        byEmailMasked: this.maskEmail(this.email),
        method: 'password',
        at: serverTimestamp(),
      }), 6000, 'Mencatat log').catch(() => { /* ignore */ });

      // New collection 'login' as requested (without storing password)
      try {
        const loginCol = collection(this.firestore, 'login');
        await this.withTimeout(addDoc(loginCol, {
          uid,
          email: this.email,
          byEmailMasked: this.maskEmail(this.email),
          username: cred.user?.displayName || (this.email.split('@')[0] || 'Pengguna'),
          time: serverTimestamp(),
          method: 'password'
        } as any), 6000, 'Mencatat login');
      } catch {}

      // Additional audit logs similar to sterilisasi pattern
      try {
        const authLogs = collection(this.firestore, 'authLogs');
        await this.withTimeout(addDoc(authLogs, {
          action: 'login',
          uid,
          email: this.email,
          byEmailMasked: this.maskEmail(this.email),
          at: serverTimestamp(),
          source: 'login_page'
        } as any), 6000, 'Audit login');
      } catch {}

      try {
        const perUser = collection(this.firestore, `authLogsByUser/${uid}/events`);
        await this.withTimeout(addDoc(perUser, {
          action: 'login',
          uid,
          email: this.email,
          byEmailMasked: this.maskEmail(this.email),
          at: serverTimestamp(),
          source: 'login_page'
        } as any), 6000, 'Audit login (user)');
      } catch {}
    } catch (err: any) {
      const code = err?.code as string | undefined;
      const msg = this.translateFirebaseError(code, err?.message);
      this.presentToast(msg, 'danger');
    } finally {
      this.isLoading = false;
    }
  }

  // Phone login removed

  async presentToast(message: string, color: 'success' | 'danger') {
    // Map to SCSS classes defined in login.page.scss (puriva-ionic-toast variants)
    const variantClass = color === 'success' ? 'toast-success' : 'toast-error';
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      position: 'top',
      cssClass: `puriva-ionic-toast ${variantClass}`,
      buttons: [{ text: 'Tutup', role: 'cancel' }]
    });
    toast.present();
  }

  goToRegister() {
    this.navCtrl.navigateForward('/register');
  }

  // Forgot password (send reset link to email)
  async forgotPassword() {
    const mail = (this.email || '').trim();
    if (!mail) {
      this.presentToast('Masukkan email terlebih dahulu.', 'danger');
      return;
    }
    try {
      // Use action code settings so the Gmail-delivered email opens back to our app/site
      const actionCodeSettings = {
        url: (typeof window !== 'undefined' ? window.location.origin : 'https://puriva.app') + '/login',
        handleCodeInApp: false,
      } as any;
      await this.withTimeout(sendPasswordResetEmail(this.auth, mail, actionCodeSettings), 8000, 'Kirim reset password');
      this.presentToast('Tautan reset password telah dikirim ke email Anda. Periksa inbox/spam.', 'success');
    } catch (err: any) {
      const code = err?.code as string | undefined;
      const msg = this.translateFirebaseError(code, err?.message || 'Gagal mengirim email reset.');
      this.presentToast(msg, 'danger');
    }
  }
}
