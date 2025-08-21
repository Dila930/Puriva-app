import { Component, OnDestroy, OnInit } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { SterilizationService } from '../services/sterilization.service';
import { Auth } from '@angular/fire/auth';
import { Database, ref, get, set, update, child, push } from '@angular/fire/database';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-control',
  templateUrl: 'control.page.html',
  styleUrls: ['control.page.scss'],
  standalone: false,
})
export class ControlPage implements OnInit, OnDestroy {
  // Navigation state
  public activeTab: string = 'control';

  // UI state variables
  public isRunning = false;
  public selectedFood: string | null = null;
  public intensityValue = 75;
  public frequencyValue = 50.0;
  public durationValue = 5;

  // Session stats
  public currentIntensity = 0;
  public temperature = 25;
  public totalSessions = 0;
  public energyUsed = 0.0;

  // Countdown timer
  private currentSessionTimer: any;
  public remainingTotalSeconds = 0;
  public remainingSeconds = 0; // display seconds (0-59)
  public remainingMinutes = 0;
  public progressPercentage = 0;
  private totalDurationInSeconds = 0;
  private currentSessionId: string | null = null;
  private currentSessionStartTs: number | null = null;
  private steriStateSub?: Subscription;

  // Temperature simulation
  private tempInterval: any;

  constructor(
    private alertController: AlertController,
    private toastController: ToastController,
    private router: Router,
    private sterilizationSvc: SterilizationService,
    private auth: Auth,
    private db: Database
  ) { }

  ngOnInit() {
    // Hydrate running session so countdown persists across navigation
    this.steriStateSub = this.sterilizationSvc.currentSession$.subscribe((ev) => {
      if (!ev) { return; }
      if (ev.status === 'processing') {
        // Mark running and start local UI countdown based on wall clock
        this.isRunning = true;
        this.currentSessionId = ev.id;
        this.currentSessionStartTs = ev.startedAt;
        this.totalDurationInSeconds = (ev.duration || 0) * 60;
        this.startOrSyncLocalCountdown(ev.startedAt, ev.duration);
      } else {
        // If session finished elsewhere, ensure local UI stops gracefully
        this.isRunning = false;
        this.clearLocalTimersOnly();
      }
    });
  }

  ngOnDestroy() {
    // Jangan hentikan sesi saat berpindah halaman; hanya bersihkan timer lokal
    this.clearLocalTimersOnly();
    if (this.steriStateSub) { try { this.steriStateSub.unsubscribe(); } catch {} }
  }

  // Navigation methods
  goToHome() {
    this.router.navigate(['/home']);
  }

  goToControl() {
    // Already on control page
  }

  goToEducation() {
    this.router.navigate(['/news']);
  }

  goToForum() {
    this.router.navigate(['/forum']);
  }

  goToProfile() {
    this.router.navigate(['/profile']);
  }

  goToStats() {
    this.router.navigate(['/news']);
  }

  goToNotifications() {
    this.router.navigate(['/notifikasi']);
  }

  updateIntensity(event: any) {
    this.intensityValue = event.detail.value;
  }

  updateFrequency(event: any) {
    this.frequencyValue = parseFloat(event.detail.value);
  }

  updateDuration(event: any) {
    this.durationValue = event.detail.value;
  }

  selectFood(foodType: string, intensity: number, frequency: number, duration: number) {
    if (this.isRunning) {
      this.presentToast('Sterilisasi sedang berjalan!', 'warning');
      return;
    }

    this.selectedFood = foodType;
    this.intensityValue = intensity;
    this.frequencyValue = frequency;
    this.durationValue = duration;

    this.presentToast(`Setting untuk ${foodType} telah diterapkan!`, 'success');
  }

  async startSterilization() {
    if (this.isRunning) {
      this.presentToast('Sterilisasi sedang berjalan!', 'warning');
      return;
    }

    if (this.intensityValue < 30) {
      const alert = await this.alertController.create({
        header: 'Intensitas Rendah',
        message: 'Intensitas kurang dari 30%. Yakin ingin melanjutkan?',
        buttons: [
          {
            text: 'Batal',
            role: 'cancel'
          },
          {
            text: 'Lanjutkan',
            handler: () => {
              this.executeStart();
            }
          }
        ]
      });
      await alert.present();
    } else {
      this.executeStart();
    }
  }

  private executeStart() {
    this.isRunning = true;
    this.totalSessions++;
    this.currentSessionId = `sess-${Date.now()}`;
    this.currentSessionStartTs = Date.now();
    this.totalDurationInSeconds = this.durationValue * 60;
    // Sinkronkan countdown lokal berdasarkan waktu mulai agar tetap konsisten setelah navigasi
    this.startOrSyncLocalCountdown(this.currentSessionStartTs, this.durationValue);

    // Update UI
    this.currentIntensity = this.intensityValue;
    this.totalSessions = this.totalSessions;
    this.temperature = 25; // Reset temperature
    this.progressPercentage = 0;

    // Simulate temperature increase
    this.simulateTemperature();

    // Emit start event for Home page sync
    this.sterilizationSvc.emitStart(this.currentSessionId!, this.selectedFood, this.durationValue);

    this.presentToast(`Sterilisasi dimulai! Durasi: ${this.durationValue} menit`, 'success');
  }

