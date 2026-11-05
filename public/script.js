let role = "", token = "";
let currentSitesData = [];
let mapInstance = null;
let pickerMapInstance = null;
let siteLayers = {};
let activeTileLayer = null;
let boundaryLayer = null;
let markerLayer = null;
let bufferLayer = null;
let showBoundaries = true;
let showMarkers = true;
let showBuffers = false;
let currentBaseTheme = "streets";
let pickerMarker = null;
let pickerPolygon = null;
let selectedSiteData = null;

const $ = id => document.getElementById(id);

async function api(path, options = {}) {
  const res = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (!res.ok) {
    let x = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(x.error || x.message || "Request failed");
  }
  return res.json();
}

function toast(t) {
  const el = $("toast");
  if (!el) return;
  el.textContent = t;
  el.style.display = "block";
  setTimeout(() => el.style.display = "none", 2500);
}

async function login() {
  try {
    const username = $("username").value.trim(), password = $("password").value;
    const r = await api("/login", {
      method: "POST",
      body: JSON.stringify({ username, password, role: $("role").value })
    });
    role = r.role;
    token = r.token;
    sessionStorage.setItem("role", role);
    render();
  } catch (e) {
    toast(e.message);
  }
}

function logout() {
  cleanupMaps();
  cleanupThree();
  sessionStorage.clear();
  location.reload();
}

function render() {
  $("login").hidden = true;
  $("app").hidden = false;
  $("roleBadge").innerHTML = `<span class="badge">${role}</span>`;
  const titles = {
    PLANNER: ["Site Planner", "Find, analyze, and select the best real-world site with GIS & 3D."],
    LAYOUT: ["Layout Designer", "Create, compare, and select high-performance 3D layouts."],
    CONSTRUCTOR: ["Constructor", "Compare final proposals and inspect 3D digital twin & BIM output."]
  };
  $("title").textContent = titles[role][0];
  $("subtitle").textContent = titles[role][1];
  const tabs = role === "PLANNER"
    ? ["Sites", "3D Model", "AI Analysis", "AI Media", "Add Site", "BIM"]
    : role === "LAYOUT"
    ? ["Layouts", "3D Model", "AI Analysis", "Optimized Design", "AI Media", "Add Layout", "BIM"]
    : ["Layouts", "Final Comparison", "3D Model", "AI Analysis", "Optimized Design", "AI Media", "BIM"];
  $("tabs").innerHTML = tabs.map((x, i) =>
    `<button class="tab ${i === 0 ? "active" : ""}" onclick="tab('${x}',this)">${x}</button>`
  ).join("");
  tab(tabs[0], $("tabs").firstElementChild);
}

function cleanupMaps() {
  if (mapInstance) {
    try { mapInstance.remove(); } catch (err) {}
    mapInstance = null;
  }
  if (pickerMapInstance) {
    try { pickerMapInstance.remove(); } catch (err) {}
    pickerMapInstance = null;
  }
  siteLayers = {};
}

function cleanupThree() {
  if (window.threeCityController) {
    import("./threeCity.js").then(m => m.destroyThreeCityScene()).catch(() => {});
    window.threeCityController = null;
  }
}

async function tab(name, el) {
  cleanupMaps();
  cleanupThree();
  document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
  if (el) el.classList.add("active");
  if (name === "Sites") return sites();
  if (name === "3D Model") return model3D();
  if (name === "AI Analysis") return aiAnalysis();
  if (name === "AI Media") return aiMedia();
  if (name === "Add Site") return addSite();
  if (name === "Layouts") return layouts();
  if (name === "Add Layout") return addLayout();
  if (name === "Final Comparison") return comparison();
  if (name === "Optimized Design") return optimizedDesign();
  if (name === "BIM") return bim();
}

function generateFallbackBoundary(lat, lng, areaKm2) {
  const sideKm = Math.sqrt(areaKm2 || 1);
  const halfLat = (sideKm / 2) / 110.574;
  const halfLng = (sideKm / 2) / (111.320 * Math.cos((lat || 16) * Math.PI / 180));
  return [
    [Number((lat + halfLat).toFixed(6)), Number((lng - halfLng).toFixed(6))],
    [Number((lat + halfLat).toFixed(6)), Number((lng + halfLng).toFixed(6))],
    [Number((lat - halfLat).toFixed(6)), Number((lng + halfLng).toFixed(6))],
    [Number((lat - halfLat).toFixed(6)), Number((lng - halfLng).toFixed(6))]
  ];
}

