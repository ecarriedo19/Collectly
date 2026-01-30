import { useState, useEffect } from "react";
import Layout from "../components/Layout";
import api from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Switch } from "../components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { toast } from "sonner";
import { 
  RefreshCw, 
  Save, 
  Plus, 
  Trash2,
  GripVertical,
  Mail,
  Clock,
  ChevronDown,
  ChevronUp
} from "lucide-react";

export default function ReminderPolicy({ user }) {
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedStep, setExpandedStep] = useState(null);

  useEffect(() => {
    fetchPolicy();
  }, []);

  const fetchPolicy = async () => {
    setLoading(true);
    try {
      const data = await api.policies.getDefault();
      setPolicy(data);
    } catch (error) {
      console.error('Error fetching policy:', error);
    } finally {
      setLoading(false);
    }
  };

  const updatePolicy = async (updates) => {
    setSaving(true);
    try {
      const data = await api.policies.update(policy.policy_id, updates);
      setPolicy(data);
      toast.success('Policy updated');
    } catch (error) {
      console.error('Error updating policy:', error);
      toast.error('Error updating policy');
    } finally {
      setSaving(false);
    }
  };

  const updateStep = async (stepId, updates) => {
    try {
      await api.policies.updateStep(policy.policy_id, stepId, updates);
      fetchPolicy();
      toast.success('Step updated');
    } catch (error) {
      console.error('Error updating step:', error);
      toast.error('Error updating step');
    }
  };

  const deleteStep = async (stepId) => {
    if (!confirm('Are you sure you want to delete this step?')) return;
    
    try {
      await api.policies.deleteStep(policy.policy_id, stepId);
      fetchPolicy();
      toast.success('Step deleted');
    } catch (error) {
      console.error('Error deleting step:', error);
      toast.error('Error deleting step');
    }
  };

  const addStep = async () => {
    const newStepOrder = (policy.steps?.length || 0) + 1;
    
    try {
      await api.policies.createStep(policy.policy_id, {
        step_order: newStepOrder,
        trigger_type: 'after_due',
        trigger_offset_days: 21,
        subject_template: 'Follow-up: Invoice {{invoice_number}}',
        body_template: 'Hi {{customer_name}},\n\nThis is a follow-up regarding Invoice {{invoice_number}} for {{amount}}.\n\nPay here: {{hosted_invoice_url}}\n\n{{company_name}}\n\n{{footer}}',
        is_enabled: true
      });
      fetchPolicy();
      toast.success('Step added');
    } catch (error) {
      console.error('Error adding step:', error);
      toast.error('Error adding step');
    }
  };

  const getTriggerLabel = (type, days) => {
    if (type === 'before_due') return `${days} days before due`;
    if (type === 'on_due') return 'On due date';
    if (type === 'after_due') return `${days} days after due`;
    return type;
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

  if (!policy) {
    return (
      <Layout user={user}>
        <div className="text-center py-12">
          <p className="text-slate-500">No policy found. Create a workspace first.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout user={user}>
      <div className="space-y-8" data-testid="reminder-policy-page">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Reminder Policy</h1>
            <p className="text-slate-500 mt-1">Configure your automated reminder schedule</p>
          </div>
        </div>

        {/* Policy Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Policy Settings</CardTitle>
            <CardDescription>General settings for all reminder emails</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <Label>Enable Autopilot</Label>
                <p className="text-sm text-slate-500">Automatically send reminders</p>
              </div>
              <Switch
                checked={policy.is_enabled}
                onCheckedChange={(checked) => updatePolicy({ is_enabled: checked })}
                data-testid="enable-autopilot-switch"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="max-emails">Max Emails per Week per Customer</Label>
                <Input
                  id="max-emails"
                  type="number"
                  min={1}
                  max={10}
                  value={policy.max_emails_per_week_per_customer}
                  onChange={(e) => updatePolicy({ max_emails_per_week_per_customer: parseInt(e.target.value) })}
                  className="mt-1"
                  data-testid="max-emails-input"
                />
              </div>

              <div>
                <Label>Quiet Hours</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={policy.quiet_hours_start}
                    onChange={(e) => updatePolicy({ quiet_hours_start: parseInt(e.target.value) })}
                    className="w-20"
                    data-testid="quiet-hours-start-input"
                  />
                  <span className="text-slate-500">to</span>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={policy.quiet_hours_end}
                    onChange={(e) => updatePolicy({ quiet_hours_end: parseInt(e.target.value) })}
                    className="w-20"
                    data-testid="quiet-hours-end-input"
                  />
                  <span className="text-sm text-slate-500">(24h format)</span>
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="footer">Email Footer</Label>
              <Textarea
                id="footer"
                value={policy.email_footer_text}
                onChange={(e) => updatePolicy({ email_footer_text: e.target.value })}
                rows={2}
                className="mt-1"
                data-testid="email-footer-textarea"
              />
              <p className="text-xs text-slate-500 mt-1">Included at the bottom of all reminder emails</p>
            </div>
          </CardContent>
        </Card>

        {/* Reminder Steps */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Reminder Steps</CardTitle>
              <CardDescription>Configure when and what to send</CardDescription>
            </div>
            <Button onClick={addStep} variant="outline" className="btn-active" data-testid="add-step-btn">
              <Plus className="w-4 h-4 mr-2" />
              Add Step
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {policy.steps?.map((step, index) => (
                <div 
                  key={step.step_id} 
                  className="border border-slate-200 rounded-lg overflow-hidden"
                  data-testid={`reminder-step-${index}`}
                >
                  <div 
                    className="flex items-center gap-4 p-4 bg-slate-50 cursor-pointer"
                    onClick={() => setExpandedStep(expandedStep === step.step_id ? null : step.step_id)}
                  >
                    <GripVertical className="w-4 h-4 text-slate-400" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-slate-500" />
                        <span className="font-medium text-slate-900">Step {step.step_order}</span>
                        <span className="text-sm text-slate-500">
                          — {getTriggerLabel(step.trigger_type, step.trigger_offset_days)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={step.is_enabled}
                        onCheckedChange={(checked) => updateStep(step.step_id, { is_enabled: checked })}
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`step-${index}-enabled-switch`}
                      />
                      {expandedStep === step.step_id ? (
                        <ChevronUp className="w-5 h-5 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-slate-400" />
                      )}
                    </div>
                  </div>

                  {expandedStep === step.step_id && (
                    <div className="p-4 space-y-4 border-t border-slate-200 animate-fade-in">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label>Trigger Type</Label>
                          <Select
                            value={step.trigger_type}
                            onValueChange={(value) => updateStep(step.step_id, { trigger_type: value })}
                          >
                            <SelectTrigger className="mt-1" data-testid={`step-${index}-trigger-type`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="before_due">Before Due</SelectItem>
                              <SelectItem value="on_due">On Due Date</SelectItem>
                              <SelectItem value="after_due">After Due</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Days Offset</Label>
                          <Input
                            type="number"
                            min={0}
                            value={step.trigger_offset_days}
                            onChange={(e) => updateStep(step.step_id, { trigger_offset_days: parseInt(e.target.value) })}
                            className="mt-1"
                            disabled={step.trigger_type === 'on_due'}
                            data-testid={`step-${index}-days-offset`}
                          />
                        </div>
                      </div>

                      <div>
                        <Label>Subject Template</Label>
                        <Input
                          value={step.subject_template}
                          onChange={(e) => updateStep(step.step_id, { subject_template: e.target.value })}
                          className="mt-1 font-mono text-sm"
                          data-testid={`step-${index}-subject`}
                        />
                      </div>

                      <div>
                        <Label>Body Template</Label>
                        <Textarea
                          value={step.body_template}
                          onChange={(e) => updateStep(step.step_id, { body_template: e.target.value })}
                          rows={6}
                          className="mt-1 font-mono text-sm"
                          data-testid={`step-${index}-body`}
                        />
                      </div>

                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-xs font-medium text-slate-500 mb-2">Available Variables</p>
                        <div className="flex flex-wrap gap-2">
                          {['{{customer_name}}', '{{invoice_number}}', '{{amount}}', '{{due_date}}', '{{hosted_invoice_url}}', '{{company_name}}', '{{footer}}'].map((v) => (
                            <code key={v} className="text-xs bg-white px-2 py-1 rounded border border-slate-200">
                              {v}
                            </code>
                          ))}
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <Button 
                          variant="ghost" 
                          onClick={() => deleteStep(step.step_id)}
                          className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                          data-testid={`delete-step-${index}-btn`}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete Step
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {(!policy.steps || policy.steps.length === 0) && (
                <div className="text-center py-8 text-slate-500">
                  <p>No reminder steps configured.</p>
                  <Button onClick={addStep} className="mt-4" data-testid="add-first-step-btn">
                    <Plus className="w-4 h-4 mr-2" />
                    Add First Step
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
