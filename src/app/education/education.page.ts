import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ActionSheetController, AlertController, ToastController } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { BottomNavComponent } from '../components/bottom-nav/bottom-nav.component';
import { Database, ref, onValue, query, orderByChild, get, set, update } from '@angular/fire/database';
import { Auth } from '@angular/fire/auth';
import { isAdmin } from '../utils/admin-ids';

@Component({
  selector: 'app-education',
  templateUrl: './education.page.html',
  styleUrls: ['./education.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterModule, BottomNavComponent]
})
export class EducationPage implements OnInit, OnDestroy {
  constructor(
    private router: Router,
    private db: Database,
    private auth: Auth,
    private actionSheetCtrl: ActionSheetController,
    private alertCtrl: AlertController,
    private toast: ToastController,
  ) {}
  
  // Get current active tab based on URL
  get activeTab(): string {
    const url = this.router.url.split('/')[1];
    return url || 'home';
  }

  // Reactions API used by template
  getNewsCounts(id: string): { likes: number; dislikes: number } {
    return this.newsCounts[id] || { likes: 0, dislikes: 0 };
    }
  getMyNewsReaction(id: string): 'like'|'dislike'|null {
    return this.myNewsReactions[id] || null;
  }
  async onNewsReact(ev: Event, id: string, kind: 'like'|'dislike'): Promise<void> {
    ev.stopPropagation();
    const user = this.auth.currentUser;
    if (!user) return;
    const voteRef = ref(this.db, `news/reactions/${id}/${user.uid}`);
    const current = this.getMyNewsReaction(id);
    try {
      if (current === kind) {
        // unvote
        await set(voteRef, null as any);
      } else {
        await set(voteRef, kind);
      }
      // optionally update aggregates on item node
      // read current counts and write to `news/items/{id}/reactions`
      const counts = this.getNewsCounts(id);
      const next = { ...counts };
      if (current) { if (current === 'like') next.likes = Math.max(0, next.likes - 1); else next.dislikes = Math.max(0, next.dislikes - 1); }
      if (current !== kind) { if (kind === 'like') next.likes += 1; else next.dislikes += 1; }
      await update(ref(this.db, `news/items/${id}`), { reactions: next });
    } catch (e) {
      console.warn('onNewsReact failed', e);
    }
  }

  // Per-item actions
  async openItemActions(ev: Event, item: { id: string; title: string }): Promise<void> {
    ev.stopPropagation();
    const buttons: any[] = [];
    if (this.isAdmin) {
      buttons.push({ text: 'Edit', icon: 'create-outline', handler: () => this.editNews(item) });
      buttons.push({ text: 'Hapus', role: 'destructive', icon: 'trash-outline', handler: () => this.confirmDelete(item) });
    }
    buttons.push({ text: 'Pilih beberapa', icon: 'checkmark-done-outline', handler: () => this.enterSelectionMode(item) });
    buttons.push({ text: 'Batal', role: 'cancel' });
    const sheet = await this.actionSheetCtrl.create({ header: item.title || 'Aksi', buttons });
    await sheet.present();
  }

  editNews(item: { id: string }): void {
    if (!this.isAdmin) return;
    this.router.navigate(['/news/edit', item.id]);
  }

  async confirmDelete(item: { id: string }): Promise<void> {
    if (!this.isAdmin) return;
    const alert = await this.alertCtrl.create({
      header: 'Hapus Berita',
      message: 'Yakin ingin menghapus berita ini?',
      buttons: [
        { text: 'Batal', role: 'cancel' },
        { text: 'Hapus', role: 'destructive', handler: () => this.deleteNews(item) },
      ]
    });
    await alert.present();
  }

  async deleteNews(item: { id: string }): Promise<void> {
    try {
      const r = ref(this.db, `news/items/${item.id}`);
      // Use set(null) via update with null by importing remove? We can set to null by set from db API, but here we'll use update path with null
      // Simpler: import from '@angular/fire/database' remove
    } catch {}
    try {
      const { remove } = await import('@angular/fire/database');
      await remove(ref(this.db, `news/items/${item.id}`));
      this.presentToast('Berita dihapus', 'success');
    } catch (e) {
      this.presentToast('Gagal menghapus berita', 'danger');
    }
  }

  enterSelectionMode(item?: { id: string }): void {
    this.selectionMode = true;
    this.selectedIds.clear();
    if (item?.id) this.selectedIds.add(item.id);
  }

  toggleSelect(ev: Event, id: string): void {
    ev.stopPropagation();
    if (!this.selectionMode) return;
    if (this.selectedIds.has(id)) this.selectedIds.delete(id); else this.selectedIds.add(id);
  }

  exitSelectionMode(): void {
    this.selectionMode = false;
    this.selectedIds.clear();
  }

  async confirmDeleteSelected(): Promise<void> {
    if (!this.isAdmin || this.selectedIds.size === 0) return;
    const alert = await this.alertCtrl.create({
      header: 'Hapus Berita Terpilih',
      message: `Yakin ingin menghapus ${this.selectedIds.size} berita?`,
      buttons: [
        { text: 'Batal', role: 'cancel' },
        { text: 'Hapus', role: 'destructive', handler: () => this.deleteSelectedNews() },
      ]
    });
    await alert.present();
  }

  private async deleteSelectedNews(): Promise<void> {
    if (!this.isAdmin || this.selectedIds.size === 0) return;
    try {
      const updates: Record<string, any> = {};
      this.selectedIds.forEach(id => { updates[`news/items/${id}`] = null; });
      await update(ref(this.db), updates);
      this.presentToast('Berita terpilih dihapus', 'success');
      this.exitSelectionMode();
    } catch (e) {
      console.warn('deleteSelectedNews failed', e);
      this.presentToast('Gagal menghapus beberapa berita', 'danger');
    }
  }

  private async presentToast(message: string, color: 'success' | 'warning' | 'danger') {
    const t = await this.toast.create({ message, duration: 1500, color });
    await t.present();
  }
  // New UI state for redesigned news page
  searchQuery: string = '';
  currentFilter: string = 'semua';

  // Raw items from DB (kept for reference/mapping)
  newsItems: Array<{ id: string; title: string; category: string; content: string; createdAt: number; authorUid: string; authorEmail?: string; authorMaskedEmail?: string }>= [];

  // UI-model list consumed by template
  filteredNews: Array<{ id: string; title: string; description: string; category: string; categoryLabel: string; icon: string; date: string; readTime: number; isNew: boolean; thumbnail?: string; createdAt?: number }>= [];
  featuredNews: { id: string; title: string; description: string; category: string; categoryLabel: string; icon: string; date: string; readTime: number; isNew: boolean; thumbnail?: string; createdAt?: number } = {
    id: '', title: '', description: '', category: 'semua', categoryLabel: 'Umum', icon: '📰', date: '', readTime: 1, isNew: false, thumbnail: ''
  };
  private unsubscribeFn?: () => void;
  get isAdmin(): boolean { return isAdmin(this.auth); }
  // reactions state
  private newsCounts: Record<string, { likes: number; dislikes: number }> = {};
  private myNewsReactions: Record<string, 'like' | 'dislike' | null> = {};

  // Selection mode state
  selectionMode = false;
  selectedIds = new Set<string>();

  ngOnInit(): void {
    const q = query(ref(this.db, 'news/items'), orderByChild('createdAt'));
    this.unsubscribeFn = onValue(q, (snap) => {
      const val = snap.val() as Record<string, any> | null;
      const items = val
        ? Object.entries(val).map(([id, v]: [string, any]) => ({ id, ...v }))
        : [];
      // Order by createdAt desc on client
      items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      // Normalize & keep original
      this.newsItems = (items as any);

      // Map to UI model
      const ui = this.newsItems.map((it: any) => this.toUiNews(it));
      // Pick featured (first item if exists)
      this.featuredNews = ui[0] || this.featuredNews;
      // Apply current filters to produce filteredNews
      this.applyFilters(ui);
    });

    // Listen to all reactions summary and my votes
    onValue(ref(this.db, 'news/reactions'), (snap) => {
      const all = (snap.val() || {}) as Record<string, Record<string, 'like'|'dislike'>>;
      const counts: Record<string, { likes: number; dislikes: number }> = {};
      Object.entries(all).forEach(([newsId, users]) => {
        let likes = 0, dislikes = 0;
        Object.values(users || {}).forEach((v) => {
          if (v === 'like') likes++; else if (v === 'dislike') dislikes++;
        });
        counts[newsId] = { likes, dislikes };
      });
      this.newsCounts = counts;
      // also refresh my reactions map if user exists
      const uid = this.auth.currentUser?.uid;
      if (uid) {
        const mine: Record<string, 'like'|'dislike'|null> = {};
        Object.entries(all).forEach(([newsId, users]) => {
          mine[newsId] = (users && (users as any)[uid]) || null;
        });
        this.myNewsReactions = mine;
      }
    });
  }

  ngOnDestroy(): void {
    if (this.unsubscribeFn) this.unsubscribeFn();
  }

  // Template helpers for new UI
  filterNews(filter: string): void {
    this.currentFilter = filter;
    this.applyFilters();
  }

  searchNews(_: any): void {
    this.applyFilters();
  }

  // Open custom filter popover (styled like the provided example)
  showFilter = false;
  async openFilterSheet(): Promise<void> { this.showFilter = true; }
  closeFilter(): void { this.showFilter = false; }

  chooseSort(mode: 'terbaru'|'terlama'|'az'|'za'): void {
    this.setSort(mode);
    this.closeFilter();
  }

  chooseCategory(key: 'semua'|'teknologi'|'kesehatan'|'panduan'): void {
    this.filterNews(key);
    this.closeFilter();
  }

  formatDate(ts?: number): string {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  openNewsDetail(news: { id: string }): void {
    // Build payload expected by `news-detail` page
    // Our UI model uses `description` as the article content and `icon` as category icon
    // Map category to match detail page conditional blocks when possible
    const match = (this.filteredNews || []).find(n => n.id === news.id) || this.featuredNews;
    const mapCategory = (c: string) => {
      switch ((c || '').toLowerCase()) {
        case 'teknologi':
          return 'technology';
        default:
          return (c || 'umum').toLowerCase();
      }
    };

    const newsData = {
      id: match.id,
      title: match.title,
      description: match.description,
      // detail page reads `content`
      content: match.description,
      // pass thumbnail if any
      thumbnail: match.thumbnail || '',
      date: match.date,
      readTime: match.readTime,
      category: mapCategory(match.category),
      categoryLabel: match.categoryLabel,
    } as any;

    this.router.navigate(['/news-detail'], {
      state: { newsData }
    });
  }

  // Optional load more (placeholder to match template)
  showLoadMore = false;
  loadingMore = false;
  loadMoreNews(): void {
    // Implement pagination if needed
  }

  // Internal helpers
  private toUiNews(it: any): { id: string; title: string; description: string; category: string; categoryLabel: string; icon: string; date: string; readTime: number; isNew: boolean; thumbnail?: string; createdAt?: number } {
    const cat = (it.category || 'Umum').toString().toLowerCase();
    const map: Record<string, { label: string; icon: string }> = {
      'teknologi': { label: 'Teknologi', icon: '💻' },
      'program': { label: 'Program', icon: '📢' },
      'update': { label: 'Update', icon: '🆕' },
      'tips': { label: 'Tips', icon: '💡' },
      'kesehatan': { label: 'Kesehatan', icon: '🩺' },
      'panduan': { label: 'Panduan', icon: '📘' },
      'umum': { label: 'Umum', icon: '📰' }
    };
    const meta = map[cat] || map['umum'];
    const text = (it.content || '').toString();
    const words = text.split(/\s+/).filter(Boolean).length;
    const readTime = Math.max(1, Math.ceil(words / 200));
    // Mark as NEW if within last 3 days
    const createdAt: number = Number(it.createdAt || 0);
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const isNew = createdAt > 0 && (Date.now() - createdAt) <= threeDaysMs;
    return {
      id: it.id,
      title: (it.title || '').toString(),
      description: (it.content || '').toString(),
      category: cat,
      categoryLabel: meta.label,
      icon: meta.icon,
      date: this.formatDate(it.createdAt),
      readTime,
      isNew,
      thumbnail: (it.thumbnail || '').toString(),
      createdAt
    };
  }

  // Sorting state
  sortMode: 'terbaru' | 'terlama' | 'az' | 'za' = 'terbaru';
  private getSortLabel(m: 'terbaru' | 'terlama' | 'az' | 'za'): string {
    switch (m) {
      case 'terbaru': return 'Terbaru';
      case 'terlama': return 'Terlama';
      case 'az': return 'A - Z';
      case 'za': return 'Z - A';
    }
  }
  private setSort(m: 'terbaru' | 'terlama' | 'az' | 'za'): void {
    this.sortMode = m;
    this.applyFilters();
  }

  private applyFilters(source?: Array<{ id: string; title: string; description: string; category: string; categoryLabel: string; icon: string; date: string; readTime: number; isNew: boolean; thumbnail?: string; createdAt?: number }>): void {
    const base = source || this.newsItems.map((it: any) => this.toUiNews(it));
    const q = (this.searchQuery || '').toLowerCase();
    const cat = this.currentFilter;
    const filtered = base.filter(n => {
      const catOk = cat === 'semua' || n.category === cat;
      if (!q) return catOk;
      const hay = `${n.title} ${n.description} ${n.categoryLabel}`.toLowerCase();
      return catOk && hay.includes(q);
    });
    // apply sorting
    const sorted = [...filtered];
    switch (this.sortMode) {
      case 'terbaru':
        sorted.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        break;
      case 'terlama':
        sorted.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        break;
      case 'az':
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'za':
        sorted.sort((a, b) => b.title.localeCompare(a.title));
        break;
    }
    this.filteredNews = sorted;
  }

  // Bottom nav navigations
  goToHome(): void { this.router.navigate(['/home']); }
  goToControl(): void { this.router.navigate(['/control']); }
  goToEducation(): void { /* already on education */ }
  goToForum(): void { this.router.navigate(['/forum']); }
  goToProfile(): void { this.router.navigate(['/profile']); }
  goToNotifications(): void { this.router.navigate(['/notifikasi']); }

  // Create News
  goToCreateNews(): void {
    this.router.navigate(['/news/create']);
  }
}