async function sites() {
  const data = await api("/sites");
  currentSitesData = data;
  if (!selectedSiteData && data.length > 0) {
    selectedSiteData = data[0];
  }

  $("content").innerHTML = `
    <section class="map-container-card">
      <div class="map-header">
        <div class="map-header-title">
          <span class="badge" style="background:#193b5c;color:#38bdf8;">GIS & ZONING</span>
          <h3>🗺️ Urban Planning Site & Boundary Visualizer</h3>
          <span class="badge" style="font-size:11px;">${data.length} candidate sites</span>
        </div>
        <div class="map-toolbar">
          <select id="mapBaseSelect" class="map-select" onchange="switchBaseLayer(this.value)">
            <option value="streets" ${currentBaseTheme === "streets" ? "selected" : ""}>OpenStreetMap</option>
            <option value="satellite" ${currentBaseTheme === "satellite" ? "selected" : ""}>Satellite (Esri)</option>
            <option value="dark" ${currentBaseTheme === "dark" ? "selected" : ""}>Carto Dark</option>
          </select>
          <button class="map-btn ${showBoundaries ? "active" : ""}" id="btnToggleBoundaries" onclick="toggleBoundaries()">
            🟩 Boundaries
          </button>
          <button class="map-btn ${showMarkers ? "active" : ""}" id="btnToggleMarkers" onclick="toggleMarkers()">
            📍 Markers
          </button>
          <button class="map-btn ${showBuffers ? "active" : ""}" id="btnToggleBuffers" onclick="toggleBuffers()">
            ⭕ 1km Buffer
          </button>
          <button class="map-btn" onclick="fitAllSites()">
            🎯 Fit All Sites
          </button>
        </div>
      </div>

      <div id="map"></div>

      <div class="map-coord-bar">
        <div class="map-coord-item">
          <span>Cursor:</span>
          <b id="liveCoords">Move cursor across map</b>
        </div>
        <div class="map-coord-item">
          <span>Inspection:</span>
          <b id="clickCoords">Click anywhere to inspect coordinates or boundary</b>
        </div>
        <div class="map-coord-item">
          <span>Projection:</span>
          <b>WGS84 (EPSG:4326)</b>
        </div>
      </div>
    </section>

    <div class="grid">
      ${data.map(s => `
        <article class="card" id="site-card-${s.id}">
          <span class="badge">${s.city}, ${s.state}</span>
          <h3>${s.name}</h3>
          <p>${s.description}</p>
          <div class="metric"><span>Zoning Area</span><b>${s.areaKm2} km²</b></div>
          <div class="metric"><span>Coordinates</span><b>${Number(s.latitude).toFixed(4)}°, ${Number(s.longitude).toFixed(4)}°</b></div>
          <div class="metric"><span>Terrain</span><b>${s.terrain}</b></div>
          <div class="metric"><span>Transport</span><b>${s.transport}%</b></div>
          <div class="metric"><span>Infrastructure</span><b>${s.infrastructure}%</b></div>
          <div class="metric"><span>Land Suitability</span><b>${s.landSuitability}%</b></div>
          <div class="actions">
            <button onclick="selectSite(${s.id})">Select best site</button>
            <button class="secondary" onclick="focusSiteOnMap(${s.id})">📍 View on Map</button>
          </div>
        </article>
      `).join("")}
    </div>
  `;

  setTimeout(() => {
    initSitesMap(data);
  }, 60);
}

