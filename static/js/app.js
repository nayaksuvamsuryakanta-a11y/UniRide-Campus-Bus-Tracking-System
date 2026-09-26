/**
 * UniRide - Campus Live Bus Tracker
 * Leaflet.js Frontend & Real-Time Polling Engine
 */

const App = (() => {
  // Application State
  const state = {
    map: null,
    routes: [],
    buses: [],
    schedules: [],
    notifications: [],
    busMarkers: {},       // bus_id -> L.marker
    stopMarkers: [],      // array of L.marker
    routePolylines: {},   // route_code -> L.polyline
    selectedRouteFilter: 'all',
    selectedBusId: null,
    showStops: true,
    simRunning: true,
    pollingTimer: null,
    busEventSource: null,
    sseConnectionTimer: null,
    pollInterval: 3000,    // 3 seconds
  };

  // SVGs for clean UI icons
  const ICONS = {
    bus: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="15" rx="3"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="7" cy="14" r="1.5"/><circle cx="17" cy="14" r="1.5"/><path d="M5 18v2m14-2v2" stroke-linecap="round"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    speed: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>`,
    pin: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-8-7.5-8-12a8 8 0 1 1 16 0c0 4.5-8 12-8 12z"/><circle cx="12" cy="9" r="3"/></svg>`,
    users: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    alert: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    check: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>`,
  };

  function formatDriverName(fullName) {
    const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return parts[0] || 'Unknown';
    return `${parts[0]} ${parts[parts.length - 1][0]}.`;
  }

  /**
   * Initialize Map and Event Listeners
   */
  async function init() {
    try {
      if (typeof L === 'undefined') throw new Error('Leaflet did not load');
      initMap();
    } catch (err) {
      console.error('Interactive map unavailable:', err);
      const mapContainer = document.getElementById('map');
      if (mapContainer) {
        mapContainer.innerHTML = '<div class="map-unavailable">Interactive map could not load. Bus details remain available in the fleet list.</div>';
      }
    }
    bindEvents();
    
    // Initial data fetches
    await fetchRoutes();
    await fetchNotifications();
    await fetchSchedules();

    // Prefer server-pushed bus updates; retain polling for older browsers.
    startLiveUpdates();
    window.addEventListener('beforeunload', closeLiveUpdates, { once: true });
  }

  /**
   * Create Leaflet Map centered on Dr. Harisingh Gour Vishwavidyalaya, Sagar (MP)
   */
  function initMap() {
    // Dr. Harisingh Gour Vishwavidyalaya, Sagar, MP: [23.8268, 78.7712]
    state.map = L.map('map', {
      center: [23.8268, 78.7712],
      zoom: 15,
      zoomControl: false,
    });

    // Add Zoom Control in top-right
    L.control.zoom({ position: 'topright' }).addTo(state.map);

    const invalidateMobileMapSize = () => {
      if (window.innerWidth > 768) return;
      window.requestAnimationFrame(() => state.map.invalidateSize({ pan: false }));
    };
    window.addEventListener('resize', invalidateMobileMapSize);
    window.addEventListener('orientationchange', () => {
      window.setTimeout(invalidateMobileMapSize, 150);
    });
    if (window.ResizeObserver) {
      const mapResizeObserver = new ResizeObserver(invalidateMobileMapSize);
      mapResizeObserver.observe(state.map.getContainer().parentElement);
    }

    // Free OpenStreetMap tile server
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(state.map);
  }

  /**
   * Bind DOM Events
   */
  function bindEvents() {
    // Tab Switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const targetPane = document.getElementById(`pane-${targetTab}`);
        if (targetPane) targetPane.classList.add('active');
        if (targetTab === 'schedules') fetchSchedules();
      });
    });

    // Filter Chips for Routes
    document.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.selectedRouteFilter = chip.getAttribute('data-filter');
        applyRouteFilter();
      });
    });

    // Schedule Route Selector
    const scheduleSelect = document.getElementById('scheduleRouteSelect');
    if (scheduleSelect) {
      scheduleSelect.addEventListener('change', (e) => {
        fetchSchedules(e.target.value);
      });
    }

    // Header Controls
    const btnToggleSim = document.getElementById('btnToggleSim');
    if (btnToggleSim) {
      btnToggleSim.addEventListener('click', toggleSimulation);
    }

    // Modal Controls
    const btnOpenDemo = document.getElementById('btnOpenDemoModal');
    const modal = document.getElementById('demoModal');
    const btnCloseDemo = document.getElementById('btnCloseDemoModal');
    const btnDoneDemo = document.getElementById('btnDoneDemoModal');

    if (btnOpenDemo) btnOpenDemo.addEventListener('click', () => modal.classList.add('show'));
    if (btnCloseDemo) btnCloseDemo.addEventListener('click', () => modal.classList.remove('show'));
    if (btnDoneDemo) btnDoneDemo.addEventListener('click', () => modal.classList.remove('show'));

    // Floating Map Controls
    const btnRecenter = document.getElementById('btnRecenter');
    if (btnRecenter) {
      btnRecenter.addEventListener('click', () => {
        if (state.map) state.map.flyTo([23.8268, 78.7712], 15);
      });
    }

    const btnToggleStops = document.getElementById('btnToggleStops');
    if (btnToggleStops) {
      btnToggleStops.addEventListener('click', () => {
        state.showStops = !state.showStops;
        state.stopMarkers.forEach(m => {
          if (!state.map) return;
          if (state.showStops) m.addTo(state.map);
          else state.map.removeLayer(m);
        });
        btnToggleStops.style.color = state.showStops ? 'var(--primary)' : 'var(--text-light)';
      });
    }
  }

  /**
   * Fetch and Draw Routes & Stops
   */
  async function fetchRoutes() {
    try {
      const res = await fetch('/api/routes');
      const data = await res.json();
      state.routes = data.routes || [];

      // Update schedule filter dropdown
      const sel = document.getElementById('scheduleRouteSelect');
      if (sel) {
        sel.innerHTML = '<option value="">All Campus Routes</option>' +
          state.routes.map(r => `<option value="${r.id}">${r.name} (${r.code})</option>`).join('');
      }

      // Draw route polylines and stops
      renderRouteLines();
      renderStops();
    } catch (err) {
      console.error('Error fetching routes:', err);
    }
  }

  /**
   * Render Route Lines on Map
   */
  function renderRouteLines() {
    if (!state.map) return;
    state.routes.forEach(route => {
      if (route.waypoints && route.waypoints.length > 0) {
        // Outer glow polyline
        const glow = L.polyline(route.waypoints, {
          color: route.color,
          weight: 8,
          opacity: 0.25,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(state.map);

        // Core polyline
        const line = L.polyline(route.waypoints, {
          color: route.color,
          weight: 4,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(state.map);

        line.bindTooltip(`<strong>${route.name}</strong><br>Frequency: Every ${route.frequency_mins} mins`, {
          sticky: true,
          className: 'route-tooltip',
        });

        state.routePolylines[route.code] = { line, glow };
      }
    });
  }

  /**
   * Render Bus Stops
   */
  function renderStops() {
    if (!state.map) return;
    // Clear old stops
    state.stopMarkers.forEach(m => state.map.removeLayer(m));
    state.stopMarkers = [];

    state.routes.forEach(route => {
      (route.stops || []).forEach(stop => {
        const icon = L.divIcon({
          className: 'custom-stop-icon',
          html: `<div class="stop-marker-pin" style="border-color: ${route.color};" title="${stop.name}"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });

        const marker = L.marker([stop.lat, stop.lng], { icon }).addTo(state.map);
        
        marker.bindPopup(`
          <div class="custom-popup">
            <div class="popup-header">
              <span class="popup-title">${stop.name}</span>
              <span class="bus-route-tag" style="background-color: ${route.color}">${route.code}</span>
            </div>
            <div class="popup-row">
              <span class="popup-label">Route:</span>
              <span class="popup-val">${route.name}</span>
            </div>
            <div class="popup-row">
              <span class="popup-label">Stop Sequence:</span>
              <span class="popup-val">Stop #${stop.stop_order}</span>
            </div>
          </div>
        `);

        marker.bindTooltip(`📍 ${stop.name}`, { direction: 'top', offset: [0, -8] });
        state.stopMarkers.push(marker);
      });
    });
  }

  /**
   * Fetch Live Buses & Update Map / Sidebar
   */
  async function fetchBuses() {
    try {
      const res = await fetch('/api/buses');
      const data = await res.json();
      renderBusSnapshot(data);
    } catch (err) {
      console.error('Error fetching buses:', err);
    }
  }

  /** Apply a bus snapshot received from either the API or the SSE stream. */
  function renderBusSnapshot(data) {
    state.buses = data.buses || [];
    updateBusMarkers();
    renderBusList();
    updateTelemetryHeader();
    applyRouteFilter();
  }

  /**
   * Update or Create Leaflet Markers for Buses
   */
  function updateBusMarkers() {
    if (!state.map) return;
    state.buses.forEach(bus => {
      const lat = bus.current_lat;
      const lng = bus.current_lng;
      const isDelayed = bus.delay_minutes > 0;
      const heading = bus.heading || 0;

      const markerHtml = `
        <div class="bus-marker-container ${isDelayed ? 'delayed' : ''}">
          <div class="bus-marker-icon" style="border-color: ${bus.route_color}; transform: rotate(${heading}deg);">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${bus.route_color}" stroke-width="2.2" style="transform: rotate(-${heading}deg);">
              <rect x="4" y="3" width="16" height="15" rx="3"/>
              <line x1="4" y1="9" x2="20" y2="9"/>
              <circle cx="8" cy="14" r="1.5"/>
              <circle cx="16" cy="14" r="1.5"/>
              <path d="M6 18v2m12-2v2" stroke-linecap="round"/>
            </svg>
          </div>
          <span class="bus-marker-badge">${bus.bus_number}</span>
        </div>
      `;

      const icon = L.divIcon({
        className: 'custom-bus-icon-wrapper',
        html: markerHtml,
        iconSize: [38, 48],
        iconAnchor: [19, 24],
        popupAnchor: [0, -26],
      });

      if (state.busMarkers[bus.id]) {
        // Move existing marker smoothly
        const marker = state.busMarkers[bus.id];
        marker.setLatLng([lat, lng]);
        marker.setIcon(icon);
        marker.setPopupContent(buildBusPopupContent(bus));
      } else {
        // Create new marker
        const marker = L.marker([lat, lng], { icon }).addTo(state.map);
        marker.bindPopup(buildBusPopupContent(bus));
        marker.on('click', () => selectBus(bus.id, false));
        state.busMarkers[bus.id] = marker;
      }
    });
  }

  /**
   * Generate HTML for Bus Popup
   */
  function buildBusPopupContent(bus) {
    const isDelayed = bus.delay_minutes > 0;
    return `
      <div class="custom-popup">
        <div class="popup-header">
          <span class="popup-title">${bus.bus_number}</span>
          <span class="status-badge ${isDelayed ? 'delayed' : 'on-time'}">
            ${bus.status}
          </span>
        </div>
        <div class="popup-row">
          <span class="popup-label">Route:</span>
          <span class="popup-val" style="color:${bus.route_color}">${bus.route_name}</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">Driver:</span>
          <span class="popup-val">${formatDriverName(bus.driver_name)}</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">Speed:</span>
          <span class="popup-val">${bus.speed_mph} mph</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">Next Stop:</span>
          <span class="popup-val">${bus.next_stop_name || 'In Transit'}</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">ETA:</span>
          <span class="popup-val">${bus.eta_minutes} mins</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">Occupancy:</span>
          <span class="popup-val">${bus.capacity_percent}% Full</span>
        </div>
        <div class="action-row" style="margin-top: 8px;">
          <button class="btn ${isDelayed ? 'btn-success' : 'btn-warning'} btn-sm" style="width: 100%;"
                  onclick="App.triggerDelay(${bus.id}, ${isDelayed ? 0 : 15}, 'Simulated Demo Delay')">
            ${isDelayed ? 'Clear Delay' : 'Simulate Delay (+15m)'}
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Render Bus List in Sidebar
   */
  function renderBusList() {
    const container = document.getElementById('busList');
    if (!container) return;

    if (state.buses.length === 0) {
      container.innerHTML = `<div class="loading-state"><span>No active buses in service.</span></div>`;
      return;
    }

    container.innerHTML = state.buses.map(bus => {
      const isDelayed = bus.delay_minutes > 0;
      const isSelected = state.selectedBusId === bus.id;
      
      // Capacity color
      let capColor = '#10b981';
      if (bus.capacity_percent > 75) capColor = '#ef4444';
      else if (bus.capacity_percent > 45) capColor = '#f59e0b';

      return `
        <div class="bus-card ${isDelayed ? 'delayed' : ''} ${isSelected ? 'active-selected' : ''}" 
             data-bus-id="${bus.id}"
             data-route-code="${bus.route_code}"
             style="border-left-color: ${bus.route_color};"
             onclick="App.selectBus(${bus.id}, true)">
          
          <div class="bus-card-top">
            <div class="bus-identity">
              <span class="bus-number-badge">${bus.bus_number}</span>
              <span class="bus-route-tag" style="background-color: ${bus.route_color}">${bus.route_code}</span>
            </div>
            <span class="status-badge ${isDelayed ? 'delayed' : 'on-time'}">
              ${isDelayed ? ICONS.alert : ICONS.check}
              ${bus.status}
            </span>
          </div>

          <div class="bus-details-grid">
            <div class="detail-item">
              <span class="detail-label">Next Stop</span>
              <span class="detail-value" title="${bus.next_stop_name || 'En route'}">
                ${bus.next_stop_name ? (bus.next_stop_name.length > 18 ? bus.next_stop_name.substring(0, 18) + '...' : bus.next_stop_name) : 'In Transit'}
              </span>
            </div>
            <div class="detail-item">
              <span class="detail-label">ETA to Stop</span>
              <span class="detail-value">
                ${ICONS.clock}
                ${bus.eta_minutes} mins
              </span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Speed</span>
              <span class="detail-value">
                ${ICONS.speed}
                ${bus.speed_mph} mph
              </span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Driver</span>
              <span class="detail-value">
                ${formatDriverName(bus.driver_name)}
              </span>
            </div>
          </div>

          <div class="capacity-wrapper">
            <div class="capacity-header">
              <span>Passenger Occupancy</span>
              <span>${bus.capacity_percent}%</span>
            </div>
            <div class="capacity-bar-track">
              <div class="capacity-bar-fill" style="width: ${bus.capacity_percent}%; background-color: ${capColor};"></div>
            </div>
          </div>

          <div class="bus-card-actions">
            <button class="btn btn-outline btn-sm" style="flex:1;" onclick="event.stopPropagation(); App.focusOnBus(${bus.id});">
              Center on Map
            </button>
            <button class="btn ${isDelayed ? 'btn-success' : 'btn-warning'} btn-sm" style="flex:1;" 
                    onclick="event.stopPropagation(); App.triggerDelay(${bus.id}, ${isDelayed ? 0 : 15}, 'Patharia Hills road maintenance work')">
              ${isDelayed ? 'Clear Delay' : 'Simulate Delay'}
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Filter Buses and Polylines by Route Chip
   */
  function applyRouteFilter() {
    const filter = state.selectedRouteFilter;

    // Filter Sidebar Cards
    document.querySelectorAll('.bus-card').forEach(card => {
      const code = card.getAttribute('data-route-code');
      if (filter === 'all' || code === filter) {
        card.style.display = 'block';
      } else {
        card.style.display = 'none';
      }
    });

    // Filter Bus Map Markers
    if (state.map) state.buses.forEach(bus => {
      const marker = state.busMarkers[bus.id];
      if (marker) {
        if (filter === 'all' || bus.route_code === filter) {
          if (!state.map.hasLayer(marker)) marker.addTo(state.map);
        } else {
          if (state.map.hasLayer(marker)) state.map.removeLayer(marker);
        }
      }
    });

    // Filter Polylines
    if (state.map) Object.keys(state.routePolylines).forEach(code => {
      const { line, glow } = state.routePolylines[code];
      if (filter === 'all' || code === filter) {
        if (!state.map.hasLayer(line)) line.addTo(state.map);
        if (!state.map.hasLayer(glow)) glow.addTo(state.map);
      } else {
        if (state.map.hasLayer(line)) state.map.removeLayer(line);
        if (state.map.hasLayer(glow)) state.map.removeLayer(glow);
      }
    });
  }

  /**
   * Fetch Active Notifications / Delay Alerts
   */
  async function fetchNotifications() {
    try {
      const res = await fetch('/api/notifications');
      const data = await res.json();
      state.notifications = data.notifications || [];
      renderNotifications();
      updateTelemetryHeader();
    } catch (err) {
      console.error('Error fetching notifications:', err);
    }
  }

  /**
   * Render Top Notifications Banner for Delays
   */
  function renderNotifications() {
    const container = document.getElementById('notificationsContainer');
    if (!container) return;

    if (state.notifications.length === 0) {
      // Normal operating status ribbon
      container.innerHTML = `
        <div class="notification-banner info-normal">
          <div class="notif-content">
            <div class="notif-icon">${ICONS.check}</div>
            <div class="notif-text-wrap">
              <span class="notif-title" style="color: #166534;">All Transit Systems Normal</span>
              <span class="notif-msg" style="color: #15803d;">All DHSGSU campus transit routes are operating on scheduled timetable. No active delays.</span>
            </div>
          </div>
        </div>
      `;
      return;
    }

    // Render active delay alerts
    container.innerHTML = state.notifications.map(notif => {
      const isDanger = notif.severity === 'danger';
      return `
        <div class="notification-banner ${isDanger ? 'danger' : ''}">
          <div class="notif-content">
            <div class="notif-icon">${ICONS.alert}</div>
            <div class="notif-text-wrap">
              <div class="notif-title-row">
                <span class="notif-title">${notif.title}</span>
                ${notif.route_name ? `<span class="brand-badge" style="background:#fef08a; color:#854d0e;">${notif.route_name}</span>` : ''}
              </div>
              <span class="notif-msg">${notif.message}</span>
            </div>
          </div>
          <div class="notif-actions">
            ${notif.bus_id ? `
              <button class="btn-notif-action" onclick="App.focusOnBus(${notif.bus_id})">
                Focus on Bus
              </button>
            ` : ''}
            <button class="btn-notif-dismiss" title="Dismiss Alert" onclick="App.dismissNotification(${notif.id})">
              &times;
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Dismiss a Notification Banner Alert
   */
  async function dismissNotification(alertId) {
    try {
      await fetch(`/api/notifications/${alertId}/dismiss`, { method: 'POST' });
      await fetchNotifications();
    } catch (err) {
      console.error('Error dismissing notification:', err);
    }
  }

  /**
   * Fetch Bus Schedules & Timetables
   */
  async function fetchSchedules(routeId = '') {
    try {
      const url = routeId ? `/api/schedules?route_id=${routeId}` : '/api/schedules';
      const res = await fetch(url);
      const data = await res.json();
      state.schedules = data.schedules || [];
      renderSchedules();
    } catch (err) {
      console.error('Error fetching schedules:', err);
    }
  }

  /**
   * Render Schedule Table in Sidebar
   */
  function renderSchedules() {
    const tbody = document.getElementById('schedulesTableBody');
    if (!tbody) return;

    if (state.schedules.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px;">No schedule records found.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.schedules.map(item => {
      const isDelayed = item.status.includes('Delayed');
      const isDeparted = item.status.includes('Departed');
      
      let badgeClass = 'on-time';
      if (isDelayed) badgeClass = 'delayed';
      else if (isDeparted) badgeClass = '';

      return `
        <tr>
          <td>
            <div style="display:flex; flex-direction:column;">
              <span style="font-weight:700;">${item.bus_number || 'TBD'}</span>
              <span style="font-size:0.68rem; color:${item.route_color};">${item.route_name}</span>
            </div>
          </td>
          <td><strong>${item.stop_name}</strong></td>
          <td><span style="font-family:var(--font-mono); font-size:0.75rem;">${item.scheduled_time}</span></td>
          <td><span style="font-family:var(--font-mono); font-size:0.75rem; font-weight:600;">${item.estimated_time}</span></td>
          <td>
            <span class="status-badge ${badgeClass}" style="display:inline-flex;">
              ${item.status}
            </span>
          </td>
        </tr>
      `;
    }).join('');
  }

  /**
   * Update Live Telemetry in Header & Bottom Bar
   */
  function updateTelemetryHeader() {
    const statActiveBuses = document.getElementById('statActiveBuses');
    const statRoutes = document.getElementById('statRoutes');
    const statAlerts = document.getElementById('statAlerts');
    const bottomLastUpdated = document.getElementById('bottomLastUpdated');

    if (statActiveBuses) statActiveBuses.textContent = state.buses.length;
    if (statRoutes) statRoutes.textContent = state.routes.length;
    if (statAlerts) statAlerts.textContent = state.notifications.length;

    if (bottomLastUpdated) {
      const now = new Date();
      bottomLastUpdated.textContent = `Live Telemetry • ${now.toLocaleTimeString()}`;
    }
  }

  /**
   * Select and Center on a Bus
   */
  function selectBus(busId, fly = true) {
    state.selectedBusId = busId;
    const bus = state.buses.find(b => b.id === busId);
    if (!bus) return;

    if (fly && state.map) {
      state.map.flyTo([bus.current_lat, bus.current_lng], 16, { duration: 0.8 });
    }

    const marker = state.busMarkers[busId];
    if (marker) {
      marker.openPopup();
    }

    // Highlight card in sidebar
    document.querySelectorAll('.bus-card').forEach(card => {
      const id = parseInt(card.getAttribute('data-bus-id'), 10);
      if (id === busId) {
        card.classList.add('active-selected');
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        card.classList.remove('active-selected');
      }
    });
  }

  function focusOnBus(busId) {
    selectBus(busId, true);
  }

  /**
   * Live bus stream with polling fallback for browsers without EventSource.
   */
  function startLiveUpdates() {
    if (typeof EventSource === 'undefined') {
      startPolling();
      return;
    }

    const eventSource = new EventSource('/api/buses/stream');
    state.busEventSource = eventSource;
    let receivedBusSnapshot = false;
    let pollingFallbackStarted = false;

    const fallbackToPolling = () => {
      if (pollingFallbackStarted) return;
      pollingFallbackStarted = true;
      eventSource.close();
      if (state.busEventSource === eventSource) state.busEventSource = null;
      if (state.sseConnectionTimer) clearTimeout(state.sseConnectionTimer);
      state.sseConnectionTimer = null;
      startPolling();
    };

    state.sseConnectionTimer = setTimeout(() => {
      if (!receivedBusSnapshot) fallbackToPolling();
    }, 5000);

    eventSource.addEventListener('buses', event => {
      try {
        const snapshot = JSON.parse(event.data);
        renderBusSnapshot(snapshot);
        receivedBusSnapshot = true;
        if (state.sseConnectionTimer) clearTimeout(state.sseConnectionTimer);
        state.sseConnectionTimer = null;
      } catch (err) {
        console.error('Error parsing live bus update:', err);
      }
    });

    eventSource.addEventListener('notifications', event => {
      try {
        const data = JSON.parse(event.data);
        state.notifications = data.notifications || [];
        renderNotifications();
        updateTelemetryHeader();
      } catch (err) {
        console.error('Error parsing live notification update:', err);
      }
    });
    eventSource.onerror = fallbackToPolling;
  }

  /** Poll bus snapshots and notifications when EventSource is unavailable. */
  function startPolling() {
    if (state.pollingTimer) clearInterval(state.pollingTimer);
    fetchBuses();
    fetchNotifications();
    state.pollingTimer = setInterval(async () => {
      await fetchBuses();
      await fetchNotifications();
    }, state.pollInterval);
  }

  /** Close the live stream and timers when the page is leaving. */
  function closeLiveUpdates() {
    if (state.busEventSource) {
      state.busEventSource.close();
      state.busEventSource = null;
    }
    if (state.sseConnectionTimer) {
      clearTimeout(state.sseConnectionTimer);
      state.sseConnectionTimer = null;
    }
    if (state.pollingTimer) {
      clearInterval(state.pollingTimer);
      state.pollingTimer = null;
    }
  }

  /**
   * Demo Action: Toggle Delay on Bus
   */
  function getAdminToken() {
    let token = sessionStorage.getItem('unirideAdminToken');
    if (!token) {
      token = window.prompt('Enter the admin token to simulate or clear a delay:');
      if (!token) return null;
      sessionStorage.setItem('unirideAdminToken', token);
    }
    return token;
  }

  async function triggerDelay(busId, minutes, reason) {
    const adminToken = getAdminToken();
    if (!adminToken) return;
    try {
      const res = await fetch(`/api/demo/toggle-delay/${busId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': adminToken,
        },
        body: JSON.stringify({ minutes, reason }),
      });
      const data = await res.json();
      if (res.status === 401) {
        sessionStorage.removeItem('unirideAdminToken');
        alert(data.error || 'The admin token was not accepted. Please try again.');
        return;
      }
      if (!res.ok) {
        alert(data.error || 'Unable to change the bus delay.');
        return;
      }

      // Immediately refresh live data
      await fetchBuses();
      await fetchNotifications();
      await fetchSchedules();
      selectBus(busId, false);
    } catch (err) {
      console.error('Error toggling delay:', err);
    }
  }

  /**
   * Demo Action: Step Simulation 1 Tick Forward
   */
  async function stepSimulation() {
    try {
      await fetch('/api/demo/step', { method: 'POST' });
      await fetchBuses();
    } catch (err) {
      console.error('Error stepping simulation:', err);
    }
  }

  /**
   * Demo Action: Push Custom Coordinates (Testing POST /api/buses/:id/location)
   */
  async function postManualCoordinates() {
    try {
      // Pick Bus 101 and nudge coordinate slightly
      const bus = state.buses[0];
      if (!bus) return;
      const nudgeLat = bus.current_lat + 0.0008;
      const nudgeLng = bus.current_lng + 0.0008;

      const res = await fetch(`/api/buses/${bus.id}/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: nudgeLat,
          lng: nudgeLng,
          speed_mph: 22.4,
          heading: 45,
          status: 'On Time (Manual Push)',
        }),
      });
      const data = await res.json();
      alert(`Pushed GPS Telemetry to Backend!\nEndpoint: POST /api/buses/${bus.id}/location\nNew Coordinates: [${nudgeLat.toFixed(5)}, ${nudgeLng.toFixed(5)}]`);
      await fetchBuses();
      selectBus(bus.id, true);
    } catch (err) {
      console.error('Error pushing manual coordinates:', err);
    }
  }

  /**
   * Demo Action: Toggle Background Simulation Run/Pause
   */
  async function toggleSimulation() {
    try {
      const res = await fetch('/api/demo/toggle-simulation', { method: 'POST' });
      const data = await res.json();
      state.simRunning = data.running;

      const liveDot = document.getElementById('liveDot');
      const liveStatusText = document.getElementById('liveStatusText');
      const btnSimText = document.getElementById('btnSimText');

      if (state.simRunning) {
        if (liveDot) liveDot.classList.remove('paused');
        if (liveStatusText) liveStatusText.textContent = 'LIVE FEED (3s)';
        if (btnSimText) btnSimText.textContent = 'Pause Sim';
      } else {
        if (liveDot) liveDot.classList.add('paused');
        if (liveStatusText) liveStatusText.textContent = 'SIM PAUSED';
        if (btnSimText) btnSimText.textContent = 'Resume Sim';
      }
    } catch (err) {
      console.error('Error toggling simulation:', err);
    }
  }

  /**
   * Demo Action: Reset Demo State to Initial Seed
   */
  async function resetDemoState() {
    if (!confirm('Reset all buses, schedules, and alerts back to baseline demo state?')) return;
    try {
      await fetch('/api/demo/reset', { method: 'POST' });
      await fetchRoutes();
      await fetchBuses();
      await fetchNotifications();
      await fetchSchedules();
      alert('Demo database reset successfully.');
    } catch (err) {
      console.error('Error resetting demo state:', err);
    }
  }

  // Auto initialize on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', init);

  // Public API exposed for HTML onclick handlers
  return {
    init,
    selectBus,
    focusOnBus,
    triggerDelay,
    stepSimulation,
    postManualCoordinates,
    toggleSimulation,
    resetDemoState,
    dismissNotification,
  };
})();
