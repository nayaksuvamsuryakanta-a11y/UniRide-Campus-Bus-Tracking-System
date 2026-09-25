import os
import json
from datetime import datetime
from flask import Flask, render_template, jsonify, request
from database import get_db, init_db
import simulation

app = Flask(__name__)

# Ensure DB is initialized
init_db(reset=False)

# Start background bus simulation thread
simulation.start_simulation()

@app.route('/')
def index():
    """Render the main campus bus tracker dashboard."""
    return render_template('index.html')

@app.route('/api/buses', methods=['GET'])
def get_buses():
    """Return live positions, telemetry, and status for all active buses."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
    SELECT b.*, r.name as route_name, r.code as route_code, r.color as route_color
    FROM buses b
    JOIN routes r ON b.route_id = r.id
    ORDER BY b.bus_number
    ''')
    buses = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({
        'status': 'success',
        'count': len(buses),
        'timestamp': datetime.now().isoformat(),
        'buses': buses
    })

@app.route('/api/buses/<int:bus_id>/location', methods=['POST'])
def update_bus_location(bus_id):
    """
    Update a specific bus's live location and status.
    Expected JSON payload: { lat, lng, speed_mph?, heading?, status?, next_stop_name?, eta_minutes? }
    """
    data = request.get_json(silent=True) or {}
    lat = data.get('lat')
    lng = data.get('lng')

    if lat is None or lng is None:
        return jsonify({'error': 'lat and lng are required'}), 400

    conn = get_db()
    cursor = conn.cursor()
    
    # Check if bus exists
    cursor.execute("SELECT * FROM buses WHERE id = ?", (bus_id,))
    bus = cursor.fetchone()
    if not bus:
        conn.close()
        return jsonify({'error': 'Bus not found'}), 404

    now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    speed = data.get('speed_mph', bus['speed_mph'])
    heading = data.get('heading', bus['heading'])
    status = data.get('status', bus['status'])
    delay_minutes = data.get('delay_minutes', bus['delay_minutes'])
    next_stop_name = data.get('next_stop_name', bus['next_stop_name'])
    eta_minutes = data.get('eta_minutes', bus['eta_minutes'])

    cursor.execute('''
    UPDATE buses
    SET current_lat = ?, current_lng = ?, speed_mph = ?, heading = ?,
        status = ?, delay_minutes = ?, next_stop_name = ?, eta_minutes = ?, updated_at = ?
    WHERE id = ?
    ''', (lat, lng, speed, heading, status, delay_minutes, next_stop_name, eta_minutes, now_str, bus_id))
    conn.commit()
    conn.close()

    return jsonify({
        'status': 'success',
        'message': f'Location updated for bus {bus_id}',
        'bus_id': bus_id,
        'lat': lat,
        'lng': lng,
        'updated_at': now_str
    })

@app.route('/api/routes', methods=['GET'])
def get_routes():
    """Return all routes with stops and full waypoints path for Leaflet polylines."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('SELECT * FROM routes WHERE is_active = 1')
    routes_rows = cursor.fetchall()

    routes = []
    for r in routes_rows:
        r_dict = dict(r)
        r_dict['waypoints'] = json.loads(r_dict.pop('waypoints_json'))

        # Fetch stops for this route
        cursor.execute('''
        SELECT id, name, stop_order, lat, lng
        FROM stops
        WHERE route_id = ?
        ORDER BY stop_order
        ''', (r['id'],))
        r_dict['stops'] = [dict(s) for s in cursor.fetchall()]

        routes.append(r_dict)

    conn.close()
    return jsonify({
        'status': 'success',
        'routes': routes
    })

