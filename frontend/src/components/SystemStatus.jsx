import { useState, useEffect } from "react";
import { API } from "../App";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { formatDateTime } from "../utils/dateUtils";
import { 
  CheckCircle, 
  AlertTriangle, 
  XCircle, 
  RefreshCw,
  Clock,
  Zap,
  Mail,
  CreditCard
} from "lucide-react";

export default function SystemStatus({ workspace, compact = false }) {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

  useEffect(() => {
    fetchHealth();
  }, []);

  const fetchHealth = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/health/status`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      }
    } catch (error) {
      console.error('Error fetching health status:', error);
    } finally {
      setLoading(false);
    }
  };

  const runScheduler = async () => {
    setActionLoading('scheduler');
    try {
      const res = await fetch(`${API}/jobs/run-scheduler`, {
        method: 'POST',
        credentials: 'include'
      });
      if (res.ok) {
        toast.success('Scheduler run triggered');
        fetchHealth();
      } else {
        toast.error('Failed to run scheduler');
      }
    } catch (error) {
      toast.error('Error running scheduler');
    } finally {
      setActionLoading(null);
    }
  };

  const retrySync = async () => {
    setActionLoading('sync');
    try {
      const res = await fetch(`${API}/integrations/stripe/sync`, {
        method: 'POST',
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Synced ${data.customers_synced} customers and ${data.invoices_synced} invoices`);
        fetchHealth();
      } else {
        const error = await res.json();
        toast.error(error.detail || 'Sync failed');
      }
    } catch (error) {
      toast.error('Error syncing');
    } finally {
      setActionLoading(null);
    }
  };

  const timezone = workspace?.timezone || 'America/New_York';

  const getStatusIcon = (status) => {
    if (status === 'ok') return <CheckCircle className="w-4 h-4 text-emerald-500" />;
    if (status === 'error') return <XCircle className="w-4 h-4 text-rose-500" />;
    if (status === 'never') return <Clock className="w-4 h-4 text-slate-400" />;
    return <AlertTriangle className="w-4 h-4 text-amber-500" />;
  };

  const getStatusColor = (status) => {
    if (status === 'ok') return 'text-emerald-600';
    if (status === 'error') return 'text-rose-600';
    if (status === 'never') return 'text-slate-500';
    return 'text-amber-600';
  };

  if (loading) {
    return (
      <Card className={compact ? "border-slate-200" : ""}>
        <CardContent className={compact ? "p-4" : "p-6"}>
          <div className="flex items-center justify-center h-20">
            <RefreshCw className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!health) return null;

  // Compact view for dashboard
  if (compact) {
    const hasWarnings = health.warnings?.length > 0;
    const allGood = health.stripe_connected && !hasWarnings;

    return (
      <Card className={`border ${hasWarnings ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200'}`} data-testid="system-status-compact">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${allGood ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                {allGood ? (
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {allGood ? 'All systems operational' : `${health.warnings?.length || 0} issue${health.warnings?.length !== 1 ? 's' : ''} detected`}
                </p>
                <p className="text-xs text-slate-500">
                  Last sync: {health.stripe_sync?.last_run ? formatDateTime(health.stripe_sync.last_run, timezone) : 'Never'}
                </p>
              </div>
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={fetchHealth}
              data-testid="refresh-health-btn"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>

          {hasWarnings && (
            <div className="mt-3 pt-3 border-t border-amber-200 space-y-2">
              {health.warnings.slice(0, 2).map((warning, i) => (
                <div key={i} className="flex items-center justify-between">
                  <p className="text-xs text-amber-700">{warning.message}</p>
                  {warning.action === 'run_scheduler' && (
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={runScheduler}
                      disabled={actionLoading === 'scheduler'}
                      className="text-xs h-7"
                      data-testid="run-scheduler-btn"
                    >
                      {actionLoading === 'scheduler' ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Run now'}
                    </Button>
                  )}
                  {warning.action === 'retry_sync' && (
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={retrySync}
                      disabled={actionLoading === 'sync'}
                      className="text-xs h-7"
                      data-testid="retry-sync-btn"
                    >
                      {actionLoading === 'sync' ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Retry'}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Full view for integrations page
  return (
    <Card data-testid="system-status-full">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">System Status</CardTitle>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={fetchHealth}
            data-testid="refresh-health-full-btn"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stripe Sync */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {getStatusIcon(health.stripe_sync?.status)}
            <div>
              <p className="text-sm font-medium text-slate-900">Stripe Sync</p>
              <p className="text-xs text-slate-500">
                {health.stripe_sync?.last_run 
                  ? formatDateTime(health.stripe_sync.last_run, timezone)
                  : 'Never synced'}
              </p>
            </div>
          </div>
          <span className={`text-xs font-medium uppercase ${getStatusColor(health.stripe_sync?.status)}`}>
            {health.stripe_sync?.status || 'Unknown'}
          </span>
        </div>

        {/* Stripe Webhook */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {getStatusIcon(health.stripe_webhook?.status)}
            <div>
              <p className="text-sm font-medium text-slate-900">Stripe Webhooks</p>
              <p className="text-xs text-slate-500">
                {health.stripe_webhook?.last_received 
                  ? `Last received: ${formatDateTime(health.stripe_webhook.last_received, timezone)}`
                  : 'No webhooks received'}
              </p>
            </div>
          </div>
          <span className={`text-xs font-medium uppercase ${getStatusColor(health.stripe_webhook?.status)}`}>
            {health.stripe_webhook?.status === 'ok' ? 'Active' : health.stripe_webhook?.status || 'Inactive'}
          </span>
        </div>

        {/* Scheduler */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {getStatusIcon(health.scheduler?.status)}
            <div>
              <p className="text-sm font-medium text-slate-900">Reminder Scheduler</p>
              <p className="text-xs text-slate-500">
                {health.scheduler?.last_run 
                  ? `Last run: ${formatDateTime(health.scheduler.last_run, timezone)}`
                  : 'Never run'}
              </p>
            </div>
          </div>
          <span className={`text-xs font-medium uppercase ${getStatusColor(health.scheduler?.status)}`}>
            {health.scheduler?.status || 'Unknown'}
          </span>
        </div>

        {/* Gmail Reply Check */}
        {health.gmail_connected && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {getStatusIcon(health.reply_check?.status)}
              <div>
                <p className="text-sm font-medium text-slate-900">Reply Detection</p>
                <p className="text-xs text-slate-500">
                  {health.reply_check?.last_run 
                    ? `Last check: ${formatDateTime(health.reply_check.last_run, timezone)}`
                    : 'Never checked'}
                </p>
              </div>
            </div>
            <span className={`text-xs font-medium uppercase ${getStatusColor(health.reply_check?.status)}`}>
              {health.reply_check?.status || 'Unknown'}
            </span>
          </div>
        )}

        {/* Warnings */}
        {health.warnings?.length > 0 && (
          <div className="pt-4 border-t border-slate-200 space-y-3">
            <p className="text-xs font-medium text-slate-500 uppercase">Issues Detected</p>
            {health.warnings.map((warning, i) => (
              <div key={i} className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-amber-800">{warning.message}</p>
                  </div>
                  {warning.action === 'run_scheduler' && (
                    <Button 
                      size="sm"
                      variant="outline"
                      onClick={runScheduler}
                      disabled={actionLoading === 'scheduler'}
                      className="flex-shrink-0"
                      data-testid="run-scheduler-action-btn"
                    >
                      {actionLoading === 'scheduler' ? (
                        <RefreshCw className="w-3 h-3 animate-spin mr-1" />
                      ) : (
                        <Zap className="w-3 h-3 mr-1" />
                      )}
                      Run Now
                    </Button>
                  )}
                  {warning.action === 'retry_sync' && (
                    <Button 
                      size="sm"
                      variant="outline"
                      onClick={retrySync}
                      disabled={actionLoading === 'sync'}
                      className="flex-shrink-0"
                      data-testid="retry-sync-action-btn"
                    >
                      {actionLoading === 'sync' ? (
                        <RefreshCw className="w-3 h-3 animate-spin mr-1" />
                      ) : (
                        <RefreshCw className="w-3 h-3 mr-1" />
                      )}
                      Retry Sync
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
