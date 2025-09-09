import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ChatPageRoutingModule } from './chat-routing.module';
import { ChatPage } from './chat.page'; // Import komponen ChatPage

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    ChatPageRoutingModule,
    ChatPage // Tambahkan ChatPage ke dalam imports karena ini adalah komponen standalone
  ],
  declarations: [] // Kosongkan declarations karena ChatPage adalah standalone
})
export class ChatPageModule {}