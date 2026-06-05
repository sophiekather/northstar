import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth.jsx';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import TimePage from './pages/TimePage';
import ExpensesPage from './pages/ExpensesPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import SettingsPage from './pages/SettingsPage';
import ClientsSettingsPage from './pages/ClientsSettingsPage';
import TaskTypesSettingsPage from './pages/TaskTypesSettingsPage';
import ReportsPage from './pages/ReportsPage';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-text-muted">Loading…</div></div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/time" replace /> : <LoginPage />} />
      <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Navigate to="/time" replace />} />
        <Route path="time" element={<TimePage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/clients" element={<ClientsSettingsPage />} />
        <Route path="settings/tasks" element={<TaskTypesSettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/time" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
