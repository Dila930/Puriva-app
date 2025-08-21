import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { isAdmin } from '../utils/admin-ids';

@Injectable({ providedIn: 'root' })
export class AdminGuard implements CanActivate {
  constructor(private auth: Auth, private router: Router) {}

  canActivate(): boolean | UrlTree {
    if (isAdmin(this.auth)) return true;
    return this.router.parseUrl('/news');
  }
}
