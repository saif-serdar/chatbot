export interface User {
  id: string;
  bitrixUserId: string;
  email: string;
  name: string;
  role: string;
}

export interface Lead {
  id: string;
  bitrixLeadId: string;
  name: string;
  phone?: string;
  email?: string;
  status?: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  leadId: string;
  content: string;
  type: string;
  source: string;
  direction: string;
  createdAt: string;
  metadata?: any;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  createdAt: string;
}

export interface Source {
  type: string;
  timestamp: string;
  source: string;
  preview: string;
  score?: number;
}

export interface ChatSession {
  id: string;
  title?: string;
  leadId?: string;
  lead?: Lead;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  chatMessages?: ChatMessage[];
}

export interface AuthResponse {
  agent: User;
  token: string;
}

export interface ChatResponse {
  sessionId: string;
  message: string;
  sources: Source[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}
