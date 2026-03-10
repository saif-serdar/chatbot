import { useState, KeyboardEvent, useRef, useEffect } from 'react';

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  isLoading: boolean;
  disabled: boolean;
}

export function ChatInput({ onSendMessage, isLoading, disabled }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [message]);

  const handleSubmit = () => {
    if (message.trim() && !disabled) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="px-4 sm:px-6 py-4 border-t border-gray-200 bg-gradient-to-r from-gray-50 via-white to-gray-50 backdrop-blur-sm">
      <div className="max-w-4xl mx-auto">
        <div
          className={`relative flex items-end gap-2 sm:gap-3 bg-white rounded-2xl shadow-lg transition-all duration-300 ${
            isFocused
              ? 'ring-2 ring-blue-500 ring-offset-2 shadow-2xl'
              : 'ring-1 ring-gray-200'
          }`}
        >
          {/* Textarea Container */}
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder="Type your message here..."
              className="w-full resize-none rounded-2xl px-4 sm:px-5 py-3 sm:py-4 pr-12 focus:outline-none text-sm sm:text-base text-gray-900 placeholder-gray-400 max-h-[150px] overflow-y-auto bg-transparent"
              rows={1}
              disabled={disabled}
              style={{ minHeight: '52px' }}
            />

            {/* Character count indicator (optional) */}
            {message.length > 0 && (
              <div className="absolute bottom-2 right-2 text-xs text-gray-400 bg-white px-2 py-0.5 rounded-full">
                {message.length}
              </div>
            )}
          </div>

          {/* Send Button */}
          <div className="flex-shrink-0 pb-2 pr-2">
            <button
              onClick={handleSubmit}
              disabled={disabled || !message.trim()}
              className={`relative group rounded-xl px-4 sm:px-5 py-3 font-medium transition-all duration-300 transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 ${
                message.trim() && !disabled
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-md hover:shadow-xl'
                  : 'bg-gray-200 text-gray-400'
              }`}
            >
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span className="hidden sm:inline text-sm">Thinking...</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <svg
                    className={`w-5 h-5 transition-transform duration-300 ${
                      message.trim() ? 'group-hover:translate-x-0.5 group-hover:-translate-y-0.5' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                  </svg>
                  <span className="hidden sm:inline text-sm font-semibold">Send</span>
                </div>
              )}

              {/* Button glow effect */}
              {message.trim() && !disabled && (
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-400 to-indigo-400 blur-lg opacity-30 group-hover:opacity-50 transition-opacity duration-300 -z-10" />
              )}
            </button>
          </div>
        </div>

        {/* Helper Text - Simplified */}
        <div className="flex items-center justify-center mt-2 px-2">
          {/* Status indicator */}
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-blue-600 font-medium animate-pulse">
              <div className="w-2 h-2 bg-blue-600 rounded-full animate-ping" />
              <span>AI is thinking...</span>
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              Press <span className="text-gray-700 font-medium">Enter</span> to send • <span className="text-gray-700 font-medium">Shift+Enter</span> for new line
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
