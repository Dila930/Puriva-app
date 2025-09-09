import { Injectable } from '@angular/core';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { environment } from 'src/environments/environment';

@Injectable({
  providedIn: 'root'
})
export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    if (!environment.geminiApiKey) {
      console.error('Gemini API Key is not set in environment.ts');
      // Handle this error gracefully in your UI
    }
    this.genAI = new GoogleGenerativeAI(environment.geminiApiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }

  async getChatResponse(prompt: string, history: any[] = []): Promise<string> {
    const generationConfig = {
      temperature: 1,
      topK: 64,
      topP: 0.95,
      maxOutputTokens: 8192,
    };

    const safetySettings = [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ];

    try {
      const chat = this.model.startChat({
        history: history,
        generationConfig,
        safetySettings,
      });

      const result = await chat.sendMessage(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error('Error getting chat response:', error);
      return 'Maaf, terjadi kesalahan saat menghubungi AI. Coba lagi nanti.';
    }
  }
}