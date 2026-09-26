import os
import json
import math
from datetime import datetime
from flask import Flask, Response, render_template, jsonify, request, stream_with_context
from werkzeug.exceptions import HTTPException
from database import get_db, init_db
import simulation

app = Flask(__name__)


@app.errorhandler(HTTPException)
def handle_http_error(error: HTTPException):
    """Return framework HTTP errors as JSON for API requests."""
    if request.path.startswith('/api/'):
        return jsonify({'status': 'error', 'error': error.description}), error.code
    return error

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
    """Return live positions, telemetry, and status for every bus as JSON."""
    return jsonify(_get_bus_snapshot())


def _get_bus_snapshot():
    """Read and serialize the current bus fleet, closing the DB connection."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute('''
        SELECT b.*, r.name as route_name, r.code as route_code, r.color as route_color
        FROM buses b
        LEFT JOIN routes r ON b.route_id = r.id AND r.is_active = 1
        ORDER BY b.bus_number
        ''')
        buses = [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()
    return {
        'status': 'success',
        'count': len(buses),
        'timestamp': datetime.now().isoformat(),
        'buses': buses
    }


@app.route('/api/buses/stream', methods=['GET'])
def stream_buses():
    """Stream initial and changed bus snapshots using Server-Sent Events."""
    def event_stream():
        version = simulation.get_update_version()
        try:
            initial = json.dumps(_get_bus_snapshot(), separators=(',', ':'))
            yield f'retry: 3000\nevent: buses\ndata: {initial}\n\n'
            while True:
                next_version = simulation.wait_for_update(version, timeout=15.0)
                if next_version == version:
                    yield ': keep-alive\n\n'
                    continue
                version = next_version
                payload = json.dumps(_get_bus_snapshot(), separators=(',', ':'))
                yield f'event: buses\ndata: {payload}\n\n'
        except GeneratorExit:
            # No DB connection is held while waiting or yielding; closing the
            # generator releases the request context and exits the stream.
            raise

    return Response(
        stream_with_context(event_stream()),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )

@app.route('/api/buses/<int:bus_id>/location', methods=['POST'])
def update_bus_location(bus_id):
    """
    Update a specific bus's live location and status.
    Expected JSON payload: { lat, lng, speed_mph?, heading?, status?, next_stop_name?, eta_minutes? }
    """
    if not request.is_json:
        return jsonify({'status': 'error', 'error': 'Request body must be JSON'}), 400
    data = request.get_json(silent=False)
    if not isinstance(data, dict):
        return jsonify({'status': 'error', 'error': 'JSON body must be an object'}), 400
    lat = data.get('lat')
    lng = data.get('lng')

    if lat is None or lng is None:
        return jsonify({'status': 'error', 'error': 'lat and lng are required'}), 400
    try:
        lat, lng = float(lat), float(lng)
    except (TypeError, ValueError):
        return jsonify({'status': 'error', 'error': 'lat and lng must be numbers'}), 400
    if not math.isfinite(lat) or not math.isfinite(lng) or not -90 <= lat <= 90 or not -180 <= lng <= 180:
        return jsonify({'status': 'error', 'error': 'lat or lng is outside the valid range'}), 400
    for field in ('speed_mph', 'heading', 'delay_minutes', 'eta_minutes'):
        if field in data:
            try:
                value = float(data[field])
            except (TypeError, ValueError):
                return jsonify({'status': 'error', 'error': f'{field} must be a number'}), 400
            if not math.isfinite(value):
                return jsonify({'status': 'error', 'error': f'{field} must be finite'}), 400
    for field in ('status', 'next_stop_name'):
        if field in data and data[field] is not None and not isinstance(data[field], str):
            return jsonify({'status': 'error', 'error': f'{field} must be a string'}), 400

    conn = get_db()
    cursor = conn.cursor()
    
    # Check if bus exists
    cursor.execute("SELECT * FROM buses WHERE id = ?", (bus_id,))
    bus = cursor.fetchone()
    if not bus:
        conn.close()
        return jsonify({'status': 'error', 'error': 'Bus not found'}), 404

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
    simulation.notify_bus_update()

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
    if request.method == 'POST':
        if not request.is_json:
            return jsonify({'status': 'error', 'error': 'Request body must be JSON'}), 400
        data = request.get_json(silent=False)
        if not isinstance(data, dict):
            return jsonify({'status': 'error', 'error': 'JSON body must be an object'}), 400

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
    title = data.get('title')
    message = data.get('message')
    severity = data.get('severity', 'warning')
    bus_id = data.get('bus_id')
    route_id = data.get('route_id')

    if not title or not message:
        conn.close()
        return jsonify({'status': 'error', 'error': 'Title and message are required'}), 400

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
    if cursor.rowcount == 0:
        conn.close()
        return jsonify({'status': 'error', 'error': 'Notification not found'}), 404
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
    if request.data and not request.is_json:
        return jsonify({'status': 'error', 'error': 'Request body must be JSON'}), 400
    data = request.get_json(silent=False) if request.is_json else {}
    data = data or {}
    if not isinstance(data, dict):
        return jsonify({'status': 'error', 'error': 'JSON body must be an object'}), 400
    minutes = data.get('minutes', 15)
    reason = data.get('reason', 'Campus Construction & Delivery Traffic')
    if isinstance(minutes, bool) or not isinstance(minutes, int) or minutes < 0:
        return jsonify({'status': 'error', 'error': 'minutes must be a non-negative integer'}), 400
    if not isinstance(reason, str):
        return jsonify({'status': 'error', 'error': 'reason must be a string'}), 400
    ok, message = simulation.toggle_bus_delay(bus_id, minutes, reason)
    if not ok:
        return jsonify({'status': 'error', 'error': message}), 404
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
    simulation.notify_bus_update()
    return jsonify({'status': 'success', 'message': 'Database reset to initial demo state'})

if __name__ == '__main__':
    host = os.environ.get('CAMPUS_BUS_HOST', '127.0.0.1')
    port = int(os.environ.get('CAMPUS_BUS_PORT', '5000'))
    debug = os.environ.get('CAMPUS_BUS_DEBUG', '').lower() in {'1', 'true', 'yes'}
    print("=" * 60)
    print("UniRide Campus Bus Tracker started!")
    print(f"Open http://{host}:{port} in your browser.")
    print("=" * 60)
    app.run(host=host, port=port, debug=debug)
