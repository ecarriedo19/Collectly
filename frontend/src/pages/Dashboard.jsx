import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout";
import { API } from "../App";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { 
  DollarSign, 
  AlertTriangle, 
  CheckCircle, 
  Pause,
  ArrowRight,
  RefreshCw,
  ExternalLink
} from "lucide-react";

export default function Dashboard({ user }) {
  const [summary, setSummary] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch workspace
      const wsRes = await fetch(`${API}/workspaces/me`, { credentials: 'include' });
      if (wsRes.ok) {
        const wsData = await wsRes.json();
        setWorkspace(wsData.workspace);
      }

      // Fetch summary
      const summaryRes = await fetch(`${API}/dashboard/summary`, { credentials: 'include' });
      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        setSummary(summaryData);
      }

      // Fetch recent invoices
      const invRes = await fetch(`${API}/invoices?limit=10`, { credentials: 'include' });
      if (invRes.ok) {
        const invData = await invRes.json();
        setInvoices(invData.invoices);
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
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
      <div className="space-y-8" data-testid="dashboard-page">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
            <p className="text-slate-500 mt-1">{workspace?.name || 'Your workspace'}</p>
          </div>
          <Button 
            onClick={fetchData} 
            variant="outline" 
            className="btn-active"
            data-testid="refresh-dashboard-btn"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Metrics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard
            title="Total Open"
            value={formatCurrency(summary?.total_open_amount || 0, summary?.currency)}
            subtitle={`${summary?.total_open || 0} invoices`}
            icon={<DollarSign className="w-5 h-5" />}
            iconBg="bg-blue-100 text-blue-600"
          />
          <MetricCard
            title="Past Due"
            value={formatCurrency(summary?.total_past_due_amount || 0, summary?.currency)}
            subtitle={`${summary?.total_past_due || 0} invoices`}
            icon={<AlertTriangle className="w-5 h-5" />}
            iconBg="bg-rose-100 text-rose-600"
          />
          <MetricCard
            title="Paid This Month"
            value={formatCurrency(summary?.paid_this_month_amount || 0, summary?.currency)}
            subtitle={`${summary?.paid_this_month || 0} invoices`}
            icon={<CheckCircle className="w-5 h-5" />}
            iconBg="bg-emerald-100 text-emerald-600"
          />
          <MetricCard
            title="Paused"
            value={summary?.invoices_paused || 0}
            subtitle="invoices paused"
            icon={<Pause className="w-5 h-5" />}
            iconBg="bg-amber-100 text-amber-600"
          />
        </div>

        {/* Recent Invoices */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg font-semibold">Recent Invoices</CardTitle>
            <Link to="/invoices">
              <Button variant="ghost" className="text-indigo-600 hover:text-indigo-700" data-testid="view-all-invoices-btn">
                View all <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {invoices.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-slate-500">No invoices yet.</p>
                <Link to="/integrations">
                  <Button className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white btn-active" data-testid="connect-stripe-cta">
                    Connect Stripe to import invoices
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full" data-testid="invoices-table">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Invoice</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Customer</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Amount</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Due Date</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Autopilot</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => (
                      <tr key={invoice.invoice_id} className="border-b border-slate-100 table-row-hover">
                        <td className="py-3 px-4">
                          <span className="font-mono text-sm text-slate-900">
                            {invoice.stripe_invoice_id?.slice(-8).toUpperCase()}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div>
                            <p className="text-sm font-medium text-slate-900">{invoice.customer?.name || 'Unknown'}</p>
                            <p className="text-xs text-slate-500">{invoice.customer?.email}</p>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-mono text-sm text-slate-900">
                            {formatCurrency(invoice.amount_due_cents, invoice.currency)}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-sm text-slate-700">
                            {invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : '-'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <Badge className={`${getStatusBadge(invoice.status)} border`}>
                            {invoice.status?.replace('_', ' ')}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <Badge className={`${getStateBadge(invoice.autopilot_state)} border`}>
                            {formatState(invoice.autopilot_state)}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Link to={`/invoices/${invoice.invoice_id}`}>
                            <Button variant="ghost" size="sm" data-testid={`view-invoice-${invoice.invoice_id}`}>
                              <ExternalLink className="w-4 h-4" />
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

function MetricCard({ title, value, subtitle, icon, iconBg }) {
  return (
    <Card className="card-hover">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">{title}</p>
            <p className="text-2xl font-semibold text-slate-900 mt-2 font-mono tabular-nums">{value}</p>
            <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
          </div>
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${iconBg}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
