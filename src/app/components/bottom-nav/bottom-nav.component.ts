import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';

@Component({
  selector: 'app-bottom-nav',
  templateUrl: './bottom-nav.component.html',
  styleUrls: ['./bottom-nav.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule]
})
export class BottomNavComponent implements OnInit {
  @Input() activeTab: string = '';

  constructor(private router: Router) { }

  ngOnInit() {}

  goToHome(): void {
    this.router.navigate(['/home']);
  }

  goToControl(): void {
    this.router.navigate(['/control']);
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

}
