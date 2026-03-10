import axios, { AxiosInstance } from 'axios';
import type { AuthResponse, ChatResponse, ChatSession, Lead } from '../types';

class ApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: '/api',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add token to requests
    this.client.interceptors.request.use((config) => {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Handle 401 errors
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          localStorage.removeItem('token');
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  // Auth endpoints
  async login(email: string, password: string): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>('/auth/login', {
      email,
      password,
    });
    return response.data;
  }

  async register(data: {
    bitrixUserId: string;
    email: string;
    name: string;
    password: string;
  }): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>('/auth/register', data);
    return response.data;
  }

  async getMe() {
    const response = await this.client.get('/auth/me');
    return response.data;
  }

  // Lead endpoints
  async getLeads(): Promise<Lead[]> {
    const response = await this.client.get<Lead[]>('/leads');
    return response.data;
  }

  async getLead(leadId: string): Promise<Lead> {
    const response = await this.client.get<Lead>(`/leads/${leadId}`);
    return response.data;
  }

  async getLeadMessages(leadId: string) {
    const response = await this.client.get(`/leads/${leadId}/messages`);
    return response.data;
  }

  // Chat endpoints
  async smartChat(data: {
    message: string;
    sessionId?: string;
  }) {
    const response = await this.client.post('/chat/smart', data);
    return response.data;
  }

  async sendMessage(data: {
    leadId: string;
    message: string;
    sessionId?: string;
  }): Promise<ChatResponse> {
    const response = await this.client.post<ChatResponse>('/chat/message', data);
    return response.data;
  }

  async getChatHistory(sessionId: string): Promise<ChatSession> {
    const response = await this.client.get<ChatSession>(`/chat/session/${sessionId}`);
    return response.data;
  }

  async getSessions(leadId?: string): Promise<ChatSession[]> {
    const response = await this.client.get<ChatSession[]>('/chat/sessions', {
      params: { leadId },
    });
    return response.data;
  }
}

export const api = new ApiService();
