import time
import json
import random
import threading
from datetime import datetime
from database import get_db, calculate_bearing

# Global simulation state
_sim_thread = None
_sim_running = True
_sim_lock = threading.Lock()
_sim_interval_seconds = 3.0

def step_simulation_once():
    """Advance all active buses to the next waypoint along their routes."""
    with _sim_lock:
        conn = get_db()
        cursor = conn.cursor()

        # Get routes waypoints
        cursor.execute("SELECT id, waypoints_json FROM routes")
        routes_dict = {row['id']: json.loads(row['waypoints_json']) for row in cursor.fetchall()}

        # Get stops for each route to find upcoming stops
        cursor.execute("SELECT id, route_id, name, lat, lng, stop_order FROM stops ORDER BY route_id, stop_order")
        stops_by_route = {}
        for s in cursor.fetchall():
            stops_by_route.setdefault(s['route_id'], []).append(dict(s))

        # Get all buses
        cursor.execute("SELECT * FROM buses")
        buses = cursor.fetchall()

        now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        for bus in buses:
            route_id = bus['route_id']
            waypoints = routes_dict.get(route_id)
            if not waypoints or len(waypoints) < 2:
                continue

            current_idx = bus['waypoint_index'] or 0
            next_idx = (current_idx + 1) % len(waypoints)
            new_lat, new_lng = waypoints[next_idx]

            # Look ahead for heading
            future_idx = (next_idx + 1) % len(waypoints)
            fut_lat, fut_lng = waypoints[future_idx]
            heading = calculate_bearing(new_lat, new_lng, fut_lat, fut_lng)

            # Speed variation (if delayed in traffic, lower speed)
            if bus['delay_minutes'] > 0:
                speed = round(random.uniform(7.0, 14.0), 1)
            else:
                speed = round(random.uniform(16.0, 24.0), 1)

            # Determine closest upcoming stop
            stops = stops_by_route.get(route_id, [])
            next_stop_name = bus['next_stop_name']
            eta_mins = bus['eta_minutes']

            if stops:
                # Find stop with minimum positive distance along route, or cyclical
                # Approximate distance to each stop from current coords
                closest_stop = None
                min_dist = float('inf')
                for st in stops:
                    d = (st['lat'] - new_lat) ** 2 + (st['lng'] - new_lng) ** 2
                    if d < min_dist:
                        min_dist = d
                        closest_stop = st

                if closest_stop:
                    # If very close, bus is arriving!
                    if min_dist < 0.00003:
                        next_stop_name = closest_stop['name']
                        eta_mins = 1
                    else:
                        next_stop_name = closest_stop['name']
                        # Calculate rough ETA: 1 to 5 mins plus delay
                        base_eta = max(1, int((min_dist ** 0.5) * 600))
                        eta_mins = min(base_eta + (bus['delay_minutes'] // 2), 15)

            cursor.execute('''
            UPDATE buses
            SET current_lat = ?,
                current_lng = ?,
                waypoint_index = ?,
                heading = ?,
                speed_mph = ?,
                next_stop_name = ?,
                eta_minutes = ?,
                updated_at = ?
            WHERE id = ?
            ''', (new_lat, new_lng, next_idx, heading, speed, next_stop_name, eta_mins, now_str, bus['id']))

        conn.commit()
        conn.close()

def _simulation_worker():
    """Background worker continuously stepping the simulation."""
    global _sim_running
    while True:
        if _sim_running:
            try:
                step_simulation_once()
            except Exception as e:
                print(f"[Sim Error] {e}")
        time.sleep(_sim_interval_seconds)

def start_simulation():
    """Start the background simulation thread if not already running."""
    global _sim_thread, _sim_running
    _sim_running = True
    if _sim_thread is None or not _sim_thread.is_alive():
        _sim_thread = threading.Thread(target=_simulation_worker, daemon=True)
        _sim_thread.start()

def pause_simulation():
    """Pause the background simulation thread."""
    global _sim_running
    _sim_running = False

def resume_simulation():
    """Resume the background simulation."""
    global _sim_running
    _sim_running = True

def is_simulation_running():
    global _sim_running
    return _sim_running

def toggle_bus_delay(bus_id, delay_minutes=15, reason="Heavy traffic near Main Gate"):
    """Trigger or clear a delay for a specific bus."""
    with _sim_lock:
        conn = get_db()
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM buses WHERE id = ?", (bus_id,))
        bus = cursor.fetchone()
        if not bus:
            conn.close()
            return False, "Bus not found"

        now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        if bus['delay_minutes'] > 0:
            # Clear delay
            cursor.execute('''
            UPDATE buses
            SET status = 'On Time', delay_minutes = 0, updated_at = ?
            WHERE id = ?
            ''', (now_str, bus_id))

            # Mark associated notifications as inactive
            cursor.execute('''
            UPDATE notifications
            SET is_active = 0
            WHERE bus_id = ?
            ''', (bus_id,))

            # Update schedule status for this bus
            cursor.execute('''
            UPDATE schedules
            SET status = 'On Time'
            WHERE bus_id = ? AND status LIKE 'Delayed%'
            ''', (bus_id,))

            conn.commit()
            conn.close()
            return True, f"Delay resolved for {bus['bus_number']}. Status returned to On Time."
        else:
            # Add delay
            new_status = f"Delayed (+{delay_minutes}m)"
            cursor.execute('''
            UPDATE buses
            SET status = ?, delay_minutes = ?, updated_at = ?
            WHERE id = ?
            ''', (new_status, delay_minutes, now_str, bus_id))

            # Create notification banner alert
            title = f"{bus['bus_number']} Delay Alert (+{delay_minutes} mins)"
            msg = f"{bus['bus_number']} on {bus['next_stop_name'] or 'Route'} is delayed by ~{delay_minutes} mins due to {reason}."
            cursor.execute('''
            INSERT INTO notifications (bus_id, route_id, title, message, severity, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, 1, ?)
            ''', (bus_id, bus['route_id'], title, msg, 'danger', now_str))

            # Update schedules
            cursor.execute('''
            UPDATE schedules
            SET status = ?
            WHERE bus_id = ? AND status = 'On Time'
            ''', (new_status, bus_id))

            conn.commit()
            conn.close()
            return True, f"{bus['bus_number']} marked as Delayed (+{delay_minutes}m)."
