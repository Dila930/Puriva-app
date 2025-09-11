import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { Auth } from '@angular/fire/auth';
import { Database, ref, remove } from '@angular/fire/database';
import { isAdmin } from '../utils/admin-ids';

interface NewsItem {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  date: string;
  readTime: number;
  category: string;
  categoryLabel: string;
  content: string;
  likes?: { [key: string]: boolean };
  likeCount?: number;
  createdAt: number; // Timestamp
}

@Component({
  selector: 'app-news-detail',
  templateUrl: './news-detail.page.html',
  styleUrls: ['./news-detail.page.scss'],
  standalone: false,
})
export class NewsDetailPage implements OnInit {
  newsData: NewsItem | null = null;
  get isAdmin(): boolean { return isAdmin(this.auth); }

  constructor(
    private router: Router,
    private location: Location,
    private auth: Auth,
    private db: Database,
  ) {
    // Get news data from navigation state
    const navigation = this.router.getCurrentNavigation();
    if (navigation?.extras.state) {
      this.newsData = navigation.extras.state['newsData'];
    }
  }

  ngOnInit() {
    // If no news data, redirect back
    if (!this.newsData) {
      this.goBack();
    }
  }

  // Check if news is popular (more than 50 likes)
  get isPopular(): boolean {
    return (this.newsData?.likeCount || 0) > 50;
  }

  // Check if news is new (less than 7 days old)
  get isNew(): boolean {
    if (!this.newsData?.createdAt) return false;
    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    return this.newsData.createdAt > oneWeekAgo;
  }

  goBack() {
    this.location.back();
  }

  editNews(): void {
    if (!this.newsData?.id || !this.isAdmin) return;
    this.router.navigate(['/news/edit', this.newsData.id]);
  }

  async deleteNews(): Promise<void> {
    if (!this.newsData?.id || !this.isAdmin) return;
    const ok = confirm('Hapus berita ini? Tindakan ini tidak dapat dibatalkan.');
    if (!ok) return;
    try {
      await remove(ref(this.db, `news/items/${this.newsData.id}`));
      this.router.navigate(['/news']);
    } catch (e) {
      console.warn('failed delete news', e);
      alert('Gagal menghapus berita');
    }
  }
}
