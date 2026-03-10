import { create } from 'zustand';
import { api } from '../services/api';
import type { ChatMessage, ChatSession, Lead } from '../types';

interface ChatState {
  currentLead: Lead | null;
  currentSession: ChatSession | null;
  messages: ChatMessage[];
  sessions: ChatSession[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (message: string) => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  loadSessions: () => Promise<void>;
  clearChat: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  currentLead: null,
  currentSession: null,
  messages: [],
  sessions: [],
  isLoading: false,
  error: null,

  sendMessage: async (message) => {
    const { currentSession } = get();

    // Add user message optimistically
    const userMessage: ChatMessage = {
      id: 'temp-' + Date.now(),
      role: 'user',
      content: message,
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      messages: [...state.messages, userMessage],
      isLoading: true,
      error: null,
    }));

    try {
      const response = await api.smartChat({
        message,
        sessionId: currentSession?.id,
      });

      // Remove temp message
      set((state) => ({
        messages: state.messages.filter((m) => m.id !== userMessage.id),
      }));

      // Handle different response types
      if (response.type === 'clarification') {
        // AI needs clarification
        const clarificationMessage: ChatMessage = {
          id: 'clarification-' + Date.now(),
          role: 'assistant',
          content: response.message,
          createdAt: new Date().toISOString(),
        };

        set((state) => ({
          messages: [...state.messages, userMessage, clarificationMessage],
          isLoading: false,
        }));
      } else if (response.type === 'answer') {
        // Got answer (with or without lead context)
        const assistantMessage: ChatMessage = {
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: response.message,
          sources: response.sources,
          createdAt: new Date().toISOString(),
        };

        set((state) => ({
          messages: [...state.messages, userMessage, assistantMessage],
          // Only update currentLead if a lead was found (lead-specific query)
          currentLead: response.lead || state.currentLead,
          isLoading: false,
        }));
      }
    } catch (error: any) {
      set((state) => ({
        error: error.response?.data?.error || 'Failed to send message',
        isLoading: false,
        messages: state.messages.filter((m) => m.id !== userMessage.id),
      }));
    }
  },

  loadSession: async (sessionId) => {
    set({ isLoading: true, error: null });
    try {
      const session = await api.getChatHistory(sessionId);
      set({
        currentSession: session,
        messages: session.chatMessages || [],
        currentLead: session.lead || null,
        isLoading: false,
      });
    } catch (error: any) {
      set({
        error: error.response?.data?.error || 'Failed to load session',
        isLoading: false,
      });
    }
  },

  loadSessions: async () => {
    try {
      const sessions = await api.getSessions();
      set({ sessions });
    } catch (error: any) {
      set({ error: error.response?.data?.error || 'Failed to load sessions' });
    }
  },

  clearChat: () => {
    set({
      currentLead: null,
      currentSession: null,
      messages: [],
      error: null,
    });
  },
}));
