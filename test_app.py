import unittest
import json
import os
from unittest.mock import patch
from app import app
from database import get_db, init_db
import simulation

class CampusBusTestCase(unittest.TestCase):
    def setUp(self):
        # Fresh test db state
        simulation.pause_simulation()
        init_db(reset=True)
        self.client = app.test_client()
        self.client.testing = True

    def tearDown(self):
        simulation.resume_simulation()

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

    def test_get_buses_empty_list(self):
        """An empty fleet returns a successful JSON response with count zero."""
        conn = get_db()
        conn.execute('DELETE FROM buses')
        conn.commit()
        conn.close()

        response = self.client.get('/api/buses')
        data = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(data['count'], 0)
        self.assertEqual(data['buses'], [])

    def test_get_buses_with_inactive_or_missing_route(self):
        """A bus remains serializable when its route is inactive or missing."""
        conn = get_db()
        conn.execute('UPDATE buses SET route_id = -1 WHERE id = 1')
        conn.commit()
        conn.close()

        response = self.client.get('/api/buses')
        bus = next(bus for bus in response.get_json()['buses'] if bus['id'] == 1)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(bus['route_name'])
        self.assertIsNone(bus['route_color'])

    def test_api_malformed_json_returns_json_400(self):
        """Malformed JSON request bodies use a JSON 400 response."""
        response = self.client.post(
            '/api/buses/1/location', data='{', content_type='application/json'
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.mimetype, 'application/json')
        self.assertEqual(response.get_json()['status'], 'error')

    def test_buses_endpoint_works_before_simulation_starts(self):
        """Reading buses does not depend on the background worker being started."""
        response = self.client.get('/api/buses')
        self.assertEqual(response.status_code, 200)
        self.assertGreater(response.get_json()['count'], 0)

    def test_unknown_api_path_returns_json_404(self):
        response = self.client.get('/api/not-a-route')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.mimetype, 'application/json')

    def test_bus_stream_sends_snapshots_and_closes(self):
        """The SSE endpoint sends an initial snapshot and later updates."""
        response = self.client.get('/api/buses/stream', buffered=False)
        try:
            initial = next(response.response).decode('utf-8')
            self.assertIn('event: buses', initial)
            self.assertIn('"buses"', initial)
            initial_notifications = next(response.response).decode('utf-8')
            self.assertIn('event: notifications', initial_notifications)
            self.assertIn('"notifications"', initial_notifications)

            simulation.notify_bus_update()
            update = next(response.response).decode('utf-8')
            self.assertIn('event: buses', update)
            self.assertIn('"timestamp"', update)
            notification_update = next(response.response).decode('utf-8')
            self.assertIn('event: notifications', notification_update)
        finally:
            response.close()

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
        with patch.dict(os.environ, {'ADMIN_TOKEN': 'test-admin-token'}):
            self._test_demo_toggle_delay_with_token()

    def _test_demo_toggle_delay_with_token(self):
        # Trigger delay
        res = self.client.post('/api/demo/toggle-delay/2',
                               data=json.dumps({'minutes': 18, 'reason': 'Obstruction'}),
                               content_type='application/json',
                               headers={'X-Admin-Token': 'test-admin-token'})
        self.assertEqual(res.status_code, 200)

        # Check bus is delayed
        res_bus = self.client.get('/api/buses')
        buses = json.loads(res_bus.data)['buses']
        bus2 = next(b for b in buses if b['id'] == 2)
        self.assertEqual(bus2['delay_minutes'], 18)
        self.assertIn('Delayed', bus2['status'])

        # Clear delay
        res_clear = self.client.post(
            '/api/demo/toggle-delay/2',
            headers={'X-Admin-Token': 'test-admin-token'},
        )
        self.assertEqual(res_clear.status_code, 200)
        res_bus2 = self.client.get('/api/buses')
        buses2 = json.loads(res_bus2.data)['buses']
        bus2_cleared = next(b for b in buses2 if b['id'] == 2)
        self.assertEqual(bus2_cleared['delay_minutes'], 0)
        self.assertEqual(bus2_cleared['status'], 'On Time')

    def test_demo_toggle_delay_requires_admin_token(self):
        with patch.dict(os.environ, {'ADMIN_TOKEN': 'test-admin-token'}):
            response = self.client.post('/api/demo/toggle-delay/2')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()['status'], 'error')

if __name__ == '__main__':
    unittest.main()