  async stopSterilization() {
    if (!this.isRunning) {
      this.presentToast('Tidak ada sterilisasi yang sedang berjalan!', 'warning');
      return;
    }

    const alert = await this.alertController.create({
      header: 'Konfirmasi',
      message: 'Yakin ingin menghentikan sterilisasi?',
      buttons: [
        {
          text: 'Batal',
          role: 'cancel'
        },
        {
          text: 'Ya, Hentikan',
          handler: () => {
            this.finishSterilization(true);
            this.presentToast('Sterilisasi telah dihentikan!', 'info');
          }
        }
      ]
    });
    await alert.present();
  }

  private finishSterilization(stopped = false) {
    this.isRunning = false;
    this.clearLocalTimersOnly();

    // Reset UI state
    this.currentIntensity = 0;
    this.temperature = 25;
    this.remainingSeconds = 0;
    this.progressPercentage = 0;

    if (!stopped) {
      this.presentToast('🎉 Sterilisasi selesai! Makanan aman dikonsumsi.', 'success');
      this.updateEnergyUsage();
    }

    // Emit finish event
    if (this.currentSessionId) {
      this.sterilizationSvc.emitFinish(
        this.currentSessionId,
        this.selectedFood,
        this.durationValue,
        stopped ? 'stopped' : 'completed'
      );

      // Persist session and update statistics
      this.persistSterilization(
        this.currentSessionId,
        this.selectedFood,
        this.durationValue,
        this.currentSessionStartTs || Date.now(),
        Date.now(),
        stopped ? 'stopped' : 'completed'
      );
    }
    this.currentSessionId = null;
    this.currentSessionStartTs = null;
  }

  private async persistSterilization(
    sessionId: string,
    food: string | null,
    durationMin: number,
    startedAt: number,
    finishedAt: number,
    status: 'completed' | 'stopped'
  ): Promise<void> {
    try {
      const user = this.auth.currentUser;
      if (!user) return;
      const uid = user.uid;
      const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

      // Write session detail
      const sessionPath = `users/${uid}/sterilizations/${dateKey}/${sessionId}`;
      await set(ref(this.db, sessionPath), {
        food: food || 'unknown',
        durationMin,
        startedAt,
        finishedAt,
        status,
      });

      // If completed, increment daily counters
      if (status === 'completed') {
        const totalTodayRef = ref(this.db, `users/${uid}/stats/totalToday`);
        const dailyRef = ref(this.db, `users/${uid}/stats/daily/${dateKey}`);

        // totalToday
        const totalSnap = await get(totalTodayRef);
        const currentTotal = typeof totalSnap.val() === 'number' ? totalSnap.val() : 0;
        await set(totalTodayRef, currentTotal + 1);

        // per-day count
        const dailySnap = await get(dailyRef);
        const currentDaily = typeof dailySnap.val() === 'number' ? dailySnap.val() : 0;
        await set(dailyRef, currentDaily + 1);
      }
    } catch (e) {
      // Non-blocking: log to console only
      console.warn('persistSterilization failed', e);
    }
  }

  private simulateTemperature() {
    this.tempInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(this.tempInterval);
        this.temperature = 25;
        return;
      }
      this.temperature += Math.random() * 2;
      if (this.temperature > 45) {
        this.temperature = 45;
      }
    }, 2000);
  }

  private updateEnergyUsage() {
    const energyUsedThisSession = this.totalDurationInSeconds * 0.1 / 3600; // Simplified calculation
    this.energyUsed = parseFloat((this.energyUsed + energyUsedThisSession).toFixed(2));
  }

  // ===== Helpers for persistent countdown =====
  private startOrSyncLocalCountdown(startedAtMs: number | null, durationMin: number | null) {
    // Clear previous interval if any
    if (this.currentSessionTimer) { try { clearInterval(this.currentSessionTimer); } catch {} }
    const start = startedAtMs || Date.now();
    const totalSec = Math.max(0, Math.round((durationMin || 0) * 60));
    this.totalDurationInSeconds = totalSec;
    const update = () => {
      const now = Date.now();
      const elapsed = Math.max(0, Math.floor((now - start) / 1000));
      const remaining = Math.max(0, totalSec - elapsed);
      this.remainingTotalSeconds = remaining;
      this.remainingMinutes = Math.floor(remaining / 60);
      this.remainingSeconds = remaining % 60;
      this.progressPercentage = totalSec > 0 ? ((totalSec - remaining) / totalSec) * 100 : 0;
      if (remaining <= 0 && this.isRunning) {
        // Auto-finish when countdown reaches zero
        this.finishSterilization(false);
      }
    };
    update();
    this.currentSessionTimer = setInterval(update, 1000);
  }

  private clearLocalTimersOnly() {
    if (this.currentSessionTimer) { try { clearInterval(this.currentSessionTimer); } catch {} }
    if (this.tempInterval) { try { clearInterval(this.tempInterval); } catch {} }
  }

  async presentToast(message: string, type: 'success' | 'warning' | 'info') {
    let color = '';
    switch (type) {
      case 'success':
        color = 'success';
        break;
      case 'warning':
        color = 'warning';
        break;
      case 'info':
        color = 'primary';
        break;
    }
    const toast = await this.toastController.create({
      message: message,
      duration: 3000,
      position: 'top',
      color: color,
      cssClass: 'custom-toast'
    });
    await toast.present();
  }

  showSettings() {
    this.router.navigate(['/profile']);
  }
}