@app.route('/api/schedules', methods=['GET'])
def get_schedules():
    """Return timetables and schedules. Can be filtered by route_id."""
    route_id = request.args.get('route_id')

    conn = get_db()
    cursor = conn.cursor()

    query = '''
    SELECT s.*, r.name as route_name, r.code as route_code, r.color as route_color,
           b.bus_number, b.driver_name
    FROM schedules s
    JOIN routes r ON s.route_id = r.id
    LEFT JOIN buses b ON s.bus_id = b.id
    '''
    params = []
    if route_id:
        query += ' WHERE s.route_id = ?'
        params.append(route_id)

    query += ' ORDER BY s.route_id, s.id'

    cursor.execute(query, params)
    schedules = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return jsonify({
        'status': 'success',
        'count': len(schedules),
        'schedules': schedules
    })

@app.route('/api/notifications', methods=['GET', 'POST'])
def handle_notifications():
    """GET active delay & alert notifications, or POST a new notification."""
    conn = get_db()
    cursor = conn.cursor()

    if request.method == 'GET':
        cursor.execute('''
        SELECT n.*, b.bus_number, r.name as route_name, r.color as route_color
        FROM notifications n
        LEFT JOIN buses b ON n.bus_id = b.id
        LEFT JOIN routes r ON n.route_id = r.id
        WHERE n.is_active = 1
        ORDER BY n.id DESC
        ''')
        notifications = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({
            'status': 'success',
            'notifications': notifications
        })

    # POST: Create a notification
    data = request.get_json(silent=True) or {}
    title = data.get('title')
    message = data.get('message')
    severity = data.get('severity', 'warning')
    bus_id = data.get('bus_id')
    route_id = data.get('route_id')

    if not title or not message:
        conn.close()
        return jsonify({'error': 'Title and message are required'}), 400

    now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    cursor.execute('''
    INSERT INTO notifications (bus_id, route_id, title, message, severity, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
    ''', (bus_id, route_id, title, message, severity, now_str))
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()

    return jsonify({
        'status': 'success',
        'notification_id': new_id,
        'message': 'Notification created'
    }), 201

@app.route('/api/notifications/<int:alert_id>/dismiss', methods=['POST'])
def dismiss_notification(alert_id):
    """Dismiss/resolve an alert notification."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('UPDATE notifications SET is_active = 0 WHERE id = ?', (alert_id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success', 'message': f'Notification {alert_id} dismissed'})

# Demo helper endpoints for the 5-10 minute presentation
@app.route('/api/demo/step', methods=['POST'])
def demo_step():
    """Manually step all buses forward along their routes."""
    simulation.step_simulation_once()
    return jsonify({'status': 'success', 'message': 'Simulated 1 step movement'})

@app.route('/api/demo/toggle-delay/<int:bus_id>', methods=['POST'])
def demo_toggle_delay(bus_id):
    """Toggle delay status on a bus and emit notification."""
    data = request.get_json(silent=True) or {}
    minutes = data.get('minutes', 15)
    reason = data.get('reason', 'Campus Construction & Delivery Traffic')
    ok, message = simulation.toggle_bus_delay(bus_id, minutes, reason)
    if not ok:
        return jsonify({'error': message}), 404
    return jsonify({'status': 'success', 'message': message})

@app.route('/api/demo/toggle-simulation', methods=['POST'])
def demo_toggle_simulation():
    """Toggle live automatic background simulation."""
    if simulation.is_simulation_running():
        simulation.pause_simulation()
        state = False
    else:
        simulation.resume_simulation()
        state = True
    return jsonify({'status': 'success', 'running': state})

@app.route('/api/demo/simulation-status', methods=['GET'])
def demo_simulation_status():
    """Get current running status of background simulation."""
    return jsonify({'running': simulation.is_simulation_running()})

@app.route('/api/demo/reset', methods=['POST'])
def demo_reset():
    """Reset database to initial seed state."""
    init_db(reset=True)
    return jsonify({'status': 'success', 'message': 'Database reset to initial demo state'})

if __name__ == '__main__':
    print("=" * 60)
    print("UniRide Campus Bus Tracker started!")
    print("Open http://127.0.0.1:5000 in your browser.")
    print("=" * 60)
    app.run(host='127.0.0.1', port=5000, debug=True)
