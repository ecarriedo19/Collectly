import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { API } from "../App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { toast } from "sonner";
import { formatDate } from "../utils/dateUtils";
import { 
  CheckCircle, 
  CreditCard, 
  Mail, 
  Zap,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  ExternalLink,
  Send,
  Play,
  AlertCircle
} from "lucide-react";

const STEPS = [
  { id: 'stripe', label: 'Connect Stripe', icon: CreditCard },
  { id: 'import', label: 'Import Data', icon: RefreshCw },
  { id: 'gmail', label: 'Connect Gmail', icon: Mail },
  { id: 'test_email', label: 'Test Email', icon: Send },
  { id: 'autopilot', label: 'Enable Autopilot', icon: Zap }
];

export default function OnboardingWizard({ user, onComplete, onSkip }) {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  
  // Step 1: Stripe
  const [stripeKey, setStripeKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [stripeConnected, setStripeConnected] = useState(false);
  
  // Step 2: Import
  const [importData, setImportData] = useState(null);
  const [syncing, setSyncing] = useState(false);
  
  // Step 3: Gmail
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState(null);
  
  // Step 4: Test email
  const [testEmailSent, setTestEmailSent] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  
  // Step 5: Autopilot
  const [scheduledPreview, setScheduledPreview] = useState(null);

  useEffect(() => {
    fetchOnboardingStatus();
  }, []);

  const fetchOnboardingStatus = async () => {
    try {
      const res = await fetch(`${API}/onboarding/status`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        setStripeConnected(data.steps.stripe);
        setGmailConnected(data.steps.gmail);
        setGmailEmail(data.gmail_email);
        
        // Determine starting step
        if (!data.steps.stripe) setCurrentStep(0);
        else if (!data.steps.import) setCurrentStep(1);
        else if (!data.steps.gmail) setCurrentStep(2);
        else if (!data.steps.test_email) setCurrentStep(3);
        else setCurrentStep(4);
        
        // If stripe connected, fetch import preview
        if (data.steps.stripe) {
          fetchImportPreview();
        }
      }
    } catch (error) {
      console.error('Error fetching onboarding status:', error);
    }
  };

  const fetchImportPreview = async () => {
    try {
      const res = await fetch(`${API}/onboarding/import-preview`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setImportData(data);
      }
    } catch (error) {
      console.error('Error fetching import preview:', error);
    }
  };

  const fetchScheduledPreview = async () => {
    try {
      const res = await fetch(`${API}/onboarding/scheduled-preview`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setScheduledPreview(data);
      }
    } catch (error) {
      console.error('Error fetching scheduled preview:', error);
    }
  };

  const connectStripe = async () => {
    if (!stripeKey.trim()) {
      toast.error('Please enter your Stripe Secret Key');
      return;
    }
    if (!stripeKey.startsWith('sk_')) {
      toast.error('Invalid Stripe key format');
      return;
    }

    setLoading(true);
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
        toast.success('Stripe connected!');
        setStripeConnected(true);
        setStripeKey('');
        setWebhookSecret('');
        // Auto-advance to import step
        setCurrentStep(1);
      } else {
        const error = await res.json();
        toast.error(error.detail || 'Failed to connect Stripe');
      }
    } catch (error) {
      toast.error('Error connecting Stripe');
    } finally {
      setLoading(false);
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
        await fetchImportPreview();
      } else {
        const error = await res.json();
        toast.error(error.detail || 'Sync failed');
      }
    } catch (error) {
      toast.error('Error syncing');
    } finally {
      setSyncing(false);
    }
  };

  const connectGmail = () => {
    const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    if (!clientId) {
      toast.info('Gmail OAuth requires Google Cloud Console setup. You can skip this step for now.');
      return;
    }

    const redirectUri = window.location.origin + '/integrations';
    const scope = encodeURIComponent('https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly email profile');
    
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;
    
    window.location.href = authUrl;
  };

  const sendTestEmail = async () => {
    setSendingTest(true);
    try {
      const res = await fetch(`${API}/onboarding/send-test-email`, {
        method: 'POST',
        credentials: 'include'
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(data.message);
        setTestEmailSent(true);
      } else {
        const error = await res.json();
        toast.error(error.detail || 'Failed to send test email');
      }
    } catch (error) {
      toast.error('Error sending test email');
    } finally {
      setSendingTest(false);
    }
  };

  const completeOnboarding = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/onboarding/complete`, {
        method: 'POST',
        credentials: 'include'
      });

      if (res.ok) {
        toast.success('Onboarding complete! Autopilot is now active.');
        if (onComplete) onComplete();
        navigate('/dashboard', { replace: true });
      } else {
        toast.error('Failed to complete onboarding');
      }
    } catch (error) {
      toast.error('Error completing onboarding');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (cents, currency = 'usd') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(cents / 100);
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0: return stripeConnected;
      case 1: return importData && importData.invoices?.total > 0;
      case 2: return true; // Gmail is optional
      case 3: return true; // Test email is optional
      case 4: return true;
      default: return false;
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0: // Connect Stripe
        return (
          <div className="space-y-6">
            {stripeConnected ? (
              <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                  <p className="text-emerald-800 font-medium">Stripe connected successfully!</p>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="stripe-key">Stripe Secret Key</Label>
                    <Input
                      id="stripe-key"
                      type="password"
                      placeholder="sk_live_... or sk_test_..."
                      value={stripeKey}
                      onChange={(e) => setStripeKey(e.target.value)}
                      className="mt-1"
                      data-testid="onboarding-stripe-key"
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      Find your key in the{' '}
                      <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                        Stripe Dashboard → Developers → API keys
                      </a>
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="webhook-secret">Webhook Secret (optional)</Label>
                    <Input
                      id="webhook-secret"
                      type="password"
                      placeholder="whsec_..."
                      value={webhookSecret}
                      onChange={(e) => setWebhookSecret(e.target.value)}
                      className="mt-1"
                      data-testid="onboarding-webhook-secret"
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      Required for instant payment notifications. Set up in Stripe Webhooks.
                    </p>
                  </div>
                </div>
                <Button
                  onClick={connectStripe}
                  disabled={loading || !stripeKey.trim()}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                  data-testid="onboarding-connect-stripe-btn"
                >
                  {loading ? (
                    <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Connecting...</>
                  ) : (
                    <><CreditCard className="w-4 h-4 mr-2" /> Connect Stripe</>
                  )}
                </Button>
              </>
            )}
          </div>
        );

      case 1: // Import Data
        return (
          <div className="space-y-6">
            {importData ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-slate-900 tabular-nums">{importData.customers}</p>
                    <p className="text-sm text-slate-500">Customers</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-blue-700 tabular-nums">{importData.invoices?.open || 0}</p>
                    <p className="text-sm text-slate-500">Open</p>
                  </div>
                  <div className="bg-rose-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-rose-700 tabular-nums">{importData.invoices?.past_due || 0}</p>
                    <p className="text-sm text-slate-500">Past Due</p>
                  </div>
                  <div className="bg-emerald-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-emerald-700 tabular-nums">{importData.invoices?.paid || 0}</p>
                    <p className="text-sm text-slate-500">Paid</p>
                  </div>
                </div>
                
                <div className="bg-slate-100 rounded-lg p-4">
                  <p className="text-sm text-slate-600">
                    Total Accounts Receivable:{' '}
                    <span className="font-bold text-slate-900">
                      {formatCurrency(importData.total_ar_cents, importData.currency)}
                    </span>
                  </p>
                </div>

                <Button
                  onClick={syncStripe}
                  disabled={syncing}
                  variant="outline"
                  className="w-full"
                  data-testid="onboarding-resync-btn"
                >
                  {syncing ? (
                    <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Syncing...</>
                  ) : (
                    <><RefreshCw className="w-4 h-4 mr-2" /> Re-sync from Stripe</>
                  )}
                </Button>
              </>
            ) : (
              <div className="text-center py-8">
                <Button
                  onClick={syncStripe}
                  disabled={syncing}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                  data-testid="onboarding-sync-btn"
                >
                  {syncing ? (
                    <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Importing...</>
                  ) : (
                    <><RefreshCw className="w-4 h-4 mr-2" /> Import from Stripe</>
                  )}
                </Button>
              </div>
            )}
          </div>
        );

      case 2: // Connect Gmail
        return (
          <div className="space-y-6">
            {gmailConnected ? (
              <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                  <div>
                    <p className="text-emerald-800 font-medium">Gmail connected!</p>
                    <p className="text-sm text-emerald-600">{gmailEmail}</p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-4">
                  <div className="flex gap-2">
                    <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-amber-800">
                        Gmail OAuth requires Google Cloud Console setup with GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
                      </p>
                      <p className="text-sm text-amber-700 mt-1">
                        You can skip this step for now and set it up later.
                      </p>
                    </div>
                  </div>
                </div>
                <Button
                  onClick={connectGmail}
                  className="w-full bg-red-600 hover:bg-red-700 text-white"
                  data-testid="onboarding-connect-gmail-btn"
                >
                  <Mail className="w-4 h-4 mr-2" /> Connect Gmail
                </Button>
              </>
            )}
          </div>
        );

      case 3: // Test Email
        return (
          <div className="space-y-6">
            {testEmailSent ? (
              <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                  <div>
                    <p className="text-emerald-800 font-medium">Test email sent!</p>
                    <p className="text-sm text-emerald-600">Check your inbox at {user?.email}</p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-slate-600">
                  Send a test reminder email to <strong>{user?.email}</strong> to verify your email setup is working.
                </p>
                <Button
                  onClick={sendTestEmail}
                  disabled={sendingTest}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                  data-testid="onboarding-send-test-btn"
                >
                  {sendingTest ? (
                    <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Sending...</>
                  ) : (
                    <><Send className="w-4 h-4 mr-2" /> Send Test Email</>
                  )}
                </Button>
              </>
            )}
          </div>
        );

      case 4: // Enable Autopilot
        return (
          <div className="space-y-6">
            <p className="text-sm text-slate-600">
              Enabling autopilot will start sending automatic payment reminders based on your reminder policy.
            </p>
            
            {scheduledPreview && scheduledPreview.scheduled_count > 0 && (
              <div className="bg-slate-50 rounded-lg p-4">
                <p className="text-sm font-medium text-slate-900 mb-3">
                  {scheduledPreview.scheduled_count} reminder{scheduledPreview.scheduled_count !== 1 ? 's' : ''} scheduled for the next 7 days
                </p>
                <div className="space-y-2">
                  {scheduledPreview.invoices.slice(0, 5).map((inv, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">{inv.customer_name}</span>
                      <span className="text-slate-900 font-medium tabular-nums">
                        {formatCurrency(inv.amount_due_cents, inv.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <Button
              onClick={completeOnboarding}
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              data-testid="onboarding-enable-autopilot-btn"
            >
              {loading ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Enabling...</>
              ) : (
                <><Zap className="w-4 h-4 mr-2" /> Enable Autopilot & Finish</>
              )}
            </Button>
          </div>
        );

      default:
        return null;
    }
  };

  // Load scheduled preview when reaching step 5
  useEffect(() => {
    if (currentStep === 4) {
      fetchScheduledPreview();
    }
  }, [currentStep]);

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4" data-testid="onboarding-wizard">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Zap className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">Set up Collectly</h1>
          <p className="text-slate-600 mt-2">Let&apos;s get your automated invoice follow-ups running</p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-between mb-8 px-4">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            const isComplete = index < currentStep || (index === currentStep && canProceed());
            const isCurrent = index === currentStep;
            
            return (
              <div key={step.id} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div 
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                      isComplete 
                        ? 'bg-emerald-100 text-emerald-600' 
                        : isCurrent 
                          ? 'bg-indigo-100 text-indigo-600' 
                          : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {isComplete && index < currentStep ? (
                      <CheckCircle className="w-5 h-5" />
                    ) : (
                      <Icon className="w-5 h-5" />
                    )}
                  </div>
                  <span className={`text-xs mt-2 ${isCurrent ? 'text-slate-900 font-medium' : 'text-slate-500'}`}>
                    {step.label}
                  </span>
                </div>
                {index < STEPS.length - 1 && (
                  <div className={`w-8 h-0.5 mx-2 ${index < currentStep ? 'bg-emerald-300' : 'bg-slate-200'}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Step Content */}
        <Card>
          <CardHeader>
            <CardTitle>{STEPS[currentStep].label}</CardTitle>
            <CardDescription>
              {currentStep === 0 && "Connect your Stripe account to import customers and invoices"}
              {currentStep === 1 && "Review your imported data before proceeding"}
              {currentStep === 2 && "Connect Gmail to send reminders from your inbox"}
              {currentStep === 3 && "Verify your email setup is working correctly"}
              {currentStep === 4 && "Enable automatic payment reminders"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {renderStepContent()}
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6">
          <Button
            variant="ghost"
            onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
            disabled={currentStep === 0}
            data-testid="onboarding-back-btn"
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={onSkip || (() => navigate('/dashboard'))}
              data-testid="onboarding-skip-btn"
            >
              Skip for now
            </Button>
            
            {currentStep < STEPS.length - 1 && (
              <Button
                onClick={() => setCurrentStep(currentStep + 1)}
                disabled={!canProceed() && currentStep < 2}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
                data-testid="onboarding-next-btn"
              >
                Continue <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
