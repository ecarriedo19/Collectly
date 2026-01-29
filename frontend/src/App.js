/**
 * Main Application
 * 
 * Uses Supabase for authentication and routing.
 * All protected routes require authentication via AuthProvider.
 */

import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, useNavigate, Navigate } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import Invoices from "./pages/Invoices";
import InvoiceDetail from "./pages/InvoiceDetail";
import Integrations from "./pages/Integrations";
import ReminderPolicy from "./pages/ReminderPolicy";
import Settings from "./pages/Settings";
import WorkspaceSetup from "./pages/WorkspaceSetup";
import OnboardingWizard from "./components/OnboardingWizard";

// Legacy API export for components that haven't been migrated yet
// TODO: Remove after full migration to api.js service layer
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
export const API = `${SUPABASE_URL}/functions/v1`;

/**
 * Protected Route Component
 * Redirects to landing page if not authenticated
 */
function ProtectedRoute({ children }) {
  const { user, loading, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [loading, isAuthenticated, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-pulse text-slate-500">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  // Convert Supabase user to app user format
  const appUser = user ? {
    user_id: user.id,
    email: user.email,
    name: user.user_metadata?.name || user.user_metadata?.full_name || user.email?.split('@')[0],
    picture: user.user_metadata?.avatar_url || user.user_metadata?.picture,
  } : null;

  return typeof children === 'function' ? children({ user: appUser }) : children;
}

/**
 * Auth Callback Handler
 * Supabase handles this automatically via detectSessionInUrl
 * This component just shows a loading state during the redirect
 */
function AuthCallback() {
  const { isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading) {
      if (isAuthenticated) {
        navigate('/dashboard', { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    }
  }, [loading, isAuthenticated, navigate]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-4"></div>
        <p className="text-slate-500">Signing you in...</p>
      </div>
    </div>
  );
}

/**
 * App Router - handles all routing
 */
function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route 
        path="/setup" 
        element={
          <ProtectedRoute>
            {({ user }) => <WorkspaceSetup user={user} />}
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/onboarding" 
        element={
          <ProtectedRoute>
            {({ user }) => <OnboardingWizard user={user} />}
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/dashboard" 
        element={
          <ProtectedRoute>
            {({ user }) => <Dashboard user={user} />}
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/invoices" 
        element={
          <ProtectedRoute>
            {({ user }) => <Invoices user={user} />}
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/invoices/:invoiceId" 
        element={
          <ProtectedRoute>
            {({ user }) => <InvoiceDetail user={user} />}
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/integrations" 
        element={
          <ProtectedRoute>
            {({ user }) => <Integrations user={user} />}
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/policy" 
        element={
          <ProtectedRoute>
            {({ user }) => <ReminderPolicy user={user} />}
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/settings" 
        element={
          <ProtectedRoute>
            {({ user }) => <Settings user={user} />}
          </ProtectedRoute>
        } 
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * Main App Component
 */
function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRouter />
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
