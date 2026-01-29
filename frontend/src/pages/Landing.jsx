import { Button } from "../components/ui/button";
import { ArrowRight, Mail, CreditCard, Clock, CheckCircle, Zap } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

export default function Landing() {
  const { signIn } = useAuth();

  const handleSignIn = async () => {
    try {
      await signIn();
    } catch (error) {
      console.error('Sign in error:', error);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50" data-testid="landing-page">
      {/* Navigation */}
      <nav className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-semibold text-slate-900 tracking-tight">Collectly</span>
          </div>
          <Button 
            onClick={handleSignIn}
            className="bg-indigo-600 hover:bg-indigo-700 text-white btn-active"
            data-testid="nav-login-btn"
          >
            Sign in with Google
          </Button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 tracking-tight leading-tight">
            Automate invoice follow-ups.
            <br />
            <span className="text-indigo-600">Get paid faster.</span>
          </h1>
          <p className="mt-6 text-lg text-slate-600 max-w-2xl mx-auto">
            Connect your Gmail and Stripe. Collectly sends polite payment reminders automatically, 
            pauses when customers reply, and stops the moment they pay.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <Button 
              onClick={handleSignIn}
              size="lg"
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-6 text-lg btn-active"
              data-testid="hero-get-started-btn"
            >
              Get Started Free <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-6 bg-white border-y border-slate-200">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-semibold text-center text-slate-900 mb-12">
            How it works
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard 
              icon={<CreditCard className="w-6 h-6" />}
              title="Connect Stripe"
              description="Import your customers and invoices automatically. We sync open and past-due invoices."
            />
            <FeatureCard 
              icon={<Mail className="w-6 h-6" />}
              title="Connect Gmail"
              description="Send reminders from your real email. Customers reply directly to you."
            />
            <FeatureCard 
              icon={<Clock className="w-6 h-6" />}
              title="Autopilot Mode"
              description="Set your reminder schedule. We send emails at the right time, automatically."
            />
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-2xl sm:text-3xl font-semibold text-slate-900 mb-6">
                Smart automation that respects your customers
              </h2>
              <ul className="space-y-4">
                <BenefitItem text="Pauses automatically when customers reply" />
                <BenefitItem text="Stops instantly when Stripe shows payment received" />
                <BenefitItem text="Rate-limited to avoid over-emailing" />
                <BenefitItem text="Weekly AR digest keeps you informed" />
              </ul>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <div className="space-y-4">
                <StatusRow label="Invoice #1234" status="Paid" type="paid" amount="$1,500.00" />
                <StatusRow label="Invoice #1235" status="Reminder sent" type="open" amount="$750.00" />
                <StatusRow label="Invoice #1236" status="Paused - Replied" type="paused" amount="$2,500.00" />
                <StatusRow label="Invoice #1237" status="Past due" type="past-due" amount="$500.00" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6 bg-slate-900">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-semibold text-white mb-6">
            Stop chasing payments manually
          </h2>
          <p className="text-slate-400 mb-8 text-lg">
            Join SaaS companies using Collectly to automate accounts receivable.
          </p>
          <Button 
            onClick={handleSignIn}
            size="lg"
            className="bg-white text-slate-900 hover:bg-slate-100 px-8 py-6 text-lg btn-active"
            data-testid="cta-get-started-btn"
          >
            Start Free <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-8 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-indigo-600 rounded-md flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="text-slate-600">Collectly</span>
          </div>
          <p className="text-sm text-slate-500">
            © {new Date().getFullYear()} Collectly. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }) {
  return (
    <div className="bg-slate-50 rounded-xl p-6 border border-slate-100">
      <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-600 mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-slate-900 mb-2">{title}</h3>
      <p className="text-slate-600">{description}</p>
    </div>
  );
}

function BenefitItem({ text }) {
  return (
    <li className="flex items-center gap-3">
      <CheckCircle className="w-5 h-5 text-emerald-500 flex-shrink-0" />
      <span className="text-slate-700">{text}</span>
    </li>
  );
}

function StatusRow({ label, status, type, amount }) {
  const statusClasses = {
    paid: "bg-emerald-50 text-emerald-700 border-emerald-100",
    open: "bg-blue-50 text-blue-700 border-blue-100",
    paused: "bg-amber-50 text-amber-700 border-amber-100",
    "past-due": "bg-rose-50 text-rose-700 border-rose-100"
  };

  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <div>
        <p className="font-medium text-slate-900 text-sm">{label}</p>
        <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium border ${statusClasses[type]}`}>
          {status}
        </span>
      </div>
      <span className="text-sm font-semibold text-slate-700 tabular-nums">{amount}</span>
    </div>
  );
}
