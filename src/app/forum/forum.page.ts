import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { BottomNavComponent } from '../components/bottom-nav/bottom-nav.component';
import { Database, onValue, orderByChild, query, ref, push, set, update, remove, onDisconnect, get, child } from '@angular/fire/database';
import { Auth, onAuthStateChanged, User } from '@angular/fire/auth';
import { isAdminByUidOrEmail } from '../utils/admin-ids';

@Component({
  selector: 'app-forum',
  templateUrl: './forum.page.html',
  styleUrls: ['./forum.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterModule, BottomNavComponent]
})
export class ForumPage implements OnInit, OnDestroy {
  constructor(private router: Router, private db: Database, private auth: Auth) {}

// Fetch and cache username for a given UID (for likers display)
private async getUsernameByUid(uid: string): Promise<string> {
  if (!uid) return 'Pengguna';
  const cached = this.usernameCache[uid];
  if (cached) return cached;
  try {
    const snap = await get(child(ref(this.db), `users/${uid}`));
    const data = snap.val() || {};
    const name = (data.username || data.displayName || '').toString().trim();
    const finalName = name || 'Pengguna';
    this.usernameCache[uid] = finalName;
    return finalName;
  } catch {
    const fallback = 'Pengguna';
    this.usernameCache[uid] = fallback;
    return fallback;
  }
}

  // Models
  interfaceComment = {} as never; // placeholder for TS section separation
  private unsubscribeFn?: () => void;
  private voteUnsub?: () => void;
  private commentVoteUnsub?: () => void;
  private presenceUnsub?: () => void;
  private authUnsub?: () => void;
  private connectionUnsub?: () => void;

  forumStats = { totalThreads: 0, totalComments: 0, activeUsers: 0 };

  categories: Array<{ key: string; name: string; icon: string; count: number }> = [
    { key: 'all', name: 'Semua', icon: '📚', count: 0 },
    { key: 'troubleshooting', name: 'Troubleshooting', icon: '🛠️', count: 0 },
    { key: 'tips', name: 'Tips & Trik', icon: '💡', count: 0 },
    { key: 'data', name: 'Data & Analitik', icon: '📊', count: 0 },
    { key: 'news', name: 'Berita & Update', icon: '📰', count: 0 },
    { key: 'diskusi', name: 'Diskusi Bebas', icon: '💬', count: 0 },
  ];
  currentCategory: string = 'all';

  threads: Array<{
    id: string;
    title: string;
    content: string;
    author: string;
    authorUid?: string | null;
    role: 'operator' | 'teknisi' | 'admin' | 'user';
    comments: Array<{ author: string; authorUid?: string | null; role: string; content: string; timestamp: number; id?: string }>;
    likes: number;
    dislikes?: number;
    timestamp: number;
    isPinned?: boolean;
    isTrending?: boolean;
    status?: 'open' | 'solved';
    category?: string;
  }> = [];

  filteredThreads: typeof this.threads = [];

  // Cache for uid -> username/displayName
  private usernameCache: Record<string, string> = {};

  // Cache for uid -> { url, visibility }
  private avatarCache: Record<string, { url: string | null; visibility: 'public' | 'private' }> = {};

  // Detail view
  showThreadDetail = false;
  selectedThread: (typeof this.threads)[number] | null = null;

  // Auth (mock)
  currentUser: { name: string; role: 'operator' | 'teknisi' | 'admin' } | null = null;
  showLoginAlert = false;
  loginAlertButtons = [
    { text: 'Batal', role: 'cancel' },
    { text: 'Login', role: 'confirm', handler: () => (this.showLoginModal = true) },
  ];
  showLoginModal = false;
  loginForm: { username: string; password: string; role: 'operator' | 'teknisi' | 'admin' | '' } = {
    username: '',
    password: '',
    role: ''
  };
  showPassword = false;
  isLoading = false;
  loginSuccess = false;

  // Derived auth state from Firebase
  get isLoggedIn(): boolean {
    return !!this.auth.currentUser;
  }

  // Session ID for anonymous presence
  private getOrCreateSessionId(): string {
    try {
      const key = 'puriva_forum_session_id';
      const existing = sessionStorage.getItem(key);
      if (existing && existing.length > 0) return existing;
      const id = this.cryptoRandomId();
      sessionStorage.setItem(key, id);
      return id;
    } catch {
      return this.cryptoRandomId();
    }
  }

  private cryptoRandomId(len: number = 20): string {
    try {
      const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const arr = new Uint8Array(len);
      (crypto as any).getRandomValues(arr);
      let s = '';
      for (let i = 0; i < len; i++) s += alphabet[arr[i] % alphabet.length];
      return s;
    } catch {
      // Fallback
      return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
  }

  // Comment ownership helpers
  isMyComment(threadId: string, comment: { authorUid?: string | null; id?: string }): boolean {
    const uid = this.auth.currentUser?.uid || null;
    return !!uid && !!comment && !!comment.authorUid && comment.authorUid === uid;
  }
  canViewCommentLikers(threadId: string, comment: { authorUid?: string | null; id?: string }): boolean {
    // Thread owner/admin already handled by canManageThread(selectedThread) in template; include comment owner
    return this.isMyComment(threadId, comment) || (this.selectedThread ? this.canManageThread(this.selectedThread) : false);
  }
  async editComment(threadId: string, commentId: string, currentContent: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) { this.showLoginPrompt(); return; }
    const t = this.threads.find(x => x.id === threadId);
    const c = t?.comments.find((cc: any) => (cc.id && cc.id === commentId));
    if (!c || !this.isMyComment(threadId, c)) return;
    const updated = prompt('Ubah komentar:', currentContent || '');
    if (updated == null) return;
    try {
      await set(ref(this.db, `forum/discussions/${threadId}/comments/${commentId}/content`), updated.trim());
      // Optimistic update
      (c as any).content = updated.trim();
    } catch (e) {
      console.warn('editComment failed', e);
    }
  }
  async deleteComment(threadId: string, commentId: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) { this.showLoginPrompt(); return; }
    const t = this.threads.find(x => x.id === threadId);
    const cIdx = t?.comments.findIndex((cc: any) => (cc.id && cc.id === commentId)) ?? -1;
    if (!t || cIdx < 0) return;
    const c = t.comments[cIdx] as any;
    if (!this.isMyComment(threadId, c)) return;
    if (!confirm('Hapus komentar ini?')) return;
    try {
      await remove(ref(this.db, `forum/discussions/${threadId}/comments/${commentId}`));
      // Optimistic update
      t.comments.splice(cIdx, 1);
      this.computeStats();
    } catch (e) {
      console.warn('deleteComment failed', e);
    }
  }

  private attachCommentVotesListener(): void {
    try {
      if (this.commentVoteUnsub) { try { this.commentVoteUnsub(); } catch {} this.commentVoteUnsub = undefined; }
      const root = ref(this.db, 'forum/commentVotes');
      this.commentVoteUnsub = onValue(root, async (snap) => {
        const all = (snap.val() || {}) as Record<string, Record<string, Record<string, any>>>; // threadId -> commentId -> uid -> vote
        const counts: Record<string, Record<string, number>> = {};
        const mine: Record<string, Record<string, boolean>> = {};
        const likers: Record<string, Record<string, string[]>> = {};
        const myUid = this.auth.currentUser?.uid || null;
        // Collect UIDs to ensure username cache
        const needFetch = new Set<string>();
        for (const threadId of Object.keys(all)) {
          const comments = all[threadId] || {};
          for (const commentId of Object.keys(comments)) {
            const obj = comments[commentId] || {};
            for (const uid of Object.keys(obj)) {
              if (uid && uid !== myUid && !this.usernameCache[uid]) needFetch.add(uid);
            }
          }
        }
        if (needFetch.size > 0) {
          await Promise.all(Array.from(needFetch).map(uid => this.getUsernameByUid(uid).catch(() => undefined)));
        }
        // Build counts and likers with usernames
        for (const threadId of Object.keys(all)) {
          counts[threadId] = counts[threadId] || {};
          mine[threadId] = mine[threadId] || {};
          likers[threadId] = likers[threadId] || {};
          const comments = all[threadId] || {};
          for (const commentId of Object.keys(comments)) {
            let like = 0;
            const names: string[] = [];
            // Use the current thread's comments object; index by commentId directly
            for (const [uid, v] of Object.entries(comments[commentId] || {})) {
              const kind = (v && typeof v === 'object' && 'kind' in v) ? (v.kind as string) : (v as any);
              if (kind === 'like') {
                like++;
                const nm = myUid && uid === myUid ? 'Anda' : (this.usernameCache[uid] || (uid.slice(0,4) + '***'));
                names.push(nm);
              }
              if (myUid && uid === myUid) mine[threadId][commentId] = kind === 'like';
            }
            counts[threadId][commentId] = like;
            likers[threadId][commentId] = names;
          }
        }
        this.commentLikeCounts = counts;
        this.myCommentLikes = mine;
        this.commentLikers = likers;
      });
    } catch (e) {
      // ignore
    }
  }

  // Create thread modal
  showCreateThreadModal = false;
  newThreadForm: { title: string; category: string; content: string } = { title: '', category: '', content: '' };

  // UI state
  private likedThreadIds = new Set<string>();
  // reactions state
  private threadCounts: Record<string, { likes: number; dislikes: number }> = {};
  private myThreadVotes: Record<string, 'like'|'dislike'|null> = {};
  threadLikers: Record<string, string[]> = {};

  // Posting guards
  isPostingComment = false;
  isPostingThread = false;

  // UI modal state for likers
  showLikersModal = false;
  likersForThreadId: string | null = null;
  // comment likes state
  private commentLikeCounts: Record<string, Record<string, number>> = {}; // threadId -> commentId -> likes
  private myCommentLikes: Record<string, Record<string, boolean>> = {}; // threadId -> commentId -> true
  commentLikers: Record<string, Record<string, string[]>> = {}; // threadId -> commentId -> names
  likersForComment: { threadId: string; commentId: string } | null = null;

  // Lifecycle
  ngOnInit(): void {
    const q = query(ref(this.db, 'forum/discussions'), orderByChild('createdAt'));
    this.unsubscribeFn = onValue(q, (snap) => {
      const val = snap.val() as Record<string, any> | null;
      const arr = val ? Object.entries(val).map(([id, v]: [string, any]) => ({ id, ...v })) : [];
      const mapped = arr
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map((d: any) => ({
          id: d.id || cryptoRandomId(),
          title: d.topic || d.title || '(Tanpa Judul)',
          content: d.content || '',
          // Display username first; avoid showing email (even masked) per requirement
          author: d.username || d.authorDisplayName || d.author || 'Pengguna',
          authorUid: d.authorUid || null,
          role: (d.role || 'user') as any,
          comments: ((): Array<{ author: string; authorUid?: string | null; role: string; content: string; timestamp: number; id?: string }> => {
            if (Array.isArray(d.comments)) {
              // Legacy data may store comments as an array without IDs; use index as a stable fallback ID
              return d.comments.map((c: any, i: number) => ({
                id: c.id || String(i),
                author: c.username || c.authorDisplayName || c.author || 'Pengguna',
                authorUid: c.authorUid || null,
                role: c.role || 'user',
                content: c.content || '',
                timestamp: c.timestamp || Date.now(),
              }));
            }
            if (d.comments && typeof d.comments === 'object') {
              return Object.entries(d.comments).map(([cid, c]: [string, any]) => ({
                id: cid,
                author: c.username || c.authorDisplayName || c.author || 'Pengguna',
                authorUid: c.authorUid || null,
                role: c.role || 'user',
                content: c.content || '',
                timestamp: c.timestamp || Date.now(),
              }));
            }
            return [];
          })(),
          likes: d.likes || 0,
          dislikes: d.dislikes || 0,
          timestamp: d.createdAt || d.timestamp || Date.now(),
          isPinned: !!d.isPinned,
          isTrending: !!d.isTrending,
          status: (d.status || 'open') as any,
          category: d.category || 'diskusi',
        }));
      this.threads = mapped;
      // Rebind selectedThread to the latest object from snapshot to avoid stale references
      if (this.selectedThread) {
        const updated = this.threads.find(x => x.id === this.selectedThread!.id);
        if (updated) this.selectedThread = updated;
      }
      // Seed initial counts from discussion snapshot to avoid flicker before votes listener loads
      const seeded: Record<string, { likes: number; dislikes: number }> = {};
      for (const t of this.threads) {
        seeded[t.id] = { likes: (t as any).likes || 0, dislikes: (t as any).dislikes || 0 };
      }
      this.threadCounts = seeded;
      this.applyFilters();
      this.computeStats();
      this.computeCategories();
      // Hydrate usernames for legacy data that doesn't store username at node
      void this.hydrateUsernames();
      // Hydrate avatars and privacy for authors and commenters
      void this.hydrateAvatars();
      this.attachVotesListener();
      this.attachCommentVotesListener();
    });

    // Fallback dummy thread if no data (keeps UI usable)
    setTimeout(() => {
      if (this.threads.length === 0) {
        this.threads = [
          {
            id: cryptoRandomId(),
            title: 'Selamat datang di Forum PURIVA',
            content: 'Bagikan pengalaman, tips, dan pertanyaan Anda di sini.',
            author: 'Admin',
            role: 'admin',
            comments: [],
            likes: 0,
            timestamp: Date.now(),
            isPinned: true,
            isTrending: true,
            status: 'open',
            category: 'news',
          },
        ];
        this.applyFilters();
        this.computeStats();
        this.computeCategories();
      }
    }, 800);

    // Track active users presence in forum (includes non-auth viewers)
    try {
      // 1) Per-device session id for anonymous presence
      const sessionId = this.getOrCreateSessionId();
      const sessionRef = ref(this.db, `presence/forumSessions/${sessionId}`);
      const connRef = ref(this.db, '.info/connected');
      this.connectionUnsub = onValue(connRef, (snap) => {
        const connected = !!snap.val();
        if (!connected) return;
        const payload: any = { at: Date.now() };
        set(sessionRef, payload).catch(() => {});
        try { onDisconnect(sessionRef).remove(); } catch {}
      });

      // 2) Also write user presence when authenticated (optional)
      this.authUnsub = onAuthStateChanged(this.auth as any, (user: User | null) => {
        if (!user) return;
        const meRef = ref(this.db, `presence/forum/${user.uid}`);
        const payload: any = {
          at: Date.now(),
          byEmailMasked: user.email ? this.maskEmail(user.email) : null,
        };
        set(meRef, payload).catch(() => {});
        try { onDisconnect(meRef).remove(); } catch {}
      }) as unknown as () => void;

      // 3) Listen to session presence to compute active users (device-level)
      const sessionsRoot = ref(this.db, 'presence/forumSessions');
      this.presenceUnsub = onValue(sessionsRoot, (snap) => {
        const obj = (snap.val() || {}) as Record<string, any>;
        const count = Object.keys(obj).length;
        this.forumStats = { ...this.forumStats, activeUsers: count };
      });
    } catch {
      // ignore if Auth/DB not configured
    }
  }

  ngOnDestroy(): void {
    if (this.unsubscribeFn) this.unsubscribeFn();
    if (this.voteUnsub) { try { this.voteUnsub(); } catch {} this.voteUnsub = undefined; }
    if (this.commentVoteUnsub) { try { this.commentVoteUnsub(); } catch {} this.commentVoteUnsub = undefined; }
    if (this.presenceUnsub) { try { this.presenceUnsub(); } catch {} this.presenceUnsub = undefined; }
    if (this.authUnsub) { try { this.authUnsub(); } catch {} this.authUnsub = undefined; }
    if (this.connectionUnsub) { try { this.connectionUnsub(); } catch {} this.connectionUnsub = undefined; }
  }

  // Filtering & Search
  searchThreads(ev: any): void {
    const term: string = (ev?.detail?.value || '').toLowerCase();
    this.applyFilters(term);
  }

  filterByCategory(key: string): void {
    this.currentCategory = key;
    this.applyFilters();
  }

  private applyFilters(term = ''): void {
    const list = this.threads.filter((t) =>
      (this.currentCategory === 'all' || t.category === this.currentCategory) &&
      ((t.title || '').toLowerCase().includes(term) || (t.content || '').toLowerCase().includes(term))
    );
    this.filteredThreads = list;
  }

  private computeStats(): void {
    const totalThreads = this.threads.length;
    const totalComments = this.threads.reduce((acc, t) => acc + (t.comments?.length || 0), 0);
    // Preserve real-time activeUsers (from presence listener)
    const activeUsers = this.forumStats.activeUsers || 0;
    this.forumStats = { totalThreads, totalComments, activeUsers };
  }

  private computeCategories(): void {
    const counts: Record<string, number> = {};
    for (const t of this.threads) counts[t.category || 'diskusi'] = (counts[t.category || 'diskusi'] || 0) + 1;
    this.categories = this.categories.map((c) => ({ ...c, count: c.key === 'all' ? this.threads.length : (counts[c.key] || 0) }));
  }

  // Template helpers
  getThreadExcerpt(content: string): string { return (content || '').slice(0, 140); }
  getRoleText(role: string): string { return role === 'admin' ? 'Admin' : role === 'teknisi' ? 'Teknisi' : role === 'operator' ? 'Operator' : 'Pengguna'; }
  getTimeAgo(ts: number): string { return this.relativeTime(ts); }

  // Format counts for header stats (99+)
  formatCount(n?: number): string {
    const v = typeof n === 'number' && isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    return v > 99 ? '99+' : String(v);
  }

  private relativeTime(ts?: number): string {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'baru saja';
    if (m < 60) return `${m} menit yang lalu`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} jam yang lalu`;
    const d = Math.floor(h / 24);
    return `${d} hari yang lalu`;
  }

  // Thread interactions
  openThread(thread: (typeof this.threads)[number]): void {
    this.selectedThread = thread;
    this.showThreadDetail = true;
  }
  backToForum(): void { this.showThreadDetail = false; this.selectedThread = null; }

  // Permissions
  canManageThread(t: { author?: string; id: string }): boolean {
    const u = this.auth.currentUser;
    if (!u) return false;
    const admin = isAdminByUidOrEmail(u.uid, u.email || null);
    // We stored authorUid in DB but local `threads` doesn't keep it; query selectedThread via id when needed
    // Fallback: allow manage if admin
    if (admin) return true;
    // Read ownership from current snapshot list if present
    const raw = (this.threads as any).find((x: any) => x.id === t.id) as any;
    return !!raw && raw.authorUid === u.uid;
  }

  async editThreadTitleContent(threadId: string): Promise<void> {
    const u = this.auth.currentUser;
    if (!u) { this.showLoginPrompt(); return; }
    // Permission check
    if (!this.canManageThread({ id: threadId })) return;
    const t = this.threads.find(x => x.id === threadId);
    if (!t) return;
    const newTitle = prompt('Ubah judul thread:', t.title || '');
    if (newTitle === null) return;
    const newContent = prompt('Ubah konten thread:', t.content || '');
    if (newContent === null) return;
    try {
      const node = ref(this.db, `forum/discussions/${threadId}`);
      await update(node, { topic: newTitle, content: newContent });
      // Local update
      t.title = newTitle;
      t.content = newContent;
    } catch (e) {
      console.warn('editThread failed', e);
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    const u = this.auth.currentUser;
    if (!u) { this.showLoginPrompt(); return; }
    if (!this.canManageThread({ id: threadId })) return;
    if (!confirm('Hapus thread ini? Tindakan ini tidak dapat dibatalkan.')) return;
    try {
      await remove(ref(this.db, `forum/discussions/${threadId}`));
      this.threads = this.threads.filter(x => x.id !== threadId);
      this.applyFilters();
      this.computeStats();
      this.computeCategories();
      if (this.selectedThread?.id === threadId) this.backToForum();
    } catch (e) {
      console.warn('deleteThread failed', e);
    }
  }

  // Reactions helpers
  isThreadLiked(id: string): boolean { return this.getMyThreadVote(id) === 'like'; }
  getThreadCounts(id: string): { likes: number; dislikes: number } {
    return this.threadCounts[id] || { likes: 0, dislikes: 0 };
  }
  getMyThreadVote(id: string): 'like'|'dislike'|null {
    return this.myThreadVotes[id] || null;
  }
  openLikersModal(threadId: string): void {
    this.likersForThreadId = threadId;
    this.showLikersModal = true;
  }
  closeLikersModal(): void {
    this.showLikersModal = false;
    this.likersForThreadId = null;
    this.likersForComment = null;
  }
  async onThreadReact(threadId: string, kind: 'like'|'dislike'): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) { this.showLoginPrompt(); return; }
    const voteRef = ref(this.db, `forum/votes/${threadId}/${user.uid}`);
    const current = this.getMyThreadVote(threadId);
    try {
      if (current === kind) {
        await set(voteRef, null as any);
      } else {
        const payload: any = { kind };
        if (user.email) payload.byEmailMasked = this.maskEmail(user.email);
        await set(voteRef, payload);
      }
      // update aggregates on discussion node
      const counts = this.getThreadCounts(threadId);
      const next = { ...counts };
      if (current) { if (current === 'like') next.likes = Math.max(0, next.likes - 1); else next.dislikes = Math.max(0, next.dislikes - 1); }
      if (current !== kind) { if (kind === 'like') next.likes += 1; else next.dislikes += 1; }
      await update(ref(this.db, `forum/discussions/${threadId}`), { likes: next.likes, dislikes: next.dislikes });
      // Optimistic local selectedThread sync
      if (this.selectedThread && this.selectedThread.id === threadId) {
        this.selectedThread.likes = next.likes;
        (this.selectedThread as any).dislikes = next.dislikes;
      }
      // Notification to thread author for new like
      if (kind === 'like' && current !== 'like') {
        const t = (this.threads as any).find((x: any) => x.id === threadId);
        const authorUid = t?.authorUid;
        if (authorUid && user.uid !== authorUid) {
          const notifRef = push(ref(this.db, `users/${authorUid}/forumNotifications`));
          const notifPayload = {
            type: 'thread_like',
            at: Date.now(),
            threadId,
            threadTitle: t?.title || '(Tanpa Judul)',
            byUid: user.uid,
            byEmailMasked: user.email ? this.maskEmail(user.email) : null,
          };
          try { await set(notifRef, notifPayload); } catch {}
        }
      }
    } catch (e) {
      console.warn('onThreadReact failed', e);
    }
  }

  reportThread(id: string): void {
    // Minimal UX; could be replaced with ToastController
    alert('Terima kasih, laporan Anda telah dikirim.');
  }

  // Comment reactions
  isCommentLiked(threadId: string, commentId: string): boolean {
    return !!this.myCommentLikes[threadId]?.[commentId];
  }
  getCommentLikes(threadId: string, commentId: string): number {
    return this.commentLikeCounts[threadId]?.[commentId] || 0;
  }
  openCommentLikers(threadId: string, commentId: string): void {
    this.likersForComment = { threadId, commentId };
    this.showLikersModal = true;
  }
  async onCommentReact(threadId: string, commentId: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) { this.showLoginPrompt(); return; }
    const voteRef = ref(this.db, `forum/commentVotes/${threadId}/${commentId}/${user.uid}`);
    const currentlyLiked = this.isCommentLiked(threadId, commentId);
    try {
      if (currentlyLiked) {
        await set(voteRef, null as any);
      } else {
        const payload: any = { kind: 'like' };
        if (user.email) payload.byEmailMasked = this.maskEmail(user.email);
        await set(voteRef, payload);
      }
      // notify comment author on new like
      if (!currentlyLiked) {
        const t = this.threads.find((x) => x.id === threadId);
        const c = t?.comments.find((cc: any) => (cc.id && cc.id === commentId));
        const authorUid = (c as any)?.authorUid;
        if (authorUid && user.uid !== authorUid) {
          const notifRef = push(ref(this.db, `users/${authorUid}/forumNotifications`));
          const notifPayload = {
            type: 'comment_like',
            at: Date.now(),
            threadId,
            commentId,
            threadTitle: t?.title || '(Tanpa Judul)',
            byUid: user.uid,
            byEmailMasked: user.email ? this.maskEmail(user.email) : null,
          };
          try { await set(notifRef, notifPayload); } catch {}
        }
      }
    } catch (e) {
      console.warn('onCommentReact failed', e);
    }
  }

  toggleSolved(id: string): void {
    const t = this.threads.find((x) => x.id === id);
    if (!t) return;
    t.status = t.status === 'solved' ? 'open' : 'solved';
  }

  // Comments
  newComment = '';
  async submitReply(): Promise<void> {
    if (!this.selectedThread || !this.newComment.trim()) return;
    if (this.isPostingComment) return; // guard against double-click
    const user = this.auth.currentUser;
    if (!user) { this.showLoginPrompt(); return; }
    try {
      this.isPostingComment = true;
      const username = await this.resolveUsername(user);
      const commentRef = push(ref(this.db, `forum/discussions/${this.selectedThread.id}/comments`));
      const payload = {
        content: this.newComment.trim(),
        timestamp: Date.now(),
        authorUid: user.uid,
        username,
        role: 'user'
      };
      await set(commentRef, payload);
      // Clear input; rely on realtime listener + selectedThread rebind to render
      this.newComment = '';
    } catch (e) {
      console.warn('submitReply failed', e);
    }
    finally {
      this.isPostingComment = false;
    }
  }

  // Login
  showLoginPrompt(): void { this.showLoginAlert = true; }
  togglePassword(): void { this.showPassword = !this.showPassword; }
  quickLogin(role: 'operator' | 'teknisi' | 'admin'): void {
    this.loginForm = { username: `${role}@puriva.app`, password: 'demo', role };
    this.performLogin();
  }
  performLogin(): void {
    if (!this.loginForm.username || !this.loginForm.password || !this.loginForm.role) return;
    this.isLoading = true;
    setTimeout(() => {
      this.isLoading = false;
      this.loginSuccess = true;
      this.currentUser = { name: this.loginForm.username.split('@')[0], role: this.loginForm.role as any };
      setTimeout(() => {
        this.showLoginModal = false;
        this.loginSuccess = false;
      }, 600);
    }, 800);
  }
  forgotPassword(): void { alert('Hubungi admin untuk reset password.'); }

  // Create thread
  openCreateThreadModal(): void {
    if (!this.auth.currentUser) { this.showLoginPrompt(); return; }
    this.showCreateThreadModal = true;
  }
  // FAB helper to add a comment quickly
  onFabComment(): void {
    const user = this.auth.currentUser;
    if (!user) { this.showLoginPrompt(); return; }
    if (!this.showThreadDetail && this.filteredThreads.length) {
      // Open first thread if none selected
      this.openThread(this.filteredThreads[0]);
    }
    // Try focus the reply textarea
    setTimeout(() => {
      try {
        const el = document.querySelector('.reply-form ion-textarea textarea') as HTMLTextAreaElement | null;
        if (el) el.focus();
      } catch {}
    }, 50);
  }
  async createNewThread(): Promise<void> {
    if (!this.newThreadForm.title || !this.newThreadForm.content || !this.newThreadForm.category) return;
    if (this.isPostingThread) return; // guard against double-click
    const user = this.auth.currentUser;
    if (!user) { this.showLoginPrompt(); return; }
    try {
      this.isPostingThread = true;
      const username = await this.resolveUsername(user);
      const node = ref(this.db, 'forum/discussions');
      const keyRef = push(node);
      const payload = {
        topic: this.newThreadForm.title,
        content: this.newThreadForm.content,
        category: this.newThreadForm.category,
        createdAt: Date.now(),
        likes: 0,
        status: 'open',
        role: 'user',
        authorUid: user.uid,
        username,
      } as const;
      await set(keyRef, payload);
      // Rely on realtime listener to insert the new thread and update lists
      this.newThreadForm = { title: '', category: '', content: '' };
      this.showCreateThreadModal = false;
    } catch (e) {
      console.warn('createNewThread failed', e);
    }
    finally {
      this.isPostingThread = false;
    }
  }

  // Mask helper
  private maskEmail(email: string): string {
    if (!email || !email.includes('@')) return '';
    const [local, domain] = email.split('@');
    const first = local.charAt(0) || '';
    return `${first}***@${domain}`;
  }

  // Prefer RTDB username/displayName; avoid exposing email for author display
  private async resolveUsername(user: User): Promise<string> {
    try {
      const snap = await get(child(ref(this.db), `users/${user.uid}`));
      const data = snap.val() || {};
      const name = data.username || data.displayName || user.displayName || '';
      const normalized = (name || '').toString().trim();
      return normalized || 'Pengguna';
    } catch {
      const dn = (user.displayName || '').trim();
      return dn || 'Pengguna';
    }
  }

  // Hydrate missing usernames for legacy records using authorUid
  private async hydrateUsernames(): Promise<void> {
    try {
      const uids = new Set<string>();
      for (const t of this.threads) {
        if ((t as any).authorUid && (!t.author || t.author === 'Pengguna')) uids.add((t as any).authorUid as string);
        for (const c of t.comments || []) {
          if (c.authorUid && (!c.author || c.author === 'Pengguna')) uids.add(c.authorUid);
        }
      }
      const tasks: Array<Promise<void>> = [];
      for (const uid of uids) {
        if (this.usernameCache[uid]) continue;
        tasks.push(
          (async () => {
            try {
              const snap = await get(child(ref(this.db), `users/${uid}`));
              const data = snap.val() || {};
              const name = (data.username || data.displayName || '').toString().trim();
              this.usernameCache[uid] = name || 'Pengguna';
            } catch {
              this.usernameCache[uid] = 'Pengguna';
            }
          })()
        );
      }
      await Promise.all(tasks);
      let changed = false;
      for (const t of this.threads) {
        const tuid = (t as any).authorUid as string | undefined;
        if (tuid && (t.author === 'Pengguna' || !t.author)) {
          const nm = this.usernameCache[tuid];
          if (nm && nm !== t.author) { t.author = nm; changed = true; }
        }
        for (const c of t.comments || []) {
          if (c.authorUid && (c.author === 'Pengguna' || !c.author)) {
            const nm = this.usernameCache[c.authorUid];
            if (nm && nm !== c.author) { c.author = nm; changed = true; }
          }
        }
      }
      if (changed) {
        // Trigger change detection for lists and detail
        this.filteredThreads = [...this.filteredThreads];
        if (this.selectedThread) {
          const id = this.selectedThread.id;
          this.selectedThread = this.threads.find(x => x.id === id) || this.selectedThread;
        }
      }
    } catch {
      // ignore
    }
  }

  // Hydrate avatars and privacy from RTDB users/{uid}
  private async hydrateAvatars(): Promise<void> {
    try {
      const uids = new Set<string>();
      for (const t of this.threads) {
        const tuid = (t as any).authorUid as string | undefined;
        if (tuid) uids.add(tuid);
        for (const c of t.comments || []) {
          if (c.authorUid) uids.add(c.authorUid);
        }
      }
      const tasks: Array<Promise<void>> = [];
      for (const uid of uids) {
        if (this.avatarCache[uid]) continue;
        tasks.push(
          (async () => {
            try {
              const snap = await get(child(ref(this.db), `users/${uid}`));
              const data = snap.val() || {};
              const url = (data.photoURL || data.avatarUrl || null) as string | null;
              const vis = (data.privacy && data.privacy.profileVisibility === 'private') ? 'private' : 'public';
              this.avatarCache[uid] = { url: url || null, visibility: vis };
            } catch {
              this.avatarCache[uid] = { url: null, visibility: 'public' };
            }
          })()
        );
      }
      await Promise.all(tasks);
      // Trigger change detection for lists and detail views
      this.filteredThreads = [...this.filteredThreads];
      if (this.selectedThread) {
        const id = this.selectedThread.id;
        this.selectedThread = this.threads.find(x => x.id === id) || this.selectedThread;
      }
    } catch {
      // ignore
    }
  }

  // Avatar helpers
  getInitials(name?: string): string {
    const n = (name || '').trim();
    if (!n) return 'U';
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }
  shouldShowAvatar(uid?: string | null): boolean {
    if (!uid) return false;
    const meta = this.avatarCache[uid];
    return !!meta && meta.visibility !== 'private' && !!meta.url;
  }
  getAvatarUrl(uid?: string | null): string | null {
    if (!uid) return null;
    return this.avatarCache[uid]?.url || null;
  }

  // Votes listener to keep counts and my vote in sync
  private attachVotesListener(): void {
    try {
      if (this.voteUnsub) { try { this.voteUnsub(); } catch {} this.voteUnsub = undefined; }
      const votesRoot = ref(this.db, 'forum/votes');
      this.voteUnsub = onValue(votesRoot, async (snap) => {
        const all = (snap.val() || {}) as Record<string, Record<string, any>>; // threadId -> { uid: vote }
        const counts: Record<string, { likes: number; dislikes: number }> = {};
        const myVotes: Record<string, 'like'|'dislike'|null> = {};
        const likers: Record<string, string[]> = {};
        const myUid = this.auth.currentUser?.uid || null;
        // Collect UIDs to ensure username cache
        const needFetch = new Set<string>();
        for (const threadId of Object.keys(all)) {
          const obj = all[threadId] || {};
          for (const uid of Object.keys(obj)) {
            if (uid && uid !== myUid && !this.usernameCache[uid]) needFetch.add(uid);
          }
        }
        // Fetch missing usernames in parallel
        if (needFetch.size > 0) {
          await Promise.all(Array.from(needFetch).map(uid => this.getUsernameByUid(uid).catch(() => undefined)));
        }
        // Build counts and likers with usernames
        for (const threadId of Object.keys(all)) {
          const obj = all[threadId] || {};
          let like = 0, dislike = 0;
          const names: string[] = [];
          for (const [uid, v] of Object.entries(obj)) {
            const kind = (v && typeof v === 'object' && 'kind' in v) ? (v.kind as string) : (v as any);
            if (kind === 'like') like++;
            else if (kind === 'dislike') dislike++;
            if (kind === 'like') {
              const nm = myUid && uid === myUid ? 'Anda' : (this.usernameCache[uid] || (uid.slice(0,4) + '***'));
              names.push(nm);
            }
            if (myUid && uid === myUid) myVotes[threadId] = kind as any;
          }
          counts[threadId] = { likes: like, dislikes: dislike };
          likers[threadId] = names;
        }
        this.threadCounts = counts;
        this.myThreadVotes = myVotes;
        this.threadLikers = likers;
      });
    } catch (e) {
      // ignore if RTDB not configured
    }
  }

  // Bottom nav navigations
  goToHome(): void { this.router.navigate(['/home']); }
  goToControl(): void { this.router.navigate(['/control']); }
  goToEducation(): void { this.router.navigate(['/news']); }
  goToForum(): void { /* already on forum */ }
  goToProfile(): void { this.router.navigate(['/profile']); }
  goToNotifications(): void { this.router.navigate(['/notifikasi']); }
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    // @ts-ignore
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}