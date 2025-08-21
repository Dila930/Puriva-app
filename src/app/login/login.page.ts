import { Component, OnInit } from '@angular/core';
import { NavController, ToastController } from '@ionic/angular';
import { Auth, signInWithEmailAndPassword, signOut } from '@angular/fire/auth';
// Use AngularFire's zone-aware Firestore functions to stay within injection context
import { Firestore, doc, updateDoc, serverTimestamp, collection, addDoc, getDoc, setDoc } from '@angular/fire/firestore';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false
})
export class LoginPage implements OnInit {
  // UI state
  currentMethod: 'email' | 'phone' = 'email';
  otpSent = false;
  showPassword = false;
  isLoading = false;

  // Form data
  email = '';
  password = '';
  phoneNumber = '';
  otpCode = '';

  constructor(
    private navCtrl: NavController,
    private toastCtrl: ToastController,
    private auth: Auth,
    private firestore: Firestore,
  ) {}

  ngOnInit() {
    // Tempat inisialisasi Auth/Service jika diperlukan
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

      this.withTimeout(updateDoc(userRef, { lastLogin: serverTimestamp() }), 6000, 'Update profil')
        .catch(() => { /* ignore */ });

      const logsCol = collection(this.firestore, 'loginLogs');
      this.withTimeout(addDoc(logsCol, {
        uid,
        email: this.email,
        method: 'password',
        at: serverTimestamp(),
      }), 6000, 'Mencatat log').catch(() => { /* ignore */ });
    } catch (err: any) {
      const code = err?.code as string | undefined;
      const msg = this.translateFirebaseError(code, err?.message);
      this.presentToast(msg, 'danger');
    } finally {
      this.isLoading = false;
    }
  }

  // Phone: kirim OTP (belum diintegrasikan)
  async sendOTP() {
    if (!this.phoneNumber || this.phoneNumber.length < 8) {
      this.presentToast('Nomor telepon tidak valid', 'danger');
      return;
    }

    this.isLoading = true;
    try {
      // Integrasi OTP via Firebase Phone Auth dapat ditambahkan nanti
      await this.presentToast('OTP berhasil dikirim! (simulasi)', 'success');
      this.otpSent = true;
    } finally {
      this.isLoading = false;
    }
  }

  // Phone: verifikasi OTP (belum diintegrasikan)
  async verifyOTP() {
    if (!this.otpCode || this.otpCode.length !== 6) {
      this.presentToast('Kode OTP tidak valid', 'danger');
      return;
    }

    this.isLoading = true;
    try {
      // Integrasi verifikasi OTP via Firebase Phone Auth nanti
      await this.presentToast('Verifikasi berhasil! (simulasi)', 'success');
      this.navCtrl.navigateRoot('/home');
    } finally {
      this.isLoading = false;
    }
  }

  backToPhoneForm() {
    this.otpSent = false;
    this.otpCode = '';
  }

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
}
