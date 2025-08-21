import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Auth, onAuthStateChanged, User } from '@angular/fire/auth';
import { Database, onValue, ref, Unsubscribe } from '@angular/fire/database';

@Component({
  selector: 'app-profile-activity',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './profile-activity.page.html',
  styleUrls: ['./profile-activity.page.scss']
})
export class ProfileActivityPage implements OnInit, OnDestroy {
  items: Array<{ id: string; title: string; status: 'processing'|'completed'|'stopped'; at: number } > = [];
  private authUnsub?: Unsubscribe;
  private rtdbUnsub?: Unsubscribe;

  constructor(private auth: Auth, private db: Database) {}

  ngOnInit(): void {
    this.authUnsub = onAuthStateChanged(this.auth as any, (user: User | null) => {
      this.detach();
      if (!user) { this.items = []; return; }
      const recentRef = ref(this.db, `users/${user.uid}/recentActivities`);
      this.rtdbUnsub = onValue(recentRef, (snap) => {
        const obj = snap.val() || {};
        const list = Object.values(obj as any);
        list.sort((a: any, b: any) => (b.at || 0) - (a.at || 0));
        this.items = list.map((it: any) => ({ id: it.id, title: it.food || 'Sterilisasi', status: it.status, at: it.at || it.startedAt || 0 }));
      });
    });
  }

  ngOnDestroy(): void { this.detach(); }

  private detach(): void {
    try { if (this.rtdbUnsub) this.rtdbUnsub(); } catch {}
    this.rtdbUnsub = undefined;
    try { if (this.authUnsub) (this.authUnsub as any)(); } catch {}
    this.authUnsub = undefined;
  }

  getTime(ts: number): string {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString();
  }
}
