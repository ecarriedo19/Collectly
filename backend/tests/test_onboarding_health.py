"""
Test suite for Onboarding and Health API endpoints
Tests: /api/onboarding/*, /api/health/status, /api/jobs/run-scheduler
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestHealthEndpoints:
    """Health and system status endpoint tests"""
    
    def test_health_status_requires_auth(self):
        """Health status endpoint should require authentication"""
        response = requests.get(f"{BASE_URL}/api/health/status")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("PASS: /api/health/status requires authentication")
    
    def test_jobs_run_scheduler_requires_auth(self):
        """Jobs run-scheduler endpoint should require authentication"""
        response = requests.post(f"{BASE_URL}/api/jobs/run-scheduler")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("PASS: /api/jobs/run-scheduler requires authentication")


class TestOnboardingEndpoints:
    """Onboarding API endpoint tests"""
    
    def test_onboarding_status_requires_auth(self):
        """Onboarding status endpoint should require authentication"""
        response = requests.get(f"{BASE_URL}/api/onboarding/status")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("PASS: /api/onboarding/status requires authentication")
    
    def test_onboarding_import_preview_requires_auth(self):
        """Import preview endpoint should require authentication"""
        response = requests.get(f"{BASE_URL}/api/onboarding/import-preview")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("PASS: /api/onboarding/import-preview requires authentication")
    
    def test_onboarding_complete_requires_auth(self):
        """Complete onboarding endpoint should require authentication"""
        response = requests.post(f"{BASE_URL}/api/onboarding/complete")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("PASS: /api/onboarding/complete requires authentication")
    
    def test_onboarding_send_test_email_requires_auth(self):
        """Send test email endpoint should require authentication"""
        response = requests.post(f"{BASE_URL}/api/onboarding/send-test-email")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("PASS: /api/onboarding/send-test-email requires authentication")
    
    def test_onboarding_scheduled_preview_requires_auth(self):
        """Scheduled preview endpoint should require authentication"""
        response = requests.get(f"{BASE_URL}/api/onboarding/scheduled-preview")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("PASS: /api/onboarding/scheduled-preview requires authentication")


class TestIntegrationEndpoints:
    """Integration status endpoint tests"""
    
    def test_stripe_status_requires_auth(self):
        """Stripe status endpoint should require authentication"""
        response = requests.get(f"{BASE_URL}/api/integrations/stripe/status")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("PASS: /api/integrations/stripe/status requires authentication")
    
    def test_gmail_status_requires_auth(self):
        """Gmail status endpoint should require authentication"""
        response = requests.get(f"{BASE_URL}/api/integrations/gmail/status")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("PASS: /api/integrations/gmail/status requires authentication")


class TestDashboardEndpoints:
    """Dashboard endpoint tests"""
    
    def test_dashboard_summary_requires_auth(self):
        """Dashboard summary endpoint should require authentication"""
        response = requests.get(f"{BASE_URL}/api/dashboard/summary")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("PASS: /api/dashboard/summary requires authentication")


class TestPublicEndpoints:
    """Public endpoint tests (no auth required)"""
    
    def test_stripe_webhook_accessible(self):
        """Stripe webhook endpoint should be accessible (returns 400 for invalid payload)"""
        response = requests.post(
            f"{BASE_URL}/api/webhooks/stripe",
            json={"type": "test"},
            headers={"Content-Type": "application/json"}
        )
        # Webhook should be accessible but may return 400 for invalid signature
        assert response.status_code in [200, 400], f"Expected 200 or 400, got {response.status_code}"
        print(f"PASS: /api/webhooks/stripe is accessible (status: {response.status_code})")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
