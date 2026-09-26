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
        conn.execute('DELETE FROM notifications')
        conn.execute('DELETE FROM schedules')
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
        conn.execute('UPDATE routes SET is_active = 0 WHERE id = (SELECT route_id FROM buses WHERE id = 1)')
        conn.commit()
        conn.close()

        response = self.client.get('/api/buses')
        bus = next(bus for bus in response.get_json()['buses'] if bus['id'] == 1)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(bus['route_name'])
        self.assertIsNone(bus['route_color'])

    def test_api_malformed_json_returns_json_400(self):
        """Malformed JSON request bodies use a JSON 400 response."""
        with patch.dict(os.environ, {'GPS_UPDATE_TOKEN': 'test-gps-token'}):
            response = self.client.post(
                '/api/buses/1/location', data='{', content_type='application/json',
                headers={'X-Update-Token': 'test-gps-token'},
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
        """An authenticated update at the current position is accepted."""
        bus = next(bus for bus in self.client.get('/api/buses').get_json()['buses'] if bus['id'] == 1)
        new_loc = {
            'lat': bus['current_lat'],
            'lng': bus['current_lng'],
            'speed_mph': 24.5,
            'heading': 180,
            'status': 'On Time'
        }
        with patch.dict(os.environ, {'GPS_UPDATE_TOKEN': 'test-gps-token'}):
            response = self.client.post('/api/buses/1/location',
                                       data=json.dumps(new_loc),
                                       content_type='application/json',
                                       headers={'X-Update-Token': 'test-gps-token'})
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data['status'], 'success')
        self.assertEqual(data['lat'], bus['current_lat'])

    def test_location_update_rejects_missing_or_invalid_token(self):
        with patch.dict(os.environ, {'GPS_UPDATE_TOKEN': 'test-gps-token'}):
            missing = self.client.post('/api/buses/1/location', json={'lat': 23.8268, 'lng': 78.7712})
            invalid = self.client.post('/api/buses/1/location', json={'lat': 23.8268, 'lng': 78.7712},
                                       headers={'X-Update-Token': 'wrong-token'})
        self.assertEqual(missing.status_code, 401)
        self.assertEqual(invalid.status_code, 401)

    def test_location_update_rejects_out_of_bounds_coordinates(self):
        with patch.dict(os.environ, {'GPS_UPDATE_TOKEN': 'test-gps-token'}):
            response = self.client.post('/api/buses/1/location', json={'lat': 40.0, 'lng': 78.7712},
                                        headers={'X-Update-Token': 'test-gps-token'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('Sagar', response.get_json()['error'])

    def test_demo_location_update_accepts_admin_token_and_updates_bus(self):
        bus = next(bus for bus in self.client.get('/api/buses').get_json()['buses'] if bus['id'] == 1)
        new_lat = bus['current_lat'] + 0.00001
        payload = {'lat': new_lat, 'lng': bus['current_lng'], 'speed_mph': 22.4, 'heading': 45}
        with patch.dict(os.environ, {'ADMIN_TOKEN': 'test-admin-token'}):
            response = self.client.post(
                '/api/demo/buses/1/location', json=payload,
                headers={'X-Admin-Token': 'test-admin-token'},
            )
        self.assertEqual(response.status_code, 200)
        updated_bus = next(bus for bus in self.client.get('/api/buses').get_json()['buses'] if bus['id'] == 1)
        self.assertAlmostEqual(updated_bus['current_lat'], new_lat)
        self.assertEqual(updated_bus['current_lng'], bus['current_lng'])

    def test_demo_location_update_requires_admin_token(self):
        with patch.dict(os.environ, {'ADMIN_TOKEN': 'test-admin-token'}):
            response = self.client.post('/api/demo/buses/1/location', json={'lat': 23.8268, 'lng': 78.7712})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()['status'], 'error')

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
        with patch.dict(os.environ, {'ADMIN_TOKEN': 'test-admin-token'}):
            res_post = self.client.post('/api/notifications',
                                        data=json.dumps(new_alert),
                                        content_type='application/json',
                                        headers={'X-Admin-Token': 'test-admin-token'})
        self.assertEqual(res_post.status_code, 201)
        post_data = json.loads(res_post.data)
        alert_id = post_data['notification_id']

        # Dismiss notification
        with patch.dict(os.environ, {'ADMIN_TOKEN': 'test-admin-token'}):
            res_dismiss = self.client.post(f'/api/notifications/{alert_id}/dismiss',
                                           headers={'X-Admin-Token': 'test-admin-token'})
        self.assertEqual(res_dismiss.status_code, 200)

    def test_notification_creation_requires_admin_token(self):
        with patch.dict(os.environ, {'ADMIN_TOKEN': 'test-admin-token'}):
            response = self.client.post('/api/notifications', json={
                'title': 'Unauthorized', 'message': 'Should not be stored'
            })
            created = self.client.post('/api/notifications', json={
                'title': 'Authorized', 'message': 'Used to check dismissal auth'
            }, headers={'X-Admin-Token': 'test-admin-token'})
            dismiss_response = self.client.post(
                f"/api/notifications/{created.get_json()['notification_id']}/dismiss"
            )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(dismiss_response.status_code, 401)

    def test_notification_html_is_stored_and_rendered_as_literal_text(self):
        title = '<img src=x onerror=alert(1)>'
        with patch.dict(os.environ, {'ADMIN_TOKEN': 'test-admin-token'}):
            response = self.client.post('/api/notifications', json={
                'title': title, 'message': 'Safe message'
            }, headers={'X-Admin-Token': 'test-admin-token'})
        self.assertEqual(response.status_code, 201)
        conn = get_db()
        stored_title = conn.execute(
            'SELECT title FROM notifications WHERE id = ?',
            (response.get_json()['notification_id'],)
        ).fetchone()['title']
        conn.close()
        self.assertEqual(stored_title, '&lt;img src=x onerror=alert(1)&gt;')
        with open('static/js/app.js', encoding='utf-8') as js_file:
            js = js_file.read()
        self.assertIn('escapeNotificationText(title)', js)
        self.assertIn('escapeNotificationText(message)', js)

    def test_notification_rejects_nonexistent_bus_id(self):
        with patch.dict(os.environ, {'ADMIN_TOKEN': 'test-admin-token'}):
            response = self.client.post('/api/notifications', json={
                'title': 'Invalid bus', 'message': 'Must be rejected', 'bus_id': 999999
            }, headers={'X-Admin-Token': 'test-admin-token'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('bus_id', response.get_json()['error'])

    def test_simulated_speed_matches_distance_for_five_ticks(self):
        bus_id = 1
        for _ in range(5):
            before = next(bus for bus in self.client.get('/api/buses').get_json()['buses'] if bus['id'] == bus_id)
            simulation.step_simulation_once()
            after = next(bus for bus in self.client.get('/api/buses').get_json()['buses'] if bus['id'] == bus_id)
            distance_miles = simulation._distance_miles(
                before['current_lat'], before['current_lng'],
                after['current_lat'], after['current_lng']
            )
            expected_speed = round(distance_miles / simulation._sim_interval_seconds * 3600, 1)
            self.assertEqual(after['speed_mph'], expected_speed)

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

    def test_demo_step_requires_admin_token(self):
        with patch.dict(os.environ, {'ADMIN_TOKEN': 'test-admin-token'}):
            missing = self.client.post('/api/demo/step')
            invalid = self.client.post('/api/demo/step', headers={'X-Admin-Token': 'wrong-token'})
        self.assertEqual(missing.status_code, 401)
        self.assertEqual(invalid.status_code, 401)

    def test_demo_step_accepts_admin_token(self):
        with patch.dict(os.environ, {'ADMIN_TOKEN': 'test-admin-token'}):
            with patch('app.simulation.step_simulation_once') as step:
                response = self.client.post('/api/demo/step', headers={'X-Admin-Token': 'test-admin-token'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['status'], 'success')
        step.assert_called_once_with()

    def test_demo_toggle_simulation_requires_admin_token(self):
        with patch.dict(os.environ, {'ADMIN_TOKEN': 'test-admin-token'}):
            missing = self.client.post('/api/demo/toggle-simulation')
            invalid = self.client.post('/api/demo/toggle-simulation', headers={'X-Admin-Token': 'wrong-token'})
        self.assertEqual(missing.status_code, 401)
        self.assertEqual(invalid.status_code, 401)

    def test_demo_toggle_simulation_accepts_admin_token(self):
        with patch.dict(os.environ, {'ADMIN_TOKEN': 'test-admin-token'}):
            response = self.client.post('/api/demo/toggle-simulation',
                                        headers={'X-Admin-Token': 'test-admin-token'})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()['running'])
        simulation.pause_simulation()

    def test_demo_reset_requires_admin_token(self):
        with patch.dict(os.environ, {'ADMIN_TOKEN': 'test-admin-token'}):
            missing = self.client.post('/api/demo/reset')
            invalid = self.client.post('/api/demo/reset', headers={'X-Admin-Token': 'wrong-token'})
        self.assertEqual(missing.status_code, 401)
        self.assertEqual(invalid.status_code, 401)

    def test_demo_reset_accepts_admin_token_and_restores_seed_data(self):
        conn = get_db()
        conn.execute('UPDATE buses SET current_lat = 0, current_lng = 0 WHERE id = 1')
        conn.commit()
        conn.close()
        with patch.dict(os.environ, {'ADMIN_TOKEN': 'test-admin-token'}):
            response = self.client.post('/api/demo/reset', headers={'X-Admin-Token': 'test-admin-token'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['status'], 'success')
        bus = next(bus for bus in self.client.get('/api/buses').get_json()['buses'] if bus['id'] == 1)
        self.assertAlmostEqual(bus['current_lat'], 23.834)
        self.assertAlmostEqual(bus['current_lng'], 78.7675)

    def test_demo_simulation_status_only_exposes_running_state(self):
        response = self.client.get('/api/demo/simulation-status')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.get_json()), {'running'})

if __name__ == '__main__':
    unittest.main()
