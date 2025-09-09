import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { isAdmin } from '../../utils/admin-ids';

@Component({
  selector: 'app-bottom-nav',
  templateUrl: './bottom-nav.component.html',
  styleUrls: ['./bottom-nav.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule]
})
export class BottomNavComponent implements OnInit {
  @Input() activeTab: string = '';

  isAdminUser = false;

  constructor(private router: Router, private auth: Auth) { }

  ngOnInit() {
    onAuthStateChanged(this.auth as any, () => {
      this.isAdminUser = isAdmin(this.auth);
    });
  }

  goToHome(): void {
    this.router.navigate(['/home']);
  }
  
  // Tambahkan fungsi ini
  goToChat(): void {
    this.router.navigate(['/chat']);
  }

  goToNews(): void {
    this.router.navigate(['/news']);
  }

  goToForum(): void {
    this.router.navigate(['/forum']);
  }

  goToProfile(): void {
    this.router.navigate(['/profile']);
  }

  goToControl(): void {
    this.router.navigate(['/control']);
  }

  goToNotifications(): void {
    this.router.navigate(['/notifikasi']);
  }

  goToAdmin(): void {
    if (this.isAdminUser) {
      this.router.navigate(['/admin/management']);
    }
  }
}