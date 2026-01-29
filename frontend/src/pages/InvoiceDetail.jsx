import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import Layout from "../components/Layout";
import { API } from "../App";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { formatDate, formatDateTime } from "../utils/dateUtils";
import { 
  ArrowLeft,
  ExternalLink,
  RefreshCw,
  Play,
  Pause,
  Square,
  CheckCircle,
  Mail,
  MessageSquare,
  Clock,
  User,
  Calendar
} from "lucide-react";

export default function InvoiceDetail({ user }) {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [note, setNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  useEffect(() => {
    fetchWorkspace();
    fetchInvoice();
  }, [invoiceId]);

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

  const fetchInvoice = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/invoices/${invoiceId}`, { 
        credentials: 'include' 
      });
      
      if (res.ok) {
        const data = await res.json();
        setInvoice(data);
      } else if (res.status === 404) {
        navigate('/invoices');
      }
    } catch (error) {
      console.error('Error fetching invoice:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateInvoice = async (updates) => {
    setActionLoading(true);
    try {
      const res = await fetch(`${API}/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates)
      });

      if (res.ok) {
        toast.success('Invoice updated');
        fetchInvoice();
      } else {
        toast.error('Failed to update invoice');
      }
    } catch (error) {
      toast.error('Error updating invoice');
    } finally {
      setActionLoading(false);
    }
  };

  const addNote = async () => {
    if (!note.trim()) {
      toast.error('Please enter a note');
      return;
    }

    setAddingNote(true);
    try {
      const res = await fetch(`${API}/invoices/${invoiceId}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ note })
      });

      if (res.ok) {
        toast.success('Note added');
        setNote('');
        fetchInvoice();
      } else {
        toast.error('Failed to add note');
      }
    } catch (error) {
      toast.error('Error adding note');
    } finally {
      setAddingNote(false);
    }
  };

  const formatCurrency = (cents, currency = 'usd') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(cents / 100);
  };

  const getStatusBadge = (status) => {
    const styles = {
      open: "bg-blue-50 text-blue-700 border-blue-100",
      past_due: "bg-rose-50 text-rose-700 border-rose-100",
      paid: "bg-emerald-50 text-emerald-700 border-emerald-100",
      void: "bg-slate-50 text-slate-600 border-slate-200"
    };
    return styles[status] || styles.open;
  };

  const getStateBadge = (state) => {
    const styles = {
      active: "bg-indigo-50 text-indigo-700 border-indigo-100",
      paused_replied: "bg-amber-50 text-amber-700 border-amber-100",
      paused_manual: "bg-amber-50 text-amber-700 border-amber-100",
      stopped_paid: "bg-emerald-50 text-emerald-700 border-emerald-100",
      stopped_manual: "bg-slate-50 text-slate-600 border-slate-200"
    };
    return styles[state] || styles.active;
  };

  const formatState = (state) => {
    const labels = {
      active: "Active",
      paused_replied: "Paused - Replied",
      paused_manual: "Paused",
      stopped_paid: "Stopped - Paid",
      stopped_manual: "Stopped"
    };
    return labels[state] || state;
  };

  const getEventIcon = (eventType) => {
    switch (eventType) {
      case 'sent':
        return <Mail className="w-4 h-4 text-blue-600" />;
      case 'replied':
        return <MessageSquare className="w-4 h-4 text-amber-600" />;
      case 'paused':
        return <Pause className="w-4 h-4 text-amber-600" />;
      case 'resumed':
        return <Play className="w-4 h-4 text-emerald-600" />;
      case 'stopped':
        return <Square className="w-4 h-4 text-slate-600" />;
      case 'manual_note':
        return <MessageSquare className="w-4 h-4 text-slate-600" />;
      default:
        return <Clock className="w-4 h-4 text-slate-400" />;
    }
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

  if (!invoice) {
    return (
      <Layout user={user}>
        <div className="text-center py-12">
          <p className="text-slate-500">Invoice not found</p>
          <Link to="/invoices">
            <Button className="mt-4">Back to Invoices</Button>
          </Link>
        </div>
      </Layout>
    );
  }

  const canPause = invoice.autopilot_state === 'active';
  const canResume = ['paused_replied', 'paused_manual'].includes(invoice.autopilot_state);
  const canStop = !['stopped_paid', 'stopped_manual'].includes(invoice.autopilot_state);
  const canMarkPaid = invoice.status !== 'paid';

  return (
    <Layout user={user}>
      <div className="space-y-6" data-testid="invoice-detail-page">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            onClick={() => navigate('/invoices')}
            className="p-2"
            data-testid="back-to-invoices-btn"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold text-slate-900">
              Invoice {invoice.stripe_invoice_id?.slice(-8).toUpperCase()}
            </h1>
            <p className="text-slate-500 mt-1">{invoice.customer?.name || 'Unknown Customer'}</p>
          </div>
          {invoice.hosted_invoice_url && (
            <a 
              href={invoice.hosted_invoice_url} 
              target="_blank" 
              rel="noopener noreferrer"
            >
              <Button variant="outline" className="btn-active" data-testid="view-stripe-invoice-btn">
                <ExternalLink className="w-4 h-4 mr-2" />
                View in Stripe
              </Button>
            </a>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Invoice Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Invoice Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div>
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Amount Due</p>
                    <p className="text-xl font-bold text-slate-900 tabular-nums tracking-tight mt-1">
                      {formatCurrency(invoice.amount_due_cents, invoice.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Due Date</p>
                    <p className="text-lg font-medium text-slate-900 mt-1 tabular-nums">
                      {formatDate(invoice.due_date, workspace?.timezone || 'America/New_York')}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Status</p>
                    <Badge className={`${getStatusBadge(invoice.status)} border mt-2`}>
                      {invoice.status?.replace('_', ' ')}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Autopilot</p>
                    <Badge className={`${getStateBadge(invoice.autopilot_state)} border mt-2`}>
                      {formatState(invoice.autopilot_state)}
                    </Badge>
                  </div>
                </div>

                {/* Customer Info */}
                {invoice.customer && (
                  <div className="mt-6 pt-6 border-t border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center">
                        <User className="w-5 h-5 text-slate-500" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">{invoice.customer.name}</p>
                        <p className="text-sm text-slate-500">{invoice.customer.email}</p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Activity Timeline */}
            <Card>
              <CardHeader>
                <CardTitle>Activity Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                {invoice.events?.length > 0 ? (
                  <div className="space-y-4">
                    {invoice.events.map((event, index) => (
                      <div key={event.event_id || index} className="flex gap-4">
                        <div className="flex-shrink-0 w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center">
                          {getEventIcon(event.event_type)}
                        </div>
                        <div className="flex-1 pb-4 border-b border-slate-100 last:border-0 last:pb-0">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-medium text-slate-900 capitalize">
                                {event.event_type?.replace('_', ' ')}
                              </p>
                              {event.subject && (
                                <p className="text-sm text-slate-600 mt-1">{event.subject}</p>
                              )}
                              {event.snippet && (
                                <p className="text-sm text-slate-500 mt-1 line-clamp-2">{event.snippet}</p>
                              )}
                            </div>
                            <span className="text-xs text-slate-400 tabular-nums">
                              {formatDateTime(event.created_at, workspace?.timezone || 'America/New_York')}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500 text-center py-8">No activity yet</p>
                )}
              </CardContent>
            </Card>

            {/* Add Note */}
            <Card>
              <CardHeader>
                <CardTitle>Add Note</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <Textarea
                    placeholder="Add a note about this invoice..."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    data-testid="add-note-textarea"
                  />
                  <Button 
                    onClick={addNote} 
                    disabled={addingNote}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white btn-active"
                    data-testid="save-note-btn"
                  >
                    {addingNote ? 'Adding...' : 'Add Note'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar Actions */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {canPause && (
                  <Button
                    onClick={() => updateInvoice({ autopilot_state: 'paused_manual' })}
                    disabled={actionLoading}
                    variant="outline"
                    className="w-full justify-start btn-active"
                    data-testid="pause-invoice-btn"
                  >
                    <Pause className="w-4 h-4 mr-2" />
                    Pause Reminders
                  </Button>
                )}
                {canResume && (
                  <Button
                    onClick={() => updateInvoice({ autopilot_state: 'active' })}
                    disabled={actionLoading}
                    variant="outline"
                    className="w-full justify-start btn-active"
                    data-testid="resume-invoice-btn"
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Resume Reminders
                  </Button>
                )}
                {canStop && (
                  <Button
                    onClick={() => updateInvoice({ autopilot_state: 'stopped_manual' })}
                    disabled={actionLoading}
                    variant="outline"
                    className="w-full justify-start btn-active"
                    data-testid="stop-invoice-btn"
                  >
                    <Square className="w-4 h-4 mr-2" />
                    Stop Sequence
                  </Button>
                )}
                {canMarkPaid && (
                  <Button
                    onClick={() => updateInvoice({ status: 'paid' })}
                    disabled={actionLoading}
                    className="w-full justify-start bg-emerald-600 hover:bg-emerald-700 text-white btn-active"
                    data-testid="mark-paid-btn"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Mark as Paid
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Quick Info */}
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Stripe Invoice ID</p>
                  <p className="text-sm text-slate-900 mt-1 font-medium">{invoice.stripe_invoice_id}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Created</p>
                  <p className="text-sm text-slate-900 mt-1">
                    {invoice.created_at ? new Date(invoice.created_at).toLocaleString() : '-'}
                  </p>
                </div>
                {invoice.last_step_sent_at && (
                  <div>
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Last Reminder</p>
                    <p className="text-sm text-slate-900 mt-1">
                      {new Date(invoice.last_step_sent_at).toLocaleString()}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}
