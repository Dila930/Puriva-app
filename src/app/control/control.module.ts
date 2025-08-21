import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { ControlPageRoutingModule } from './control-routing.module';

import { ControlPage } from './control.page';
import { BottomNavComponent } from '../components/bottom-nav/bottom-nav.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    ControlPageRoutingModule,
    BottomNavComponent
  ],
  declarations: [ControlPage]
})
export class ControlPageModule {}
