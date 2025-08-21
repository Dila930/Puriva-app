import { Component, OnDestroy, OnInit } from '@angular/core';
import { Auth, onAuthStateChanged, User } from '@angular/fire/auth';
import { Database, onValue, ref, Unsubscribe } from '@angular/fire/database';

type NotifStatus = 'success' | 'warning';
interface NotificationItem {
  icon: string;
  title: string;
  time: string;
  status: NotifStatus;
}

@Component({
  selector: 'app-notifikasi',
  templateUrl: './notifikasi.page.html',
  styleUrls: ['./notifikasi.page.scss'],
  standalone: false,
})
export class NotifikasiPage implements OnInit, OnDestroy {
  notifications: NotificationItem[] = [];

  private authUnsub?: Unsubscribe;
  private rtdbUnsubs: Unsubscribe[] = [];

  constructor(private auth: Auth, private db: Database) {}

  ngOnInit(): void {
    try {
      this.authUnsub = onAuthStateChanged(this.auth as any, (user: User | null) => {
        this.detachListeners();
        if (!user) {
          this.notifications = [];
          return;
        }
        const recentRef = ref(this.db, `users/${user.uid}/recentActivities`);
        const un = onValue(recentRef, (snap) => {
          const val = snap.val() || {};
          const list = Object.values(val as any) as any[];
          list.sort((a, b) => (b.at || 0) - (a.at || 0));
          this.notifications = list.map((it) => this.toNotification(it)).slice(0, 50);
        });
        this.rtdbUnsubs.push(un);
      });
    } catch { /* ignore if not configured */ }
  }

  ngOnDestroy(): void {
    this.detachListeners();
  }

  private detachListeners(): void {
    try {
      this.rtdbUnsubs.forEach(un => { try { un(); } catch {} });
      this.rtdbUnsubs = [];
      if (this.authUnsub) { try { (this.authUnsub as any)(); } catch {} }
      this.authUnsub = undefined;
    } catch { /* no-op */ }
  }

  private toNotification(it: any): NotificationItem {
    const status: NotifStatus = it.status === 'completed' ? 'success' : 'warning';
    const icon = 'notifications-outline';
    const food = it.food || 'Sterilisasi';
    const title = it.status === 'completed'
      ? `Sterilisasi ${food} selesai`
      : (it.status === 'processing' ? `Sterilisasi ${food} dalam proses` : `Sterilisasi ${food} dihentikan`);
    const time = this.formatTimeAgo(typeof it.at === 'number' ? it.at : Date.now());
    return { icon, title, time, status };
  }

  private formatTimeAgo(ts: number): string {
    const now = Date.now();
    const diff = Math.max(0, now - ts);
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec} detik lalu`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} menit lalu`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} jam lalu`;
    const day = Math.floor(hr / 24);
    return `${day} hari lalu`;
  }
}
