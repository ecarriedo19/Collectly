import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import { API } from "../App";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { formatDate, getDaysDiff } from "../utils/dateUtils";
import { 
  Search, 
  RefreshCw, 
  ExternalLink,
  Filter,
  X
} from "lucide-react";

export default function Invoices({ user }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [workspace, setWorkspace] = useState(null);
  
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'all');
  const [stateFilter, setStateFilter] = useState(searchParams.get('state') || 'all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchWorkspace();
  }, []);

  useEffect(() => {
    fetchInvoices();
  }, [statusFilter, stateFilter]);

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

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter);
      if (stateFilter && stateFilter !== 'all') params.set('autopilot_state', stateFilter);
      params.set('limit', '50');

      const res = await fetch(`${API}/invoices?${params.toString()}`, { 
        credentials: 'include' 
      });
      
      if (res.ok) {
        const data = await res.json();
        setInvoices(data.invoices);
        setTotal(data.total);
      }
    } catch (error) {
      console.error('Error fetching invoices:', error);
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
      void: "bg-slate-50 text-slate-600 border-slate-200",
      draft: "bg-slate-50 text-slate-600 border-slate-200",
      uncollectible: "bg-slate-50 text-slate-600 border-slate-200"
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

  const timezone = workspace?.timezone || 'America/New_York';

  const formatPaidInfo = (invoice) => {
    // If paid, show when it was paid or days to pay
    if (invoice.updated_at && invoice.due_date) {
      const daysDiff = getDaysDiff(invoice.due_date, invoice.updated_at);
      if (daysDiff <= 0) {
        return { text: `${Math.abs(daysDiff)} days early`, color: 'text-emerald-600' };
      } else {
        return { text: `${daysDiff} days late`, color: 'text-slate-500' };
      }
    }
    return { text: formatDate(invoice.updated_at, timezone), color: 'text-slate-500' };
    }
    return { text: '-', color: 'text-slate-400' };
  };

  const clearFilters = () => {
    setStatusFilter('all');
    setStateFilter('all');
    setSearchQuery('');
    setSearchParams({});
  };

  const filteredInvoices = invoices.filter(inv => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      inv.stripe_invoice_id?.toLowerCase().includes(query) ||
      inv.customer?.name?.toLowerCase().includes(query) ||
      inv.customer?.email?.toLowerCase().includes(query)
    );
  });

  const hasFilters = (statusFilter && statusFilter !== 'all') || (stateFilter && stateFilter !== 'all') || searchQuery;

  return (
    <Layout user={user}>
      <div className="space-y-6" data-testid="invoices-page">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Invoices</h1>
            <p className="text-slate-500 mt-1">{total} total invoices</p>
          </div>
          <Button 
            onClick={fetchInvoices} 
            variant="outline" 
            className="btn-active"
            data-testid="refresh-invoices-btn"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search invoices..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                  data-testid="search-invoices-input"
                />
              </div>
              
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px]" data-testid="status-filter">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="past_due">Past Due</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="void">Void</SelectItem>
                </SelectContent>
              </Select>

              <Select value={stateFilter} onValueChange={setStateFilter}>
                <SelectTrigger className="w-[180px]" data-testid="state-filter">
                  <SelectValue placeholder="All states" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All states</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused_replied">Paused - Replied</SelectItem>
                  <SelectItem value="paused_manual">Paused - Manual</SelectItem>
                  <SelectItem value="stopped_paid">Stopped - Paid</SelectItem>
                  <SelectItem value="stopped_manual">Stopped - Manual</SelectItem>
                </SelectContent>
              </Select>

              {hasFilters && (
                <Button 
                  variant="ghost" 
                  onClick={clearFilters}
                  className="text-slate-500"
                  data-testid="clear-filters-btn"
                >
                  <X className="w-4 h-4 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Invoice Table */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : filteredInvoices.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-slate-500">No invoices found.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full" data-testid="invoices-table">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Invoice</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Customer</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Amount</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Due Date</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Timeline</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Autopilot</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInvoices.map((invoice) => {
                      const daysOverdue = getDaysOverdue(invoice.due_date);
                      const isPaid = invoice.status === 'paid';
                      const paidInfo = isPaid ? formatPaidInfo(invoice) : null;
                      
                      return (
                        <tr key={invoice.invoice_id} className="border-b border-slate-100 table-row-hover">
                          <td className="py-3 px-4">
                            <span className="text-sm font-semibold text-slate-900 tabular-nums">
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
                            <span className="text-sm font-semibold text-slate-900 tabular-nums">
                              {formatCurrency(invoice.amount_due_cents, invoice.currency)}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-sm text-slate-700">
                              {invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : '-'}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {isPaid ? (
                              <span className={`text-sm font-medium ${paidInfo.color}`}>
                                {paidInfo.text}
                              </span>
                            ) : daysOverdue !== null && daysOverdue > 0 ? (
                              <span className="text-sm font-medium text-rose-600">
                                {daysOverdue} days late
                              </span>
                            ) : daysOverdue !== null && daysOverdue < 0 ? (
                              <span className="text-sm text-slate-500">
                                Due in {Math.abs(daysOverdue)} days
                              </span>
                            ) : daysOverdue === 0 ? (
                              <span className="text-sm font-medium text-amber-600">
                                Due today
                              </span>
                            ) : (
                              <span className="text-sm text-slate-400">-</span>
                            )}
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
                      );
                    })}
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
