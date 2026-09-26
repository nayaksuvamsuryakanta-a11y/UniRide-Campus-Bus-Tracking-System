import sqlite3
import json
import math
import os
import logging
from datetime import datetime, timedelta
from typing import Sequence
from logging_config import configure_logging

logger = logging.getLogger(__name__)

DB_PATH = os.environ.get(
    'CAMPUS_BUS_DB',
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'campus_bus.db'),
)

def get_db() -> sqlite3.Connection:
    """Open a configured SQLite connection with row access and lock waiting."""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.execute('PRAGMA busy_timeout = 10000')
    conn.row_factory = sqlite3.Row
    return conn

def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate forward azimuth / bearing in degrees between two coordinates."""
    lat1_r = math.radians(lat1)
    lat2_r = math.radians(lat2)
    dlon_r = math.radians(lon2 - lon1)
    
    y = math.sin(dlon_r) * math.cos(lat2_r)
    x = math.cos(lat1_r) * math.sin(lat2_r) - math.sin(lat1_r) * math.cos(lat2_r) * math.cos(dlon_r)
    bearing = math.degrees(math.atan2(y, x))
    return round((bearing + 360) % 360, 1)

def interpolate_segment(
    pt1: Sequence[float], pt2: Sequence[float], steps: int = 6
) -> list[list[float]]:
    """Interpolate coordinates between two points."""
    points = []
    for i in range(steps):
        t = i / steps
        lat = pt1[0] + (pt2[0] - pt1[0]) * t
        lng = pt1[1] + (pt2[1] - pt1[1]) * t
        points.append([round(lat, 6), round(lng, 6)])
    return points

def build_loop(
    key_points: Sequence[Sequence[float]], steps_per_segment: int = 6
) -> list[list[float]]:
    """Build a closed loop sequence of coordinates with interpolation."""
    all_points = []
    n = len(key_points)
    for i in range(n):
        p1 = key_points[i]
        p2 = key_points[(i + 1) % n]
        all_points.extend(interpolate_segment(p1, p2, steps_per_segment))
    return all_points

# Dr. Harisingh Gour Vishwavidyalaya (DHSGSU), Sagar, Madhya Pradesh, India
# Key campus road nodes on Patharia Hills
ROUTE_1_KEYS = [
    [23.834000, 78.767500], # Main Gate (Patharia Hills Entrance)
    [23.831500, 78.769000], # University Road
    [23.829000, 78.770500], # Administrative Block
    [23.828200, 78.770800], # State Bank of India Branch
    [23.826900, 78.771200], # Central Library
    [23.824800, 78.771400], # Law Faculty
    [23.826000, 78.769500], # Gour Sangrahalaya (University Museum)
    [23.830000, 78.767000], # University Road North
]

ROUTE_2_KEYS = [
    [23.829000, 78.770500], # Administrative Block
    [23.828200, 78.770800], # State Bank of India Branch
    [23.827000, 78.774000], # Science Faculty
    [23.825500, 78.775200], # Advanced Research Labs
    [23.824100, 78.774550], # University Health Centre
    [23.823500, 78.772500], # Botanical Garden
    [23.824800, 78.771400], # Law Faculty Junction
    [23.826900, 78.771200], # Central Library
]

ROUTE_3_KEYS = [
    [23.823500, 78.769800], # Shopping Complex
    [23.821000, 78.770500], # Boys Hostel Block
    [23.820500, 78.774000], # Sports Complex/Stadium
    [23.818500, 78.772500], # Girls Hostel Block
    [23.820000, 78.769500], # Student Activity Centre
    [23.822000, 78.768500], # Faculty Residences
    [23.826000, 78.769500], # Gour Sangrahalaya (University Museum)
    [23.826900, 78.771200], # Central Library Junction
]

def init_db(reset: bool = False) -> None:
    """Initialize database schemas and seed data."""
    conn = get_db()
    cursor = conn.cursor()
    # WAL lets API reads continue while the simulation commits a position update.
    cursor.execute('PRAGMA journal_mode = WAL')
    if reset:
        # Clear tables transactionally instead of unlinking a database another
        # connection may currently be reading or writing.
        cursor.execute('PRAGMA foreign_keys = OFF')
        for table in ('notifications', 'schedules', 'buses', 'stops', 'routes'):
            cursor.execute(f'DROP TABLE IF EXISTS {table}')
        cursor.execute('PRAGMA foreign_keys = ON')

    # Create Routes table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        description TEXT,
        frequency_mins INTEGER DEFAULT 10,
        waypoints_json TEXT NOT NULL,
        is_active INTEGER DEFAULT 1
    )
    ''')

    # Create Stops table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS stops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        stop_order INTEGER NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        FOREIGN KEY (route_id) REFERENCES routes (id)
    )
    ''')

    # Create Buses table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS buses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bus_number TEXT UNIQUE NOT NULL,
        route_id INTEGER NOT NULL,
        driver_name TEXT NOT NULL,
        current_lat REAL NOT NULL,
        current_lng REAL NOT NULL,
        waypoint_index INTEGER DEFAULT 0,
        speed_mph REAL DEFAULT 18.5,
        heading REAL DEFAULT 0,
        capacity_percent INTEGER DEFAULT 50,
        status TEXT DEFAULT 'On Time',
        delay_minutes INTEGER DEFAULT 0,
        next_stop_name TEXT,
        eta_minutes INTEGER DEFAULT 3,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (route_id) REFERENCES routes (id)
    )
    ''')

    # Create Schedules table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_id INTEGER NOT NULL,
        bus_id INTEGER,
        stop_name TEXT NOT NULL,
        scheduled_time TEXT NOT NULL,
        estimated_time TEXT NOT NULL,
        status TEXT DEFAULT 'On Time',
        FOREIGN KEY (route_id) REFERENCES routes (id),
        FOREIGN KEY (bus_id) REFERENCES buses (id)
    )
    ''')

    # Create Notifications / Alerts table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bus_id INTEGER,
        route_id INTEGER,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT DEFAULT 'warning', -- 'warning', 'danger', 'info', 'success'
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (bus_id) REFERENCES buses (id),
        FOREIGN KEY (route_id) REFERENCES routes (id)
    )
    ''')

    conn.commit()

    # Check if seed data exists
    cursor.execute('SELECT COUNT(*) as cnt FROM routes')
    if cursor.fetchone()['cnt'] == 0:
        seed_data(conn)

    conn.close()

def seed_data(conn: sqlite3.Connection) -> None:
    """Insert the initial route, bus, stop, schedule, and alert records."""
    cursor = conn.cursor()

    # Generate smooth waypoints
    r1_waypoints = build_loop(ROUTE_1_KEYS, steps_per_segment=6)
    r2_waypoints = build_loop(ROUTE_2_KEYS, steps_per_segment=6)
    r3_waypoints = build_loop(ROUTE_3_KEYS, steps_per_segment=6)

    # 1. Insert Routes for DHSGSU Sagar
    cursor.execute('''
    INSERT INTO routes (code, name, color, description, frequency_mins, waypoints_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ''', (
        'CAMP-10', 'Campus Central Express', '#2563EB',
        'Main Gate, Administrative Block, Central Library & Law Faculty Loop',
        10, json.dumps(r1_waypoints)
    ))
    r1_id = cursor.lastrowid

    cursor.execute('''
    INSERT INTO routes (code, name, color, description, frequency_mins, waypoints_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ''', (
        'SCI-20', 'Science & Health Shuttle', '#059669',
        'Administrative Block, State Bank of India Branch, Science Faculty & Central Library Loop',
        12, json.dumps(r2_waypoints)
    ))
    r2_id = cursor.lastrowid

    cursor.execute('''
    INSERT INTO routes (code, name, color, description, frequency_mins, waypoints_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ''', (
        'HOST-30', 'Hostels & Sports Connector', '#7C3AED',
        'Shopping Complex, Boys Hostel Block, Sports Complex/Stadium & Girls Hostel Block Loop',
        15, json.dumps(r3_waypoints)
    ))
    r3_id = cursor.lastrowid

    # 2. Insert Stops
    # Route 1 Stops (Campus Central Express)
    r1_stops = [
        ('Main Gate', 23.834000, 78.767500, 1),
        ('Administrative Block', 23.829000, 78.770500, 2),
        ('State Bank of India Branch', 23.828200, 78.770800, 3),
        ('Central Library', 23.826900, 78.771200, 4),
        ('Law Faculty', 23.824800, 78.771400, 5),
        ('Gour Sangrahalaya (University Museum)', 23.826000, 78.769500, 6),
    ]
    for name, lat, lng, order in r1_stops:
        cursor.execute('INSERT INTO stops (route_id, name, stop_order, lat, lng) VALUES (?, ?, ?, ?, ?)',
                       (r1_id, name, order, lat, lng))

    # Route 2 Stops (Science & Health Shuttle)
    r2_stops = [
        ('Administrative Block', 23.829000, 78.770500, 1),
        ('State Bank of India Branch', 23.828200, 78.770800, 2),
        ('Science Faculty', 23.827000, 78.774000, 3),
        ('Central Library', 23.826900, 78.771200, 4),
        ('Law Faculty', 23.824800, 78.771400, 5),
    ]
    for name, lat, lng, order in r2_stops:
        cursor.execute('INSERT INTO stops (route_id, name, stop_order, lat, lng) VALUES (?, ?, ?, ?, ?)',
                       (r2_id, name, order, lat, lng))

    # Route 3 Stops (Hostels & Sports Connector)
    r3_stops = [
        ('Shopping Complex', 23.823500, 78.769800, 1),
        ('Boys Hostel Block', 23.821000, 78.770500, 2),
        ('Sports Complex/Stadium', 23.820500, 78.774000, 3),
        ('Girls Hostel Block', 23.818500, 78.772500, 4),
        ('Gour Sangrahalaya (University Museum)', 23.826000, 78.769500, 5),
        ('Central Library', 23.826900, 78.771200, 6),
    ]
    for name, lat, lng, order in r3_stops:
        cursor.execute('INSERT INTO stops (route_id, name, stop_order, lat, lng) VALUES (?, ?, ?, ?, ?)',
                       (r3_id, name, order, lat, lng))

    # 3. Insert Buses
    buses_to_add = [
        {
            'bus_number': 'Bus 101',
            'route_id': r1_id,
            'driver_name': 'Ramesh Sharma',
            'waypoint_index': 0,
            'pts': r1_waypoints,
            'speed_mph': 18.0,
            'capacity_percent': 65,
            'status': 'Delayed (+12m)',
            'delay_minutes': 12,
            'next_stop_name': 'Administrative Block',
            'eta_minutes': 6
        },
        {
            'bus_number': 'Bus 102',
            'route_id': r1_id,
            'driver_name': 'Sunil Verma',
            'waypoint_index': len(r1_waypoints) // 2,
            'pts': r1_waypoints,
            'speed_mph': 21.0,
            'capacity_percent': 42,
            'status': 'On Time',
            'delay_minutes': 0,
            'next_stop_name': 'Main Gate',
            'eta_minutes': 2
        },
        {
            'bus_number': 'Bus 201',
            'route_id': r2_id,
            'driver_name': 'Anand Mishra',
            'waypoint_index': 5,
            'pts': r2_waypoints,
            'speed_mph': 16.5,
            'capacity_percent': 78,
            'status': 'On Time',
            'delay_minutes': 0,
            'next_stop_name': 'Science Faculty',
            'eta_minutes': 3
        },
        {
            'bus_number': 'Bus 301',
            'route_id': r3_id,
            'driver_name': 'Rajesh Ahirwar',
            'waypoint_index': 12,
            'pts': r3_waypoints,
            'speed_mph': 19.5,
            'capacity_percent': 30,
            'status': 'On Time',
            'delay_minutes': 0,
            'next_stop_name': 'Sports Complex/Stadium',
            'eta_minutes': 4
        }
    ]

    for b in buses_to_add:
        idx = b['waypoint_index']
        pt = b['pts'][idx]
        next_pt = b['pts'][(idx + 1) % len(b['pts'])]
        heading = calculate_bearing(pt[0], pt[1], next_pt[0], next_pt[1])

        cursor.execute('''
        INSERT INTO buses (bus_number, route_id, driver_name, current_lat, current_lng,
                           waypoint_index, speed_mph, heading, capacity_percent, status,
                           delay_minutes, next_stop_name, eta_minutes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            b['bus_number'], b['route_id'], b['driver_name'], pt[0], pt[1],
            idx, b['speed_mph'], heading, b['capacity_percent'], b['status'],
            b['delay_minutes'], b['next_stop_name'], b['eta_minutes'],
            datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        ))
        bus_id = cursor.lastrowid
        b['id'] = bus_id

    # 4. Insert Schedules
    now = datetime.now()
    all_stops_tuples = [
        (r1_id, buses_to_add[0]['id'], 'Main Gate', -10, 0),
        (r1_id, buses_to_add[0]['id'], 'Administrative Block', 2, 12),
        (r1_id, buses_to_add[0]['id'], 'State Bank of India Branch', 7, 12),
        (r1_id, buses_to_add[0]['id'], 'Central Library', 14, 12),
        (r1_id, buses_to_add[0]['id'], 'Law Faculty', 22, 12),
        (r1_id, buses_to_add[1]['id'], 'Gour Sangrahalaya (University Museum)', 2, 0),
        (r1_id, buses_to_add[1]['id'], 'Main Gate', 12, 0),
        (r2_id, buses_to_add[2]['id'], 'Administrative Block', -5, 0),
        (r2_id, buses_to_add[2]['id'], 'Science Faculty', 3, 0),
        (r2_id, buses_to_add[2]['id'], 'Central Library', 11, 0),
        (r2_id, buses_to_add[2]['id'], 'State Bank of India Branch', 18, 0),
        (r3_id, buses_to_add[3]['id'], 'Shopping Complex', -4, 0),
        (r3_id, buses_to_add[3]['id'], 'Boys Hostel Block', 4, 0),
        (r3_id, buses_to_add[3]['id'], 'Sports Complex/Stadium', 14, 0),
        (r3_id, buses_to_add[3]['id'], 'Girls Hostel Block', 22, 0),
    ]

    for r_id, b_id, stop_nm, sched_offset, delay in all_stops_tuples:
        sched_time = (now + timedelta(minutes=sched_offset)).strftime('%I:%M %p')
        est_time = (now + timedelta(minutes=sched_offset + delay)).strftime('%I:%M %p')
        stat = f"Delayed (+{delay}m)" if delay > 0 else ("Departed" if sched_offset < -2 else "On Time")
        cursor.execute('''
        INSERT INTO schedules (route_id, bus_id, stop_name, scheduled_time, estimated_time, status)
        VALUES (?, ?, ?, ?, ?, ?)
        ''', (r_id, b_id, stop_nm, sched_time, est_time, stat))

    # 5. Insert Notifications / Delay Banner alerts
    cursor.execute('''
    INSERT INTO notifications (bus_id, route_id, title, message, severity, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (
        buses_to_add[0]['id'],
        r1_id,
        'Bus 101 Traffic Delay (+12 mins)',
        'Campus Central Express (Bus 101) is experiencing delays near Main Gate due to road maintenance work on Patharia Hills Road. Expected arrival at Administrative Block updated to +12m.',
        'warning',
        1,
        datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    ))

    conn.commit()

if __name__ == '__main__':
    configure_logging()
    init_db(reset=True)
    logger.info("DHSGSU Sagar database initialized successfully at: %s", DB_PATH)
