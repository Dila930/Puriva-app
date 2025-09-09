import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { BottomNavComponent } from '../components/bottom-nav/bottom-nav.component';
import { Auth } from '@angular/fire/auth';
import { Firestore, collection, getCountFromServer, query, orderBy, limit, getDocs } from '@angular/fire/firestore';
import { Database, ref, get, child } from '@angular/fire/database';
import { onValue, off } from 'firebase/database';
import { isAdmin } from '../utils/admin-ids';

interface AdminStats {
  totalUsers: number;
  sterilizations: number;
  comments: number;
  forums: number;
  news: number;
}

interface UserAggRow {
  uid: string;
  email?: string;
  username?: string;
  steril: number;
  comments: number;
  threads: number;
  password?: string;
  showPassword?: boolean;
}

@Component({
  standalone: true,
  selector: 'app-admin-management',
  templateUrl: './admin-management.page.html',
  styleUrls: ['./admin-management.page.scss'],
  imports: [CommonModule, IonicModule, FormsModule, RouterModule, BottomNavComponent]
})
export class AdminManagementPage implements OnInit, OnDestroy {
  loading = false;
  stats: AdminStats = { totalUsers: 0, sterilizations: 0, comments: 0, forums: 0, news: 0 };
  usersPreview: Array<{ email: string; username?: string; lastActive?: any } > = [];

  // Line chart bindings (monthly, 4 series: Sterilisasi vs Thread vs Komentar vs Berita)
  chartLineA = '';
  chartLineB = '';
  chartLineC = '';
  chartLineD = '';
  chartDotsA: Array<{x:number;y:number;v:number}> = [];
  chartDotsB: Array<{x:number;y:number;v:number}> = [];
  chartDotsC: Array<{x:number;y:number;v:number}> = [];
  chartDotsD: Array<{x:number;y:number;v:number}> = [];
  chartMaxY = 0;
  hasChartData = false;
  // Y-axis ticks (positions within SVG and their labels)
  yTickYs: number[] = [];
  yTickLabels: number[] = [];

  // Windowing over date segments (5-day ranges per month)
  private monthKeys: string[] = [];
  private seriesSterAll: number[] = [];
  private seriesThreadAll: number[] = [];
  private seriesCommentAll: number[] = [];
  private seriesNewsAll: number[] = [];
  viewStart = 0; // index into monthKeys for chart window
  viewSize = 6;
  viewMonthLabels: string[] = [];
  viewLabelXs: number[] = [];
  viewMonthAbbr: string[] = [];
  reverseOrder = false;

  // Aggregated per-user rows for table
  userAggRows: UserAggRow[] = [];
  filteredUserAggRows: UserAggRow[] = [];
  userSearch = '';

