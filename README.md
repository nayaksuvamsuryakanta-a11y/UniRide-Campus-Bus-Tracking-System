# UniRide — Dr. Harisingh Gour Vishwavidyalaya Campus Bus Tracking System

A full-stack campus transit tracking web application for **Dr. Harisingh Gour Vishwavidyalaya (DHSGSU / Sagar Central University)** in Sagar, Madhya Pradesh, India. Built with **Flask**, **SQLite**, and **Leaflet.js**, it features real-time GPS telemetry, animated bus movement along Patharia Hills university campus roads, schedule timetable synchronization, and an interactive delay notifications banner designed for live demonstrations.

---

## 🌟 Key Features

1. **Interactive Leaflet.js Campus Map (Sagar, MP)**:
   - Centered on the university campus on **Patharia Hills, Sagar** (`23.8268° N, 78.7712° E`).
   - 3 distinct campus routes with custom color-coded polylines:
     - 🔵 **Campus Main Express (`CAMP-10`)**: Connects University Main Gate, Administrative Block & VC Secretariat, Central Library, and Faculty of Law.
     - 🟢 **Science & Health Shuttle (`SCI-20`)**: Loops through Dept of Geography, School of Physical & Chemical Sciences, University Health Centre & Hospital, and Pharmacy.
     - 🟣 **Hostels & Sports Connector (`HOST-30`)**: Serves Vivekanand Boys Hostel, Tagore Hostel, International Boys Hostel, Sports Stadium, and Rani Laxmibai Girls Hostel.
   - Bus stop markers showing stop sequence and upcoming arrival ETAs.
   - Live bus markers with animated heading direction, route colors, speed, and real-time passenger occupancy gauges.

2. **Live Location Updates (3s Headway)**:
   - Automated background simulation engine moves buses along road waypoints.
   - Frontend asynchronously polls `/api/buses` every 3 seconds to smoothly interpolate bus markers.
   - Supports authenticated GPS telemetry push via `POST /api/buses/<id>/location` using the `X-Update-Token` header.

3. **Delay Notifications Banner**:
   - High-visibility banner across the top of the interface.
   - Highlights delays in real-time with severity badges, affected routes, and delay minutes.
   - One-click **"Focus on Bus"** button smoothly flies the camera to the delayed bus.
   - One-click dismiss and resolve functionality.

4. **Schedules & Timetable View**:
   - Filterable timetable showing scheduled vs. estimated arrival times for each stop.
   - Automatically synchronizes with delay events (e.g. shifts estimated arrival from on-time to delayed).

5. **5-10 Minute Presentation Demo Controller**:
   - Floating demo controls modal with 1-click test actions:
     - **Simulate Delay on Bus 101 / 201**: Instantly triggers delay alerts and schedule shifts (e.g. traffic on Patharia Hills road).
     - **Clear Delays**: Restores all buses to on-time.
     - **Step GPS Ping**: Manually advances buses 1 step forward.
     - **Pause / Resume Engine**: Toggles background simulation.
     - **Reset Demo State**: Restores database to fresh demo baseline.

---

## 🏗️ Project Architecture

```
FIRSTPROJECT/
│
├── app.py                  # Flask API server, route handlers & endpoints
├── database.py             # SQLite schema, DHSGSU Sagar waypoints & seed data
├── simulation.py           # Background GPS simulation engine & delay management
├── test_app.py             # Automated unit tests for all routes & transactions
├── requirements.txt        # Python package dependencies
├── README.md               # Documentation & 5-10 minute presentation guide
│
├── templates/
│   └── index.html          # Responsive single-page application & Leaflet canvas
│
└── static/
    ├── css/
    │   └── style.css       # Modern UI styling, animations & notification banner
    └── js/
        └── app.js          # Leaflet map setup, real-time polling & demo controller
```

---

## 🚀 Quickstart Guide

### 1. Requirements
- Python 3.10+
- Flask (`pip install flask`)

### 2. Run the Application
Run the Flask server from this project folder:

```bash
# Using python launcher:
py app.py

# Or standard python:
python app.py
```

### 3. Open in Browser
Visit:
```
http://127.0.0.1:5000
```

### 4. Run Automated Test Suite
To verify all endpoints, database operations, and demo logic:

```bash
py test_app.py
```

---

## 🎙️ 5-10 Minute Presentation Demo Script

