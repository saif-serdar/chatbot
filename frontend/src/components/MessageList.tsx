import type { ChatMessage } from '../types';

interface MessageListProps {
  messages: ChatMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <div className="space-y-6">
      {messages.map((message, index) => (
        <div
          key={message.id}
          className={`flex gap-3 ${
            message.role === 'user' ? 'justify-end' : 'justify-start'
          } animate-fade-in-up`}
          style={{ animationDelay: `${index * 50}ms` }}
        >
          {/* Avatar for assistant messages */}
          {message.role === 'assistant' && (
            <div className="flex-shrink-0 mt-1">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm sm:text-base font-bold shadow-lg ring-2 ring-white">
                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
          )}

          {/* Message Bubble */}
          <div
            className={`max-w-[85%] sm:max-w-[75%] rounded-2xl shadow-md ${
              message.role === 'user'
                ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-br-md'
                : 'bg-white text-gray-900 rounded-bl-md border border-gray-200'
            }`}
          >
            <div className="px-4 py-3">
              <div className="whitespace-pre-wrap break-words text-sm sm:text-base leading-relaxed">
                {message.content}
              </div>

              {/* Sources for assistant messages */}
              {message.role === 'assistant' && message.sources && message.sources.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="flex items-center gap-2 mb-3">
                    <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                    </svg>
                    <p className="text-xs font-semibold text-gray-700">
                      Sources ({message.sources.length})
                    </p>
                  </div>
                  <div className="space-y-2">
                    {message.sources.map((source, idx) => (
                      <div
                        key={idx}
                        className="text-xs bg-gradient-to-r from-gray-50 to-blue-50 rounded-lg p-3 border border-gray-200 hover:border-blue-300 transition-colors duration-200"
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 font-medium capitalize text-xs">
                            {source.type}
                          </span>
                          <span className="text-gray-400">•</span>
                          <span className="text-gray-500 flex items-center gap-1">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                            </svg>
                            {new Date(source.timestamp).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-gray-700 line-clamp-2 leading-relaxed">
                          {source.preview}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Timestamp */}
            <div className={`px-4 pb-2 flex items-center gap-1.5 text-xs ${
              message.role === 'user' ? 'text-blue-100' : 'text-gray-500'
            }`}>
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
              </svg>
              <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>

          {/* Avatar for user messages */}
          {message.role === 'user' && (
            <div className="flex-shrink-0 mt-1">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-gray-600 to-gray-800 flex items-center justify-center text-white text-sm sm:text-base font-bold shadow-lg ring-2 ring-white">
                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