  // Debounced refresh trigger for realtime updates
  private refreshTimer: any = null;
  private scheduleRefresh(delayMs = 500) {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      // Do not stack if already loading; next realtime event will retrigger
      if (!this.loading) this.refresh();
    }, delayMs);
  }

  constructor(
    private router: Router,
    private auth: Auth,
    private firestore: Firestore,
    private db: Database,
    private toast: ToastController,
  ) {}

  ngOnInit(): void {
    // Protect page: only admin
    if (!isAdmin(this.auth)) {
      this.router.navigate(['/home']);
      return;
    }
    // Start realtime listeners so totals (users, sterilisasi) reflect Firebase RTDB
    this.cleanupSubscriptions();
    this.setupRealtimeListeners();
    this.refresh();
  }

  // Period filter removed per request

  async fetchUserPassword(uid: string): Promise<string> {
    try {
      const snap = await get(child(ref(this.db), `users/${uid}/kodeAkses`));
      return snap.exists() ? snap.val() : 'N/A';
    } catch (error) {
      console.error('Error fetching password:', error);
      return 'Error';
    }
  }

  async togglePasswordVisibility(user: UserAggRow): Promise<void> {
    if (user.password === undefined) {
      user.password = await this.fetchUserPassword(user.uid);
    }
    user.showPassword = !user.showPassword;
  }

  getMaskedPassword(password: string | undefined): string {
    if (!password) return '••••••••';
    return password.replace(/./g, '•');
  }

  async refresh(): Promise<void> {
    this.loading = true;
    // Collections
    const usersCol = collection(this.firestore, 'users');
    const registerCol = collection(this.firestore, 'register');
    const sterCol = collection(this.firestore, 'sterilisasi');
    const newsCol = collection(this.firestore, 'news');

    // Totals: union of all known user sources (RTDB users + FS users + FS register)
    let totalUsers = 0;
    const uidSet = new Set<string>();
    try {
      const uSnap = await get(child(ref(this.db), 'users'));
      const uVal = uSnap.val();
      if (uVal && typeof uVal === 'object') {
        for (const [key, v] of Object.entries<any>(uVal)) {
          if (v === '' || v === null || v === undefined) continue; // ignore placeholders
          const uid = (typeof v?.uid === 'string' && v.uid.trim()) || key;
          const isNonEmptyObject = v && typeof v === 'object' && Object.keys(v).length > 0;
          const hasEmail = !!v?.email;
          const hasUsername = !!(v?.username || v?.name || v?.displayName || v?.fullname);
          if (uid && (isNonEmptyObject || hasEmail || hasUsername)) uidSet.add(uid);
        }
      }
    } catch {}
    try {
      const usersCountDocs = await getDocs(usersCol as any);
      usersCountDocs.forEach(d => uidSet.add(d.id));
    } catch {}
    try {
      const regDocs = await getDocs(registerCol as any);
      regDocs.forEach(d => {
        const v = d.data() as any;
        const id = (v?.uid || v?.userId || v?.userID || '').toString().trim() || d.id;
        if (id) uidSet.add(id);
      });
    } catch {}
    totalUsers = uidSet.size;

    // Sterilizations initial count (prefer RTDB users/*/recentActivities for accurate session totals)
    let sterilizations = 0;
    try {
      const uSnap2 = await get(child(ref(this.db), 'users'));
      const usersObj = (uSnap2.val() || {}) as Record<string, any>;
      for (const u of Object.values<any>(usersObj)) {
        const acts = u?.recentActivities;
        if (Array.isArray(acts)) sterilizations += acts.length;
        else if (acts && typeof acts === 'object') sterilizations += Object.keys(acts).length;
      }
    } catch {}
    if (!sterilizations) {
      try {
        // Fallback: Firestore sterilisasiLogs if available, else sterilisasi collection count
        const logsCol = collection(this.firestore, 'sterilisasiLogs');
        const sterLogsCount = await getCountFromServer(logsCol as any);
        sterilizations = sterLogsCount.data().count || 0;
        if (!sterilizations) {
          const sterCount = await getCountFromServer(sterCol as any);
          sterilizations = sterCount.data().count || 0;
        }
      } catch {
        sterilizations = 0;
      }
    }

    let forums = 0;
    let comments = 0;
    try {
      const snap = await get(child(ref(this.db), 'forum/discussions'));
      const all = (snap.val() || {}) as Record<string, any>;
      for (const v of Object.values(all)) {
        forums++;
        const cs = (v as any)?.comments;
        if (cs && typeof cs === 'object') {
          comments += Object.keys(cs).length;
        } else if (Array.isArray(cs)) {
          comments += cs.length;
        }
      }
    } catch {}

    // News total count (prefer RTDB 'news/items', fallback Firestore 'news')
    let news = 0;
    try {
      const nSnap = await get(child(ref(this.db), 'news/items'));
      const nVal = nSnap.val();
      if (nVal && typeof nVal === 'object') news = Object.keys(nVal).length;
    } catch {}
    if (!news) {
      try {
        const ncount = await getCountFromServer(newsCol as any);
        news = ncount.data().count || 0;
      } catch {}
    }

    // Build per-user aggregation: steril, comments, threads
    const perUser = new Map<string, { steril: number; comments: number; threads: number }>();
    const inc = (uid?: string, key?: 'steril' | 'comments' | 'threads') => {
      if (!uid || !key) return;
      const row = perUser.get(uid) || { steril: 0, comments: 0, threads: 0 };
      row[key]++;
      perUser.set(uid, row);
    };

    // Segmented series map across any month by 5-day bins
    const buckets = new Map<string, { ster: number; thr: number; cmt: number; news: number }>();
    const monthPrefixes = new Set<string>(); // e.g., YYYY-MM
    const segmentOf = (day: number): [number, number, number] => {
      // returns [segIndex (0..5), startDay, endDay]
      if (day <= 5) return [0, 1, 5];
      if (day <= 10) return [1, 6, 10];
      if (day <= 15) return [2, 11, 15];
      if (day <= 20) return [3, 16, 20];
      if (day <= 25) return [4, 21, 25];
      return [5, 26, 31]; // end will be clamped to EOM in label
    };
    const keyOf = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,'0');
      const day = d.getDate();
      const [seg] = segmentOf(day);
      monthPrefixes.add(`${y}-${m}`);
      return `${y}-${m}-S${seg}`; // e.g., 2025-08-S4
    };
    // labelOf moved to class method
    const bump = (k: string, field: keyof { ster: number; thr: number; cmt: number; news: number }) => {
      const row = buckets.get(k) || { ster: 0, thr: 0, cmt: 0, news: 0 };
      row[field]++;
      buckets.set(k, row);
    };
    const parseDate = (v: any): Date | null => {
      if (!v) return null;
      if (typeof v?.toDate === 'function') return v.toDate();
      if (typeof v === 'number') return new Date(v);
      if (typeof v === 'string') {
        const t = Date.parse(v);
        return isNaN(t) ? null : new Date(t);
      }
      if (v?.seconds) return new Date(v.seconds * 1000);
      return null;
    };

    // Helper to extract UID from various possible field names
    const extractUid = (obj: any): string | undefined => {
      const cand = obj?.uid || obj?.userId || obj?.userID || obj?.authorUid || obj?.ownerUid || obj?.owner;
      if (!cand) return undefined;
      const s = String(cand).trim();
      return s.length ? s : undefined;
    };

    // Aggregate from Firestore sterilisasi (uid + createdAt)
    try {
      const sterDocs = await getDocs(sterCol as any);
      sterDocs.forEach(d => {
        const v = d.data() as any;
        const uidVal = extractUid(v);
        if (uidVal) inc(uidVal, 'steril');
        const dt = parseDate(v?.createdAt) || parseDate(v?.time) || parseDate(v?.at) || parseDate(v?.updatedAt);
        if (dt) bump(keyOf(dt), 'ster');
      });
    } catch {}

    // Aggregate sterilizations from RTDB users/*/recentActivities (has timestamps 'at' and optional 'finishedAt')
    try {
      const uSnap2 = await get(child(ref(this.db), 'users'));
      const usersObj = (uSnap2.val() || {}) as Record<string, any>;
      for (const [uid, u] of Object.entries<any>(usersObj)) {
        const acts = u?.recentActivities;
        if (!acts) continue;
        const list: any[] = Array.isArray(acts) ? acts : Object.values<any>(acts);
        for (const it of list) {
          // item carries at/finishedAt; we attribute to start time (at)
          const dt = parseDate(it?.at) || parseDate(it?.startedAt) || parseDate(it?.time) || null;
          if (dt) bump(keyOf(dt), 'ster');
          // per-user aggregate
          inc(uid, 'steril');
        }
      }
    } catch {}

    // Aggregate from forums (threads + comments) from RTDB
    try {
      const snap = await get(child(ref(this.db), 'forum/discussions'));
      const all = (snap.val() || {}) as Record<string, any>;
      for (const v of Object.values<any>(all)) {
        const thrUid = extractUid(v);
        if (thrUid) inc(thrUid, 'threads');
        const cs = v?.comments;
        if (cs && typeof cs === 'object') {
          Object.values<any>(cs).forEach((c: any) => {
            const cUid = extractUid(c);
            if (cUid) inc(cUid, 'comments');
            const cdt = parseDate(c?.createdAt) || parseDate(c?.time) || parseDate(c?.at);
            if (cdt) bump(keyOf(cdt), 'cmt');
          });
        } else if (Array.isArray(cs)) {
          cs.forEach((c: any) => {
            const cUid = extractUid(c);
            if (cUid) inc(cUid, 'comments');
            const cdt = parseDate(c?.createdAt) || parseDate(c?.time) || parseDate(c?.at);
            if (cdt) bump(keyOf(cdt), 'cmt');
          });
        }
        const dt = parseDate(v?.createdAt) || parseDate(v?.time) || parseDate(v?.at);
        if (dt) bump(keyOf(dt), 'thr');
        // If comments had no timestamp, fallback add to thread month as approximation
        if ((cs && typeof cs === 'object' && Object.values(cs).every((c: any)=>!c?.createdAt && !c?.time && !c?.at)) || (Array.isArray(cs) && cs.every((c: any)=>!c?.createdAt && !c?.time && !c?.at))) {
          const cnt = Array.isArray(cs) ? cs.length : (cs ? Object.keys(cs).length : 0);
          if (dt && cnt>0) { for (let i=0;i<cnt;i++) bump(keyOf(dt), 'cmt'); }
        }
      }
    } catch {}

    // Aggregate sterilizations from RTDB if available (count per uid only, no date)
    try {
      const sSnap = await get(child(ref(this.db), 'sterilisasi'));
      const sAll = (sSnap.val() || {}) as Record<string, any>;
      // Support both flat list (each entry has uid) and nested per-uid structure
      for (const [key, val] of Object.entries<any>(sAll)) {
        if (val && typeof val === 'object' && ('uid' in val || 'userId' in val || 'userID' in val)) {
          const u = extractUid(val);
          if (u) inc(u, 'steril');
        } else if (val && typeof val === 'object') {
          // Possibly a bucket by uid
          const maybeUid = String(key);
          const children = Object.values(val || {});
          const count = Array.isArray(children) ? children.length : Object.keys(val || {}).length;
          if (maybeUid) {
            for (let i = 0; i < count; i++) inc(maybeUid, 'steril');
          }
        }
      }
    } catch {}

    // Aggregate News per month from Firestore
    try {
      const newsDocs = await getDocs(newsCol as any);
      newsDocs.forEach(d => {
        const v = d.data() as any;
        const dt = parseDate(v?.createdAt) || parseDate(v?.publishedAt) || parseDate(v?.time) || parseDate(v?.at) || parseDate(v?.updatedAt);
        if (dt) bump(keyOf(dt), 'news');
      });
    } catch {}

    // Also aggregate News from RTDB if present (align with Education page path 'news/items')
    try {
      const nSnap = await get(child(ref(this.db), 'news/items'));
      const nAll = (nSnap.val() || {}) as Record<string, any>;
      for (const v of Object.values<any>(nAll)) {
        const dt = parseDate(v?.createdAt) || parseDate(v?.publishedAt) || parseDate(v?.time) || parseDate(v?.at) || parseDate(v?.updatedAt);
        if (dt) bump(keyOf(dt), 'news');
      }
    } catch {}

    // Build rows and enrich with all registered users (zeros if no activity)
    const rowsMap = new Map<string, { uid: string; email?: string; username?: string; steril: number; comments: number; threads: number }>();
    for (const [uid, agg] of perUser.entries()) {
      rowsMap.set(uid, { uid, ...agg });
    }

    // Merge RTDB users so any RTDB user appears in the table
    try {
      const rtdbUsersSnap = await get(child(ref(this.db), 'users'));
      const rtdbUsers = (rtdbUsersSnap.val() || {}) as Record<string, any>;
      for (const [key, v] of Object.entries<any>(rtdbUsers)) {
        // Ignore non-user placeholders like empty string values
        if (v === '' || v === null || v === undefined) continue;
        const uid = (typeof v?.uid === 'string' && v.uid.trim()) || key;
        if (!uid) continue;
        const existing = rowsMap.get(uid);
        const base: { uid: string; email?: string; username?: string; steril: number; comments: number; threads: number } = existing
          ? { ...existing }
          : { uid, steril: 0, comments: 0, threads: 0, email: undefined, username: undefined };
        base.email = (v?.email || v?.mail) ?? base.email;
        base.username = (v?.username || v?.name || v?.displayName || v?.fullname) ?? base.username;
        rowsMap.set(uid, base);
      }
    } catch {}
    try {
      const usersSnap = await getDocs(usersCol as any);
      usersSnap.forEach(d => {
        const v = d.data() as any;
        const uid = d.id;
        const existing = rowsMap.get(uid);
        const base: { uid: string; email?: string; username?: string; steril: number; comments: number; threads: number } = existing
          ? { ...existing }
          : { uid, steril: 0, comments: 0, threads: 0, email: undefined, username: undefined };
        base.email = v?.email ?? base.email;
        base.username = v?.username ?? v?.name ?? v?.displayName ?? base.username;
        rowsMap.set(uid, base);
      });
    } catch {}

    // Merge register collection too (ensure newly registered users appear even without activity)
    try {
      const regSnap = await getDocs(registerCol as any);
      regSnap.forEach(d => {
        const v = d.data() as any;
        const uid = (v?.uid || v?.userId || v?.userID || '').toString().trim() || d.id;
        if (!uid) return;
        const existing = rowsMap.get(uid);
        const base: { uid: string; email?: string; username?: string; steril: number; comments: number; threads: number } = existing
          ? { ...existing }
          : { uid, steril: 0, comments: 0, threads: 0, email: undefined, username: undefined };
        base.email = v?.email ?? base.email;
        base.username = v?.username ?? v?.name ?? v?.displayName ?? v?.fullname ?? base.username;
        rowsMap.set(uid, base);
      });
    } catch {}
    const rows = Array.from(rowsMap.values());
    rows.sort((a, b) => a.uid.localeCompare(b.uid));
    this.userAggRows = rows;
    this.applyUserFilter();
    // Keep totalUsers consistent with what we display
    totalUsers = rows.length;

    // Users preview: prefer register entries, fallback to users by lastActive
    this.usersPreview = [];
    try {
      const regRes = await getDocs(registerCol as any);
      this.usersPreview = regRes.docs.map(d => {
        const v = d.data() as any;
        return { email: v?.email || '-', username: v?.username || v?.name || v?.displayName || v?.fullname, lastActive: v?.createdAt?.toDate?.() || null };
      }).slice(0, 10);
    } catch {}
    if (!this.usersPreview.length) {
      try {
        const recentQ = query(usersCol as any, orderBy('lastActive', 'desc'), limit(10));
        const res = await getDocs(recentQ as any);
        this.usersPreview = res.docs.map(d => {
          const v = d.data() as any;
          return { email: v?.email || '-', username: v?.username || v?.name || v?.displayName, lastActive: v?.lastActive?.toDate?.() || null };
        });
      } catch {}
    }

    // Ensure all 5-day segments exist for each encountered month; seed current month if none
    if (monthPrefixes.size > 0) {
      monthPrefixes.forEach(pref => {
        for (let s = 0; s < 6; s++) {
          const k = `${pref}-S${s}`;
          if (!buckets.has(k)) buckets.set(k, { ster: 0, thr: 0, cmt: 0, news: 0 });
        }
      });
    } else {
      const now = new Date();
      const pref = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
      for (let s = 0; s < 6; s++) {
        const k = `${pref}-S${s}`;
        buckets.set(k, { ster: 0, thr: 0, cmt: 0, news: 0 });
      }
    }

    // Build sorted keys and series arrays
    const keys = Array.from(buckets.keys()).sort();
    const sterSeries = keys.map(k => buckets.get(k)!.ster);
    const thrSeries  = keys.map(k => buckets.get(k)!.thr);
    const cmtSeries  = keys.map(k => buckets.get(k)!.cmt);
    const nwsSeries  = keys.map(k => buckets.get(k)!.news);

    this.monthKeys = keys;
    this.seriesSterAll = sterSeries;
    this.seriesThreadAll = thrSeries;
    this.seriesCommentAll = cmtSeries;
    this.seriesNewsAll = nwsSeries;

    // Clamp view window and apply
    if (!Number.isFinite(this.viewStart) || this.viewStart < 0) this.viewStart = 0;
    if (!Number.isFinite(this.viewSize) || this.viewSize <= 0) this.viewSize = 6;
    if (this.viewStart + this.viewSize > this.monthKeys.length) {
      this.viewStart = Math.max(0, this.monthKeys.length - this.viewSize);
    }
    this.applyWindow();

    // Update stats after counts
    this.stats = { totalUsers, sterilizations, comments, forums, news };

    this.loading = false;
  }

  // Filter table rows by UID, username, or email (case-insensitive)
  applyUserFilter() {
    const q = (this.userSearch || '').toLowerCase().trim();
    if (!q) {
      this.filteredUserAggRows = this.userAggRows.slice();
      return;
    }
    this.filteredUserAggRows = this.userAggRows.filter(r => {
      const uid = r.uid?.toLowerCase() || '';
      const name = (r.username || '').toLowerCase();
      const email = (r.email || '').toLowerCase();
      return uid.includes(q) || name.includes(q) || email.includes(q);
    });
  }

  // Build label for a segmented key (YYYY-MM-Sn) -> "s–e" only (days)
  private labelOf(key: string): string {
    try {
      const y = Number(key.slice(0, 4));
      const m = Number(key.slice(5, 7));
      const seg = Number(key.slice(9));
      const ranges: Array<[number, number]> = [[1,5],[6,10],[11,15],[16,20],[21,25],[26,31]];
      let [s, e] = ranges[seg] || [1,5];
      const eom = new Date(y, m, 0).getDate();
      if (e > eom) e = eom;
      return `${s}\u2013${e}`;
    } catch {
      return key;
    }
  }

  // Month abbreviation from segmented key
  private monthAbbr(key: string): string {
    try {
      const m = Number(key.slice(5, 7)) - 1; // 0-based
      const abbr = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      return abbr[m] || '';
    } catch {
      return '';
    }
  }

  get totalMonths(): number { return this.monthKeys.length; }
  get windowEnd(): number { return Math.min(this.viewStart + this.viewSize, this.totalMonths); }

  // Apply current window to chart series and labels
  private applyWindow() {
    const end = Math.min(this.viewStart + this.viewSize, this.monthKeys.length);
    let ks = this.monthKeys.slice(this.viewStart, end);
    let ster = this.seriesSterAll.slice(this.viewStart, end);
    let thr = this.seriesThreadAll.slice(this.viewStart, end);
    let cmt = this.seriesCommentAll.slice(this.viewStart, end);
    let nws = this.seriesNewsAll.slice(this.viewStart, end);
    if (this.reverseOrder) {
      ks = ks.slice().reverse();
      ster = ster.slice().reverse();
      thr = thr.slice().reverse();
      cmt = cmt.slice().reverse();
      nws = nws.slice().reverse();
    }
    this.viewMonthLabels = ks.map(k => this.labelOf(k));
    this.viewMonthAbbr = ks.map(k => this.monthAbbr(k));
    this.updateChartLines(ster, thr, cmt, nws);
  }

  private updateChartLines(monthSter: number[], monthThread: number[], monthComment: number[], monthNews: number[]) {
    const width = 320; const height = 160; const left = 32; const right = 16; const top = 16; const bottom = 32;
    const plotW = width - left - right; const plotH = height - top - bottom;
    const n = Math.max(monthSter.length, 1);
    const xAt = (i: number) => Math.round(left + (i / Math.max(n-1,1)) * plotW);
    const maxY = Math.max(1, ...monthSter, ...monthThread, ...monthComment, ...monthNews);
    const yAt = (v: number) => Math.round(top + (1 - v / maxY) * plotH);
    const ptsA: Array<{x:number;y:number;v:number}> = [];
    const ptsB: Array<{x:number;y:number;v:number}> = [];
    const ptsC: Array<{x:number;y:number;v:number}> = [];
    const ptsD: Array<{x:number;y:number;v:number}> = [];
    for (let i = 0; i < n; i++) {
      ptsA.push({ x: xAt(i), y: yAt(monthSter[i] || 0), v: monthSter[i] || 0 });
      ptsB.push({ x: xAt(i), y: yAt(monthThread[i] || 0), v: monthThread[i] || 0 });
      ptsC.push({ x: xAt(i), y: yAt(monthComment[i] || 0), v: monthComment[i] || 0 });
      ptsD.push({ x: xAt(i), y: yAt(monthNews[i] || 0), v: monthNews[i] || 0 });
    }
    const toStr = (pts: Array<{x:number;y:number}>) => pts.map(p => `${p.x},${p.y}`).join(' ');
    this.chartDotsA = ptsA; this.chartDotsB = ptsB; this.chartDotsC = ptsC; this.chartDotsD = ptsD;
    this.chartLineA = toStr(ptsA);
    this.chartLineB = toStr(ptsB);
    this.chartLineC = toStr(ptsC);
    this.chartLineD = toStr(ptsD);
    this.chartMaxY = maxY;
    this.hasChartData = maxY > 0;
    this.viewLabelXs = new Array(n).fill(0).map((_, i) => xAt(i));

    // Compute nice y-axis ticks (up to 5 ticks including 0 and max)
    const niceStep = (targetStep: number) => {
      const pow10 = Math.pow(10, Math.floor(Math.log10(targetStep)));
      const candidates = [1, 2, 5].map(m => m * pow10);
      // If targetStep is larger than 5*pow10, scale up
      while (candidates[candidates.length - 1] < targetStep) {
        const last = candidates[candidates.length - 1];
        candidates.push(last * 2);
        candidates.push(last * 2.5);
        candidates.push(last * 5);
      }
      // Pick first >= targetStep
      for (const c of candidates) if (c >= targetStep) return c;
      return targetStep || 1;
    };
    const rawStep = maxY / 4; // aim for ~5 ticks including 0
    const step = niceStep(rawStep);
    const labels: number[] = [];
    let v = 0;
    while (v < maxY) { labels.push(v); v += step; if (labels.length > 10) break; }
    if (labels[labels.length - 1] !== maxY) labels.push(maxY);
    this.yTickLabels = labels;
    this.yTickYs = labels.map(val => yAt(val));
  }

  // Pan controls by full month (6 segments)
  prevWindow() {
    if (this.viewStart <= 0) return;
    this.viewStart = Math.max(0, this.viewStart - 6);
    this.applyWindow();
  }
  nextWindow() {
    if (this.viewStart + this.viewSize >= this.monthKeys.length) return;
    this.viewStart = Math.min(this.monthKeys.length - this.viewSize, this.viewStart + 6);
    this.applyWindow();
  }

  toggleOrder() {
    this.reverseOrder = !this.reverseOrder;
    this.applyWindow();
  }

  // --- Realtime section ---
  private rtdbUnsubs: Array<() => void> = [];

  private cleanupSubscriptions() {
    this.rtdbUnsubs.forEach(u => { try { u(); } catch {} });
    this.rtdbUnsubs = [];
  }

  private setupRealtimeListeners() {
    // Realtime total users: count only valid user records from RTDB 'users'
    const usersRef = ref(this.db, 'users');
    const usersHandler = (_snap: any) => {
      // Let debounced refresh recompute the canonical union count and tables
      this.scheduleRefresh();
    };
    onValue(usersRef, usersHandler);
    this.rtdbUnsubs.push(() => off(usersRef, 'value', usersHandler as any));

    // Realtime sterilization total from users/*/recentActivities (total sessions across all users and days)
    const usersRef2 = ref(this.db, 'users');
    const sterHandler = (snap: any) => {
      const usersObj = snap.val() || {};
      let total = 0;
      if (usersObj && typeof usersObj === 'object') {
        for (const u of Object.values<any>(usersObj)) {
          const acts = u?.recentActivities;
          if (Array.isArray(acts)) total += acts.length;
          else if (acts && typeof acts === 'object') total += Object.keys(acts).length;
        }
      }
      this.stats = { ...this.stats, sterilizations: total };
      this.scheduleRefresh();
    };
    onValue(usersRef2, sterHandler);
    this.rtdbUnsubs.push(() => off(usersRef2, 'value', sterHandler as any));

    // Realtime forums and comments from RTDB 'forum/discussions'
    const forumRef = ref(this.db, 'forum/discussions');
    const forumHandler = (snap: any) => {
      const all = (snap.val() || {}) as Record<string, any>;
      let forums = 0;
      let comments = 0;
      if (all && typeof all === 'object') {
        for (const v of Object.values<any>(all)) {
          forums++;
          const cs = v?.comments;
          if (cs && typeof cs === 'object') comments += Object.keys(cs).length;
          else if (Array.isArray(cs)) comments += cs.length;
        }
      }
      this.stats = { ...this.stats, forums, comments };
      this.scheduleRefresh();
    };
    onValue(forumRef, forumHandler);
    this.rtdbUnsubs.push(() => off(forumRef, 'value', forumHandler as any));

    // Realtime news count from RTDB 'news/items'
    const newsRef = ref(this.db, 'news/items');
    const newsHandler = (snap: any) => {
      const data = snap.val();
      const news = data && typeof data === 'object' ? Object.keys(data).length : 0;
      this.stats = { ...this.stats, news };
      this.scheduleRefresh();
    };
    onValue(newsRef, newsHandler);
    this.rtdbUnsubs.push(() => off(newsRef, 'value', newsHandler as any));
  }

  ngOnDestroy(): void {
    this.cleanupSubscriptions();
  }
}