| Time | Phase | Action / Talking Points |
| :--- | :--- | :--- |
| **0:00 - 1:30** | **Introduction & Architecture** | • Open `http://127.0.0.1:5000` in fullscreen.<br>• Explain the project: Real-time transit tracker for **Dr. Harisingh Gour Vishwavidyalaya, Sagar (MP)**.<br>• Stack: **Flask** backend with **SQLite** for relational transit data + **Leaflet.js** on OpenStreetMap.<br>• Point out the live telemetry banner at top (`LIVE FEED (3s)`). |
| **1:30 - 3:30** | **Live Map & Bus Telemetry** | • Show the 3 campus routes on Patharia Hills drawn with distinct color ribbons.<br>• Note how buses navigate between the Main Gate, Administrative Block, Central Library, Science complex, and Hostels.<br>• Click on **Bus 102** in the left sidebar: the camera smoothly pans to the bus and reveals live speed, driver name, next stop ETA, and passenger capacity meter.<br>• Use the route filter chips (`All`, `Main Campus`, `Science & Health`, `Hostels & Sports`) to filter the fleet. |
| **3:30 - 5:30** | **Delay Notifications Banner** | • Click the **"Demo Controls"** button (or switch to the "Demo Guide" tab).<br>• Click **"⚠️ Delay Bus 101 (+15 min)"**.<br>• Notice the immediate changes:<br>  1. The **Notifications Banner** pops up at the top with an alert icon and delay description on Patharia Hills road.<br>  2. Bus 101's card turns amber with a pulsing alert badge.<br>  3. The bus map icon receives a pulsing beacon.<br>• Click **"Focus on Bus"** in the banner: it flies straight to the affected bus.<br>• Switch to the **"Schedules"** tab to show that the estimated arrival times updated dynamically. |
| **5:30 - 7:00** | **REST API & Location Updates** | • Explain how GPS trackers post live telemetry to `POST /api/buses/<id>/location`.<br>• In Demo Controls, click **"Forward GPS Step"** or **"Push Custom GPS Coordinates"** to demonstrate manual endpoint updates.<br>• Show that clearing delays restores the green "All Transit Systems Normal" banner. |
| **7:00 - 8:30** | **Q&A & Wrap-Up** | • Answer questions from professors/panel.<br>• Can click **"🔄 Reset Everything to Default"** to cleanly reset to default seed state. |

---

## 📡 API Reference

### 1. Buses
- `GET /api/buses`: Returns all active buses with current coordinates, heading, speed, next stop, and route information.
- `POST /api/buses/<id>/location`: Pushes a live location update for a bus. Requires the `X-Update-Token` header to match `GPS_UPDATE_TOKEN`. Coordinates must be in the Sagar service area (latitude 23.7–24.0, longitude 78.6–78.9) and movement is checked against an 80 km/h ceiling.
  ```json
  {
    "lat": 23.8290,
    "lng": 78.7705,
    "speed_mph": 20.5,
    "heading": 90,
    "status": "On Time"
  }
  ```

### GPS update token configuration
Set `GPS_UPDATE_TOKEN` in the environment where the Flask/Gunicorn process runs, and configure the same secret on the trusted GPS client as its `X-Update-Token` header. For example, set it in your deployment platform's environment variables or in the shell before starting the app (`$env:GPS_UPDATE_TOKEN = 'your-long-random-secret'` in PowerShell). If it is unset, the server generates a random process-local token; production mode (`CAMPUS_BUS_ENV=production` or `FLASK_ENV=production`) logs a warning, and GPS clients cannot authenticate reliably until the variable is configured. The in-process simulation writes directly to SQLite and does not call this endpoint.

### 2. Routes & Stops
- `GET /api/routes`: Returns all campus routes, ordered stops, and waypoints for polyline drawing.

### 3. Schedules
- `GET /api/schedules`: Returns departure timetables.
- `GET /api/schedules?route_id=1`: Filter schedules for a specific route.

### 4. Notifications & Alerts
- `GET /api/notifications`: Retrieves active delay and service notifications.
- `POST /api/notifications`: Creates a new alert.
- `POST /api/notifications/<id>/dismiss`: Dismisses an active alert.

### 5. Demo Controls
- `POST /api/demo/step`: Manually advances all buses one step.
- `POST /api/demo/toggle-delay/<bus_id>`: Toggles delay on a bus and generates an alert.
- `POST /api/demo/toggle-simulation`: Pauses or resumes the background simulation loop.
- `POST /api/demo/reset`: Resets SQLite database to the default seed state.
