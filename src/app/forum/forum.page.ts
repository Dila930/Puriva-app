import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { BottomNavComponent } from '../components/bottom-nav/bottom-nav.component';
import { Database, onValue, orderByChild, query, ref, push, set, update, remove } from '@angular/fire/database';
import { Auth } from '@angular/fire/auth';
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

  // Models
  interfaceComment = {} as never; // placeholder for TS section separation
  private unsubscribeFn?: () => void;

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
    role: 'operator' | 'teknisi' | 'admin' | 'user';
    comments: Array<{ author: string; role: string; content: string; timestamp: number }>;
    likes: number;
    timestamp: number;
    isPinned?: boolean;
    isTrending?: boolean;
    status?: 'open' | 'solved';
    category?: string;
  }> = [];

  filteredThreads: typeof this.threads = [];

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

  // Create thread modal
  showCreateThreadModal = false;
  newThreadForm: { title: string; category: string; content: string } = { title: '', category: '', content: '' };

  // UI state
  private likedThreadIds = new Set<string>();

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
          author: d.authorMaskedEmail || d.username || d.author || 'Anonim',
          authorUid: d.authorUid || null,
          role: (d.role || 'user') as any,
          comments: Array.isArray(d.comments)
            ? d.comments.map((c: any) => ({
                author: c.authorMaskedEmail || c.author || 'Anonim',
                role: c.role || 'user',
                content: c.content || '',
                timestamp: c.timestamp || Date.now(),
              }))
            : (d.comments && typeof d.comments === 'object'
              ? Object.values(d.comments).map((c: any) => ({
                  author: c.authorMaskedEmail || c.author || 'Anonim',
                  role: c.role || 'user',
                  content: c.content || '',
                  timestamp: c.timestamp || Date.now(),
                }))
              : []),
          likes: d.likes || 0,
          timestamp: d.createdAt || d.timestamp || Date.now(),
          isPinned: !!d.isPinned,
          isTrending: !!d.isTrending,
          status: (d.status || 'open') as any,
          category: d.category || 'diskusi',
        }));
      this.threads = mapped;
      this.applyFilters();
      this.computeStats();
      this.computeCategories();
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
  }

  ngOnDestroy(): void {
    if (this.unsubscribeFn) this.unsubscribeFn();
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
    const activeUsers = new Set(this.threads.map((t) => t.author)).size;
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

  isThreadLiked(id: string): boolean { return this.likedThreadIds.has(id); }
  likeThread(id: string): void {
    const t = this.threads.find((x) => x.id === id);
    if (!t) return;
    if (this.likedThreadIds.has(id)) {
      this.likedThreadIds.delete(id);
      t.likes = Math.max(0, (t.likes || 0) - 1);
    } else {
      this.likedThreadIds.add(id);
      t.likes = (t.likes || 0) + 1;
    }
  }

  reportThread(id: string): void {
    // Minimal UX; could be replaced with ToastController
    alert('Terima kasih, laporan Anda telah dikirim.');
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
    const user = this.auth.currentUser;
    if (!user) { this.showLoginPrompt(); return; }
    try {
      const commentRef = push(ref(this.db, `forum/discussions/${this.selectedThread.id}/comments`));
      const payload = {
        content: this.newComment.trim(),
        timestamp: Date.now(),
        authorUid: user.uid,
        authorEmail: user.email || null,
        authorMaskedEmail: user.email ? this.maskEmail(user.email) : null,
        role: 'user'
      };
      await set(commentRef, payload);
      // Optimistic local update; listener will also refresh
      this.selectedThread.comments.push({
        author: payload.authorMaskedEmail || 'Anonim',
        role: payload.role,
        content: payload.content,
        timestamp: payload.timestamp,
      });
      this.newComment = '';
      this.computeStats();
    } catch (e) {
      console.warn('submitReply failed', e);
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
    const user = this.auth.currentUser;
    if (!user) { this.showLoginPrompt(); return; }
    try {
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
        authorEmail: user.email || null,
        authorMaskedEmail: user.email ? this.maskEmail(user.email) : null
      } as const;
      await set(keyRef, payload);
      // Optimistic prepend; realtime listener will also refresh
      const t = {
        id: (keyRef.key || cryptoRandomId()),
        title: payload.topic,
        content: payload.content,
        author: payload.authorMaskedEmail || 'Anonim',
        role: payload.role as 'operator' | 'teknisi' | 'admin' | 'user',
        comments: [],
        likes: payload.likes,
        timestamp: payload.createdAt,
        isPinned: false,
        isTrending: false,
        status: 'open' as const,
        category: payload.category,
      };
      this.threads = [t, ...this.threads];
      this.applyFilters();
      this.computeStats();
      this.computeCategories();
      this.newThreadForm = { title: '', category: '', content: '' };
      this.showCreateThreadModal = false;
    } catch (e) {
      console.warn('createNewThread failed', e);
    }
  }

  // Mask helper
  private maskEmail(email: string): string {
    if (!email || !email.includes('@')) return '';
    const [local, domain] = email.split('@');
    const first = local.charAt(0) || '';
    return `${first}***@${domain}`;
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
