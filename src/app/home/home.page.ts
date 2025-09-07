import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { SterilizationService, SterilizationEvent } from '../services/sterilization.service';
import { AlertController } from '@ionic/angular';
import { Auth, onAuthStateChanged, User } from '@angular/fire/auth';
import { Database, ref, onValue, Unsubscribe } from '@angular/fire/database';

interface Activity {
  id?: string;
  emoji: string;
  iconClass: string;
  title: string;
  timeAgo: string;
  status: 'completed' | 'processing' | 'stopped';
  at?: number; // epoch ms when the activity happened
  food?: string | null; // original food label if available
}

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage implements OnInit, OnDestroy {
  // UI State
  activeTab: string = 'home';
  greeting: string = '';
  userName: string = 'Pengguna';
  notificationCount: number = 0;
  hasUnread: boolean = false;
  
  // Stats
  totalToday: number = 0;
  activeSessions: number = 0;
  efficiency: string = '0%';
  // Status totals for stats modal summary
  statsTotals: { total: number; berhasil: number; gagal: number } = { total: 0, berhasil: 0, gagal: 0 };
  // Filter for stats modal (status-based)
  selectedStatusFilter: 'total' | 'berhasil' | 'gagal' = 'total';
  
  // Activity feed
  recentActivities: Activity[] = [];
  visibleActivities: number = 5; // Show 5 activities by default
  showAllActivities: boolean = false;

  /**
   * Toggle between showing all activities or just the first few
   */
  toggleShowAll() {
    this.showAllActivities = !this.showAllActivities;
    this.visibleActivities = this.showAllActivities ? this.recentActivities.length : 5;
  }
  // Notifications (for badge demo; replace with real data source as needed)
  notifications: string[] = [];
  
  // Timers
  private realtimeTimer: any;
  private animateTimer: any;
  private sessionTimer: any;
  nowTs: number = Date.now();

  // Current active session (synced with Control via SterilizationService)
  currentSession?: {
    id: string;
    food: string | null;
    duration: number; // minutes
    startedAt: number; // ms
    status: 'processing' | 'completed' | 'stopped';
  };

  // Stats modal state
  selectedStatsRange: 'day' | 'week' | 'month' = 'day';
  statsDetail: { label: string; value: number }[] = [];

  private steriSub?: Subscription;
  private steriStateSub?: Subscription;
  // Track last authenticated UID to detect account switches
  private lastAuthUid?: string;

  constructor(
    private router: Router,
    private sterSvc: SterilizationService,
    private alertCtrl: AlertController,
    private auth: Auth,
    private db: Database,
  ) {
    // Update active tab based on route
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd)
    ).subscribe(event => {
      const url = event.urlAfterRedirects || event.url;
      this.activeTab = url.split('/')[1] || 'home';
    });
  }

  private subscribeSterilizationEvents(): void {
    this.steriSub = this.sterSvc.events$.subscribe((ev: SterilizationEvent) => {
      if (ev.status === 'processing') {
        // Increment total immediately and add processing activity
        // Do not increment locally; rely on RTDB `users/{uid}/stats/totalToday`
        // Mark current session active
        this.currentSession = {
          id: ev.id,
          food: ev.food ?? null,
          duration: ev.duration,
          startedAt: ev.startedAt,
          status: ev.status,
        };
        this.activeSessions = 1;
        const { emoji, iconClass, title } = this.getFoodMeta(ev.food);
        const newAct: Activity = {
          id: ev.id,
          emoji,
          iconClass,
          title,
          timeAgo: 'baru saja',
          status: 'processing',
          at: Date.now(),
          food: ev.food ?? null,
        };
        this.prependActivity(newAct);
      } else {
        // Update existing activity status (completed or stopped)
        const idx = this.recentActivities.findIndex(a => a.id === ev.id);
        if (idx >= 0) {
          this.recentActivities[idx] = {
            ...this.recentActivities[idx],
            status: ev.status,
            timeAgo: ev.status === 'completed' ? 'selesai baru saja' : 'dihentikan',
          };
          // Trigger change detection by copying array
          this.recentActivities = [...this.recentActivities];
        }
        // End current session if matches
        if (this.currentSession && this.currentSession.id === ev.id) {
          this.currentSession = { ...this.currentSession, status: ev.status };
          // Session ended (completed or stopped)
          this.activeSessions = 0;
        }
      }
    });
  }

  private prependActivity(act: Activity): void {
    this.recentActivities = [act, ...this.recentActivities].slice(0, 10);
  }

  getFoodMeta(food: string | null | undefined): { emoji: string; iconClass: string; title: string } {
    const f = (food || '').toString().trim().toLowerCase();
    // Aliases/contains mapping to handle variations: sayuran, daging sapi, ikan goreng, dsb.
    if (f.includes('nasi') || f.includes('beras')) {
      return { emoji: '🍚', iconClass: 'activity-icon nasi', title: 'Nasi' };
    }
    if (f.includes('sayur') || f.includes('sayuran') || f.includes('veget') || f.includes('veggie')) {
      return { emoji: '🥦', iconClass: 'activity-icon sayur', title: 'Sayuran' };
    }
    if (f.includes('ayam') || f.includes('chicken') || f.includes('poultry')) {
      return { emoji: '🍗', iconClass: 'activity-icon ayam', title: 'Ayam' };
    }
    if (f.includes('ikan') || f.includes('fish') || f.includes('tuna') || f.includes('salmon')) {
      return { emoji: '🐟', iconClass: 'activity-icon ikan', title: 'Ikan' };
    }
    if (f.includes('daging') || f.includes('sapi') || f.includes('kambing') || f.includes('beef') || f.includes('meat')) {
      return { emoji: '🥩', iconClass: 'activity-icon daging', title: 'Daging' };
    }
    if (f.includes('buah') || f.includes('apple') || f.includes('jeruk') || f.includes('banana') || f.includes('pisang') || f.includes('fruit')) {
      return { emoji: '🍎', iconClass: 'activity-icon buah', title: 'Buah' };
    }
    // Fallback
    return { emoji: '🍽️', iconClass: 'activity-icon', title: f ? f.charAt(0).toUpperCase() + f.slice(1) : 'Sterilisasi' };
  }

  private initializeNotifications(): void {
    this.notifications = [
      'UV Chamber #1 selesai sterilisasi',
      'Efektivitas mencapai 99.9%',
      'Maintenance dijadwalkan besok'
    ];
    this.notificationCount = this.notifications.length;
    this.hasUnread = this.notificationCount > 0;
  }

  ngOnInit(): void {
    this.setGreeting();
    this.initializeActivities();
    this.initializeStats();
    this.initializeNotifications();
    this.startRealTimeData();
    this.subscribeSterilizationEvents();
    this.subscribeCurrentSessionState();
    this.bindDatabaseListeners();
    // Initialize userName from current session immediately (mirror Profile logic)
    try {
      const cu = this.auth.currentUser as User | null;
      this.userName = cu ? (cu.displayName || cu.email || 'Pengguna') : 'Pengguna';
    } catch { this.userName = 'Pengguna'; }
    // Ticker setiap 1s agar progress & sisa waktu ter-update
    this.sessionTimer = setInterval(() => { this.nowTs = Date.now(); }, 1000);
  }

  ngOnDestroy(): void {
    if (this.realtimeTimer) clearInterval(this.realtimeTimer);
    if (this.animateTimer) clearInterval(this.animateTimer);
    if (this.sessionTimer) clearInterval(this.sessionTimer);
    if (this.steriSub) this.steriSub.unsubscribe();
    if (this.steriStateSub) this.steriStateSub.unsubscribe();
    this.detachDatabaseListeners();
  }

  private subscribeCurrentSessionState(): void {
    this.steriStateSub = this.sterSvc.currentSession$.subscribe((ev) => {
      if (!ev) { return; }
      if (ev.status === 'processing') {
        // Hydrate current running session
        this.currentSession = {
          id: ev.id,
          food: ev.food ?? null,
          duration: ev.duration,
          startedAt: ev.startedAt,
          status: ev.status,
        };
        this.activeSessions = 1;
        // Ensure an activity item exists for this session
        const idx = this.recentActivities.findIndex(a => a.id === ev.id);
        if (idx === -1) {
          const { emoji, iconClass, title } = this.getFoodMeta(ev.food);
          this.prependActivity({ id: ev.id, emoji, iconClass, title, timeAgo: 'berjalan', status: 'processing', at: Date.now(), food: ev.food ?? null });
          // Do not adjust total locally; RTDB listener provides the authoritative value
        }
        // Drop any placeholder/mock activities once real data arrives
        if (this.recentActivities.length > 3) {
          this.recentActivities = this.recentActivities.slice(0, 10);
        }
      } else {
        // Completed or stopped
        if (this.currentSession && this.currentSession.id === ev.id) {
          this.currentSession = { ...this.currentSession, status: ev.status };
        }
        this.activeSessions = 0;
        const idx = this.recentActivities.findIndex(a => a.id === ev.id);
        if (idx >= 0) {
          this.recentActivities[idx] = { ...this.recentActivities[idx], status: ev.status, timeAgo: ev.status === 'completed' ? 'selesai' : 'dihentikan' };
          this.recentActivities = [...this.recentActivities];
        } else {
          const { emoji, iconClass, title } = this.getFoodMeta(ev.food);
          this.prependActivity({ id: ev.id, emoji, iconClass, title, timeAgo: ev.status === 'completed' ? 'selesai' : 'dihentikan', status: ev.status, at: Date.now(), food: ev.food ?? null });
        }
      }
    });
  }

  private initializeActivities(): void {
    // Start empty; will be populated by real-time events
    this.recentActivities = [];
  }

  private initializeStats(): void {
    // Initialize values directly; real-time updates will adjust these
    this.totalToday = this.totalToday || 0;
    this.activeSessions = this.activeSessions || 0;
    this.updateEfficiency();
  }

  private setGreeting(): void {
    const hour = new Date().getHours();
    if (hour < 12) {
      this.greeting = 'Selamat Pagi';
    } else if (hour < 15) {
      this.greeting = 'Selamat Siang';
    } else if (hour < 19) {
      this.greeting = 'Selamat Sore';
    } else {
      this.greeting = 'Selamat Malam';
    }
  }

  private startRealTimeData(): void {
    // Clear any existing timer
    if (this.realtimeTimer) {
      clearInterval(this.realtimeTimer);
    }
    // Periodic updates (e.g., efficiency). activeSessions is driven by events.
    this.realtimeTimer = setInterval(() => {
      // Do not auto-increment totalToday; it reflects real user actions
      // Update efficiency based on current data
      this.updateEfficiency();

      // Watchdog: auto-complete session when countdown time elapsed
      const s = this.currentSession;
      if (s && s.status === 'processing') {
        const elapsedMs = Date.now() - (s.startedAt || 0);
        const totalMs = (s.duration || 0) * 60_000;
        if (totalMs > 0 && elapsedMs >= totalMs) {
          this.sterSvc.emitFinish(s.id, s.food ?? null, s.duration, 'completed');
        }
      }
    }, 10000);
  }

  // Navigation methods
  goToHome(): void {
    this.router.navigate(['/home']);
    this.activeTab = 'home';
  }

  goToControl(): void {
    this.router.navigate(['/control']);
  }

  goToStats(): void {
    // default to day + total to mirror Home summary
    this.router.navigate(['/stats'], { queryParams: { range: 'day', status: 'total' } });
  }

  goToForum(): void {
    this.router.navigate(['/forum']);
  }

  goToProfile(): void {
    this.router.navigate(['/profile']);
  }

  showSettings(): void {
    // Navigate to settings or show settings modal
    console.log('Showing settings');
    // this.router.navigate(['/settings']); // Uncomment when settings page is available
  }

  // Navigation to existing notifications page
  goToNotifications(): void {
    // Consider all notifications as read when opening the page
    this.hasUnread = false;
    this.notificationCount = 0;
    this.router.navigate(['/notifikasi']);
  }

  // Backward compatibility: keep existing method name
  showNotifications(): void {
    this.goToNotifications();
  }

  viewAllActivities(): void {
    // Navigate to activities page or show all activities
    console.log('Viewing all activities');
    // this.router.navigate(['/activities']); // Uncomment when activities page is available
  }

  setStatsRange(range: 'day' | 'week' | 'month'): void {
    this.selectedStatsRange = range;
    this.generateStats();
  }

  onStatsRangeChange(ev: CustomEvent): void {
    const value = (ev as any)?.detail?.value as 'day' | 'week' | 'month' | undefined;
    this.setStatsRange(value ?? 'day');
  }

  onStatusFilterChange(ev: CustomEvent): void {
    const value = (ev as any)?.detail?.value as 'total' | 'berhasil' | 'gagal' | undefined;
    this.selectedStatusFilter = value ?? 'total';
    this.generateStats();
  }

  private generateStats(): void {
    // Build last 4-month totals (current month included), not filtered by UI range
    const now = new Date();
    const months: { key: string; label: string; year: number; month: number }[] = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    for (let i = 3; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
      months.push({ key, label, year: d.getFullYear(), month: d.getMonth() });
    }

    const counts = new Map<string, number>(months.map(m => [m.key, 0]));

    for (const a of this.recentActivities) {
      if (!a) continue;
      // Apply status filter
      if (this.selectedStatusFilter === 'berhasil' && a.status !== 'completed') continue;
      if (this.selectedStatusFilter === 'gagal' && a.status !== 'stopped') continue;
      if (this.selectedStatusFilter === 'total' && (a.status !== 'completed' && a.status !== 'stopped')) continue;
      const at = typeof a.at === 'number' ? a.at : 0;
      if (at <= 0) continue;
      const d = new Date(at);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (counts.has(k)) counts.set(k, (counts.get(k) || 0) + 1);
    }

    const data = months.map(m => ({ label: m.label, value: counts.get(m.key) || 0 }));

    // Ensure at least a zero dataset so chart renders
    this.statsDetail = data.length > 0 ? data : [{ label: '—', value: 0 }];
    // Update status totals alongside chart
    this.computeStatusTotals();
  }

  private computeStatusTotals(): void {
    const berhasil = this.recentActivities.filter(a => a.status === 'completed').length;
    const gagal = this.recentActivities.filter(a => a.status === 'stopped').length;
    this.statsTotals = { total: berhasil + gagal, berhasil, gagal };
  }

  private getRangeWindow(nowTs: number, range: 'day' | 'week' | 'month'): { startTs: number; endTs: number } {
    const d = new Date(nowTs);
    let start = new Date(d);
    if (range === 'day') {
      start.setHours(0, 0, 0, 0);
    } else if (range === 'week') {
      // Start of week (Mon)
      const day = d.getDay(); // 0 Sun .. 6 Sat
      const diffToMon = (day === 0 ? -6 : 1 - day);
      start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffToMon, 0, 0, 0, 0);
    } else {
      // month
      start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    }
    return { startTs: start.getTime(), endTs: nowTs };
  }

  getMax(arr: { value: number }[]): number {
    return Math.max(1, ...arr.map(x => x.value));
  }

  // ===== Efficiency helpers & detail popup =====
  private updateEfficiency(): void {
    const total = this.totalToday || 0;
    if (total <= 0) {
      this.efficiency = '100%';
      return;
    }
    const completed = this.recentActivities.filter(a => a.status === 'completed').length;
    const pct = Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
    this.efficiency = `${pct}%`;
  }

  async showEfficiencyDetail(): Promise<void> {
    const total = this.totalToday || 0;
    const completed = this.recentActivities.filter(a => a.status === 'completed').length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 100;
    const alert = await this.alertCtrl.create({
      header: 'Detail Efektivitas',
      message: `Efektivitas dihitung sederhana berdasarkan penyelesaian hari ini.<br/><br/>` +
        `Rumus: <b>Efektivitas = (Selesai / Total Hari Ini) × 100%</b><br/>` +
        `Nilai: (${completed} / ${total}) × 100% = <b>${pct}%</b>`,
      buttons: ['OK']
    });
    await alert.present();
  }

  // ===== Progress computation for Active Session card =====
  getCurrentProgressPct(): number {
    if (!this.currentSession || this.currentSession.status !== 'processing') return 0;
    const elapsedMs = this.nowTs - this.currentSession.startedAt;
    const totalMs = (this.currentSession.duration || 0) * 60_000;
    if (totalMs <= 0) return 0;
    const pct = (elapsedMs / totalMs) * 100;
    if (pct < 0) return 0;
    if (pct > 100) return 100;
    return Math.round(pct);
  }

  getRemainingLabel(): string {
    if (!this.currentSession) return '';
    const totalMs = (this.currentSession.duration || 0) * 60_000;
    const endAt = (this.currentSession.startedAt || 0) + totalMs;
    const remainingMs = Math.max(0, endAt - this.nowTs);
    if (this.currentSession.status !== 'processing') {
      return this.currentSession.status === 'completed' ? 'selesai' : 'dihentikan';
    }
    const mins = Math.floor(remainingMs / 60000);
    const secs = Math.floor((remainingMs % 60000) / 1000);
    if (mins <= 0 && secs <= 0) return 'selesai';
    if (mins <= 0) return `sisa ${secs} dtk`;
    return `sisa ${mins} mnt ${secs} dtk`;
  }

  // ===== Realtime Database bindings per user =====
  private authUnsub?: Unsubscribe;
  private rtdbUnsubs: Unsubscribe[] = [];

  private bindDatabaseListeners(): void {
    try {
      this.authUnsub = onAuthStateChanged(this.auth as any, (user: User | null) => {
        // Always detach previous listeners first
        this.detachDatabaseListeners();
        // If signed out, hard reset UI state
        if (!user) {
          this.resetHomeState();
          this.lastAuthUid = undefined;
          return;
        }
        // If switching to a different user, clear any stale state before binding
        if (this.lastAuthUid && this.lastAuthUid !== user.uid) {
          this.resetHomeState();
        }
        this.lastAuthUid = user.uid;
        this.updateUserProfile(user);
        // Active session
        const activeRef = ref(this.db, `users/${user.uid}/activeSession`);
        const un1 = onValue(activeRef, (snap) => {
          const val = snap.val();
          if (val && val.status === 'processing') {
            this.currentSession = val;
            this.activeSessions = 1;
          } else {
            this.activeSessions = 0;
            if (this.currentSession && this.currentSession.status !== 'processing') {
              this.currentSession = null as any;
            }
          }
        });
        this.rtdbUnsubs.push(un1);

        // Total today
        const totalRef = ref(this.db, `users/${user.uid}/stats/totalToday`);
        const un2 = onValue(totalRef, (_snap) => {
          // Do not set totalToday here; we compute it strictly from recentActivities timestamps
          // Keep subscription to avoid unused listener warnings if needed for future features
          this.updateEfficiency();
        });
        this.rtdbUnsubs.push(un2);

        // Recent activities
        const recentRef = ref(this.db, `users/${user.uid}/recentActivities`);
        const un3 = onValue(recentRef, (snap) => {
          const obj = snap.val() || {};
          const list = Object.values(obj as any);
          list.sort((a: any, b: any) => (b.at || 0) - (a.at || 0));
          this.recentActivities = list.map((it: any) => {
            const meta = this.getFoodMeta(it.food ?? null);
            return {
              id: it.id,
              emoji: meta.emoji,
              iconClass: meta.iconClass,
              title: it.food || meta.title || 'Lainnya',
              timeAgo: it.status === 'processing' ? 'berjalan' : (it.status === 'completed' ? 'selesai' : 'dihentikan'),
              status: it.status,
              at: typeof it.at === 'number' ? it.at : (typeof it.startedAt === 'number' ? it.startedAt : Date.now()),
              food: it.food ?? null,
            } as any;
          });
          // Recompute today's total strictly from timestamps within today (local time)
          try {
            const now = new Date();
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
            const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
            const todayCount = this.recentActivities.filter(a => {
              const at = typeof a.at === 'number' ? a.at : 0;
              return at >= start && at <= end;
            }).length;
            this.totalToday = todayCount;
          } catch { /* ignore */ }
          this.updateEfficiency();
          // Regenerate stats detail based on latest activities and selected range
          this.generateStats();
        });
        this.rtdbUnsubs.push(un3);
      });
    } catch { /* ignore if DB not configured */ }
  }

  private updateUserProfile(user: User | null): void {
    if (!user) {
      this.resetHomeState();
      return;
    }

    // Get full name and extract first name only
    const fullName = user.displayName || user.email?.split('@')[0] || 'Pengguna';
    this.userName = fullName.split(' ')[0];
  }

  private detachDatabaseListeners(): void {
    try {
      this.rtdbUnsubs.forEach(un => { try { un(); } catch {} });
      this.rtdbUnsubs = [];
      if (this.authUnsub) { try { (this.authUnsub as any)(); } catch {} }
      this.authUnsub = undefined;
    } catch { /* no-op */ }
  }

  // Fully reset UI state so old account data does not leak into new session
  private resetHomeState(): void {
    this.userName = 'Pengguna';
    this.notificationCount = 0;
    this.hasUnread = false;
    this.totalToday = 0;
    this.activeSessions = 0;
    this.efficiency = '0%';
    this.statsTotals = { total: 0, berhasil: 0, gagal: 0 };
    this.recentActivities = [];
    this.currentSession = undefined;
    this.statsDetail = [];
  }
}
