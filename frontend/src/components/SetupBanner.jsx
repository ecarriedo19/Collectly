import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { Button } from "./ui/button";
import { AlertTriangle, X, ArrowRight } from "lucide-react";

export default function SetupBanner() {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  const fetchStatus = async () => {
    try {
      const data = await api.onboarding.getStatus();
      setStatus(data);
      setVisible(!data.is_complete);
    } catch (error) {
      console.error('Error fetching onboarding status:', error);
    }
  };

  useEffect(() => {
    // Check if dismissed in this session
    const isDismissed = sessionStorage.getItem('setup_banner_dismissed');
    if (isDismissed) {
      setDismissed(true);
      return;
    }
    
    fetchStatus();
  }, []);

  const dismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('setup_banner_dismissed', 'true');
  };

  if (!visible || dismissed) return null;

  const getNextStep = () => {
    if (!status) return 'integrations';
    if (!status.steps.stripe) return 'integrations';
    if (!status.steps.import) return 'integrations';
    if (!status.steps.gmail) return 'integrations';
    if (!status.steps.test_email) return 'settings';
    return 'policy';
  };

  const getStepMessage = () => {
    if (!status) return 'Complete setup to enable autopilot';
    if (!status.steps.stripe) return 'Connect Stripe to import invoices';
    if (!status.steps.import) return 'Import your invoices from Stripe';
    if (!status.steps.gmail) return 'Connect Gmail to send reminders';
    if (!status.steps.test_email) return 'Send a test email to verify setup';
    return 'Enable autopilot to start sending reminders';
  };

  return (
    <div className="bg-amber-50 border-b border-amber-200" data-testid="setup-banner">
      <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <p className="text-sm font-medium text-amber-800">
              {getStepMessage()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link to={`/${getNextStep()}`}>
              <Button 
                size="sm" 
                className="bg-amber-600 hover:bg-amber-700 text-white"
                data-testid="setup-banner-cta"
              >
                Finish Setup <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={dismiss}
              className="text-amber-700 hover:text-amber-800"
              data-testid="setup-banner-dismiss"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
