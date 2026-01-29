import { useState, useEffect } from "react";
import Layout from "../components/Layout";
import { API } from "../App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { toast } from "sonner";
import { RefreshCw, Save, Mail, Send } from "lucide-react";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
  "UTC"
];

export default function Settings({ user }) {
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingDigest, setSendingDigest] = useState(false);

  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');

  useEffect(() => {
    fetchWorkspace();
  }, []);

  const fetchWorkspace = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/workspaces/me`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setWorkspace(data.workspace);
        setName(data.workspace?.name || '');
        setTimezone(data.workspace?.timezone || 'America/New_York');
      }
    } catch (error) {
      console.error('Error fetching workspace:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!name.trim()) {
      toast.error('Workspace name is required');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API}/workspaces/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, timezone })
      });

      if (res.ok) {
        const data = await res.json();
        setWorkspace(data.workspace);
        toast.success('Settings saved');
      } else {
        toast.error('Failed to save settings');
      }
    } catch (error) {
      toast.error('Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  const sendWeeklyDigest = async () => {
    setSendingDigest(true);
    try {
      const res = await fetch(`${API}/jobs/send-weekly-digest`, {
        method: 'POST',
        credentials: 'include'
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(`Digest sent to ${data.recipient}`);
      } else {
        const error = await res.json();
        toast.error(error.detail || 'Failed to send digest');
      }
    } catch (error) {
      toast.error('Error sending digest');
    } finally {
      setSendingDigest(false);
    }
  };

  const seedDemoData = async () => {
    try {
      const res = await fetch(`${API}/demo/seed`, {
        method: 'POST',
        credentials: 'include'
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(`Created ${data.customers_created} customers and ${data.invoices_created} invoices`);
      } else {
        toast.error('Failed to seed demo data');
      }
    } catch (error) {
      toast.error('Error seeding demo data');
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

  return (
    <Layout user={user}>
      <div className="space-y-8" data-testid="settings-page">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
          <p className="text-slate-500 mt-1">Manage your workspace settings</p>
        </div>

        {/* Workspace Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>Basic workspace information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="workspace-name">Workspace Name</Label>
                <Input
                  id="workspace-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1"
                  data-testid="workspace-name-input"
                />
                <p className="text-sm text-slate-500 mt-1">Used in reminder emails as {{company_name}}</p>
              </div>

              <div>
                <Label htmlFor="timezone">Timezone</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger className="mt-1" data-testid="timezone-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz.replace('_', ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-slate-500 mt-1">Used for scheduling reminders and digests</p>
              </div>
            </div>

            <Button 
              onClick={saveSettings} 
              disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-700 text-white btn-active"
              data-testid="save-settings-btn"
            >
              {saving ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Weekly Digest */}
        <Card>
          <CardHeader>
            <CardTitle>Weekly Digest</CardTitle>
            <CardDescription>AR summary sent every Monday at 9am</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-slate-50 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                  <Mail className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="font-medium text-slate-900">Digest Recipient</p>
                  <p className="text-sm text-slate-500">{user?.email}</p>
                </div>
              </div>
            </div>
            <Button 
              onClick={sendWeeklyDigest}
              disabled={sendingDigest}
              variant="outline"
              className="btn-active"
              data-testid="send-digest-btn"
            >
              {sendingDigest ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send Test Digest
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Demo Data */}
        <Card>
          <CardHeader>
            <CardTitle>Demo Data</CardTitle>
            <CardDescription>Generate sample data for testing</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600 mb-4">
              Create sample customers and invoices to see how Collectly works.
            </p>
            <Button 
              onClick={seedDemoData}
              variant="outline"
              className="btn-active"
              data-testid="seed-demo-data-btn"
            >
              Generate Demo Data
            </Button>
          </CardContent>
        </Card>

        {/* Account Info */}
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Your account information</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              {user?.picture && (
                <img 
                  src={user.picture} 
                  alt={user.name} 
                  className="w-12 h-12 rounded-full"
                />
              )}
              <div>
                <p className="font-medium text-slate-900">{user?.name}</p>
                <p className="text-sm text-slate-500">{user?.email}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
