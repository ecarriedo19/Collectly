import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import { API } from "../App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { toast } from "sonner";
import { formatDateTime } from "../utils/dateUtils";
import { 
  Mail, 
  CreditCard, 
  CheckCircle, 
  XCircle, 
  RefreshCw,
  ExternalLink,
  AlertCircle,
  Copy
} from "lucide-react";

export default function Integrations({ user }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState(null);
  const [gmailStatus, setGmailStatus] = useState({ connected: false });
  const [stripeStatus, setStripeStatus] = useState({ connected: false });
  const [stripeKey, setStripeKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchWorkspace();
    fetchStatuses();
  }, []);

  const fetchWorkspace = async () => {
    try {
      const res = await fetch(`${API}/workspaces/me`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setWorkspace(data.workspace);
      }
    } catch (error) {
      console.error('Error fetching workspace:', error);
    }
  };

  const fetchStatuses = async () => {
    setLoading(true);
    try {
      const [gmailRes, stripeRes] = await Promise.all([
        fetch(`${API}/integrations/gmail/status`, { credentials: 'include' }),
        fetch(`${API}/integrations/stripe/status`, { credentials: 'include' })
      ]);

      if (gmailRes.ok) {
        const data = await gmailRes.json();
        setGmailStatus(data);
      }

      if (stripeRes.ok) {
        const data = await stripeRes.json();
        setStripeStatus(data);
      }
    } catch (error) {
      console.error('Error fetching integration statuses:', error);
    } finally {
      setLoading(false);
    }
  };

  const connectGmail = () => {
    // Get Google OAuth URL
    const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    if (!clientId) {
      toast.error('Google OAuth not configured. Please set up GOOGLE_CLIENT_ID.');
      return;
    }

    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUri = window.location.origin + '/integrations';
    const scope = encodeURIComponent('https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly email profile');
    
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;
    
    window.location.href = authUrl;
  };

  const disconnectGmail = async () => {
    try {
      const res = await fetch(`${API}/integrations/gmail/disconnect`, {
        method: 'POST',
        credentials: 'include'
      });

      if (res.ok) {
        toast.success('Gmail disconnected');
        setGmailStatus({ connected: false });
      }
    } catch (error) {
      toast.error('Failed to disconnect Gmail');
    }
  };

  const connectStripe = async () => {
    if (!stripeKey.trim()) {
      toast.error('Please enter your Stripe Secret Key');
      return;
    }

    if (!stripeKey.startsWith('sk_')) {
      toast.error('Invalid Stripe key format. Should start with sk_');
      return;
    }

    setConnecting(true);
    try {
      const res = await fetch(`${API}/integrations/stripe/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          secret_key: stripeKey,
          webhook_secret: webhookSecret || null
        })
      });

      if (res.ok) {
        const data = await res.json();
        toast.success('Stripe connected!');
        setStripeStatus(data);
        setStripeKey('');
        setWebhookSecret('');
      } else {
        const error = await res.json();
        toast.error(error.detail || 'Failed to connect Stripe');
      }
    } catch (error) {
      toast.error('Error connecting Stripe');
    } finally {
      setConnecting(false);
    }
  };

  const disconnectStripe = async () => {
    try {
      const res = await fetch(`${API}/integrations/stripe/disconnect`, {
        method: 'POST',
        credentials: 'include'
      });

      if (res.ok) {
        toast.success('Stripe disconnected');
        setStripeStatus({ connected: false });
      }
    } catch (error) {
      toast.error('Failed to disconnect Stripe');
    }
  };

  const syncStripe = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${API}/integrations/stripe/sync`, {
        method: 'POST',
        credentials: 'include'
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(`Synced ${data.customers_synced} customers and ${data.invoices_synced} invoices`);
        fetchStatuses();
      } else {
        const error = await res.json();
        toast.error(error.detail || 'Sync failed');
      }
    } catch (error) {
      toast.error('Error syncing Stripe data');
    } finally {
      setSyncing(false);
    }
  };

  const webhookUrl = `${process.env.REACT_APP_BACKEND_URL}/api/webhooks/stripe`;

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('Webhook URL copied!');
  };

  if (loading) {
    return (
      <Layout user={user}>
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout user={user}>
      <div className="space-y-8" data-testid="integrations-page">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Integrations</h1>
          <p className="text-slate-500 mt-1">Connect your services to enable automated follow-ups</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Gmail Integration */}
          <Card className="card-hover">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                  <Mail className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <CardTitle>Gmail</CardTitle>
                  <CardDescription>Send reminder emails from your inbox</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {gmailStatus.connected ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-emerald-600">
                    <CheckCircle className="w-5 h-5" />
                    <span className="font-medium">Connected</span>
                  </div>
                  <p className="text-sm text-slate-600">
                    Sending from: <span className="font-medium">{gmailStatus.email}</span>
                  </p>
                  <Button 
                    variant="outline" 
                    onClick={disconnectGmail}
                    className="btn-active"
                    data-testid="disconnect-gmail-btn"
                  >
                    Disconnect
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-slate-500">
                    <XCircle className="w-5 h-5" />
                    <span>Not connected</span>
                  </div>
                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                    <div className="flex gap-2">
                      <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                      <p className="text-sm text-amber-800">
                        Gmail OAuth requires Google Cloud Console setup. Please configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your environment.
                      </p>
                    </div>
                  </div>
                  <Button 
                    onClick={connectGmail}
                    className="bg-red-600 hover:bg-red-700 text-white btn-active"
                    data-testid="connect-gmail-btn"
                  >
                    Connect Gmail
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Stripe Integration */}
          <Card className="card-hover">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center">
                  <CreditCard className="w-6 h-6 text-indigo-600" />
                </div>
                <div>
                  <CardTitle>Stripe</CardTitle>
                  <CardDescription>Import customers and invoices</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {stripeStatus.connected ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-emerald-600">
                    <CheckCircle className="w-5 h-5" />
                    <span className="font-medium">Connected</span>
                  </div>
                  {stripeStatus.account_id && (
                    <p className="text-sm text-slate-600">
                      Account: <span className="font-mono">{stripeStatus.account_id}</span>
                    </p>
                  )}
                  {stripeStatus.last_sync_at && (
                    <p className="text-sm text-slate-500">
                      Last synced: <span className="tabular-nums">{formatDateTime(stripeStatus.last_sync_at, workspace?.timezone || 'America/New_York')}</span>
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button 
                      onClick={syncStripe}
                      disabled={syncing}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white btn-active"
                      data-testid="sync-stripe-btn"
                    >
                      {syncing ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Syncing...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Sync Now
                        </>
                      )}
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={disconnectStripe}
                      className="btn-active"
                      data-testid="disconnect-stripe-btn"
                    >
                      Disconnect
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-slate-500">
                    <XCircle className="w-5 h-5" />
                    <span>Not connected</span>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="stripe-key">Stripe Secret Key</Label>
                      <Input
                        id="stripe-key"
                        type="password"
                        placeholder="sk_live_... or sk_test_..."
                        value={stripeKey}
                        onChange={(e) => setStripeKey(e.target.value)}
                        className="mt-1 font-mono"
                        data-testid="stripe-key-input"
                      />
                    </div>
                    <div>
                      <Label htmlFor="webhook-secret">Webhook Secret (optional)</Label>
                      <Input
                        id="webhook-secret"
                        type="password"
                        placeholder="whsec_..."
                        value={webhookSecret}
                        onChange={(e) => setWebhookSecret(e.target.value)}
                        className="mt-1 font-mono"
                        data-testid="webhook-secret-input"
                      />
                    </div>
                  </div>
                  <Button 
                    onClick={connectStripe}
                    disabled={connecting}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white btn-active"
                    data-testid="connect-stripe-btn"
                  >
                    {connecting ? 'Connecting...' : 'Connect Stripe'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Webhook Setup */}
        {stripeStatus.connected && (
          <Card>
            <CardHeader>
              <CardTitle>Stripe Webhook Setup</CardTitle>
              <CardDescription>
                Configure webhooks to receive instant payment notifications
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Webhook Endpoint URL</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    value={webhookUrl}
                    readOnly
                    className="font-mono text-sm"
                    data-testid="webhook-url-display"
                  />
                  <Button 
                    variant="outline" 
                    onClick={copyWebhookUrl}
                    className="btn-active"
                    data-testid="copy-webhook-url-btn"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="bg-slate-50 rounded-lg p-4">
                <h4 className="font-medium text-slate-900 mb-2">Required Events</h4>
                <ul className="text-sm text-slate-600 space-y-1">
                  <li>• invoice.paid</li>
                  <li>• invoice.payment_succeeded</li>
                  <li>• invoice.payment_failed</li>
                  <li>• invoice.voided</li>
                </ul>
              </div>
              <a 
                href="https://dashboard.stripe.com/webhooks" 
                target="_blank" 
                rel="noopener noreferrer"
              >
                <Button variant="outline" className="btn-active">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open Stripe Webhooks Dashboard
                </Button>
              </a>
            </CardContent>
          </Card>
        )}

        {/* Continue Button */}
        {stripeStatus.connected && (
          <div className="flex justify-end">
            <Button 
              onClick={() => navigate('/dashboard')}
              className="bg-indigo-600 hover:bg-indigo-700 text-white btn-active"
              data-testid="continue-to-dashboard-btn"
            >
              Continue to Dashboard
            </Button>
          </div>
        )}
      </div>
    </Layout>
  );
}
