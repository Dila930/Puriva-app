import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlertController, IonicModule, ToastController } from '@ionic/angular';
import { Auth, updatePassword, updateProfile } from '@angular/fire/auth';

@Component({
  selector: 'app-profile-settings',
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  templateUrl: './profile-settings.page.html',
  styleUrls: ['./profile-settings.page.scss']
})
export class ProfileSettingsPage {
  notifEmail = true;

  constructor(private alertCtrl: AlertController, private toast: ToastController, private auth: Auth) {}

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
              await updateProfile(user as any, { displayName: (data?.displayName || '').trim() });
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

  async changePassword(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Ganti Kata Sandi',
      message: 'Masukkan kata sandi baru Anda.',
      inputs: [{ name: 'password', type: 'password', placeholder: 'Kata sandi baru' }],
      buttons: [
        { text: 'Batal', role: 'cancel' },
        {
          text: 'Ganti',
          handler: async (data) => {
            const user = this.auth.currentUser;
            if (!user) { this.presentToast('Silakan login', 'warning'); return; }
            const pass = (data?.password || '').trim();
            if (pass.length < 6) { this.presentToast('Minimal 6 karakter', 'warning'); return; }
            try {
              await updatePassword(user as any, pass);
              this.presentToast('Kata sandi berhasil diganti', 'success');
            } catch {
              this.presentToast('Gagal mengganti kata sandi', 'danger');
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async openPrivacy(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Privasi Akun',
      message: 'Atur visibilitas data dan izin aplikasi (placeholder).',
      buttons: ['OK']
    });
    await alert.present();
  }

  private async presentToast(message: string, color: 'success' | 'warning' | 'danger') {
    const t = await this.toast.create({ message, duration: 1500, color });
    await t.present();
  }
}