function initSitesMap(data) {
  const mapEl = $("map");
  if (!mapEl) return;

  const defaultCenter = data.length > 0
    ? [Number(data[0].latitude), Number(data[0].longitude)]
    : [16.9, 80.6];

  mapInstance = L.map("map", {
    center: defaultCenter,
    zoom: 7,
    zoomControl: true
  });

  const tileUrls = {
    streets: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
  };

  const tileAttributions = {
    streets: "© OpenStreetMap contributors",
    satellite: "© Esri, Maxar, Earthstar Geographics",
    dark: "© CARTO, © OpenStreetMap contributors"
  };

  activeTileLayer = L.tileLayer(tileUrls[currentBaseTheme] || tileUrls.streets, {
    attribution: tileAttributions[currentBaseTheme] || tileAttributions.streets,
    maxZoom: 18
  }).addTo(mapInstance);

  boundaryLayer = L.featureGroup();
  markerLayer = L.featureGroup();
  bufferLayer = L.featureGroup();

  if (showBoundaries) boundaryLayer.addTo(mapInstance);
  if (showMarkers) markerLayer.addTo(mapInstance);
  if (showBuffers) bufferLayer.addTo(mapInstance);

  data.forEach(s => {
    const lat = Number(s.latitude);
    const lng = Number(s.longitude);
    const boundaryCoords = (s.boundary && Array.isArray(s.boundary) && s.boundary.length >= 3)
      ? s.boundary
      : generateFallbackBoundary(lat, lng, s.areaKm2);

    const polygon = L.polygon(boundaryCoords, {
      color: "#27c3ff",
      weight: 2.5,
      opacity: 0.9,
      fillColor: "#27c3ff",
      fillOpacity: 0.22
    });

    polygon.bindTooltip(`
      <div style="font-weight:700;color:#38bdf8;">${s.name}</div>
      <div>Urban Boundary: ${s.areaKm2} km²</div>
      <div style="font-size:10px;opacity:0.8;">${lat.toFixed(4)}°, ${lng.toFixed(4)}°</div>
    `, {
      className: "boundary-tooltip",
      sticky: true
    });

    const popupHtml = `
      <div class="map-popup">
        <span class="badge" style="font-size:10px;">${s.city}, ${s.state}</span>
        <h4>${s.name}</h4>
        <p>${s.description}</p>
        <div class="map-popup-grid">
          <div class="map-popup-metric">Coordinates<b>${lat.toFixed(4)}°, ${lng.toFixed(4)}°</b></div>
          <div class="map-popup-metric">Boundary Area<b>${s.areaKm2} km²</b></div>
          <div class="map-popup-metric">Transport<b>${s.transport}%</b></div>
          <div class="map-popup-metric">Suitability<b>${s.landSuitability}%</b></div>
        </div>
        <button class="map-popup-btn" onclick="selectSite(${s.id})">Select this site</button>
        <button class="map-popup-btn secondary" onclick="focusSiteOnMap(${s.id})">Zoom into Boundary</button>
      </div>
    `;

    polygon.bindPopup(popupHtml);

    polygon.on("mouseover", () => {
      polygon.setStyle({ weight: 3.5, color: "#38bdf8", fillOpacity: 0.45 });
    });
    polygon.on("mouseout", () => {
      polygon.setStyle({ weight: 2.5, color: "#27c3ff", fillOpacity: 0.22 });
    });

    polygon.addTo(boundaryLayer);

    const icon = L.divIcon({
      className: "",
      html: `<div class="custom-site-pin"><span>🏙️</span></div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -28]
    });

    const marker = L.marker([lat, lng], { icon });
    marker.bindPopup(popupHtml);
    marker.addTo(markerLayer);

    const circle = L.circle([lat, lng], {
      radius: 1000,
      color: "#38bdf8",
      weight: 1.5,
      dashArray: "5, 8",
      fillColor: "#38bdf8",
      fillOpacity: 0.08
    });
    circle.bindTooltip(`1 km Transit Buffer • ${s.name}`, { className: "boundary-tooltip" });
    circle.addTo(bufferLayer);

    siteLayers[s.id] = { polygon, marker, circle, data: s };
  });

  if (data.length > 0 && boundaryLayer.getLayers().length > 0) {
    try {
      mapInstance.fitBounds(boundaryLayer.getBounds(), { padding: [40, 40] });
    } catch (err) {}
  }

  mapInstance.on("mousemove", e => {
    const el = $("liveCoords");
    if (el) {
      el.textContent = `${e.latlng.lat.toFixed(5)}° N, ${e.latlng.lng.toFixed(5)}° E`;
    }
  });

  mapInstance.on("click", e => {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    const el = $("clickCoords");
    if (el) {
      el.textContent = `Lat: ${lat.toFixed(5)}°, Lng: ${lng.toFixed(5)}°`;
    }

    L.popup()
      .setLatLng(e.latlng)
      .setContent(`
        <div class="map-popup" style="min-width:180px;">
          <h4>📍 Coordinate Pin</h4>
          <p style="margin-bottom:6px;">Coordinates: <b>${lat.toFixed(5)}°, ${lng.toFixed(5)}°</b></p>
          <button class="map-popup-btn" onclick="addSiteAtCoords(${lat}, ${lng})">
            Add Site Here
          </button>
        </div>
      `)
      .openOn(mapInstance);
  });
}

function switchBaseLayer(theme) {
  currentBaseTheme = theme;
  if (!mapInstance || !activeTileLayer) return;

  const tileUrls = {
    streets: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
  };

  const tileAttributions = {
    streets: "© OpenStreetMap contributors",
    satellite: "© Esri, Maxar, Earthstar Geographics",
    dark: "© CARTO, © OpenStreetMap contributors"
  };

  mapInstance.removeLayer(activeTileLayer);
  activeTileLayer = L.tileLayer(tileUrls[theme] || tileUrls.streets, {
    attribution: tileAttributions[theme] || tileAttributions.streets,
    maxZoom: 18
  }).addTo(mapInstance);
}

function toggleBoundaries() {
  showBoundaries = !showBoundaries;
  const btn = $("btnToggleBoundaries");
  if (btn) btn.classList.toggle("active", showBoundaries);
  if (!mapInstance || !boundaryLayer) return;

  if (showBoundaries) {
    if (!mapInstance.hasLayer(boundaryLayer)) boundaryLayer.addTo(mapInstance);
  } else {
    if (mapInstance.hasLayer(boundaryLayer)) mapInstance.removeLayer(boundaryLayer);
  }
}

function toggleMarkers() {
  showMarkers = !showMarkers;
  const btn = $("btnToggleMarkers");
  if (btn) btn.classList.toggle("active", showMarkers);
  if (!mapInstance || !markerLayer) return;

  if (showMarkers) {
    if (!mapInstance.hasLayer(markerLayer)) markerLayer.addTo(mapInstance);
  } else {
    if (mapInstance.hasLayer(markerLayer)) mapInstance.removeLayer(markerLayer);
  }
}

function toggleBuffers() {
  showBuffers = !showBuffers;
  const btn = $("btnToggleBuffers");
  if (btn) btn.classList.toggle("active", showBuffers);
  if (!mapInstance || !bufferLayer) return;

  if (showBuffers) {
    if (!mapInstance.hasLayer(bufferLayer)) bufferLayer.addTo(mapInstance);
  } else {
    if (mapInstance.hasLayer(bufferLayer)) mapInstance.removeLayer(bufferLayer);
  }
}

function fitAllSites() {
  if (!mapInstance || !boundaryLayer || boundaryLayer.getLayers().length === 0) return;
  mapInstance.fitBounds(boundaryLayer.getBounds(), { padding: [50, 50] });
}

function focusSiteOnMap(id) {
  const item = siteLayers[id];
  if (!item || !mapInstance) return;

  const card = $("site-card-" + id);
  if (card) {
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  const mapEl = $("map");
  if (mapEl) {
    mapEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const bounds = item.polygon.getBounds();
  mapInstance.fitBounds(bounds, { padding: [70, 70], maxZoom: 14 });
  setTimeout(() => {
    item.polygon.openPopup();
  }, 350);
}

function addSiteAtCoords(lat, lng) {
  tab("Add Site", Array.from(document.querySelectorAll(".tab")).find(b => b.textContent === "Add Site"));
  setTimeout(() => {
    const latInp = document.querySelector("input[name='latitude']");
    const lngInp = document.querySelector("input[name='longitude']");
    if (latInp) latInp.value = lat.toFixed(6);
    if (lngInp) lngInp.value = lng.toFixed(6);
    updatePickerFromInputs();
  }, 100);
}

async function selectSite(id) {
  const r = await api(`/sites/${id}/select`, { method: "POST" });
  selectedSiteData = r.selectedSite;
  toast(`Selected site: ${selectedSiteData.name}`);
}

/* Three.js 3D Digital Twin Model Tab */
async function model3D() {
  $("content").innerHTML = `
    <div class="card" style="padding: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
        <div>
          <span class="badge" style="background: #1e3a5f; color: #38bdf8;">THREE.JS PROCEDURAL DIGITAL TWIN</span>
          <h2 style="margin: 6px 0 2px;">🏙️ Smart City 3D Digital Twin</h2>
          <p style="margin: 0; font-size: 13px; color: #94a3b8;">
            Procedural PBR multi-part architecture, ACESFilmic studio lighting, elevated transit, and exponential camera damping.
          </p>
        </div>
        <div>
          <span class="badge" style="font-size: 11px;">60 FPS • WebGL PBR</span>
        </div>
      </div>

      <div class="three-viewport-wrap">
        <div id="threeCanvasContainer"></div>

        <div class="three-floating-dock" id="threeDock">
          <div class="three-dock-header">
            <span style="font-size: 11px; font-weight: 800; color: #38bdf8; letter-spacing: 1px;">AUTODESK FORMA 3D CONTROLS</span>
            <button class="three-dock-toggle" onclick="toggleThreeDock()">▾ Dock</button>
          </div>
          <div class="three-dock-controls">
            <div class="three-control-group">
              <span>Lighting:</span>
              <button class="three-btn-pill active" onclick="setThreeLighting('day', this)">☀️ Daylight</button>
              <button class="three-btn-pill" onclick="setThreeLighting('sunset', this)">🌅 Sunset</button>
              <button class="three-btn-pill" onclick="setThreeLighting('night', this)">🌙 Night</button>
            </div>
            <div class="three-control-group">
              <span>Camera:</span>
              <button class="three-btn-pill active" onclick="setThreeCamera('masterplan', this)">Masterplan</button>
              <button class="three-btn-pill" onclick="setThreeCamera('aerial', this)">Drone</button>
              <button class="three-btn-pill" onclick="setThreeCamera('street', this)">Street</button>
              <button class="three-btn-pill" onclick="setThreeCamera('tower', this)">Eco Tower</button>
            </div>
            <div class="three-control-group">
              <span>Analysis Overlay:</span>
              <button class="three-btn-pill active" onclick="setThreeAnalysis('none', this)">None</button>
              <button class="three-btn-pill" onclick="setThreeAnalysis('solar', this)">Solar Insolation</button>
            </div>
          </div>
        </div>
      </div>

      <div class="grid" style="padding: 0;">
        <div class="card">
          <h3>🏢 Composite Architecture</h3>
          <p>Podium, tower shafts, cantilever terraces & solar helipad</p>
          <div class="score">6</div>
          <small>Distinct multi-part towers</small>
        </div>
        <div class="card">
          <h3>🚆 Elevated Transit Core</h3>
          <p>Concrete viaducts with modern aerodynamic electric vehicle</p>
          <div class="score">140 m</div>
          <small>Guideway span</small>
        </div>
        <div class="card">
          <h3>🌳 Procedural Canopy</h3>
          <p>Multi-tiered fluted pine and oak trees with contact shadows</p>
          <div class="score">28%</div>
          <small>Green buffer area</small>
        </div>
        <div class="card">
          <h3>☀️ Solar Orientation</h3>
          <p>Roof solar arrays with real-time incident sun ray tracing</p>
          <div class="score">86%</div>
          <small>Solar efficiency</small>
        </div>
      </div>
    </div>
  `;

  try {
    const { initThreeCityScene } = await import("./threeCity.js");
    const container = $("threeCanvasContainer");
    if (container) {
      window.threeCityController = initThreeCityScene(container);
    }
  } catch (err) {
    console.error("Failed to load Three.js scene:", err);
  }
}

function toggleThreeDock() {
  const dock = $("threeDock");
  if (dock) dock.classList.toggle("collapsed");
}

function setThreeLighting(preset, btn) {
  if (btn) {
    btn.parentElement.querySelectorAll(".three-btn-pill").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  }
  if (window.threeCityController) {
    window.threeCityController.setLightingPreset(preset);
  }
}

function setThreeCamera(view, btn) {
  if (btn) {
    btn.parentElement.querySelectorAll(".three-btn-pill").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  }
  if (window.threeCityController) {
    window.threeCityController.setCameraView(view);
  }
}

function setThreeAnalysis(mode, btn) {
  if (btn) {
    btn.parentElement.querySelectorAll(".three-btn-pill").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  }
  if (window.threeCityController) {
    window.threeCityController.toggleAnalysisLayer(mode);
  }
}

/* AI Analysis with Google Maps Grounding */
async function aiAnalysis() {
  const d = await api("/layouts");
  d.sort((a, b) => b.efficiency - a.efficiency);
  const best = d[0];

  const site = selectedSiteData || {
    name: "Amaravati Smart Growth Zone",
    city: "Amaravati",
    state: "Andhra Pradesh",
    latitude: 16.5739,
    longitude: 80.3575
  };

  $("content").innerHTML = `
    <article class="card">
      <span class="badge">🤖 AI SITE INTELLIGENCE</span>
      <h2>Smart Site Performance & Urban Analysis</h2>
      <p>
        Evaluates the smart-city development plan using environmental,
        transportation, and sustainability indicators coupled with live Google Maps geographic grounding.
      </p>

      ${best ? `
        <div class="score">${best.efficiency}%</div>
        <small>Overall layout efficiency (${best.name})</small>

        <h3>Autodesk Forma Study Metrics</h3>
        ${Object.entries(best.metrics || {}).map(([k, v]) => `
          <div class="metric"><span>${k}</span><b>${v}%</b></div>
          <div class="bar"><i style="width:${v}%"></i></div>
        `).join("")}
      ` : `<p>No layout data available yet.</p>`}

      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #1c3650;">
        <span class="badge" style="background:#13334c;color:#38bdf8;">GEMINI 3.8 FLASH • GOOGLE MAPS GROUNDING</span>
        <h3>🗺️ Live Google Maps Geographic Intelligence</h3>
        <p>Ground AI recommendations with real-world Google Maps infrastructure, road networks, and amenities around <b>${site.name}</b> (${site.city}, ${site.state}).</p>

        <div style="display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap;">
          <button onclick="runMapsGrounding()">
            ⚡ Run Google Maps Grounded Analysis
          </button>
        </div>

        <div id="mapsGroundingResult" style="display:none; margin-top: 15px; padding: 18px; background: #071322; border: 1px solid #1f3b58; border-radius: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <b style="color: #38bdf8;">Grounded Urban Planning Report</b>
            <span class="badge" style="font-size: 10px;">googleMaps Tool</span>
          </div>
          <div id="mapsGroundingText" style="line-height: 1.6; color: #cbd5e1; white-space: pre-wrap;"></div>

          <h4 style="margin: 15px 0 8px; color: #94a3b8; font-size: 13px;">Google Maps Sources & Verified Citations:</h4>
          <div id="mapsGroundingLinks"></div>
        </div>
      </div>
    </article>
  `;
}

async function runMapsGrounding() {
  const btn = event?.target;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Analyzing Google Maps data...";
  }

  const site = selectedSiteData || {
    name: "Amaravati Smart Growth Zone",
    city: "Amaravati",
    state: "Andhra Pradesh",
    latitude: 16.5739,
    longitude: 80.3575
  };

  try {
    const res = await api("/ai/maps-grounding", {
      method: "POST",
      body: JSON.stringify({
        siteName: site.name,
        city: site.city,
        state: site.state,
        latitude: site.latitude,
        longitude: site.longitude
      })
    });

    const box = $("mapsGroundingResult");
    const textEl = $("mapsGroundingText");
    const linksEl = $("mapsGroundingLinks");

    if (box && textEl && linksEl) {
      box.style.display = "block";
      textEl.textContent = res.text;

      const chunks = res.groundingChunks || [];
      const links = [];
      chunks.forEach(c => {
        if (c.maps?.uri) {
          links.push(`<a class="grounding-chip" href="${c.maps.uri}" target="_blank" rel="noopener noreferrer">📍 ${c.maps.title || "Google Maps Place"}</a>`);
        }
      });

      linksEl.innerHTML = links.length > 0
        ? links.join("")
        : `<p style="font-size:12px;color:#8fa4b8;">Analysis synthesized from regional maps context.</p>`;
    }
    toast("Google Maps grounded analysis complete!");
  } catch (err) {
    toast(err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "⚡ Run Google Maps Grounded Analysis";
    }
  }
}

/* AI Media Studio (Image Creation & Editing + Video Animation) */
function aiMedia() {
  $("content").innerHTML = `
    <div class="grid">
      <!-- Feature 1: Create & Edit Images using gemini-nano-banana-2.1 -->
      <article class="card">
        <span class="badge" style="background:#13334c;color:#38bdf8;">GEMINI-NANO-BANANA-2.1</span>
        <h2>🎨 Urban Concept Image Studio</h2>
        <p>Generate high-fidelity architectural perspectives or upload an existing photo/sketch to edit with text prompts.</p>

        <label>Concept Text Prompt</label>
        <textarea id="imagePrompt" rows="3" placeholder="e.g. Sustainable biophilic urban district with skybridges, solar-paneled glass towers, lush rooftop terraces at golden hour, architectural rendering"></textarea>

        <div class="two">
          <div>
            <label>Aspect Ratio</label>
            <select id="imageAspect">
              <option value="16:9" selected>16:9 (Landscape)</option>
              <option value="1:1">1:1 (Square)</option>
              <option value="9:16">9:16 (Portrait)</option>
            </select>
          </div>
          <div>
            <label>Optional Source Image (for editing)</label>
            <input type="file" id="imageFileInput" accept="image/*" onchange="previewUploadImage(event)">
          </div>
        </div>

        <div id="imagePreviewContainer" style="display:none;" class="ai-media-preview">
          <img id="imagePreview" alt="Concept Preview">
        </div>

        <button onclick="generateImageAction(this)">
          ✨ Generate / Edit Concept Image
        </button>
      </article>

      <!-- Feature 2: Animate Images into Video using gemini-omni-1.1-flash via Interactions API -->
      <article class="card">
        <span class="badge" style="background:#13334c;color:#38bdf8;">GEMINI-OMNI-1.1-FLASH • INTERACTIONS API</span>
        <h2>🎬 Image-to-Video Animation</h2>
        <p>Upload a site photo or architectural render and animate it with cinematic drone movement using Gemini Omni Flash.</p>

        <label>Upload Base Image</label>
        <input type="file" id="videoSourceInput" accept="image/*" onchange="previewVideoSource(event)">

        <div id="videoSourcePreviewContainer" style="display:none;" class="ai-media-preview">
          <img id="videoSourcePreview" alt="Animation Base Preview">
        </div>

        <label>Animation Motion Prompt</label>
        <input id="videoPrompt" value="Cinematic drone camera gliding forward over the smart city buildings with flowing traffic and atmospheric lighting" placeholder="Motion description...">

        <label>Video Aspect Ratio</label>
        <select id="videoAspect">
          <option value="16:9" selected>16:9 (Landscape)</option>
          <option value="9:16">9:16 (Portrait)</option>
        </select>

        <div id="videoResultContainer" style="display:none;" class="ai-media-preview">
          <video id="videoResult" controls autoplay loop playsinline></video>
        </div>

        <button onclick="animateVideoAction(this)">
          🎥 Animate into Video with Omni Flash
        </button>
      </article>
    </div>
  `;
}

let uploadedBase64Image = null;
function previewUploadImage(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    uploadedBase64Image = ev.target.result;
    const prev = $("imagePreview");
    const container = $("imagePreviewContainer");
    if (prev && container) {
      prev.src = uploadedBase64Image;
      container.style.display = "flex";
    }
  };
  reader.readAsDataURL(file);
}

async function generateImageAction(btn) {
  const prompt = $("imagePrompt")?.value.trim();
  if (!prompt) {
    toast("Please enter a concept prompt.");
    return;
  }
  btn.disabled = true;
  btn.textContent = "Processing with gemini-nano-banana-2.1...";

  try {
    const res = await api("/ai/generate-image", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        baseImage: uploadedBase64Image,
        aspectRatio: $("imageAspect")?.value || "16:9"
      })
    });

    if (res.imageUrl) {
      const prev = $("imagePreview");
      const container = $("imagePreviewContainer");
      if (prev && container) {
        prev.src = res.imageUrl;
        container.style.display = "flex";
      }
      toast("Image generated successfully!");
    } else {
      toast(res.text || "Image generation response received.");
    }
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ Generate / Edit Concept Image";
  }
}

let uploadedVideoSourceBase64 = null;
function previewVideoSource(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    uploadedVideoSourceBase64 = ev.target.result;
    const prev = $("videoSourcePreview");
    const container = $("videoSourcePreviewContainer");
    if (prev && container) {
      prev.src = uploadedVideoSourceBase64;
      container.style.display = "flex";
    }
  };
  reader.readAsDataURL(file);
}

async function animateVideoAction(btn) {
  if (!uploadedVideoSourceBase64) {
    toast("Please upload a base image to animate.");
    return;
  }
  const prompt = $("videoPrompt")?.value.trim();
  const aspectRatio = $("videoAspect")?.value || "16:9";

  btn.disabled = true;
  btn.textContent = "Generating video with gemini-omni-1.1-flash...";

  try {
    const res = await api("/ai/animate-video", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        imageBase64: uploadedVideoSourceBase64,
        aspectRatio
      })
    });

    toast("Video animation task executed!");
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🎥 Animate into Video with Omni Flash";
  }
}

function addSite() {
  $("content").innerHTML = `
    <form class="form" onsubmit="saveSite(event)">
      <h2>Add real-world site</h2>
      <p>Use verified map/GIS data. Minimum site size is 1 km². Click the map below to position coordinates and preview boundary.</p>

      <div class="two">
        <div>
          <label>Name</label>
          <input name="name" placeholder="e.g. Hyderabad Green Corridor" required>
          <label>City</label>
          <input name="city" placeholder="e.g. Hyderabad" required>
          <label>State</label>
          <input name="state" value="Andhra Pradesh">
        </div>
        <div>
          <label>Area (km²)</label>
          <input name="areaKm2" id="siteAreaInput" type="number" step=".01" min="1" value="1.20" required oninput="updatePickerFromInputs()">
          <label>Latitude</label>
          <input name="latitude" id="siteLatInput" type="number" step=".000001" value="16.5739" required oninput="updatePickerFromInputs()">
          <label>Longitude</label>
          <input name="longitude" id="siteLngInput" type="number" step=".000001" value="80.3575" required oninput="updatePickerFromInputs()">
        </div>
      </div>

      <label>Interactive GIS Coordinate & Boundary Picker</label>
      <div id="pickerMap"></div>

      <label>Description</label>
      <textarea name="description" placeholder="Strategic site summary..."></textarea>

      <label>Terrain</label>
      <input name="terrain" placeholder="Flat alluvial / coastal rolling / plateau...">

      <label>Surrounding environment</label>
      <input name="surrounding" placeholder="Roads, river, buildings, transit...">

      <div class="two">
        <div>
          <label>Transport %</label>
          <input name="transport" type="number" min="0" max="100" value="80">
          <label>Infrastructure %</label>
          <input name="infrastructure" type="number" min="0" max="100" value="80">
        </div>
        <div>
          <label>Land suitability %</label>
          <input name="landSuitability" type="number" min="0" max="100" value="80">
        </div>
      </div>

      <button>Save site & boundary</button>
    </form>
  `;

  setTimeout(() => {
    initPickerMap();
  }, 60);
}

function initPickerMap() {
  const el = $("pickerMap");
  if (!el) return;

  const lat = Number($("siteLatInput")?.value) || 16.5739;
  const lng = Number($("siteLngInput")?.value) || 80.3575;
  const area = Number($("siteAreaInput")?.value) || 1.2;

  pickerMapInstance = L.map("pickerMap", {
    center: [lat, lng],
    zoom: 13
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(pickerMapInstance);

  const icon = L.divIcon({
    className: "",
    html: `<div class="custom-site-pin"><span>📍</span></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32]
  });

  pickerMarker = L.marker([lat, lng], { icon, draggable: true }).addTo(pickerMapInstance);

  const boundary = generateFallbackBoundary(lat, lng, area);
  pickerPolygon = L.polygon(boundary, {
    color: "#27c3ff",
    weight: 2,
    fillColor: "#27c3ff",
    fillOpacity: 0.25
  }).addTo(pickerMapInstance);

  pickerMarker.on("dragend", e => {
    const pos = e.target.getLatLng();
    if ($("siteLatInput")) $("siteLatInput").value = pos.lat.toFixed(6);
    if ($("siteLngInput")) $("siteLngInput").value = pos.lng.toFixed(6);
    updatePickerBoundary(pos.lat, pos.lng, Number($("siteAreaInput")?.value) || 1.2);
  });

  pickerMapInstance.on("click", e => {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    pickerMarker.setLatLng(e.latlng);
    if ($("siteLatInput")) $("siteLatInput").value = lat.toFixed(6);
    if ($("siteLngInput")) $("siteLngInput").value = lng.toFixed(6);
    updatePickerBoundary(lat, lng, Number($("siteAreaInput")?.value) || 1.2);
  });
}

function updatePickerBoundary(lat, lng, area) {
  if (!pickerPolygon) return;
  const newBoundary = generateFallbackBoundary(lat, lng, area);
  pickerPolygon.setLatLngs(newBoundary);
}

function updatePickerFromInputs() {
  const lat = Number($("siteLatInput")?.value);
  const lng = Number($("siteLngInput")?.value);
  const area = Number($("siteAreaInput")?.value);
  if (!isNaN(lat) && !isNaN(lng) && pickerMarker && pickerMapInstance) {
    pickerMarker.setLatLng([lat, lng]);
    updatePickerBoundary(lat, lng, area || 1.2);
    pickerMapInstance.panTo([lat, lng]);
  }
}

async function saveSite(e) {
  e.preventDefault();
  let o = Object.fromEntries(new FormData(e.target));
  ["areaKm2", "latitude", "longitude", "transport", "infrastructure", "landSuitability"].forEach(k => {
    o[k] = Number(o[k]);
  });
  o.boundary = generateFallbackBoundary(o.latitude, o.longitude, o.areaKm2);
  await api("/sites", { method: "POST", body: JSON.stringify(o) });
  toast("Site and boundary added successfully");
  tab("Sites", Array.from(document.querySelectorAll(".tab")).find(b => b.textContent === "Sites"));
}

async function layouts() {
  const data = await api("/layouts");
  data.sort((a, b) => b.efficiency - a.efficiency);
  $("content").innerHTML = `
    <div class="grid">
      ${data.map((l, i) => `
        <article class="card">
          <span class="badge">${i === 0 ? "🏆 TOP PROPOSAL" : "PROPOSAL " + (i + 1)}</span>
          <h3>${l.name}</h3>
          <p>${l.description}</p>
          <div class="score">${l.efficiency}%</div>
          <small>Overall efficiency</small>
          ${Object.entries(l.metrics).map(([k, v]) => `
            <div class="metric">
              <span>${k}</span>
              <b>${v}%</b>
            </div>
            <div class="bar">
              <i style="width:${v}%"></i>
            </div>
          `).join("")}
          <div class="actions">
            <button onclick="selectLayout(${l.id})">Select this layout</button>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

async function selectLayout(id) {
  let r = await api(`/layouts/${id}/select`, { method: "POST" });
  toast(`Selected: ${r.selectedLayout.name} — ${r.efficiency}%`);
}

function addLayout() {
  $("content").innerHTML = `
    <form class="form" onsubmit="saveLayout(event)">
      <h2>Add new layout</h2>
      <p>Enter analysis values from Autodesk Forma or your validated design study (0–100).</p>
      <div class="two">
        <div>
          <label>Name</label>
          <input name="name" required>
          <label>Site name</label>
          <input name="siteName" required>
          <label>Site area km²</label>
          <input name="siteAreaKm2" type="number" step=".01" min="1" required>
        </div>
        <div>
          <label>Description</label>
          <textarea name="description"></textarea>
        </div>
      </div>
      <div class="two">
        ${["sunlight", "daylight", "wind", "noise", "solar", "carbon", "terrain", "roads", "transport", "landscaping"].map(k => `
          <div>
            <label>${k} %</label>
            <input name="${k}" type="number" min="0" max="100" value="80" required>
          </div>
        `).join("")}
      </div>
      <button>Save & calculate efficiency</button>
    </form>
  `;
}

async function saveLayout(e) {
  e.preventDefault();
  let o = Object.fromEntries(new FormData(e.target));
  ["siteAreaKm2", "sunlight", "daylight", "wind", "noise", "solar", "carbon", "terrain", "roads", "transport", "landscaping"].forEach(k => {
    o[k] = Number(o[k]);
  });
  await api("/layouts", { method: "POST", body: JSON.stringify(o) });
  toast("Layout added");
  layouts();
}

async function comparison() {
  const d = await api("/layouts");
  d.sort((a, b) => b.efficiency - a.efficiency);
  $("content").innerHTML = `
    <div class="grid">
      <article class="card">
        <h2>🏆 Recommended final plan</h2>
        <div class="score">${d[0]?.efficiency || 0}%</div>
        <p>${d[0]?.name || "No layouts yet"} is ranked highest using the transparent weighted criteria.</p>
        <p>Workflow: Site Data → 3D Model → AI Analysis → Multiple Proposals → Comparison → Optimized Design → BIM.</p>
      </article>
      ${d.map(l => `
        <article class="card">
          <h3>${l.name}</h3>
          <div class="score">${l.efficiency}%</div>
          <p>${l.siteName}</p>
        </article>
      `).join("")}
    </div>
  `;
}

async function optimizedDesign() {
  const d = await api("/layouts");
  d.sort((a, b) => b.efficiency - a.efficiency);

  const best = d[0];

  if (!best) {
    $("content").innerHTML = `
      <article class="card">
        <h2>Optimized Design</h2>
        <p>No layout is available yet. Create a layout first.</p>
      </article>`;
    return;
  }

  $("content").innerHTML = `
    <article class="card">
      <span class="badge">🏆 OPTIMIZED DESIGN</span>
      <h2>${best.name}</h2>

      <div class="score">${best.efficiency}%</div>
      <small>Overall efficiency</small>

      <p>${best.description}</p>

      <h3>Design Performance</h3>

      ${Object.entries(best.metrics).map(([k, v]) => `
        <div class="metric">
          <span>${k}</span>
          <b>${v}%</b>
        </div>
        <div class="bar">
          <i style="width:${v}%"></i>
        </div>
      `).join("")}

      <div class="actions">
        <button onclick="toast('Optimized design selected successfully!')">
          Use optimized design
        </button>

        <button class="secondary" onclick="toast('BIM export prepared successfully!')">
          Export to BIM
        </button>
      </div>
    </article>`;
}

async function bim() {
  const d = await api("/layouts");
  d.sort((a, b) => b.efficiency - a.efficiency);

  const best = d[0];

  if (!best) {
    $("content").innerHTML = `
      <article class="card">
        <h2>🏗️ BIM Output</h2>
        <p>No optimized layout is available yet.</p>
      </article>`;
    return;
  }

  const m = best.metrics || {};

  $("content").innerHTML = `
    <div class="card">
      <span class="badge">🏗️ BIM OUTPUT</span>
      <h2>Building Information Model</h2>
      <p>BIM information generated from the highest-performing smart-city layout.</p>

      <div class="card">
        <h3>🏆 Selected Optimized Layout</h3>
        <h2>${best.name}</h2>
        <div class="score">${best.efficiency}%</div>
        <small>Overall efficiency</small>
        <p>${best.description || "Optimized smart-city design."}</p>
      </div>

      <h3>🏢 Building Information</h3>
      <div class="metric"><span>Project Type</span><b>Smart City Development</b></div>
      <div class="metric"><span>Site</span><b>${best.siteName || "Selected Site"}</b></div>
      <div class="metric"><span>Site Area</span><b>${best.siteAreaKm2 || "-"} km²</b></div>

      <h3>🌱 Environmental Performance</h3>
      ${Object.entries(m).map(([k, v]) => `
        <div class="metric">
          <span>${k}</span>
          <b>${v}%</b>
        </div>
        <div class="bar">
          <i style="width:${v}%"></i>
        </div>
      `).join("")}

      <h3>🏗️ Construction Readiness</h3>
      <div class="metric"><span>3D Model</span><b>✓ Available</b></div>
      <div class="metric"><span>AI Analysis</span><b>✓ Completed</b></div>
      <div class="metric"><span>Design Optimization</span><b>✓ Completed</b></div>
      <div class="metric"><span>BIM Status</span><b>✓ Ready</b></div>
    </div>
  `;
}
