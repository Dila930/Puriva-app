import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { StatsPageRoutingModule } from './stats-routing.module';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, StatsPageRoutingModule],
})
export class StatsPageModule {}
