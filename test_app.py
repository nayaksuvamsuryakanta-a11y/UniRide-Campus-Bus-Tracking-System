import unittest
import json
from app import app
from database import init_db

class CampusBusTestCase(unittest.TestCase):
    def setUp(self):
        # Fresh test db state
        init_db(reset=True)
        self.client = app.test_client()
        self.client.testing = True

    def test_index_page(self):
        """Test index page loads HTML with Leaflet and UI elements."""
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        html = response.data.decode('utf-8')
        self.assertIn('UniRide', html)
        self.assertIn('leaflet', html.lower())
        self.assertIn('notifications-container', html)

    def test_get_buses(self):
        """Test GET /api/buses returns active buses."""
        response = self.client.get('/api/buses')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data['status'], 'success')
        self.assertGreaterEqual(len(data['buses']), 1)
        bus1 = data['buses'][0]
        self.assertIn('current_lat', bus1)
        self.assertIn('current_lng', bus1)
        self.assertIn('bus_number', bus1)
        self.assertIn('route_name', bus1)

    def test_update_bus_location(self):
        """Test POST /api/buses/<id>/location manually updates GPS location."""
        new_loc = {
            'lat': 23.8290,
            'lng': 78.7705,
            'speed_mph': 24.5,
            'heading': 180,
            'status': 'On Time'
        }
        response = self.client.post('/api/buses/1/location',
                                   data=json.dumps(new_loc),
                                   content_type='application/json')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data['status'], 'success')
        self.assertEqual(data['lat'], 23.8290)

    def test_get_routes(self):
        """Test GET /api/routes returns route paths and stops."""
        response = self.client.get('/api/routes')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data['status'], 'success')
        self.assertGreaterEqual(len(data['routes']), 3)
        route1 = data['routes'][0]
        self.assertIn('waypoints', route1)
        self.assertIn('stops', route1)
        self.assertGreater(len(route1['waypoints']), 5)
        self.assertGreater(len(route1['stops']), 2)

    def test_get_schedules(self):
        """Test GET /api/schedules returns scheduled departures."""
        response = self.client.get('/api/schedules')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data['status'], 'success')
        self.assertGreaterEqual(len(data['schedules']), 1)
        sched = data['schedules'][0]
        self.assertIn('scheduled_time', sched)
        self.assertIn('stop_name', sched)

    def test_notifications(self):
        """Test GET and POST for notifications banner."""
        # Get existing notifications
        response = self.client.get('/api/notifications')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('notifications', data)

        # Create new notification
        new_alert = {
            'title': 'Test Weather Delay',
            'message': 'Rain causing 5 min delay on Route 2',
            'severity': 'warning',
            'route_id': 2
        }
        res_post = self.client.post('/api/notifications',
                                    data=json.dumps(new_alert),
                                    content_type='application/json')
        self.assertEqual(res_post.status_code, 201)
        post_data = json.loads(res_post.data)
        alert_id = post_data['notification_id']

        # Dismiss notification
        res_dismiss = self.client.post(f'/api/notifications/{alert_id}/dismiss')
        self.assertEqual(res_dismiss.status_code, 200)

    def test_demo_toggle_delay(self):
        """Test toggling delay on bus and verify status change."""
        # Trigger delay
        res = self.client.post('/api/demo/toggle-delay/2',
                               data=json.dumps({'minutes': 18, 'reason': 'Obstruction'}),
                               content_type='application/json')
        self.assertEqual(res.status_code, 200)

        # Check bus is delayed
        res_bus = self.client.get('/api/buses')
        buses = json.loads(res_bus.data)['buses']
        bus2 = next(b for b in buses if b['id'] == 2)
        self.assertEqual(bus2['delay_minutes'], 18)
        self.assertIn('Delayed', bus2['status'])

        # Clear delay
        res_clear = self.client.post('/api/demo/toggle-delay/2')
        self.assertEqual(res_clear.status_code, 200)
        res_bus2 = self.client.get('/api/buses')
        buses2 = json.loads(res_bus2.data)['buses']
        bus2_cleared = next(b for b in buses2 if b['id'] == 2)
        self.assertEqual(bus2_cleared['delay_minutes'], 0)
        self.assertEqual(bus2_cleared['status'], 'On Time')

if __name__ == '__main__':
    unittest.main()
