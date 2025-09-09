import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController } from '@ionic/angular';
import { Auth, sendPasswordResetEmail } from '@angular/fire/auth';

@Component({
  selector: 'app-profile-help',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './profile-help.page.html',
  styleUrls: ['./profile-help.page.scss']
})
export class ProfileHelpPage implements OnInit {
  // Used by SCSS `.fade-in` utility if bound in template
  isPageReady = false;
  userEmail = '';

  constructor(private auth: Auth, private toast: ToastController) {}

  ngOnInit(): void {
    // Mark page as ready to allow CSS transitions/animations
    setTimeout(() => { this.isPageReady = true; }, 0);
    // Capture current user email (if any)
    this.userEmail = this.auth.currentUser?.email || '';
  }

  async sendResetEmail(): Promise<void> {
    const email = this.auth.currentUser?.email || this.userEmail;
    if (!email) {
      const t = await this.toast.create({ message: 'Tidak ada email akun. Silakan login kembali.', color: 'warning', duration: 2200 });
      await t.present();
      return;
    }
    try {
      await sendPasswordResetEmail(this.auth, email);
      const t = await this.toast.create({ message: `Email reset terkirim ke ${email}.`, color: 'success', duration: 2200 });
      await t.present();
    } catch (e) {
      const t = await this.toast.create({ message: 'Gagal mengirim email reset. Coba lagi.', color: 'danger', duration: 2200 });
      await t.present();
    }
  }
}
