import requests
import sys
import json
from datetime import datetime

class CollectlyAPITester:
    def __init__(self, base_url="https://bill-collect-1.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.session_token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []

    def log_test(self, name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name} - {details}")
            self.failed_tests.append({"test": name, "details": details})

    def test_health_check(self):
        """Test if backend is accessible"""
        try:
            response = requests.get(f"{self.base_url}/", timeout=10)
            success = response.status_code in [200, 404]  # 404 is ok, means server is running
            self.log_test("Backend Health Check", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Backend Health Check", False, str(e))
            return False

    def test_auth_me_unauthenticated(self):
        """Test /api/auth/me without authentication"""
        try:
            response = requests.get(f"{self.api_url}/auth/me")
            success = response.status_code == 401
            self.log_test("Auth Me (Unauthenticated)", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Auth Me (Unauthenticated)", False, str(e))
            return False

    def test_workspaces_me_unauthenticated(self):
        """Test /api/workspaces/me without authentication"""
        try:
            response = requests.get(f"{self.api_url}/workspaces/me")
            success = response.status_code == 401
            self.log_test("Workspaces Me (Unauthenticated)", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Workspaces Me (Unauthenticated)", False, str(e))
            return False

    def test_dashboard_summary_unauthenticated(self):
        """Test /api/dashboard/summary without authentication"""
        try:
            response = requests.get(f"{self.api_url}/dashboard/summary")
            success = response.status_code == 401
            self.log_test("Dashboard Summary (Unauthenticated)", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Dashboard Summary (Unauthenticated)", False, str(e))
            return False

    def test_invoices_unauthenticated(self):
        """Test /api/invoices without authentication"""
        try:
            response = requests.get(f"{self.api_url}/invoices")
            success = response.status_code == 401
            self.log_test("Invoices (Unauthenticated)", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Invoices (Unauthenticated)", False, str(e))
            return False

    def test_stripe_status_unauthenticated(self):
        """Test Stripe integration status without authentication"""
        try:
            response = requests.get(f"{self.api_url}/integrations/stripe/status")
            success = response.status_code == 401
            self.log_test("Stripe Status (Unauthenticated)", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Stripe Status (Unauthenticated)", False, str(e))
            return False

    def test_gmail_status_unauthenticated(self):
        """Test Gmail integration status without authentication"""
        try:
            response = requests.get(f"{self.api_url}/integrations/gmail/status")
            success = response.status_code == 401
            self.log_test("Gmail Status (Unauthenticated)", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Gmail Status (Unauthenticated)", False, str(e))
            return False

    def test_reminder_policy_unauthenticated(self):
        """Test reminder policy without authentication"""
        try:
            response = requests.get(f"{self.api_url}/policies/default")
            success = response.status_code == 401
            self.log_test("Reminder Policy (Unauthenticated)", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Reminder Policy (Unauthenticated)", False, str(e))
            return False

    def test_demo_seed_unauthenticated(self):
        """Test demo data seeding without authentication"""
        try:
            response = requests.post(f"{self.api_url}/demo/seed")
            success = response.status_code == 401
            self.log_test("Demo Seed (Unauthenticated)", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Demo Seed (Unauthenticated)", False, str(e))
            return False

    def test_stripe_connect_invalid_key(self):
        """Test Stripe connection with invalid key (should fail gracefully)"""
        try:
            response = requests.post(
                f"{self.api_url}/integrations/stripe/connect",
                json={"secret_key": "invalid_key"},
                headers={"Content-Type": "application/json"}
            )
            success = response.status_code in [400, 401]  # Should reject invalid key or require auth
            self.log_test("Stripe Connect (Invalid Key)", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Stripe Connect (Invalid Key)", False, str(e))
            return False

    def test_webhook_endpoint(self):
        """Test Stripe webhook endpoint"""
        try:
            # Test with empty payload
            response = requests.post(
                f"{self.api_url}/webhooks/stripe",
                json={},
                headers={"Content-Type": "application/json"}
            )
            success = response.status_code in [200, 400]  # Should handle gracefully
            self.log_test("Stripe Webhook Endpoint", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Stripe Webhook Endpoint", False, str(e))
            return False

    def test_cors_headers(self):
        """Test CORS headers are present"""
        try:
            response = requests.options(f"{self.api_url}/auth/me")
            has_cors = 'access-control-allow-origin' in response.headers
            self.log_test("CORS Headers", has_cors, f"Headers: {dict(response.headers)}")
            return has_cors
        except Exception as e:
            self.log_test("CORS Headers", False, str(e))
            return False

    def run_all_tests(self):
        """Run all backend API tests"""
        print("🚀 Starting Collectly Backend API Tests")
        print("=" * 50)
        
        # Basic connectivity
        if not self.test_health_check():
            print("❌ Backend is not accessible. Stopping tests.")
            return False
        
        # Test authentication endpoints
        print("\n📋 Testing Authentication Endpoints:")
        self.test_auth_me_unauthenticated()
        
        # Test workspace endpoints
        print("\n🏢 Testing Workspace Endpoints:")
        self.test_workspaces_me_unauthenticated()
        
        # Test dashboard endpoints
        print("\n📊 Testing Dashboard Endpoints:")
        self.test_dashboard_summary_unauthenticated()
        
        # Test invoice endpoints
        print("\n📄 Testing Invoice Endpoints:")
        self.test_invoices_unauthenticated()
        
        # Test integration endpoints
        print("\n🔗 Testing Integration Endpoints:")
        self.test_stripe_status_unauthenticated()
        self.test_gmail_status_unauthenticated()
        
        # Test reminder policy endpoints
        print("\n⏰ Testing Reminder Policy Endpoints:")
        self.test_reminder_policy_unauthenticated()
        
        # Test demo endpoints
        print("\n🎭 Testing Demo Endpoints:")
        self.test_demo_seed_unauthenticated()
        
        # Test integration functionality
        print("\n⚙️ Testing Integration Functionality:")
        self.test_stripe_connect_invalid_key()
        self.test_webhook_endpoint()
        
        # Test CORS
        print("\n🌐 Testing CORS:")
        self.test_cors_headers()
        
        # Print summary
        print("\n" + "=" * 50)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.failed_tests:
            print("\n❌ Failed Tests:")
            for test in self.failed_tests:
                print(f"  • {test['test']}: {test['details']}")
        
        success_rate = (self.tests_passed / self.tests_run) * 100 if self.tests_run > 0 else 0
        print(f"\n✨ Success Rate: {success_rate:.1f}%")
        
        return success_rate >= 80  # Consider 80%+ success rate as passing

def main():
    """Main test runner"""
    tester = CollectlyAPITester()
    success = tester.run_all_tests()
    
    if success:
        print("\n🎉 Backend tests completed successfully!")
        return 0
    else:
        print("\n⚠️ Some backend tests failed. Check the details above.")
        return 1

if __name__ == "__main__":
    sys.exit(main())