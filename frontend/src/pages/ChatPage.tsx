import { useAuthStore } from '../stores/authStore';
import { ChatWindow } from '../components/ChatWindow';

export function ChatPage() {
  const { user, logout } = useAuthStore();

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Modern Header */}
      <header className="bg-gradient-to-r from-white via-gray-50 to-white border-b border-gray-200 px-4 sm:px-6 py-3 sm:py-4 backdrop-blur-sm sticky top-0 z-20 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          {/* Logo and Title */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg">
              <svg className="w-6 h-6 sm:w-7 sm:h-7 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">
                Lead Assistant
              </h1>
              <p className="hidden sm:block text-xs sm:text-sm text-gray-600 truncate">
                Close more deals faster with AI insights
              </p>
            </div>
          </div>

          {/* User Profile & Actions */}
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            <div className="hidden md:block text-right">
              <p className="text-sm font-medium text-gray-900 truncate max-w-[150px]">{user?.name}</p>
              <p className="text-xs text-gray-500 truncate max-w-[150px]">{user?.email}</p>
            </div>
            <button
              onClick={logout}
              className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 rounded-lg font-medium transition-all duration-300 hover:shadow-md text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat Area - Full Width */}
        <main className="flex-1 flex flex-col">
          <ChatWindow />
        </main>
      </div>
    </div>
  );
}
