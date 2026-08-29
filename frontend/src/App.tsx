import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import SendMoneyPage from './pages/SendMoneyPage';
import RequestMoneyPage from './pages/RequestMoneyPage';
import RequestsPage from './pages/RequestsPage';
import RequestDetailsPage from './pages/RequestDetailsPage';
import HistoryPage from './pages/HistoryPage';
import TransactionDetailsPage from './pages/TransactionDetailsPage';
import ProfilePage from './pages/ProfilePage';
import ProgramsPage from './pages/ProgramsPage';
import ProgramDetailPage from './pages/ProgramDetailPage';
import StipendsPage from './pages/StipendsPage';

function FullscreenSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center text-brand-600">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export default function App() {
  const { me, loading } = useAuth();

  if (loading) return <FullscreenSpinner />;

  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/send" element={<SendMoneyPage />} />
        <Route path="/request" element={<RequestMoneyPage />} />
        <Route path="/requests" element={<RequestsPage />} />
        <Route path="/requests/:reference" element={<RequestDetailsPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/tx/:reference" element={<TransactionDetailsPage />} />
        <Route path="/programs" element={<ProgramsPage />} />
        <Route path="/programs/:reference" element={<ProgramDetailPage />} />
        <Route path="/stipends" element={<StipendsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
