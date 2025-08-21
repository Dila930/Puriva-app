import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { Auth, onAuthStateChanged, User } from '@angular/fire/auth';
import { Database, ref, onValue, Unsubscribe } from '@angular/fire/database';

@Component({
  selector: 'app-stats',
  templateUrl: './stats.page.html',
  styleUrls: ['./stats.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterModule],
})
export class StatsPage implements OnInit, OnDestroy {
  // UI state
  selectedStatsRange: 'day' | 'week' | 'month' = 'day';
  selectedStatusFilter: 'total' | 'berhasil' | 'gagal' = 'total';
  // Advanced template bindings (fallbacks/stubs)
  selectedPeriod: 'daily' | 'weekly' | 'monthly' = 'daily';
  isLoaded = true;
  isInitialLoading = false;
  isRefreshing = false;
  showToast = false;
  toastMessage = '';
  toastColor: string = 'primary';
  showDetailModal = false;
  selectedDetailItem: any = null;
  sortField: 'label' | 'value' = 'label';
  sortDirection: 'asc' | 'desc' = 'asc';

  // Data
  statsDetail: { label: string; value: number }[] = [];
  statsTotals: { total: number; berhasil: number; gagal: number; totalTrend: number; berhasilTrend: number; gagalTrend: number; efektivitasTrend: number } = { total: 0, berhasil: 0, gagal: 0, totalTrend: 0, berhasilTrend: 0, gagalTrend: 0, efektivitasTrend: 0 };
  recentActivities: Array<{ status: 'completed' | 'processing' | 'stopped'; at?: number }> = [];

  // UI state
  showFilters = false;
  isLoading = true; // for loading spinner in SCSS
  realtimeActive = false; // for realtime indicator in SCSS

  // Subscriptions
  private rtdbUnsubs: Unsubscribe[] = [];
  private authUnsub?: Unsubscribe;

  constructor(
    private auth: Auth,
    private db: Database,
    private alertCtrl: AlertController,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    // Apply initial query params from URL to sync with Home
    const qp = this.route.snapshot.queryParamMap;
    const qRange = qp.get('range') as 'day' | 'week' | 'month' | null;
    const qStatus = qp.get('status') as 'total' | 'berhasil' | 'gagal' | null;
    if (qRange) this.selectedStatsRange = qRange;
    if (qStatus) this.selectedStatusFilter = qStatus;
    // Mirror to advanced UI period selector
    this.selectedPeriod = this.selectedStatsRange === 'day' ? 'daily' : (this.selectedStatsRange === 'week' ? 'weekly' : 'monthly');

    // React to query param changes while staying on the page
    this.route.queryParamMap.subscribe(map => {
      const r = map.get('range') as 'day' | 'week' | 'month' | null;
      const s = map.get('status') as 'total' | 'berhasil' | 'gagal' | null;
      let changed = false;
      if (r && r !== this.selectedStatsRange) { this.selectedStatsRange = r; changed = true; }
      if (s && s !== this.selectedStatusFilter) { this.selectedStatusFilter = s; changed = true; }
      if (changed) this.generateStats();
    });

    this.bindDatabaseListeners();
  }

  // Table helpers referenced by template
  getPercentage(value: number): number {
    const max = this.getMax(this.statsDetail);
    if (max <= 0) return 0;
    return Math.round((value / max) * 100);
  }

  getStatusClass(status: string): string {
    if (status === 'berhasil') return 'success';
    if (status === 'gagal') return 'failed';
    return 'total';
  }

  // Advanced template handlers (no-op or mapped)
  refreshData(): void {
    this.isRefreshing = true;
    try {
      this.generateStats();
      this.toastMessage = 'Data diperbarui';
      this.toastColor = 'success';
      this.showToast = true;
    } finally {
      setTimeout(() => { this.isRefreshing = false; }, 600);
    }
  }

  
  
  // Map UI period selector to existing stats range
  onPeriodChange(ev: CustomEvent): void {
    const v = (ev as any)?.detail?.value as 'daily' | 'weekly' | 'monthly' | undefined;
    this.selectedPeriod = v ?? 'daily';
    const map: any = { daily: 'day', weekly: 'week', monthly: 'month' };
    this.selectedStatsRange = map[this.selectedPeriod] ?? 'day';
    this.generateStats();
  }

  getSuccessPercentage(): number {
    const t = this.statsTotals.total || 0;
    return t > 0 ? Math.round(((this.statsTotals.berhasil || 0) / t) * 100) : 100;
  }

  getFailedPercentage(): number {
    const t = this.statsTotals.total || 0;
    return t > 0 ? Math.round(((this.statsTotals.gagal || 0) / t) * 100) : 0;
  }

  getEffectiveness(): number { return this.getEffectivenessPct(); }
  getEffectivenessValue(): number { return this.getEffectivenessPct(); }

  sortBy(field: 'label' | 'value'): void {
    if (this.sortField === field) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortField = field;
      this.sortDirection = 'asc';
    }
  }

  getSortedDetailData(): any[] {
    const arr = [...this.statsDetail];
    arr.sort((a, b) => {
      const dir = this.sortDirection === 'asc' ? 1 : -1;
      if (this.sortField === 'label') return a.label.localeCompare(b.label) * dir;
      return (a.value - b.value) * dir;
    });
    // Attach a simple status for chips based on selected filter
    return arr.map(it => ({ ...it, status: this.selectedStatusFilter }));
  }

  trackByFn(_: number, item: any): string { return `${item.label}`; }

  openDetailModal(row: any): void { this.selectedDetailItem = row; this.showDetailModal = true; }
  closeDetailModal(): void { this.showDetailModal = false; this.selectedDetailItem = null; }

  getChipColor(status: string): string {
    if (status === 'berhasil') return 'success';
    if (status === 'gagal') return 'danger';
    return 'primary';
    }

  getStatusIcon(status: string): string {
    if (status === 'berhasil') return 'checkmark-circle-outline';
    if (status === 'gagal') return 'close-circle-outline';
    return 'information-circle-outline';
  }

  

  // Simple filter toggler
  toggleFilters(): void {
    this.showFilters = !this.showFilters;
  }

  ngOnDestroy(): void {
    this.detachDatabaseListeners();
  }

  // Routing helpers from Home replicated (trimmed)
  onStatsRangeChange(ev: CustomEvent): void {
    const value = (ev as any)?.detail?.value as 'day' | 'week' | 'month' | undefined;
    this.selectedStatsRange = value ?? 'day';
    this.generateStats();
  }

  onStatusFilterChange(ev: CustomEvent): void {
    const value = (ev as any)?.detail?.value as 'total' | 'berhasil' | 'gagal' | undefined;
    this.selectedStatusFilter = value ?? 'total';
    this.generateStats();
  }

  getMax(arr: { value: number }[]): number {
    return Math.max(1, ...arr.map(x => x.value));
  }

  // Derived effectiveness percentage for summary badge
  getEffectivenessPct(): number {
    const total = this.statsTotals.total || 0;
    const completed = this.statsTotals.berhasil || 0;
    return total > 0 ? Math.max(0, Math.min(100, Math.round((completed / total) * 100))) : 100;
  }

  async showEfficiencyDetail(): Promise<void> {
    const total = this.statsTotals.total || 0;
    const completed = this.statsTotals.berhasil || 0;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 100;
    const alert = await this.alertCtrl.create({
      header: 'Detail Efektivitas',
      message: `Efektivitas sederhana berdasarkan penyelesaian pada rentang terpilih.<br/><br/>` +
        `Rumus: <b>Efektivitas = (Selesai / Total) × 100%</b><br/>` +
        `Nilai: (${completed} / ${total}) × 100% = <b>${pct}%</b>`,
      buttons: ['OK']
    });
    await alert.present();
  }

  // Data bindings (simplified from Home)
  private bindDatabaseListeners(): void {
    try {
      this.authUnsub = onAuthStateChanged(this.auth as any, (user: User | null) => {
        this.detachActivityListener();
        if (!user) {
          this.recentActivities = [];
          this.generateStats();
          this.realtimeActive = false;
          this.isLoading = false;
          return;
        }
        this.realtimeActive = true;
        // Align data source with Home: use users/{uid}/recentActivities
        const actsRef = ref(this.db, `users/${user.uid}/recentActivities`);
        const un = onValue(actsRef, (snap) => {
          try {
            const obj = snap.val() || {};
            const list = Object.values(obj as any) as Array<any>;
            // Normalize minimal fields we need; prefer finishedAt, then at, then startedAt
            this.recentActivities = list.map(it => {
              const status: 'completed' | 'stopped' | 'processing' =
                (it.status === 'completed' || it.status === 'stopped' || it.status === 'processing') ? it.status : 'completed';
              const ts = (typeof (it as any).finishedAt === 'number')
                ? (it as any).finishedAt
                : (typeof it.at === 'number')
                  ? it.at
                  : (typeof (it as any).startedAt === 'number')
                    ? (it as any).startedAt
                    : 0;
              return { status, at: ts };
            }).filter(a => (a.at || 0) > 0);
            this.generateStats();
          } finally {
            this.isLoading = false;
          }
        }, () => { this.isLoading = false; });
        this.rtdbUnsubs.push(un);
      });
    } catch { /* ignore if DB not configured */ }
  }

  private detachActivityListener(): void {
    try {
      this.rtdbUnsubs.forEach(un => { try { un(); } catch {} });
      this.rtdbUnsubs = [];
    } catch { /* no-op */ }
  }

  private detachDatabaseListeners(): void {
    this.detachActivityListener();
    try { if (this.authUnsub) { (this.authUnsub as any)(); } } catch {}
    this.authUnsub = undefined;
    this.realtimeActive = false;
  }

  private generateStats(): void {
    // Build buckets based on selected range (day/week/month)
    const now = new Date();
    const activities = this.recentActivities;

    // Filter by status first
    const statusFiltered = activities.filter(a => {
      if (this.selectedStatusFilter === 'total') return a.status === 'completed' || a.status === 'stopped';
      if (this.selectedStatusFilter === 'berhasil') return a.status === 'completed';
      if (this.selectedStatusFilter === 'gagal') return a.status === 'stopped';
      return true;
    });

    type Bucket = { key: string; label: string; test(ts: number): boolean };
    const buckets: Bucket[] = this.buildBuckets(now, this.selectedStatsRange);

    // Count per bucket
    const counts = new Map<string, number>(buckets.map(b => [b.key, 0]));
    for (const a of statusFiltered) {
      const at = typeof a.at === 'number' ? a.at : 0;
      if (at <= 0) continue;
      for (const b of buckets) {
        if (b.test(at)) {
          counts.set(b.key, (counts.get(b.key) || 0) + 1);
          break;
        }
      }
    }

    const data = buckets.map(b => ({ label: b.label, value: counts.get(b.key) || 0 }));
    this.statsDetail = data.length > 0 ? data : [{ label: '—', value: 0 }];

    // Totals only within current range window (completed vs stopped)
    const { startTs, endTs } = this.getRangeWindow(now.getTime(), this.selectedStatsRange);
    const inWindow = activities.filter(a => {
      const at = typeof a.at === 'number' ? a.at : 0;
      return at >= startTs && at <= endTs;
    });
    const berhasil = inWindow.filter(a => a.status === 'completed').length;
    const gagal = inWindow.filter(a => a.status === 'stopped').length;
    this.statsTotals = {
      total: berhasil + gagal,
      berhasil,
      gagal,
      totalTrend: 0,
      berhasilTrend: 0,
      gagalTrend: 0,
      efektivitasTrend: 0,
    };
  }

  // Helpers
  private buildBuckets(now: Date, range: 'day' | 'week' | 'month'): Array<{ key: string; label: string; test: (ts: number) => boolean }> {
    const buckets: Array<{ key: string; label: string; test: (ts: number) => boolean }> = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

    if (range === 'day') {
      // Last 7 days including today
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const label = `${String(d.getDate()).padStart(2, '0')} ${monthNames[d.getMonth()]}`;
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
        const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
        buckets.push({ key, label, test: (ts) => ts >= start && ts <= end });
      }
    } else if (range === 'week') {
      // Last 8 weeks including current week (Mon-Sun)
      const cur = new Date(now);
      const day = cur.getDay(); // 0 Sun..6 Sat
      const diffToMon = (day === 0 ? -6 : 1 - day);
      const monday = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + diffToMon);
      for (let i = 7; i >= 0; i--) {
        const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - i * 7, 0, 0, 0, 0);
        const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
        const key = `${start.getFullYear()}-W${this.getWeekNumber(start)}`;
        const label = `${String(start.getDate()).padStart(2, '0')} ${monthNames[start.getMonth()]} - ${String(end.getDate()).padStart(2, '0')} ${monthNames[end.getMonth()]}`;
        buckets.push({ key, label, test: (ts) => ts >= start.getTime() && ts <= end.getTime() });
      }
    } else {
      // month: last 4 months including current
      for (let i = 3; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
        const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
        buckets.push({ key, label, test: (ts) => ts >= start && ts <= end });
      }
    }
    return buckets;
  }

  private getRangeWindow(nowTs: number, range: 'day' | 'week' | 'month'): { startTs: number; endTs: number } {
    const d = new Date(nowTs);
    let start = new Date(d);
    if (range === 'day') {
      start.setHours(0, 0, 0, 0);
    } else if (range === 'week') {
      const day = d.getDay();
      const diffToMon = (day === 0 ? -6 : 1 - day);
      start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffToMon, 0, 0, 0, 0);
    } else {
      start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    }
    return { startTs: start.getTime(), endTs: nowTs };
  }

  private getWeekNumber(date: Date): string {
    // ISO week number (YYYY-Www)
    const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = (tmp.getUTCDay() + 6) % 7;
    tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((tmp.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return `${tmp.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
  }

  
}
