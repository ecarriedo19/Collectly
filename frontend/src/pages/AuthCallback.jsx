import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { API } from "../App";

export default function AuthCallback() {
  const navigate = useNavigate();
  const hasProcessed = useRef(false);

  useEffect(() => {
    // Prevent double processing in StrictMode
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const processAuth = async () => {
      // Get session_id from URL fragment
      const hash = window.location.hash;
      const sessionIdMatch = hash.match(/session_id=([^&]+)/);
      
      if (!sessionIdMatch) {
        navigate('/', { replace: true });
        return;
      }

      const sessionId = sessionIdMatch[1];

      try {
        // Exchange session_id for session_token
        const response = await fetch(`${API}/auth/session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({ session_id: sessionId })
        });

        if (!response.ok) {
          throw new Error('Authentication failed');
        }

        const user = await response.json();

        // Check if user has a workspace
        const workspaceResponse = await fetch(`${API}/workspaces/me`, {
          credentials: 'include'
        });

        if (workspaceResponse.ok) {
          const data = await workspaceResponse.json();
          if (data.workspace) {
            // User has workspace, go to dashboard
            navigate('/dashboard', { replace: true, state: { user } });
          } else {
            // User needs to create workspace
            navigate('/setup', { replace: true, state: { user } });
          }
        } else {
          navigate('/setup', { replace: true, state: { user } });
        }
      } catch (error) {
        console.error('Auth error:', error);
        navigate('/', { replace: true });
      }
    };

    processAuth();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center" data-testid="auth-callback-page">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-slate-600">Signing you in...</p>
      </div>
    </div>
  );
}
