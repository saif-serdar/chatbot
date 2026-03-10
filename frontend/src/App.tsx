import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { LoginPage } from './pages/LoginPage';
import { ChatPage } from './pages/ChatPage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { AgentMappingPage } from './pages/AgentMappingPage';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return token ? <>{children}</> : <Navigate to="/login" />;
}

function App() {
  const { loadUser, token } = useAuthStore();

  useEffect(() => {
    if (token) {
      loadUser();
    }
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        {/* Regular user routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Navigate to="/admin" replace />} />

        {/* Admin routes — separate auth, no relation to regular users */}
        <Route path="/admin" element={<AdminLoginPage />} />
        <Route path="/admin/agents" element={<AgentMappingPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
