import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-profile-admin',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="profile-admin">
      <h1>Profile Admin</h1>
      <p>Halaman ini hanya untuk admin.</p>
      <a routerLink="../users" class="link">Kelola Admin Users</a>
    </div>
  `,
  styles: [`
    .profile-admin { padding: 16px; }
    .link { color: #667eea; text-decoration: underline; }
  `]
})
export class ProfileAdminPage {}
