import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common'; // Diperlukan untuk *ngFor dan [ngClass]
import { FormsModule } from '@angular/forms'; // Diperlukan untuk [(ngModel)]
import { IonicModule } from '@ionic/angular'; // Diperlukan untuk semua elemen Ionic
import { GeminiService } from '../services/gemini.service';
import { BottomNavComponent } from '../components/bottom-nav/bottom-nav.component';

interface Message {
  sender: 'user' | 'bot';
  text: string;
  time: string;
}

@Component({
  selector: 'app-chat',
  templateUrl: './chat.page.html',
  styleUrls: ['./chat.page.scss'],
  standalone: true, // Pastikan ini tetap true jika Anda ingin menggunakan standalone
  imports: [CommonModule, FormsModule, IonicModule, BottomNavComponent] // Tambahkan modul-modul ini
})
export class ChatPage implements OnInit {
  @ViewChild('chat-messages', { static: false }) private chatMessagesContainer!: ElementRef;
  
  messages: Message[] = [];
  newMessage: string = '';
  chatHistory: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];

  constructor(private geminiService: GeminiService) {}

  ngOnInit() {
    this.addBotMessage('Halo! Saya siap membantu Anda. Ajukan pertanyaan apa saja.');
  }

  async sendMessage() {
    if (this.newMessage.trim() === '') {
      return;
    }

    const userMessageText = this.newMessage;
    this.addMessage('user', userMessageText);
    this.newMessage = '';

    const loadingMessageId = this.addMessage('bot', `<div class="dot-flashing"></div>`);

    try {
      const responseText = await this.geminiService.getChatResponse(userMessageText, this.chatHistory);
      this.updateMessage(loadingMessageId, responseText);
      this.chatHistory.push({ role: 'user', parts: [{ text: userMessageText }] });
      this.chatHistory.push({ role: 'model', parts: [{ text: responseText }] });
    } catch (error) {
      console.error(error);
      this.updateMessage(loadingMessageId, 'Gagal mendapatkan respons dari AI.');
    } finally {
      this.scrollToBottom();
    }
  }

  private addMessage(sender: 'user' | 'bot', text: string): number {
    const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const message: Message = { sender, text, time };
    this.messages.push(message);
    this.scrollToBottom();
    return this.messages.length - 1;
  }

  private addBotMessage(text: string) {
    const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    this.messages.push({ sender: 'bot', text, time });
  }

  private updateMessage(index: number, newText: string) {
    if (this.messages[index]) {
      this.messages[index].text = newText;
    }
  }

  private scrollToBottom(): void {
    try {
      if (this.chatMessagesContainer) {
        this.chatMessagesContainer.nativeElement.scrollTop = this.chatMessagesContainer.nativeElement.scrollHeight;
      }
    } catch (err) {
      console.error(err);
    }
  }
}