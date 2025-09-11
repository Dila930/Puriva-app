import { Component, OnInit } from '@angular/core';
import { NavController, ToastController, Platform } from '@ionic/angular';
import { Auth, createUserWithEmailAndPassword, updateProfile, GoogleAuthProvider, signInWithPopup } from '@angular/fire/auth';
import { Firestore, doc, setDoc, serverTimestamp, collection, addDoc, getDoc } from '@angular/fire/firestore';
import { Database, ref, set as rtdbSet, serverTimestamp as rtdbServerTimestamp } from '@angular/fire/database';
import { Router, NavigationExtras } from '@angular/router';

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
  typingPassword = false; // used to hide eye icon while typing
  isLoading = false;
  showPolicyModal = false;

  isGoogleSignUp = false;
  googleUserData: any = null;

  constructor(
    private navCtrl: NavController,
    private toastCtrl: ToastController,
    private auth: Auth,
    private firestore: Firestore,
    private rtdb: Database,
    private router: Router,
    private platform: Platform
  ) {
    const navigation = this.router.getCurrentNavigation();
    const state = navigation?.extras.state as {
      googleUser: any;
      isGoogleSignUp: boolean;
    };

    if (state?.isGoogleSignUp && state.googleUser) {
      this.isGoogleSignUp = true;
      this.googleUserData = state.googleUser;
      this.email = this.googleUserData.email;
    }
  }

  ngOnInit() {}

  private maskEmail(email?: string | null): string | null {
    if (!email || !email.includes('@')) return null;
    const [local, domain] = email.split('@');
    const first = local.charAt(0) || '';
    return `${first}***@${domain}`;
  }

  private withTimeout<T>(p: Promise<T>, ms = 30000, label = 'Operasi'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timeout. Periksa koneksi Anda dan coba lagi.`)), ms);
      p.then(v => { clearTimeout(t); resolve(v); }).catch(e => { clearTimeout(t); reject(e); });
    });
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  onPasswordFocus() {
    this.typingPassword = true;
  }

  onPasswordBlur() {
    // give a slight delay to avoid flicker when clicking the eye icon right after blur
    setTimeout(() => {
      this.typingPassword = false;
    }, 50);
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
    if ((!this.isGoogleSignUp && !this.password) || !this.username || !this.email) {
      this.presentToast('Harap isi semua field', 'danger');
      return;
    }

    if (!this.isGoogleSignUp && this.password.length < 6) {
      this.presentToast('Password minimal 6 karakter', 'danger');
      return;
    }

    if (!this.agreeToTerms) {
      this.presentToast('Anda harus menyetujui kebijakan aplikasi', 'danger');
      this.openPolicy();
      return;
    }

    this.isLoading = true;
    const form = document.querySelector('.puriva-form-section');
    form?.classList.add('form-loading');

    try {
      let uid: string;
      let emailVerified = false;

      if (this.isGoogleSignUp && this.googleUserData) {
        // For Google sign-up, use the existing Google user
        const provider = new GoogleAuthProvider();
        provider.addScope('email');
        provider.addScope('profile');
        
        const result = await signInWithPopup(this.auth, provider);
        const user = result.user;
        uid = user.uid;
        emailVerified = user.emailVerified;
      } else {
        // Regular email/password sign-up
        const result = await this.withTimeout(
          createUserWithEmailAndPassword(this.auth, this.email, this.password),
          8000,
          'Pendaftaran'
        );
        
        uid = result.user.uid;
        emailVerified = result.user.emailVerified;
        
        // Update display name for email/password sign-up
        await updateProfile(result.user, { displayName: this.username });
      }

      // Get the next sequential user ID
      const counterRef = doc(this.firestore, 'counters', 'users');
      const counterSnap = await getDoc(counterRef);
      let nextId = 1000; // Starting ID
      
      if (counterSnap.exists()) {
        nextId = (counterSnap.data()['count'] || 1000) + 1;
      }
      
      // Update the counter for next time
      await setDoc(counterRef, { count: nextId }, { merge: true });
      
      // Format the sequential ID with leading zeros (e.g., UID1000, UID1001, etc.)
      const sequentialId = `UID${nextId.toString().padStart(4, '0')}`;

      // Prepare user data for Firestore
      const userData: any = {
        uid,
        sequentialId,
        username: this.username,
        email: this.email,
        displayName: this.username,
        emailVerified: this.isGoogleSignUp || emailVerified,
        isGoogleSignUp: this.isGoogleSignUp,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
        lastActive: serverTimestamp(),
      };

      // Add Google-specific fields if available
      if (this.isGoogleSignUp && this.googleUserData) {
        userData.photoURL = this.googleUserData.photoURL || null;
        userData.providerData = ['google'];
      } else {
        userData.kodeAkses = this.password; // Only store password for email/password users
      }

      // Save user profile to Firestore
      const userRef = doc(this.firestore, 'users', uid);
      await setDoc(userRef, userData, { merge: true });

      // Create/update register record
      try {
        const regDoc = doc(this.firestore, 'register', uid);
        await setDoc(regDoc, {
          uid,
          username: this.username,
          email: this.email,
          createdAt: serverTimestamp(),
          ...(this.isGoogleSignUp ? {} : { kodeAkses: this.password })
        }, { merge: true });
      } catch (e: any) {
        console.warn('Failed to update register collection:', e);
      }

      // Update Realtime Database
      try {
        const userRtdbRef = ref(this.rtdb, `users/${uid}`);
        await rtdbSet(userRtdbRef, {
          uid,
          email: this.email,
          username: this.username,
          displayName: this.username,
          photoURL: this.googleUserData?.photoURL || null,
          provider: this.isGoogleSignUp ? 'google' : 'password',
          lastActive: rtdbServerTimestamp(),
          createdAt: this.isGoogleSignUp ? rtdbServerTimestamp() : rtdbServerTimestamp(),
          updatedAt: rtdbServerTimestamp(),
        });
      } catch (e) {
        console.warn('Failed to update Realtime Database:', e);
      }

      // Log the registration
      try {
        const authLogsCol = collection(this.firestore, 'authLogs');
        await addDoc(authLogsCol, {
          action: 'register',
          uid,
          email: this.email,
          byEmailMasked: this.maskEmail(this.email),
          method: this.isGoogleSignUp ? 'google' : 'email',
          at: serverTimestamp(),
          source: 'register_page'
        });
      } catch (e) {
        console.warn('Failed to log registration:', e);
      }

      // Show success message and navigate
      await this.presentToast('Pendaftaran berhasil!', 'success');

      // Navigate to home page
      this.navCtrl.navigateRoot('/home');
    } catch (error: any) {
      console.error('Registration error:', error);
      let errorMessage = 'Terjadi kesalahan saat mendaftar. Silakan coba lagi.';

      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'Email sudah terdaftar. Silakan gunakan email lain.';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'Password terlalu lemah. Gunakan minimal 6 karakter.';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Format email tidak valid.';
      } else if (error.code === 'auth/account-exists-with-different-credential') {
        errorMessage = 'Akun sudah terdaftar dengan metode login yang berbeda.';
      }

      this.presentToast(errorMessage, 'danger');
    } finally {
      this.isLoading = false;
      form?.classList.remove('form-loading');
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
