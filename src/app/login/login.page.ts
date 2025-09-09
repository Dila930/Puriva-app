import { Component, OnInit } from '@angular/core';
import { NavController, ToastController } from '@ionic/angular';
import { Auth, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, signInWithPopup, GoogleAuthProvider } from '@angular/fire/auth';
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

  private async checkConnection(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator) {
      return false;
    }

    // Check basic online status
    if (!navigator.onLine) {
      return false;
    }

    // Check connection type and effective type if available
    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (connection) {
      // Check if connection is slow (2g or slow-2g)
      if (connection.effectiveType && ['slow-2g', '2g'].includes(connection.effectiveType)) {
        return false;
      }
      
      // Check if connection type is none (offline)
      if (connection.type === 'none') {
        return false;
      }
    }

    // Additional check by pinging a reliable server
    try {
      await fetch('https://www.google.com/favicon.ico', { 
        method: 'HEAD',
        cache: 'no-store',
        mode: 'no-cors'
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  private withTimeout<T>(p: Promise<T>, ms = 12000, label = 'Operasi'): Promise<T> {
    return new Promise<T>(async (resolve, reject) => {
      // First check connection status
      const isConnected = await this.checkConnection();
      if (!isConnected) {
        reject(new Error('Tidak ada koneksi internet yang stabil. Mohon periksa jaringan Anda.'));
        return;
      }

      // Set timeout for the operation
      const t = setTimeout(() => {
        reject(new Error(`${label} timeout. Periksa koneksi internet Anda dan coba lagi.`));
      }, ms);

      // Execute the promise
      p.then(v => { 
        clearTimeout(t); 
        resolve(v); 
      }).catch(e => { 
        clearTimeout(t); 
        reject(e); 
      });
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
      case 'auth/popup-closed-by-user':
        return 'Jendela pop-up Google ditutup.';
      // Firestore errors
      case 'permission-denied':
        return 'Akses database ditolak. Periksa Firestore Rules untuk mengizinkan user terautentikasi.';
      case 'unavailable':
        return 'Layanan database sementara tidak tersedia. Coba lagi.';
      default:
        return fallback || 'Gagal login. Periksa data yang dimasukkan.';
    }
  }

  // Email login
  async handleEmailLogin() {
    this.email = this.email?.trim();
    this.password = this.password?.trim();
    
    if (!this.email || !this.password) {
      this.presentToast('Harap isi semua field', 'danger');
      return;
    }
    
    if (this.password.length < 6) {
      this.presentToast('Password minimal 6 karakter', 'danger');
      return;
    }

    // Add loading class to form
    const form = document.querySelector('.puriva-form-section');
    form?.classList.add('form-loading');
    this.isLoading = true;
    
    try {
      // Check connection before proceeding
      const isConnected = await this.checkConnection();
      if (!isConnected) {
        this.presentToast('Tidak ada koneksi internet yang stabil. Mohon periksa jaringan Anda.', 'danger');
        this.isLoading = false;
        return;
      }

      // Increased timeout to 12 seconds for login operation
      const cred = await this.withTimeout(
        signInWithEmailAndPassword(this.auth, this.email, this.password),
        12000, // Increased timeout to 12 seconds
        'Login'
      );
      
      await this.presentToast('Login berhasil!', 'success');
      this.navCtrl.navigateRoot('/home');
      this.postLoginData(cred.user?.uid as string, this.email);
    } catch (err: any) {
      const code = err?.code as string | undefined;
      const msg = this.translateFirebaseError(code, err?.message);
      this.presentToast(msg, 'danger');
      console.error('Login error:', err);
    } finally {
      this.isLoading = false;
      form?.classList.remove('form-loading');
    }
  }

  // Google login
  async handleGoogleLogin() {
    this.isLoading = true;
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      // Perbaikan: Ubah batas waktu dari 8000 menjadi 15000 milidetik
      const cred = await this.withTimeout(signInWithPopup(this.auth, provider), 15000, 'Login dengan Google');
      await this.presentToast('Login berhasil!', 'success');
      this.navCtrl.navigateRoot('/home');
      this.postLoginData(cred.user?.uid as string, cred.user?.email as string, cred.user?.displayName as string, 'google');
    } catch (err: any) {
      const code = err?.code as string | undefined;
      const msg = this.translateFirebaseError(code, err?.message);
      this.presentToast(msg, 'danger');
    } finally {
      this.isLoading = false;
    }
  }

  private postLoginData(uid: string, email: string, name?: string, method = 'password') {
    // 2) FIRESTORE WORK IN BACKGROUND (best-effort)
    const userRtdbRef = ref(this.db, `users/${uid}`);
    this.withTimeout(rtdbUpdate(userRtdbRef, {
      uid,
      email
    }), 6000, 'Sinkronisasi data realtime').catch(() => {});
    
    const userRef = doc(this.firestore, 'users', uid);
    this.withTimeout(getDoc(userRef), 6000, 'Memeriksa profil')
      .then(snap => {
        if (!snap || !snap.exists()) {
          return this.withTimeout(setDoc(userRef, {
            uid,
            email,
            name: name || (email.split('@')[0] || 'Pengguna'),
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
      email,
      byEmailMasked: this.maskEmail(email),
      method,
      at: serverTimestamp(),
    }), 6000, 'Mencatat log').catch(() => { /* ignore */ });

    try {
      const loginCol = collection(this.firestore, 'login');
      this.withTimeout(addDoc(loginCol, {
        uid,
        email,
        byEmailMasked: this.maskEmail(email),
        username: name || (email.split('@')[0] || 'Pengguna'),
        time: serverTimestamp(),
        method
      } as any), 6000, 'Mencatat login').catch(() => {});
    } catch {}

    try {
      const authLogs = collection(this.firestore, 'authLogs');
      this.withTimeout(addDoc(authLogs, {
        action: 'login',
        uid,
        email,
        byEmailMasked: this.maskEmail(email),
        at: serverTimestamp(),
        source: 'login_page'
      } as any), 6000, 'Audit login').catch(() => {});
    } catch {}

    try {
      const perUser = collection(this.firestore, `authLogsByUser/${uid}/events`);
      this.withTimeout(addDoc(perUser, {
        action: 'login',
        uid,
        email,
        byEmailMasked: this.maskEmail(email),
        at: serverTimestamp(),
        source: 'login_page'
      } as any), 6000, 'Audit login (user)').catch(() => {});
    } catch {}
  }

  async presentToast(message: string, color: 'success' | 'danger') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      position: 'top',
      cssClass: `puriva-toast puriva-toast-${color}`,
      buttons: [{
        icon: 'close',
        role: 'cancel'
      }],
      mode: 'md',
      animated: true,
      keyboardClose: true,
      translucent: true
    });
    await toast.present();
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