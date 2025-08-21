import { Component, OnInit } from '@angular/core';
import { NavController, ToastController } from '@ionic/angular';
import { Auth, createUserWithEmailAndPassword, updateProfile } from '@angular/fire/auth';
import { Firestore, doc, setDoc, serverTimestamp } from '@angular/fire/firestore';

@Component({
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  standalone: false
})
export class RegisterPage implements OnInit {
  // Form data
  username = '';
  email = '';
  password = '';
  agreeToTerms = false;
  showPassword = false;
  isLoading = false;
  showPolicyModal = false;

  constructor(
    private navCtrl: NavController,
    private toastCtrl: ToastController,
    private auth: Auth,
    private firestore: Firestore,
  ) {}

  ngOnInit() {}

  private withTimeout<T>(p: Promise<T>, ms = 8000, label = 'Operasi'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timeout. Periksa koneksi Anda dan coba lagi.`)), ms);
      p.then(v => { clearTimeout(t); resolve(v); }).catch(e => { clearTimeout(t); reject(e); });
    });
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  openPolicy() {
    this.showPolicyModal = true;
  }

  onPolicyDismiss() {
    // no-op; modal state handled by accept/decline
  }

  acceptPolicy() {
    this.agreeToTerms = true;
    this.showPolicyModal = false;
  }

  declinePolicy() {
    this.agreeToTerms = false;
    this.showPolicyModal = false;
  }

  onTermsAttempt(ev: CustomEvent) {
    const willCheck = (ev as any)?.detail?.checked === true;
    if (willCheck && !this.agreeToTerms) {
      // force open modal instead of instantly checking
      this.agreeToTerms = false;
      this.openPolicy();
    } else {
      this.agreeToTerms = !!willCheck;
    }
  }

  async register() {
    if (this.isLoading) return; // prevent double submit

    // Trim inputs
    this.username = this.username?.trim();
    this.email = this.email?.trim();

    if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
      this.presentToast('Tidak ada koneksi internet.', 'danger');
      return;
    }

    // Basic validation
    if (!this.username || !this.email || !this.password) {
      this.presentToast('Harap isi semua field', 'danger');
      return;
    }

    if (this.password.length < 6) {
      this.presentToast('Password minimal 6 karakter', 'danger');
      return;
    }

    if (!this.agreeToTerms) {
      this.presentToast('Anda harus menyetujui kebijakan aplikasi', 'danger');
      this.openPolicy();
      return;
    }

    this.isLoading = true;

    try {
      // 1) Create user in Firebase Auth
      const cred = await this.withTimeout(createUserWithEmailAndPassword(this.auth, this.email, this.password), 8000, 'Pendaftaran');

      // 2) Update display name
      if (cred.user) {
        await updateProfile(cred.user, { displayName: this.username });
      }

      // 3) Save user profile to Firestore (best-effort, NON-BLOCKING)
      const uid = cred.user?.uid as string;
      const userRef = doc(this.firestore, 'users', uid);
      try {
        await this.withTimeout(setDoc(userRef, {
          uid,
          username: this.username,
          email: this.email,
          // consent status can be audited here if needed
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }), 8000, 'Menyimpan profil');
      } catch (e: any) {
        // Jangan blokir pendaftaran jika gagal simpan profil (mis. permission-denied)
        // Lanjutkan navigasi agar user tetap login dan masuk aplikasi.
        // Opsional: bisa log atau tampilkan toast non-kritis jika diperlukan.
      }

      await this.presentToast('Pendaftaran berhasil!', 'success');
      // Navigasi SELALU dilakukan setelah akun berhasil dibuat,
      // terlepas dari status penulisan profil Firestore.
      this.navCtrl.navigateRoot('/home');
    } catch (err: any) {
      const code = err?.code as string | undefined;
      const translated = this.translateFirebaseError(code, err?.message);
      this.presentToast(translated, 'danger');
    } finally {
      this.isLoading = false;
    }
  }

  private translateFirebaseError(code?: string, fallback?: string): string {
    switch (code) {
      case 'auth/email-already-in-use':
        return 'Email sudah terdaftar. Silakan gunakan email lain atau login.';
      case 'auth/invalid-email':
        return 'Format email tidak valid.';
      case 'auth/weak-password':
        return 'Password terlalu lemah. Gunakan minimal 6 karakter.';
      case 'auth/operation-not-allowed':
        return 'Metode pendaftaran tidak diizinkan.';
      case 'auth/network-request-failed':
        return 'Gagal terhubung ke jaringan. Periksa koneksi internet Anda.';
      case 'permission-denied':
        return 'Akses database ditolak. Periksa Firestore Rules untuk mengizinkan user terautentikasi.';
      case 'unavailable':
        return 'Layanan database sementara tidak tersedia. Coba lagi.';
      default:
        return fallback || 'Gagal mendaftar. Coba lagi.';
    }
  }

  async presentToast(message: string, color: 'success' | 'danger' | 'warning') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      color,
      position: 'top'
    });
    await toast.present();
  }

  goToLogin() {
    this.navCtrl.navigateBack('/login');
  }
}
