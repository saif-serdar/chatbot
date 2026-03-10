import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { LoginPage } from './pages/LoginPage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { AgentMappingPage } from './pages/AgentMappingPage';

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
