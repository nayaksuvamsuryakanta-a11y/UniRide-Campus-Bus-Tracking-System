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
    audienceRouteCodes: [],
    selectedBusId: null,
    showStops: true,
    simRunning: true,
    pollingTimer: null,
    busEventSource: null,
    sseConnectionTimer: null,
    pollInterval: 3000,    // 3 seconds
    mobileSheetExpanded: false,
    language: localStorage.getItem('unirideLanguage') === 'hi' ? 'hi' : 'en',
    audience: ['student', 'staff', 'visitor'].includes(localStorage.getItem('unirideAudience')) ? localStorage.getItem('unirideAudience') : '',
    hasBusSnapshot: false,
    connectionMode: 'connecting',
  };

  const TRANSLATIONS = {
    brandSubtitle: { en: 'Real-Time GPS Bus Tracker & Schedule', hi: 'बसों की लाइव GPS जानकारी और समय सारणी' },
    liveFeed: { en: 'LIVE FEED (3s)', hi: 'लाइव अपडेट (3 सेकंड)' }, connectedLive: { en: 'Live connection', hi: 'लाइव कनेक्शन' }, pollingConnection: { en: 'Polling for updates', hi: 'अपडेट जाँचे जा रहे हैं' },
    pauseEngine: { en: 'Pause Engine', hi: 'सिमुलेशन रोकें' }, resumeEngine: { en: 'Resume Engine', hi: 'सिमुलेशन चलाएँ' }, simPaused: { en: 'SIM PAUSED', hi: 'सिमुलेशन रुका है' }, pauseSimulation: { en: 'Pause simulation', hi: 'सिमुलेशन रोकें' }, resumeSimulation: { en: 'Resume simulation', hi: 'सिमुलेशन चलाएँ' },
    bus: { en: 'Bus', hi: 'बस' }, busesActive: { en: 'Buses Active', hi: 'सक्रिय बसें' }, campusRoutes: { en: 'Campus Routes', hi: 'कैंपस मार्ग' }, activeDelays: { en: 'Active Delays', hi: 'वर्तमान देरी' },
    pauseSim: { en: 'Pause Sim', hi: 'सिमुलेशन रोकें' }, resumeSim: { en: 'Resume Sim', hi: 'सिमुलेशन चलाएँ' }, demoControls: { en: 'Demo Controls', hi: 'डेमो नियंत्रण' }, fullDemoTools: { en: 'Full Demo Tools', hi: 'डेमो के सभी टूल' },
    searchRoutesStops: { en: 'Search routes or stops', hi: 'मार्ग या स्टॉप खोजें' }, liveFleet: { en: 'Live fleet', hi: 'लाइव बसें' }, schedules: { en: 'Schedules', hi: 'समय सारणी' }, demoGuide: { en: 'Demo Guide', hi: 'डेमो मार्गदर्शिका' },
    all: { en: 'All', hi: 'सभी' }, express: { en: 'Express', hi: 'एक्सप्रेस' }, tech: { en: 'Tech', hi: 'विज्ञान' }, residences: { en: 'Residences', hi: 'आवास' }, filter: { en: 'Filter:', hi: 'फ़िल्टर:' },
    connectingTelemetry: { en: 'Connecting to DHSGSU bus telemetry...', hi: 'DHSGSU बस जानकारी से जुड़ रहे हैं...' }, selectRoute: { en: 'Select Route:', hi: 'मार्ग चुनें:' }, allCampusRoutes: { en: 'All DHSGSU Campus Routes', hi: 'DHSGSU के सभी कैंपस मार्ग' },
    busRoute: { en: 'Bus / Route', hi: 'बस / मार्ग' }, stop: { en: 'Stop', hi: 'स्टॉप' }, scheduled: { en: 'Scheduled', hi: 'निर्धारित समय' }, estimatedArrival: { en: 'Est. Arrival', hi: 'अनुमानित आगमन' }, status: { en: 'Status', hi: 'स्थिति' },
    presentationScript: { en: '5-10 Minute Presentation Script', hi: '5–10 मिनट की प्रस्तुति रूपरेखा' }, interactiveGuide: { en: 'Interactive guide to demo the Dr. Harisingh Gour Vishwavidyalaya transit tracker.', hi: 'डॉ. हरिसिंह गौर विश्वविद्यालय के बस ट्रैकर का प्रदर्शन करने की मार्गदर्शिका।' },
    systemOverview: { en: '1. System Overview (1 min):', hi: '1. सिस्टम परिचय (1 मिनट):' }, systemOverviewText: { en: 'Flask REST API + SQLite spatial waypoints for DHSGSU Sagar campus on Patharia Hills + Leaflet.js real-time frontend.', hi: 'पठारिया पहाड़ियों पर स्थित DHSGSU सागर कैंपस के लिए Flask REST API, SQLite मार्ग-बिंदु और Leaflet.js लाइव इंटरफ़ेस।' },
    trackingTelemetry: { en: '2. Real-Time Tracking & Telemetry (2 mins):', hi: '2. लाइव ट्रैकिंग और बस जानकारी (2 मिनट):' }, trackingText: { en: 'See buses across campus roads, academic areas, residential areas, and public access points. Select any bus to view its speed, driver, and passenger load.', hi: 'कैंपस की सड़कों, शैक्षणिक और आवासीय क्षेत्रों तथा सार्वजनिक प्रवेश बिंदुओं पर बसें देखें। गति, चालक और यात्रियों की जानकारी के लिए कोई बस चुनें।' },
    delaySimulation: { en: '3. Delay Simulation & Notification Banner (3 mins):', hi: '3. देरी का प्रदर्शन और सूचना (3 मिनट):' }, delayText: { en: 'Simulate a delay on Bus 101 to demonstrate the immediate delay banner, map beacon, and timetable adjustment:', hi: 'बस 101 में देरी दिखाकर सूचना-पट्टी, मानचित्र संकेत और समय सारणी में बदलाव प्रदर्शित करें:' },
    simulateDelayBus: { en: 'Simulate Delay (Bus 101)', hi: 'बस 101 में देरी दिखाएँ' }, resolveDelay: { en: 'Resolve Delay', hi: 'देरी हटाएँ' }, locationUpdates: { en: '4. Live REST API Location Updates (2 mins):', hi: '4. लाइव REST API स्थान अपडेट (2 मिनट):' }, stepText: { en: 'Step simulation forward to show asynchronous GPS telemetry updates:', hi: 'GPS अपडेट दिखाने के लिए सिमुलेशन को एक कदम आगे बढ़ाएँ:' }, stepGps: { en: 'Step GPS Ping (1 tick)', hi: 'GPS अपडेट आगे बढ़ाएँ (1 चरण)' },
    centralExpress: { en: 'Campus Central Express', hi: 'कैंपस सेंट्रल एक्सप्रेस' }, scienceHealth: { en: 'Science & Health', hi: 'विज्ञान और स्वास्थ्य' }, hostelsSports: { en: 'Hostels & Sports', hi: 'छात्रावास और खेल' }, campusTransitSystem: { en: 'Dr. Harisingh Gour Vishwavidyalaya Campus Transit System', hi: 'डॉ. हरिसिंह गौर विश्वविद्यालय कैंपस बस सेवा' },
    connectingLive: { en: 'Connecting to live feed...', hi: 'लाइव फ़ीड से जुड़ रहे हैं...' }, presentationControls: { en: 'Presentation controls', hi: 'प्रस्तुति नियंत्रण' }, busToDelay: { en: 'Bus to delay', hi: 'देरी के लिए बस चुनें' }, triggerDelay15: { en: 'Trigger Delay (+15 min)', hi: 'देरी शुरू करें (+15 मिनट)' }, clearAllDelays: { en: 'Clear All Delays', hi: 'सभी देरी हटाएँ' }, resetDemo: { en: 'Reset Demo', hi: 'डेमो रीसेट करें' },
    fleet: { en: 'Fleet', hi: 'बसें' }, demo: { en: 'Demo', hi: 'डेमो' }, buses: { en: 'buses', hi: 'बसें' }, routes: { en: 'routes', hi: 'मार्ग' }, delays: { en: 'delays', hi: 'देरी' },
    centerMap: { en: 'Center on Map', hi: 'मानचित्र पर दिखाएँ' }, clearDelay: { en: 'Clear Delay', hi: 'देरी हटाएँ' }, simulateDelay: { en: 'Simulate Delay', hi: 'देरी दिखाएँ' },
    nextStop: { en: 'Next Stop', hi: 'अगला स्टॉप' }, etaToStop: { en: 'ETA to Stop', hi: 'स्टॉप तक अनुमानित समय' }, speed: { en: 'Speed', hi: 'गति' }, driver: { en: 'Driver', hi: 'चालक' }, passengerOccupancy: { en: 'Passenger Occupancy', hi: 'यात्री क्षमता' }, route: { en: 'Route', hi: 'मार्ग' }, inTransit: { en: 'In Transit', hi: 'रास्ते में' }, enRoute: { en: 'En route', hi: 'रास्ते में' }, mins: { en: 'mins', hi: 'मिनट' }, full: { en: 'Full', hi: 'भरा हुआ' }, occupancy: { en: 'Occupancy', hi: 'यात्री क्षमता' },
    stopSequence: { en: 'Stop Sequence', hi: 'स्टॉप क्रम' }, stopNumber: { en: 'Stop #', hi: 'स्टॉप #' }, frequencyEvery: { en: 'Frequency: Every {minutes} mins', hi: 'आवृत्ति: हर {minutes} मिनट' }, noActiveBuses: { en: 'No active buses in service.', hi: 'अभी कोई बस सेवा में नहीं है।' },
    allNormal: { en: 'All Transit Systems Normal', hi: 'बस सेवा सामान्य है' }, normalMessage: { en: 'All DHSGSU campus transit routes are operating on scheduled timetable. No active delays.', hi: 'DHSGSU कैंपस के सभी बस मार्ग निर्धारित समय पर चल रहे हैं। अभी कोई देरी नहीं है।' }, focusBus: { en: 'Focus on Bus', hi: 'बस पर जाएँ' }, dismissAlert: { en: 'Dismiss Alert', hi: 'सूचना हटाएँ' },
    noSchedules: { en: 'No schedule records found.', hi: 'समय सारणी की जानकारी उपलब्ध नहीं है।' }, campusBus: { en: 'Campus bus', hi: 'कैंपस बस' }, campusRoute: { en: 'Campus route', hi: 'कैंपस मार्ग' }, eta: { en: 'ETA', hi: 'अनुमानित समय' },
    mapCampusTitle: { en: 'Center map on DHSGSU campus', hi: 'मानचित्र पर DHSGSU कैंपस दिखाएँ' }, toggleStops: { en: 'Toggle Bus Stops visibility', hi: 'बस स्टॉप दिखाएँ या छिपाएँ' }, serviceSummary: { en: 'Service summary', hi: 'सेवा सारांश' }, mapSearchLabel: { en: 'Route and stop search', hi: 'मार्ग और स्टॉप खोजें' },
    liveTelemetry: { en: 'Live Telemetry', hi: 'लाइव जानकारी' }, updatedJustNow: { en: 'Updated just now', hi: 'अभी अपडेट किया गया' }, pollingInterval: { en: 'Polling Interval: 3000ms', hi: 'अपडेट अंतराल: 3000ms' },
    delayOnBusTitle: { en: 'Delay on Bus {bus}', hi: 'बस {bus} में देरी' }, delayOnBusMessage: { en: 'Bus {bus} is delayed by about {minutes} minutes near {stop}.', hi: 'बस {bus} को {stop} के पास लगभग {minutes} मिनट की देरी हो रही है।' },
    demoController: { en: 'DHSGSU Sagar Demo Controller', hi: 'DHSGSU सागर डेमो नियंत्रण' }, demoModalDescription: { en: 'Control live simulation, trigger delay alerts, and test REST endpoints', hi: 'लाइव सिमुलेशन नियंत्रित करें, देरी सूचनाएँ दिखाएँ और REST endpoints जाँचें' },
    delayNotificationSection: { en: '1. Delay & Notification Simulation', hi: '1. देरी और सूचना का प्रदर्शन' }, delaySectionDesc: { en: 'Instantly toggle delays to showcase the dynamic notification banner and schedule synchronization:', hi: 'सूचना-पट्टी और समय सारणी में बदलाव दिखाने के लिए बस में देरी शुरू या समाप्त करें:' }, delayBus101: { en: 'Delay Bus 101 (+15 min)', hi: 'बस 101 में देरी (+15 मिनट)' }, delayBus201: { en: 'Delay Bus 201 (+20 min)', hi: 'बस 201 में देरी (+20 मिनट)' },
    manualGpsSection: { en: '2. Manual GPS Telemetry Push', hi: '2. GPS जानकारी मैन्युअल भेजें' }, manualGpsDesc: { en: 'Demonstrates the POST /api/buses/:id/location backend endpoint:', hi: 'POST /api/buses/:id/location endpoint का प्रदर्शन:' }, forwardGps: { en: 'Forward GPS Step (All Buses)', hi: 'सभी बसों का GPS एक कदम आगे बढ़ाएँ' }, customGps: { en: 'Push Custom GPS Coordinates', hi: 'कस्टम GPS निर्देशांक भेजें' },
    simState: { en: '3. Simulation Engine & State', hi: '3. सिमुलेशन नियंत्रण और स्थिति' }, pauseResumeEngine: { en: 'Pause / Resume Engine', hi: 'सिमुलेशन रोकें / चलाएँ' }, resetDefault: { en: 'Reset Everything to Default', hi: 'सब कुछ शुरुआती स्थिति में लाएँ' }, keepBannerTip: { en: 'Tip: Keep the notification banner visible during your demo to show real-time synchronization.', hi: 'सुझाव: लाइव बदलाव दिखाने के लिए प्रदर्शन के दौरान सूचना-पट्टी खुली रखें।' }, closeControls: { en: 'Close Controls', hi: 'नियंत्रण बंद करें' },
    backendEndpoint: { en: 'backend endpoint:', hi: 'बैकएंड endpoint:' }, close: { en: 'Close', hi: 'बंद करें' }, languageToggle: { en: 'Switch language to Hindi', hi: 'भाषा English में बदलें' },
    collapseSheet: { en: 'Collapse bus and schedule sheet', hi: 'बस और समय सारणी पैनल समेटें' }, expandSheet: { en: 'Expand bus and schedule sheet', hi: 'बस और समय सारणी पैनल खोलें' },
    mapFiltersSummary: { en: 'Map filters and service summary', hi: 'मानचित्र फ़िल्टर और सेवा सारांश' }, routeFilter: { en: 'Filter buses by route', hi: 'मार्ग के अनुसार बसें छाँटें' }, mainNavigation: { en: 'Main navigation', hi: 'मुख्य नेविगेशन' }, openDemoControls: { en: 'Open demo controls', hi: 'डेमो नियंत्रण खोलें' }, demoDialog: { en: 'Demo controls', hi: 'डेमो नियंत्रण' },
    pageTitle: { en: 'UniRide — Dr. Harisingh Gour Vishwavidyalaya Transit Tracker', hi: 'UniRide — डॉ. हरिसिंह गौर विश्वविद्यालय बस ट्रैकर' }, mapUnavailable: { en: 'Interactive map could not load. Bus details remain available in the fleet list.', hi: 'इंटरैक्टिव मानचित्र लोड नहीं हो सका। बसों की जानकारी सूची में उपलब्ध है।' },
    unableDelay: { en: 'Unable to trigger delay.', hi: 'देरी शुरू नहीं की जा सकी।' }, unableClearDelays: { en: 'Unable to clear delays.', hi: 'देरी हटाई नहीं जा सकी।' }, unableReset: { en: 'Unable to reset the demo.', hi: 'डेमो रीसेट नहीं किया जा सका।' }, unableGpsPush: { en: 'Unable to push the GPS update.', hi: 'GPS अपडेट नहीं भेजा जा सका।' },
    adminPrompt: { en: 'Enter the admin token to simulate or clear a delay:', hi: 'देरी शुरू करने या हटाने के लिए एडमिन टोकन दर्ज करें:' }, adminRejected: { en: 'The admin token was not accepted. Please try again.', hi: 'एडमिन टोकन स्वीकार नहीं हुआ। कृपया फिर से प्रयास करें।' },
    gpsPushed: { en: 'Pushed GPS Telemetry to Backend!', hi: 'GPS जानकारी बैकएंड को भेज दी गई!' }, newCoordinates: { en: 'New Coordinates', hi: 'नए निर्देशांक' }, resetBaseline: { en: 'Reset all buses, schedules, and alerts back to baseline demo state?', hi: 'क्या सभी बसों, समय सारणी और सूचनाओं को शुरुआती डेमो स्थिति में रीसेट करें?' }, demoResetSuccess: { en: 'Demo database reset successfully.', hi: 'डेमो डेटा सफलतापूर्वक रीसेट हुआ।' },
    noBusAvailable: { en: 'No bus is available to delay.', hi: 'देरी के लिए कोई बस उपलब्ध नहीं है।' }, busAlreadyDelayed: { en: 'Bus {bus} already has an active delay. Use Clear All Delays to resolve it.', hi: 'बस {bus} में पहले से देरी है। इसे हटाने के लिए “सभी देरी हटाएँ” चुनें।' }, delayTriggered: { en: 'Delay triggered on Bus {bus}.', hi: 'बस {bus} में देरी शुरू की गई।' }, noDelaysToClear: { en: 'There are no active delays to clear.', hi: 'हटाने के लिए कोई सक्रिय देरी नहीं है।' }, delaysCleared: { en: 'Cleared delays on {count} {busWord}.', hi: '{count} {busWord} से देरी हटा दी गई।' }, oneBus: { en: 'bus', hi: 'बस' }, manyBuses: { en: 'buses', hi: 'बसों' }, confirmReset: { en: 'Are you sure? This resets buses, schedules, and alerts to the demo starting state.', hi: 'क्या आप निश्चित हैं? इससे बसें, समय सारणी और सूचनाएँ शुरुआती स्थिति में लौट जाएँगी।' }, resetComplete: { en: 'Demo reset complete.', hi: 'डेमो रीसेट हो गया।' },
    aboutTitle: { en: 'About / How to Use', hi: 'परिचय / उपयोग कैसे करें' }, aboutShort: { en: 'About', hi: 'परिचय' },
    aboutTextOne: { en: 'UniRide shows campus bus routes, stops, and live bus positions. Choose a route filter, then look for the nearest stop marker on the map; select a bus for its next stop and estimated arrival.', hi: 'UniRide कैंपस बसों के मार्ग, स्टॉप और उनकी लाइव स्थिति दिखाता है। मार्ग फ़िल्टर चुनें और मानचित्र पर पास का स्टॉप देखें; बस चुनने पर अगला स्टॉप और अनुमानित आगमन समय दिखेगा।' },
    aboutTextTwo: { en: 'The service is useful to students, university staff and faculty, and visitors or local residents. Bus locations in this demo are simulated.', hi: 'यह सेवा विद्यार्थियों, विश्वविद्यालय के कर्मचारियों और शिक्षकों, आगंतुकों तथा स्थानीय निवासियों के लिए उपयोगी है। इस डेमो में बसों की स्थिति सिमुलेशन से दिखाई जाती है।' },
    audiencePrompt: { en: 'I am a...', hi: 'मैं हूँ...' }, audienceDescription: { en: 'Choose a view to highlight useful routes. All routes and features remain available.', hi: 'उपयोगी मार्गों को प्राथमिकता से देखने के लिए एक विकल्प चुनें। सभी मार्ग और सुविधाएँ उपलब्ध रहेंगी।' },
    student: { en: 'Student', hi: 'विद्यार्थी' }, professorStaff: { en: 'Professor / Staff', hi: 'प्राध्यापक / कर्मचारी' }, visitorLocal: { en: 'Visitor / Local Resident', hi: 'आगंतुक / स्थानीय निवासी' },
    chooseAudience: { en: 'Choose audience', hi: 'दर्शक चुनें' }, changeAudience: { en: 'Change audience', hi: 'दर्शक बदलें' }, continueGeneral: { en: 'Continue with general view', hi: 'सामान्य दृश्य के साथ आगे बढ़ें' }, largerText: { en: 'Larger Text', hi: 'बड़ा अक्षर' },
  };

  const NAME_TRANSLATIONS = {
    'campus central express': 'कैंपस सेंट्रल एक्सप्रेस', 'science & health shuttle': 'विज्ञान और स्वास्थ्य शटल',
    'hostels & sports connector': 'छात्रावास और खेल संपर्क मार्ग', 'main gate': 'मुख्य द्वार',
    'administrative block': 'प्रशासनिक भवन', 'state bank of india branch': 'भारतीय स्टेट बैंक शाखा',
    'central library': 'केंद्रीय पुस्तकालय', 'law faculty': 'विधि संकाय',
    'gour sangrahalaya (university museum)': 'गौर संग्रहालय (विश्वविद्यालय संग्रहालय)',
    'university road': 'विश्वविद्यालय मार्ग', 'science faculty': 'विज्ञान संकाय',
    'advanced research labs': 'उन्नत अनुसंधान प्रयोगशालाएँ', 'university health centre': 'विश्वविद्यालय स्वास्थ्य केंद्र',
    'botanical garden': 'वनस्पति उद्यान', 'law faculty junction': 'विधि संकाय चौराहा',
    'shopping complex': 'खरीदारी परिसर', 'boys hostel block': 'बालक छात्रावास भवन',
    'sports complex/stadium': 'खेल परिसर / स्टेडियम', 'girls hostel block': 'बालिका छात्रावास भवन',
    'student activity centre': 'छात्र गतिविधि केंद्र', 'faculty residences': 'शिक्षक आवास', 'staff quarters': 'कर्मचारी आवास', 'guest house': 'अतिथि गृह',
  };

  function t(key, values = {}) {
    const entry = TRANSLATIONS[key];
    let value = entry ? entry[state.language] : key;
    Object.entries(values).forEach(([name, replacement]) => { value = value.replaceAll(`{${name}}`, String(replacement)); });
    return value;
  }

  function localizedName(value) {
    if (state.language !== 'hi' || !value) return value || '';
    return NAME_TRANSLATIONS[String(value).toLowerCase()] || value;
  }

  function localizedStatus(value, delayed = false, minutes = 0) {
    if (state.language !== 'hi') return value || 'Unknown';
    if (delayed || /delayed/i.test(value || '')) return `देरी (+${minutes || (String(value).match(/\d+/) || ['15'])[0]} मिनट)`;
    if (/on time/i.test(value || '')) return 'समय पर';
    if (/departed/i.test(value || '')) return 'रवाना हो गई';
    return value || 'अज्ञात';
  }

  function applyTranslations() {
    document.documentElement.lang = state.language;
    document.title = t('pageTitle');
    document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(node => { node.placeholder = t(node.dataset.i18nPlaceholder); });
    document.querySelectorAll('[data-i18n-title]').forEach(node => { node.title = t(node.dataset.i18nTitle); });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(node => { node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel)); });
    document.querySelectorAll('[data-i18n-value]').forEach(node => { node.value = t(node.dataset.i18nValue); });
    const toggle = document.getElementById('languageToggle');
    if (toggle) {
      toggle.innerHTML = state.language === 'en' ? '<span class="language-active">EN</span><span class="language-divider">/</span><span lang="hi">हिं</span>' : '<span>EN</span><span class="language-divider">/</span><span class="language-active" lang="hi">हिं</span>';
      toggle.setAttribute('aria-label', t('languageToggle'));
      toggle.title = t('languageToggle');
    }
    updateAudienceLabel();
    updateFontSizeButton();
    const lastUpdated = document.getElementById('bottomLastUpdated');
    if (lastUpdated?.dataset.lastUpdatedTime) lastUpdated.textContent = `${t('liveTelemetry')} • ${lastUpdated.dataset.lastUpdatedTime}`;
    if (state.simRunning === false) {
      const status = document.getElementById('liveStatusText');
      const simText = document.getElementById('btnSimText');
      const modalText = document.getElementById('modalToggleSimBtn');
      if (status) status.textContent = t('simPaused');
      if (simText) simText.textContent = t('resumeSim');
      if (modalText) modalText.querySelector('[data-i18n]')?.replaceChildren(t('resumeEngine'));
    } else {
      const status = document.getElementById('liveStatusText');
      const simText = document.getElementById('btnSimText');
      if (status) status.textContent = t('liveFeed');
      if (simText) simText.textContent = t('pauseSim');
    }
    document.getElementById('btnToggleSim')?.setAttribute('aria-label', t(state.simRunning === false ? 'resumeSimulation' : 'pauseSimulation'));
    setQuickConnection(state.connectionMode);
    renderLocalizedDynamicContent();
  }

  function renderLocalizedDynamicContent() {
    const tab = document.body.dataset.activeTab || 'fleet';
    const label = document.getElementById('sheetToggleLabel');
    if (label) label.textContent = t(tab === 'schedules' ? 'schedules' : tab === 'presentation' ? 'demoGuide' : tab === 'about' ? 'aboutShort' : 'liveFleet');
    const scheduleSelect = document.getElementById('scheduleRouteSelect');
    if (scheduleSelect && state.routes.length) {
      const selected = scheduleSelect.value;
      scheduleSelect.innerHTML = `<option value="">${t('allCampusRoutes')}</option>` + state.routes.map(route => `<option value="${route.id}">${localizedName(route.name)} (${route.code})</option>`).join('');
      scheduleSelect.value = selected;
    }
    renderRouteLines();
    renderStops();
    updateBusMarkers();
    renderBusList();
    renderNotifications();
    renderSchedules();
    updateTelemetryHeader();
    applyRouteFilter();
  }

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
    document.body.dataset.activeTab = 'fleet';
    state.audienceRouteCodes = audienceRoutes(state.audience);
    const savedFilter = localStorage.getItem('unirideRouteFilter');
    state.selectedRouteFilter = ['all', 'CAMP-10', 'SCI-20', 'HOST-30'].includes(savedFilter) ? savedFilter : 'all';
    document.body.dataset.mobileSheetState = 'collapsed';
    document.querySelector('.sidebar')?.classList.add('is-collapsed');
    document.querySelectorAll('.demo-section').forEach(section => {
      section.open = !window.matchMedia('(max-width: 768px)').matches;
    });
    applyTranslations();
    syncRouteFilterButtons();
    if (!localStorage.getItem('unirideAudience')) openAudienceDialog();
    try {
      if (typeof L === 'undefined') throw new Error('Leaflet did not load');
      initMap();
    } catch (err) {
      console.error('Interactive map unavailable:', err);
      const mapContainer = document.getElementById('map');
      if (mapContainer) {
        mapContainer.innerHTML = `<div class="map-unavailable">${t('mapUnavailable')}</div>`;
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

    // Mobile zoom controls sit above the future collapsed bottom sheet.
    L.control.zoom({ position: 'bottomright' }).addTo(state.map);

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
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(invalidateMobileMapSize);
    });
    window.setTimeout(invalidateMobileMapSize, 120);

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
    document.getElementById('languageToggle')?.addEventListener('click', () => {
      state.language = state.language === 'en' ? 'hi' : 'en';
      localStorage.setItem('unirideLanguage', state.language);
      applyTranslations();
    });
    document.getElementById('audienceToggle')?.addEventListener('click', openAudienceDialog);
    document.getElementById('fontSizeToggle')?.addEventListener('click', () => {
      const enlarged = !document.documentElement.classList.contains('large-text');
      document.documentElement.classList.toggle('large-text', enlarged);
      localStorage.setItem('unirideLargeText', enlarged ? 'true' : 'false');
      updateFontSizeButton();
    });
    document.getElementById('audienceDialogClose')?.addEventListener('click', dismissAudienceDialog);
    document.getElementById('audienceDismiss')?.addEventListener('click', () => {
      localStorage.setItem('unirideAudience', 'general');
      state.audience = 'general';
      closeAudienceDialog();
      updateAudienceLabel();
    });
    document.querySelectorAll('[data-audience]').forEach(button => button.addEventListener('click', () => {
      state.audience = button.dataset.audience;
      localStorage.setItem('unirideAudience', state.audience);
      state.audienceRouteCodes = audienceRoutes(state.audience);
      state.selectedRouteFilter = 'all';
      localStorage.setItem('unirideRouteFilter', state.selectedRouteFilter);
      syncRouteFilterButtons();
      applyRouteFilter();
      closeAudienceDialog();
      updateAudienceLabel();
    }));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !document.getElementById('audienceDialog')?.hidden) dismissAudienceDialog();
    });
    document.documentElement.classList.toggle('large-text', localStorage.getItem('unirideLargeText') === 'true');
    updateFontSizeButton();
    // Tab Switching
    document.querySelectorAll('.tab-btn, .bottom-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activateTab(btn.getAttribute('data-tab'));
      });
    });

    // Filter Chips for Routes
    document.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        state.selectedRouteFilter = chip.getAttribute('data-filter');
        localStorage.setItem('unirideRouteFilter', state.selectedRouteFilter);
        document.querySelectorAll('.chip').forEach(c => {
          c.classList.toggle('active', c.getAttribute('data-filter') === state.selectedRouteFilter);
        });
        applyRouteFilter();
      });
    });

    // Keep the existing desktop demo panel fully expanded; accordion behavior
    // is reserved for the mobile bottom sheet.
    document.querySelectorAll('.demo-section > summary').forEach(summary => {
      summary.addEventListener('click', event => {
        if (window.innerWidth > 768) event.preventDefault();
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

    const quickDemoToggle = document.getElementById('quickDemoToggle');
    const quickDemoPanel = document.getElementById('quickDemoPanel');
    quickDemoToggle?.addEventListener('click', () => {
      const expanded = quickDemoToggle.getAttribute('aria-expanded') === 'true';
      quickDemoToggle.setAttribute('aria-expanded', String(!expanded));
      if (quickDemoPanel) quickDemoPanel.hidden = expanded;
      if (!expanded) document.getElementById('quickDemoBus')?.focus();
    });
    document.getElementById('quickTriggerDelay')?.addEventListener('click', triggerQuickDelay);
    document.getElementById('quickClearDelays')?.addEventListener('click', clearAllDelays);
    document.getElementById('quickResetDemo')?.addEventListener('click', resetQuickDemo);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && quickDemoPanel && !quickDemoPanel.hidden) {
        quickDemoPanel.hidden = true;
        quickDemoToggle?.setAttribute('aria-expanded', 'false');
        quickDemoToggle?.focus();
      }
    });

    // Modal Controls
    const btnOpenDemo = document.getElementById('btnOpenDemoModal');
    const btnOpenDemoFab = document.getElementById('btnOpenDemoFab');
    const modal = document.getElementById('demoModal');
    const btnCloseDemo = document.getElementById('btnCloseDemoModal');
    const btnDoneDemo = document.getElementById('btnDoneDemoModal');

    if (btnOpenDemo) btnOpenDemo.addEventListener('click', openDemoControls);
    if (btnOpenDemoFab) btnOpenDemoFab.addEventListener('click', openDemoControls);
    if (btnCloseDemo) btnCloseDemo.addEventListener('click', closeDemoControls);
    if (btnDoneDemo) btnDoneDemo.addEventListener('click', closeDemoControls);
    if (modal) {
      modal.addEventListener('click', event => {
        if (event.target === modal) closeDemoControls();
      });
      const modalHeader = modal.querySelector('.modal-header');
      let touchStartY = null;
      modalHeader?.addEventListener('pointerdown', event => { touchStartY = event.clientY; });
      modalHeader?.addEventListener('pointerup', event => {
        if (touchStartY !== null && event.clientY - touchStartY > 70) closeDemoControls();
        touchStartY = null;
      });
      modalHeader?.addEventListener('pointercancel', () => { touchStartY = null; });
    }

    const sheetToggle = document.getElementById('sheetToggle');
    let sheetStartY = null;
    let suppressSheetClick = false;
    sheetToggle?.addEventListener('pointerdown', event => {
      sheetStartY = event.clientY;
      suppressSheetClick = false;
    });
    sheetToggle?.addEventListener('pointerup', event => {
      if (sheetStartY === null) return;
      const delta = event.clientY - sheetStartY;
      if (Math.abs(delta) > 28) {
        setMobileSheetExpanded(delta < 0);
        suppressSheetClick = true;
      }
      sheetStartY = null;
    });
    sheetToggle?.addEventListener('pointercancel', () => { sheetStartY = null; });
    sheetToggle?.addEventListener('click', () => {
      if (suppressSheetClick) {
        suppressSheetClick = false;
        return;
      }
      setMobileSheetExpanded(!state.mobileSheetExpanded);
    });

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

  function audienceRoutes(audience) {
    if (audience === 'student') return ['HOST-30'];
    if (audience === 'staff') return ['CAMP-10', 'HOST-30'];
    if (audience === 'visitor') return ['CAMP-10', 'HOST-30'];
    return [];
  }

  function syncRouteFilterButtons() {
    document.querySelectorAll('.chip').forEach(chip => chip.classList.toggle('active', chip.dataset.filter === state.selectedRouteFilter));
  }

  function updateAudienceLabel() {
    const label = document.getElementById('audienceLabel');
    if (!label) return;
    const key = state.audience === 'student' ? 'student' : state.audience === 'staff' ? 'professorStaff' : state.audience === 'visitor' ? 'visitorLocal' : 'chooseAudience';
    label.textContent = t(key);
  }

  function updateFontSizeButton() {
    const button = document.getElementById('fontSizeToggle');
    const active = document.documentElement.classList.contains('large-text');
    if (button) button.setAttribute('aria-pressed', String(active));
  }

  function openAudienceDialog() {
    const dialog = document.getElementById('audienceDialog');
    if (dialog) { dialog.hidden = false; dialog.querySelector('[data-audience]')?.focus(); }
  }

  function closeAudienceDialog() {
    const dialog = document.getElementById('audienceDialog');
    if (dialog) dialog.hidden = true;
    document.getElementById('audienceToggle')?.focus();
  }

  function dismissAudienceDialog() {
    if (!localStorage.getItem('unirideAudience')) {
      state.audience = 'general';
      localStorage.setItem('unirideAudience', 'general');
    }
    closeAudienceDialog();
    updateAudienceLabel();
  }

  function activateTab(targetTab) {
    if (!targetTab) return;
    document.body.dataset.activeTab = targetTab;
    document.querySelectorAll('.tab-btn, .bottom-nav-btn').forEach(btn => {
      const isActive = btn.getAttribute('data-tab') === targetTab;
      btn.classList.toggle('active', isActive);
      if (btn.classList.contains('bottom-nav-btn')) {
        if (isActive) btn.setAttribute('aria-current', 'page');
        else btn.removeAttribute('aria-current');
      }
    });
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `pane-${targetTab}`);
    });

    const label = document.getElementById('sheetToggleLabel');
    if (label) label.textContent = t(targetTab === 'schedules'
      ? 'schedules'
      : targetTab === 'presentation' ? 'demoGuide' : targetTab === 'about' ? 'aboutShort' : 'liveFleet');

    if (targetTab === 'schedules') fetchSchedules();
    if (window.matchMedia('(max-width: 768px)').matches && targetTab !== 'presentation') {
      setMobileSheetExpanded(true);
    } else if (window.matchMedia('(max-width: 768px)').matches) {
      setMobileSheetExpanded(false);
    }
  }

  function setMobileSheetExpanded(expanded) {
    if (!window.matchMedia('(max-width: 768px)').matches) return;
    state.mobileSheetExpanded = Boolean(expanded);
    document.body.dataset.mobileSheetState = state.mobileSheetExpanded ? 'expanded' : 'collapsed';
    const sidebar = document.querySelector('.sidebar');
    const toggle = document.getElementById('sheetToggle');
    if (sidebar) {
      sidebar.classList.toggle('is-expanded', state.mobileSheetExpanded);
      sidebar.classList.toggle('is-collapsed', !state.mobileSheetExpanded);
    }
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(state.mobileSheetExpanded));
      toggle.setAttribute('aria-label', t(state.mobileSheetExpanded ? 'collapseSheet' : 'expandSheet'));
    }
    if (state.map) {
      window.setTimeout(() => state.map.invalidateSize({ pan: false }), 240);
    }
  }

  function openDemoControls() {
    const modal = document.getElementById('demoModal');
    if (!modal) return;
    modal.classList.add('show');
    document.body.classList.add('demo-controls-open');
  }

  function closeDemoControls() {
    const modal = document.getElementById('demoModal');
    if (modal) modal.classList.remove('show');
    document.body.classList.remove('demo-controls-open');
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
        const selected = sel.value;
        sel.innerHTML = `<option value="">${t('allCampusRoutes')}</option>` +
          state.routes.map(r => `<option value="${r.id}">${localizedName(r.name)} (${r.code})</option>`).join('');
        sel.value = selected;
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
    Object.values(state.routePolylines).forEach(({ line, glow }) => {
      if (state.map.hasLayer(line)) state.map.removeLayer(line);
      if (state.map.hasLayer(glow)) state.map.removeLayer(glow);
    });
    state.routePolylines = {};
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

        line.bindTooltip(`<strong>${localizedName(route.name)}</strong><br>${t('frequencyEvery', { minutes: route.frequency_mins })}`, {
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
          html: `<div class="stop-marker-pin" style="border-color: ${route.color};" title="${localizedName(stop.name)}"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });

        const marker = L.marker([stop.lat, stop.lng], { icon }).addTo(state.map);
        
        marker.bindPopup(`
          <div class="custom-popup">
            <div class="popup-header">
              <span class="popup-title">${localizedName(stop.name)}</span>
              <span class="bus-route-tag" style="background-color: ${route.color}">${route.code}</span>
            </div>
            <div class="popup-row">
              <span class="popup-label">${t('route')}:</span>
              <span class="popup-val">${localizedName(route.name)}</span>
            </div>
            <div class="popup-row">
              <span class="popup-label">${t('stopSequence')}:</span>
              <span class="popup-val">${t('stopNumber')}${stop.stop_order}</span>
            </div>
          </div>
        `);

        marker.bindTooltip(`📍 ${stop.name}`, { direction: 'top', offset: [0, -8] });
        if (!state.showStops) state.map.removeLayer(marker);
        marker.bindTooltip(localizedName(stop.name), { direction: 'top', offset: [0, -8] });
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
    state.hasBusSnapshot = true;
    renderQuickDemoBuses();
    hideMapConnectOverlay();
    updateBusMarkers();
    renderBusList();
    updateTelemetryHeader();
    applyRouteFilter();
  }

  function renderQuickDemoBuses() {
    const select = document.getElementById('quickDemoBus');
    if (!select) return;
    const previous = select.value;
    select.replaceChildren();
    state.buses.forEach(bus => {
      const option = document.createElement('option');
      option.value = bus.id;
      option.textContent = `${t('bus')} ${bus.bus_number}`;
      select.append(option);
    });
    if (state.buses.some(bus => String(bus.id) === previous)) select.value = previous;
    select.disabled = state.buses.length === 0;
  }

  function setQuickConnection(mode) {
    state.connectionMode = mode;
    const dot = document.getElementById('quickConnectionDot');
    const text = document.getElementById('quickConnectionText');
    if (dot) dot.className = `connection-dot ${mode}`;
    if (text) text.textContent = t(mode === 'connected' ? 'connectedLive' : mode === 'polling' ? 'pollingConnection' : 'connectingLive');
  }

  function hideMapConnectOverlay() {
    const overlay = document.getElementById('mapConnectOverlay');
    if (overlay) overlay.hidden = true;
  }

  let toastTimer = null;
  function showDemoToast(message, isError = false) {
    const toast = document.getElementById('demoToast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle('error', isError);
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  async function triggerQuickDelay() {
    const busId = Number(document.getElementById('quickDemoBus')?.value);
    const bus = state.buses.find(item => item.id === busId);
    if (!bus) return showDemoToast(t('noBusAvailable'), true);
    if (Number(bus.delay_minutes) > 0) return showDemoToast(t('busAlreadyDelayed', { bus: bus.bus_number }));
    const token = getAdminToken();
    if (!token) return;
    try {
      const response = await fetch(`/api/demo/toggle-delay/${busId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ minutes: 15, reason: 'Presentation demo delay' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to trigger delay.');
      showDemoToast(t('delayTriggered', { bus: bus.bus_number }));
      await Promise.all([fetchBuses(), fetchNotifications(), fetchSchedules()]);
    } catch (error) {
      if (error.message.includes('admin token')) sessionStorage.removeItem('unirideAdminToken');
      showDemoToast(error.message || t('unableDelay'), true);
    }
  }

  async function clearAllDelays() {
    const delayedBuses = state.buses.filter(bus => Number(bus.delay_minutes) > 0);
    if (!delayedBuses.length) return showDemoToast(t('noDelaysToClear'));
    const token = getAdminToken();
    if (!token) return;
    try {
      for (const bus of delayedBuses) {
        const response = await fetch(`/api/demo/toggle-delay/${bus.id}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: JSON.stringify({ minutes: 0 }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Unable to clear Bus ${bus.bus_number}.`);
      }
      showDemoToast(t('delaysCleared', { count: delayedBuses.length, busWord: t(delayedBuses.length === 1 ? 'oneBus' : 'manyBuses') }));
      await Promise.all([fetchBuses(), fetchNotifications(), fetchSchedules()]);
    } catch (error) {
      if (error.message.includes('admin token')) sessionStorage.removeItem('unirideAdminToken');
      showDemoToast(error.message || t('unableClearDelays'), true);
    }
  }

  async function resetQuickDemo() {
    if (!window.confirm(t('confirmReset'))) return;
    try {
      const response = await postAdminAction('/api/demo/reset');
      if (!response) return;
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to reset the demo.');
      await Promise.all([fetchRoutes(), fetchBuses(), fetchNotifications(), fetchSchedules()]);
      showDemoToast(t('resetComplete'));
    } catch (error) {
      showDemoToast(error.message || t('unableReset'), true);
    }
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
            ${localizedStatus(bus.status, isDelayed, bus.delay_minutes)}
          </span>
        </div>
        <div class="popup-row">
          <span class="popup-label">${t('route')}:</span>
          <span class="popup-val" style="color:${bus.route_color}">${localizedName(bus.route_name)}</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">${t('driver')}:</span>
          <span class="popup-val">${formatDriverName(bus.driver_name)}</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">${t('speed')}:</span>
          <span class="popup-val">${bus.speed_mph} mph</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">${t('nextStop')}:</span>
          <span class="popup-val">${localizedName(bus.next_stop_name) || t('inTransit')}</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">${t('eta')}:</span>
          <span class="popup-val">${bus.eta_minutes} ${t('mins')}</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">${t('occupancy')}:</span>
          <span class="popup-val">${bus.capacity_percent}% ${t('full')}</span>
        </div>
        <div class="action-row" style="margin-top: 8px;">
          <button class="btn ${isDelayed ? 'btn-success' : 'btn-warning'} btn-sm" style="width: 100%;"
                  onclick="App.triggerDelay(${bus.id}, ${isDelayed ? 0 : 15}, 'Simulated Demo Delay')">
            ${isDelayed ? t('clearDelay') : `${t('simulateDelay')} (+15m)`}
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
      if (!state.hasBusSnapshot) return;
      container.innerHTML = `<div class="loading-state"><span>${t('noActiveBuses')}</span></div>`;
      updateMobilePeekCard();
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
              ${localizedStatus(bus.status, isDelayed, bus.delay_minutes)}
            </span>
          </div>

          <div class="bus-details-grid">
            <div class="detail-item">
              <span class="detail-label">${t('nextStop')}</span>
              <span class="detail-value" title="${localizedName(bus.next_stop_name) || t('enRoute')}">
                ${bus.next_stop_name ? (localizedName(bus.next_stop_name).length > 18 ? localizedName(bus.next_stop_name).substring(0, 18) + '...' : localizedName(bus.next_stop_name)) : t('inTransit')}
              </span>
            </div>
            <div class="detail-item">
              <span class="detail-label">${t('etaToStop')}</span>
              <span class="detail-value">
                ${ICONS.clock}
                ${bus.eta_minutes} ${t('mins')}
              </span>
            </div>
            <div class="detail-item">
              <span class="detail-label">${t('speed')}</span>
              <span class="detail-value">
                ${ICONS.speed}
                ${bus.speed_mph} mph
              </span>
            </div>
            <div class="detail-item">
              <span class="detail-label">${t('driver')}</span>
              <span class="detail-value">
                ${formatDriverName(bus.driver_name)}
              </span>
            </div>
          </div>

          <div class="capacity-wrapper">
            <div class="capacity-header">
              <span>${t('passengerOccupancy')}</span>
              <span>${bus.capacity_percent}%</span>
            </div>
            <div class="capacity-bar-track">
              <div class="capacity-bar-fill" style="width: ${bus.capacity_percent}%; background-color: ${capColor};"></div>
            </div>
          </div>

          <div class="bus-card-actions">
            <button class="btn btn-outline btn-sm" style="flex:1;" onclick="event.stopPropagation(); App.focusOnBus(${bus.id});">
              ${t('centerMap')}
            </button>
            <button class="btn ${isDelayed ? 'btn-success' : 'btn-warning'} btn-sm" style="flex:1;" 
                    onclick="event.stopPropagation(); App.triggerDelay(${bus.id}, ${isDelayed ? 0 : 15}, 'Patharia Hills road maintenance work')">
              ${isDelayed ? t('clearDelay') : t('simulateDelay')}
            </button>
          </div>
        </div>
      `;
    }).join('');
    updateMobilePeekCard();
  }

  function updateMobilePeekCard() {
    if (!window.matchMedia('(max-width: 768px)').matches) return;
    const cards = Array.from(document.querySelectorAll('.bus-card'));
    const visibleCards = cards.filter(card => card.style.display !== 'none');
    const selectedCard = visibleCards.find(card => Number(card.dataset.busId) === state.selectedBusId);
    const peekCard = selectedCard || visibleCards[0];
    cards.forEach(card => card.classList.toggle('mobile-peek-card', card === peekCard));
  }

  /**
   * Filter Buses and Polylines by Route Chip
   */
  function applyRouteFilter() {
    const filter = state.selectedRouteFilter;

    // Filter Sidebar Cards
    document.querySelectorAll('.bus-card').forEach(card => {
      const code = card.getAttribute('data-route-code');
      card.classList.toggle('audience-recommended', state.audienceRouteCodes?.includes(code));
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
      const recommended = state.audienceRouteCodes?.includes(code);
      line.setStyle({ weight: recommended ? 6 : 4, opacity: recommended ? 1 : 0.9 });
      glow.setStyle({ weight: recommended ? 11 : 8, opacity: recommended ? 0.35 : 0.25 });
      if (filter === 'all' || code === filter) {
        if (!state.map.hasLayer(line)) line.addTo(state.map);
        if (!state.map.hasLayer(glow)) glow.addTo(state.map);
      } else {
        if (state.map.hasLayer(line)) state.map.removeLayer(line);
        if (state.map.hasLayer(glow)) state.map.removeLayer(glow);
      }
    });
    updateMobilePeekCard();
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
              <span class="notif-title" style="color: #166534;">${t('allNormal')}</span>
              <span class="notif-msg" style="color: #15803d;">${t('normalMessage')}</span>
            </div>
          </div>
        </div>
      `;
      return;
    }

    // Render active delay alerts
    container.innerHTML = state.notifications.map(notif => {
      const isDanger = notif.severity === 'danger';
      const bus = state.buses.find(item => item.id === notif.bus_id);
      const isDelayAlert = Boolean(bus && (Number(bus.delay_minutes) > 0 || /delay/i.test(notif.title || '')));
      const delayMinutes = bus?.delay_minutes || (String(notif.title || '').match(/\+(\d+)/) || [])[1] || 15;
      const busNumber = String(bus?.bus_number || '').replace(/^bus\s+/i, '');
      const title = isDelayAlert
        ? t('delayOnBusTitle', { bus: busNumber })
        : localizedName(notif.title);
      const message = isDelayAlert
        ? t('delayOnBusMessage', { bus: busNumber, minutes: delayMinutes, stop: localizedName(bus.next_stop_name) || t('route') })
        : localizedName(notif.message);
      return `
        <div class="notification-banner ${isDanger ? 'danger' : ''}">
          <div class="notif-content">
            <div class="notif-icon">${ICONS.alert}</div>
            <div class="notif-text-wrap">
              <div class="notif-title-row">
                <span class="notif-title">${title}</span>
                ${notif.route_name ? `<span class="brand-badge" style="background:#fef08a; color:#854d0e;">${localizedName(notif.route_name)}</span>` : ''}
              </div>
              <span class="notif-msg">${message}</span>
            </div>
          </div>
          <div class="notif-actions">
            ${notif.bus_id ? `
              <button class="btn-notif-action" onclick="App.focusOnBus(${notif.bus_id})">
                ${t('focusBus')}
              </button>
            ` : ''}
            <button class="btn-notif-dismiss" title="${t('dismissAlert')}" aria-label="${t('dismissAlert')}" onclick="App.dismissNotification(${notif.id})">
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
    const cardContainer = document.getElementById('scheduleCards');
    if (!tbody && !cardContainer) return;

    if (state.schedules.length === 0) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px;">${t('noSchedules')}</td></tr>`;
      if (cardContainer) cardContainer.innerHTML = `<div class="schedule-empty-state">${t('noSchedules')}</div>`;
      return;
    }

    const schedules = state.schedules.map(item => {
      const rawStatus = String(item.status || 'Unknown');
      const isDelayed = rawStatus.toLowerCase().includes('delay');
      const isDeparted = rawStatus.toLowerCase().includes('departed');
      const bus = state.buses.find(candidate => candidate.bus_number === item.bus_number);
      const status = localizedStatus(rawStatus, isDelayed, bus?.delay_minutes || (rawStatus.match(/\+(\d+)/) || [])[1]);
      
      let badgeClass = 'on-time';
      if (isDelayed) badgeClass = 'delayed';
      else if (isDeparted) badgeClass = '';

      const row = `
        <tr>
          <td>
            <div style="display:flex; flex-direction:column;">
              <span style="font-weight:700;">${item.bus_number || 'TBD'}</span>
              <span style="font-size:0.68rem; color:${item.route_color};">${localizedName(item.route_name)}</span>
            </div>
          </td>
          <td><strong>${localizedName(item.stop_name)}</strong></td>
          <td><span style="font-family:var(--font-mono); font-size:0.75rem;">${item.scheduled_time}</span></td>
          <td><span style="font-family:var(--font-mono); font-size:0.75rem; font-weight:600;">${item.estimated_time}</span></td>
          <td>
            <span class="status-badge ${badgeClass}" style="display:inline-flex;">
              ${status}
            </span>
          </td>
        </tr>
      `;
      let cardStatusClass = isDelayed ? 'is-delayed' : '';
      if (isDelayed && /critical|severe|danger/i.test(status)) cardStatusClass = 'is-danger';
      const card = `
        <article class="schedule-card" style="--schedule-route-color: ${item.route_color || '#2563eb'}">
          <h3 class="schedule-card-title">
            ${item.bus_number || t('campusBus')}
            <span class="schedule-card-subtitle">${localizedName(item.route_name) || t('campusRoute')}</span>
          </h3>
          <div class="schedule-card-grid">
            <div class="schedule-card-field"><span class="schedule-card-label">${t('stop')}</span><span class="schedule-card-value">${localizedName(item.stop_name)}</span></div>
            <div class="schedule-card-field"><span class="schedule-card-label">${t('scheduled')}</span><span class="schedule-card-value">${item.scheduled_time}</span></div>
            <div class="schedule-card-field"><span class="schedule-card-label">${t('eta')}</span><span class="schedule-card-value">${item.estimated_time}</span></div>
            <div class="schedule-card-field"><span class="schedule-card-label">${t('status')}</span><span class="schedule-status-pill ${cardStatusClass}">${status}</span></div>
          </div>
        </article>
      `;
      return { row, card };
    });
    if (tbody) tbody.innerHTML = schedules.map(item => item.row).join('');
    if (cardContainer) cardContainer.innerHTML = schedules.map(item => item.card).join('');
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

    const mobileStatBuses = document.getElementById('mobileStatActiveBuses');
    const mobileStatRoutes = document.getElementById('mobileStatRoutes');
    const mobileStatAlerts = document.getElementById('mobileStatAlerts');
    const mobileStatAlertsChip = document.getElementById('mobileStatAlertsChip');
    if (mobileStatBuses) mobileStatBuses.textContent = state.buses.length;
    if (mobileStatRoutes) mobileStatRoutes.textContent = state.routes.length;
    if (mobileStatAlerts) mobileStatAlerts.textContent = state.notifications.length;
    if (mobileStatAlertsChip) {
      const hasAlerts = state.notifications.length > 0;
      mobileStatAlertsChip.classList.toggle('is-alert', hasAlerts);
      mobileStatAlertsChip.classList.toggle('is-clear', !hasAlerts);
      mobileStatAlertsChip.setAttribute('aria-label', `${state.notifications.length} ${t('activeDelays').toLowerCase()}`);
    }

    if (bottomLastUpdated) {
      const now = new Date();
      bottomLastUpdated.dataset.lastUpdatedTime = now.toLocaleTimeString();
      bottomLastUpdated.textContent = `${t('liveTelemetry')} • ${bottomLastUpdated.dataset.lastUpdatedTime}`;
    }
  }

  /**
   * Select and Center on a Bus
   */
  function selectBus(busId, fly = true) {
    state.selectedBusId = busId;
    const bus = state.buses.find(b => b.id === busId);
    if (!bus) return;

    if (window.matchMedia('(max-width: 768px)').matches) {
      if (document.body.dataset.activeTab !== 'fleet') activateTab('fleet');
      setMobileSheetExpanded(true);
    }

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
    updateMobilePeekCard();
    if (window.matchMedia('(max-width: 768px)').matches) {
      window.setTimeout(() => {
        document.querySelector(`.bus-card[data-bus-id="${busId}"]`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }, 240);
    }
  }

  function focusOnBus(busId) {
    selectBus(busId, true);
  }

  /**
   * Live bus stream with polling fallback for browsers without EventSource.
   */
  function startLiveUpdates() {
    if (typeof EventSource === 'undefined') {
      setQuickConnection('polling', t('pollingConnection'));
      startPolling();
      return;
    }

    const eventSource = new EventSource('/api/buses/stream');
    state.busEventSource = eventSource;
    setQuickConnection('connecting', t('connectingLive'));
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
        setQuickConnection('connected', t('connectedLive'));
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
    eventSource.onopen = () => setQuickConnection('connected', t('connectedLive'));
    eventSource.onerror = () => {
      setQuickConnection('polling', t('pollingConnection'));
      fallbackToPolling();
    };
  }

  /** Poll bus snapshots and notifications when EventSource is unavailable. */
  function startPolling() {
    setQuickConnection('polling', t('pollingConnection'));
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
      token = window.prompt(t('adminPrompt'));
      if (!token) return null;
      sessionStorage.setItem('unirideAdminToken', token);
    }
    return token;
  }

  async function postAdminAction(url, options = {}) {
    const adminToken = getAdminToken();
    if (!adminToken) return null;
    const response = await fetch(url, {
      ...options,
      method: 'POST',
      headers: { ...(options.headers || {}), 'X-Admin-Token': adminToken },
    });
    if (response.status === 401) {
      sessionStorage.removeItem('unirideAdminToken');
      alert(t('adminRejected'));
      return null;
    }
    return response;
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
        alert(data.error || t('adminRejected'));
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
      const response = await postAdminAction('/api/demo/step');
      if (!response) return;
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to step the simulation.');
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
      const adminToken = getAdminToken();
      if (!adminToken) return;
      const nudgeLat = bus.current_lat + 0.00025;
      const nudgeLng = bus.current_lng + 0.00025;

      const res = await fetch(`/api/demo/buses/${bus.id}/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
        body: JSON.stringify({
          lat: nudgeLat,
          lng: nudgeLng,
          speed_mph: 22.4,
          heading: 45,
          status: 'On Time (Manual Push)',
        }),
      });
      const data = await res.json();
      if (res.status === 401) {
        sessionStorage.removeItem('unirideAdminToken');
        alert(data.error || t('adminRejected'));
        return;
      }
      if (!res.ok) throw new Error(data.error || t('unableGpsPush'));
      alert(`${t('gpsPushed')}\nEndpoint: POST /api/demo/buses/${bus.id}/location\n${t('newCoordinates')}: [${nudgeLat.toFixed(5)}, ${nudgeLng.toFixed(5)}]`);
      await fetchBuses();
      selectBus(bus.id, true);
    } catch (err) {
      console.error('Error pushing manual coordinates:', err);
      alert(err.message || t('unableGpsPush'));
    }
  }

  /**
   * Demo Action: Toggle Background Simulation Run/Pause
   */
  async function toggleSimulation() {
    try {
      const res = await postAdminAction('/api/demo/toggle-simulation');
      if (!res) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to toggle the simulation.');
      state.simRunning = data.running;

      const liveDot = document.getElementById('liveDot');
      const liveStatusText = document.getElementById('liveStatusText');
      const btnSimText = document.getElementById('btnSimText');
      const modalToggleSimBtn = document.getElementById('modalToggleSimBtn');
      const simIcon = document.getElementById('simIcon');
      const simLabel = state.simRunning ? 'Pause simulation' : 'Resume simulation';

      if (state.simRunning) {
        if (liveDot) liveDot.classList.remove('paused');
        if (liveStatusText) liveStatusText.textContent = t('liveFeed');
        if (btnSimText) btnSimText.textContent = t('pauseSim');
        if (modalToggleSimBtn) modalToggleSimBtn.querySelector('[data-i18n]')?.replaceChildren(t('pauseEngine'));
        if (simIcon) simIcon.innerHTML = '<path d="M8 5v14M16 5v14" stroke-linecap="round"></path>';
      } else {
        if (liveDot) liveDot.classList.add('paused');
        if (liveStatusText) liveStatusText.textContent = t('simPaused');
        if (btnSimText) btnSimText.textContent = t('resumeSim');
        if (modalToggleSimBtn) modalToggleSimBtn.querySelector('[data-i18n]')?.replaceChildren(t('resumeEngine'));
        if (simIcon) simIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
      }
      document.getElementById('btnToggleSim')?.setAttribute('aria-label', t(state.simRunning ? 'pauseSimulation' : 'resumeSimulation'));
    } catch (err) {
      console.error('Error toggling simulation:', err);
    }
  }

  /**
   * Demo Action: Reset Demo State to Initial Seed
   */
  async function resetDemoState() {
    if (!confirm(t('resetBaseline'))) return;
    try {
      const response = await postAdminAction('/api/demo/reset');
      if (!response) return;
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('unableReset'));
      await fetchRoutes();
      await fetchBuses();
      await fetchNotifications();
      await fetchSchedules();
      alert(t('demoResetSuccess'));
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
