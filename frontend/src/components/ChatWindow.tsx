import { useEffect, useRef } from 'react';
import { useChatStore } from '../stores/chatStore';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';

const SUGGESTED_PROMPTS = [
  {
    icon: '🎯',
    text: 'Is +1234567890 ready to close the deal?',
    category: 'Deal Status'
  },
  {
    icon: '💰',
    text: 'What are the pricing objections from john.doe@email.com?',
    category: 'Objections'
  },
  {
    icon: '🔥',
    text: 'Show me hot leads ready to buy today',
    category: 'Hot Leads'
  },
  {
    icon: '📈',
    text: 'What are the next steps to close John Doe?',
    category: 'Action Items'
  }
];

export function ChatWindow() {
  const { currentLead, messages, sendMessage, isLoading, error } = useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async (message: string) => {
    await sendMessage(message);
  };

  const handleSuggestedPrompt = (text: string) => {
    if (!isLoading) {
      handleSendMessage(text);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-gradient-to-br from-gray-50 via-white to-gray-50 relative overflow-hidden">
      {/* Decorative Background Elements */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-blue-50/30 to-indigo-50/30 rounded-full blur-3xl -z-0" />
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-gradient-to-tr from-purple-50/20 to-blue-50/20 rounded-full blur-3xl -z-0" />

      {/* Lead Context Bar (shows when lead is identified) */}
      {currentLead && (
        <div className="px-4 sm:px-6 py-3 border-b border-gray-200 bg-gradient-to-r from-white to-gray-50 backdrop-blur-sm z-10 shadow-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-sm text-gray-700 font-medium bg-gray-100 px-3 py-1 rounded-full">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
              </svg>
              Currently Discussing
            </span>
            <span className="text-sm text-gray-900 font-bold">
              {currentLead.name}
            </span>
            {currentLead.phone && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-600 bg-white px-2 py-1 rounded-md border border-gray-300">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                </svg>
                {currentLead.phone}
              </span>
            )}
            {currentLead.email && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-600 bg-white px-2 py-1 rounded-md border border-gray-300">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                  <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                </svg>
                {currentLead.email}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Messages Container with proper scrolling */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 z-10 scroll-smooth"
        style={{ scrollBehavior: 'smooth' }}
      >
        {messages.length === 0 ? (
          <div className="flex items-center justify-center min-h-full">
            <div className="text-center max-w-4xl w-full px-4 py-8 animate-fade-in">
              {/* Animated Bot Icon */}
              <div className="relative inline-block mb-8">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-indigo-500 rounded-full blur-2xl opacity-20 animate-pulse" />
                <div className="relative text-7xl sm:text-8xl animate-bounce-slow">
                  🤖
                </div>
              </div>

              <h2 className="text-3xl sm:text-4xl font-bold mb-3 text-gray-900">
                Close More Deals with AI
              </h2>
              <p className="text-gray-600 mb-8 text-sm sm:text-base">
                Get instant insights to help you close deals faster!
              </p>

              {/* Suggested Prompts */}
              <div className="space-y-4">
                <p className="text-sm font-semibold text-gray-700 mb-4">
                  Quick Actions:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {SUGGESTED_PROMPTS.map((prompt, index) => (
                    <button
                      key={index}
                      onClick={() => handleSuggestedPrompt(prompt.text)}
                      disabled={isLoading}
                      className="group relative bg-white hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 border-2 border-gray-200 hover:border-blue-300 rounded-xl p-4 text-left transition-all duration-300 hover:shadow-lg hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                      style={{ animationDelay: `${index * 100}ms` }}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-2xl flex-shrink-0 group-hover:scale-110 transition-transform duration-300">
                          {prompt.icon}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium text-blue-600 mb-1 block">
                            {prompt.category}
                          </span>
                          <p className="text-sm text-gray-700 group-hover:text-gray-900 font-medium">
                            {prompt.text}
                          </p>
                        </div>
                        <svg
                          className="w-5 h-5 text-gray-400 group-hover:text-blue-500 group-hover:translate-x-1 transition-all duration-300 flex-shrink-0"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Additional Info */}
              <div className="mt-8 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                <div className="flex items-center justify-center gap-2 text-sm text-gray-700">
                  <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  <span className="font-medium">Tip:</span>
                  <span>Type your question or click any action above</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto">
            <MessageList messages={messages} />
            <div ref={messagesEndRef} className="h-4" />
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="px-4 sm:px-6 py-3 bg-red-50 border-t border-red-200 z-10 animate-slide-down">
          <div className="flex items-center gap-2 max-w-4xl mx-auto">
            <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <p className="text-sm text-red-700 font-medium">{error}</p>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="z-10">
        <ChatInput
          onSendMessage={handleSendMessage}
          isLoading={isLoading}
          disabled={isLoading}
        />
      </div>
    </div>
  );
}
