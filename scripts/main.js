// --- Externalized JavaScript Logic from index.html ---
//
// URBAN PLANNING MULTIAGENT ANALYSIS SYSTEM
// ==========================================
// This application integrates GPT-4o-mini for AI-powered analysis of:
// - Soil data (OpenEPI API)
// - Weather data (NASA POWER API)
// - OpenStreetMap features (Overpass API)
//
// SETUP:
// 1. Set OPENAI_API_KEY below with your OpenAI API key
// 2. Draw shapes on the map to define areas for analysis
// 3. Click "Analyze" to collect comprehensive environmental data
// 4. Use the chatbot for questions about urban planning
//
// The system will automatically:
// - Collect soil properties (clay, sand, silt, pH, nitrogen, etc.)
// - Fetch 30-day weather history (temperature, precipitation, humidity, etc.)
// - Extract land use features (buildings, parks, water bodies, etc.)
// - Analyze everything with GPT-4o-mini for development insights

document.addEventListener("DOMContentLoaded", () => {
  // --- VARIABLES & CONFIGURATION ---
  const OPENAI_API_KEY = ""; // IMPORTANT: Set your OpenAI API key here
  const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
  const OVERPASS_API_URL = "https://overpass-api.de/api/interpreter";
  const OPENEPI_SOIL_API_URL = "https://api.openepi.io/soil/property";
  const NASA_POWER_API_URL =
    "https://power.larc.nasa.gov/api/temporal/daily/point";

  let activeTool = null;
  let currentDrawer = null;
  let isFreeDrawing = false;
  let freeDrawPolyline = null;

  let selectedLayer = null;
  let history = [];
  let redoStack = [];

  let radiusCenterPoint = null;
  let searchMarker = null;

  // Conversation history for continued analysis discussion
  let conversationHistory = [];
  let currentAnalysisData = null;

  // --- UI ELEMENT SELECTORS ---
  const loadingOverlay = document.getElementById("loading-overlay");
  const toolbarActivator = document.getElementById("toolbar-activator");
  const chatbotActivator = document.getElementById("chatbot-activator");
  const toolbarContainer = document.getElementById("toolbar-container");
  const chatbotContainer = document.getElementById("chatbot-container");
  const closeChatBtn = document.getElementById("close-chat-btn");
  const chatInput = document.getElementById("chat-input");
  const chatBody = document.getElementById("chat-body");
  const shapesTool = document.getElementById("shapes-tool");
  const shapesMenu = document.getElementById("shapes-menu");
  const contextMenu = document.getElementById("context-menu");
  const editBtn = document.getElementById("edit-btn");
  const deleteBtn = document.getElementById("delete-btn");
  const contextualActions = document.getElementById("contextual-actions");
  const streetViewBtn = document.getElementById("street-view-btn");
  const satelliteViewBtn = document.getElementById("satellite-view-btn");
  const analysisLegend = document.getElementById("analysis-legend");
  const legendCloseBtn = document.getElementById("legend-close-btn");
  const searchInput = document.getElementById("search-input");
  const currentLocationBtn = document.getElementById("current-location-btn");

  // Modals
  const radiusModal = document.getElementById("radius-modal");
  const radiusConfirmBtn = document.getElementById("radius-confirm-btn");
  const radiusCancelBtn = document.getElementById("radius-cancel-btn");
  const clearModal = document.getElementById("clear-modal");
  const clearConfirmBtn = document.getElementById("clear-confirm-btn");
  const clearCancelBtn = document.getElementById("clear-cancel-btn");

  const toolButtons = {
    polygon: document.getElementById("polygon-tool"),
    freeDraw: document.getElementById("free-draw-tool"),
    radius: document.getElementById("radius-tool"),
    circle: document.getElementById("circle-tool"),
    rectangle: document.getElementById("rectangle-tool"),
    triangle: document.getElementById("triangle-tool"),
    analyze: document.getElementById("analyze-tool"),
    undo: document.getElementById("undo-tool"),
    redo: document.getElementById("redo-tool"),
    clearAll: document.getElementById("clear-all-tool"),
  };

  // --- MAP INITIALIZATION ---
  const map = L.map("map", {
    drawControl: false,
    zoomControl: false,
  }).setView([9.5916, 76.5222], 13);
  L.control.zoom({ position: "bottomright" }).addTo(map);

  const osmLayer = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }
  );
  const satelliteLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Tiles &copy; Esri",
    }
  );

  // Add a labels-only layer to create a hybrid view
  const labelsLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "", // Attribution is already covered
      pane: "shadowPane", // Ensures labels are on top
    }
  );

  // Create a hybrid layer group
  const hybridLayer = L.layerGroup([satelliteLayer, labelsLayer]);

  osmLayer.addTo(map);

  const drawnItems = new L.FeatureGroup().addTo(map);
  const analysisLayers = new L.FeatureGroup().addTo(map);

  // --- UI INTERACTIVITY ---
  toolbarActivator.addEventListener("click", (e) => {
    e.stopPropagation();
    toolbarContainer.classList.toggle("hidden");
    if (!toolbarContainer.classList.contains("hidden")) {
      deactivateAllTools();
    }
  });
  chatbotActivator.addEventListener("click", () =>
    chatbotContainer.classList.remove("hidden")
  );
  closeChatBtn.addEventListener("click", () =>
    chatbotContainer.classList.add("hidden")
  );

  shapesTool.addEventListener("click", (e) => {
    e.stopPropagation();
    shapesMenu.classList.toggle("hidden");
  });

  legendCloseBtn.addEventListener("click", () =>
    analysisLegend.classList.add("hidden")
  );

  document.addEventListener("click", (event) => {
    if (
      !toolbarContainer.contains(event.target) &&
      event.target !== toolbarActivator
    ) {
      toolbarContainer.classList.add("hidden");
    }
    if (!shapesMenu.contains(event.target) && event.target !== shapesTool) {
      shapesMenu.classList.add("hidden");
    }
  });
  map.on("click", deselectAllLayers);

  map.on("contextmenu", (e) => {
    L.popup()
      .setLatLng(e.latlng)
      .setContent(
        `Lat: ${e.latlng.lat.toFixed(6)}, Lng: ${e.latlng.lng.toFixed(6)}`
      )
      .openOn(map);
  });

  streetViewBtn.addEventListener("click", () => {
    if (!map.hasLayer(osmLayer)) {
      map.addLayer(osmLayer);
      map.removeLayer(hybridLayer);
      streetViewBtn.classList.add("active");
      satelliteViewBtn.classList.remove("active");
    }
  });
  satelliteViewBtn.addEventListener("click", () => {
    if (!map.hasLayer(hybridLayer)) {
      map.addLayer(hybridLayer);
      map.removeLayer(osmLayer);
      satelliteViewBtn.classList.add("active");
      streetViewBtn.classList.remove("active");
    }
  });

  // --- SEARCH & LOCATION ---
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const query = searchInput.value.trim();
      if (query) {
        performSearch(query);
      }
    }
  });

  currentLocationBtn.addEventListener("click", () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          map.flyTo([lat, lng], 16);
          L.marker([lat, lng])
            .addTo(map)
            .bindPopup("You are here.")
            .openPopup();
        },
        (error) => {
          console.error("Error getting current location:", error.message);
          alert(
            "Could not retrieve your location. Please ensure location services are enabled."
          );
        }
      );
    } else {
      console.error("Geolocation is not supported by this browser.");
      alert("Geolocation is not supported by this browser.");
    }
  });

  async function performSearch(query) {
    if (searchMarker) {
      map.removeLayer(searchMarker);
      searchMarker = null;
    }

    const coordRegex = /^(-?\d{1,3}(\.\d+)?),\s*(-?\d{1,3}(\.\d+)?)$/;
    const match = query.match(coordRegex);

    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[3]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        map.flyTo([lat, lng], 16);
        searchMarker = L.marker([lat, lng])
          .addTo(map)
          .bindPopup(`Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`)
          .openPopup();
      } else {
        alert("Invalid coordinates provided.");
      }
    } else {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        query
      )}`;
      try {
        const response = await fetch(url);
        const data = await response.json();
        if (data && data.length > 0) {
          const { lat, lon, display_name } = data[0];
          map.flyTo([lat, lon], 16);
          searchMarker = L.marker([lat, lon])
            .addTo(map)
            .bindPopup(`<b>${display_name}</b>`)
            .openPopup();
        } else {
          alert("Location not found.");
        }
      } catch (error) {
        console.error("Error during geocoding search:", error);
        alert("An error occurred while searching.");
      }
    }
  }

  // --- CONTEXTUAL TOOLS LOGIC ---
  const updateContextualTools = () => {
    const hasDrawings = drawnItems.getLayers().length > 0;
    if (hasDrawings) {
      contextualActions.classList.add("visible");
    } else {
      contextualActions.classList.remove("visible");
      analysisLayers.clearLayers();
      analysisLegend.classList.add("hidden");
    }

    toolButtons.analyze.disabled = !hasDrawings;
    toolButtons.undo.disabled = history.length === 0;
    toolButtons.redo.disabled = redoStack.length === 0;
    toolButtons.clearAll.disabled = !hasDrawings;
  };

  const addToHistory = (action, layer, oldLatLngs = null) => {
    const layerData =
      action === "remove" ? L.geoJSON(layer.toGeoJSON()) : layer;
    history.push({ action, layer: layerData, oldLatLngs });
    redoStack = [];
    updateContextualTools();
  };

  // --- DATA COLLECTION FUNCTIONS ---

  /**
   * Fetch soil data from OpenEPI API
   */
  async function fetchSoilData(lat, lon) {
    const essentialProperties = [
      "bdod",
      "clay",
      "sand",
      "silt",
      "soc",
      "phh2o",
      "nitrogen",
    ];
    const depths = ["0-5cm", "5-15cm", "15-30cm", "30-60cm"];
    const values = ["mean", "Q0.05", "Q0.95"];

    try {
      const params = new URLSearchParams();
      params.append("lat", lat);
      params.append("lon", lon);
      depths.forEach((d) => params.append("depths", d));
      essentialProperties.forEach((p) => params.append("properties", p));
      values.forEach((v) => params.append("values", v));

      const response = await fetch(
        `${OPENEPI_SOIL_API_URL}?${params.toString()}`,
        {
          headers: {
            Accept: "application/json",
          },
        }
      );

      if (!response.ok)
        throw new Error(`Soil API Error: ${response.statusText}`);
      return await response.json();
    } catch (error) {
      console.error("Error fetching soil data:", error);
      return { error: error.message };
    }
  }

  /**
   * Fetch weather data from NASA POWER API
   */
  async function fetchWeatherData(lat, lon, startDate, endDate) {
    const essentialParameters = [
      "PRECTOTCORR",
      "T2M",
      "T2M_MAX",
      "T2M_MIN",
      "RH2M",
      "WS2M",
      "ALLSKY_SFC_SW_DWN",
      "EVPTRNS",
    ];

    try {
      const params = new URLSearchParams({
        parameters: essentialParameters.join(","),
        community: "AG",
        longitude: lon,
        latitude: lat,
        start: startDate,
        end: endDate,
        format: "JSON",
      });

      const response = await fetch(
        `${NASA_POWER_API_URL}?${params.toString()}`,
        {
          headers: {
            Accept: "application/json",
          },
        }
      );

      if (!response.ok)
        throw new Error(`Weather API Error: ${response.statusText}`);
      return await response.json();
    } catch (error) {
      console.error("Error fetching weather data:", error);
      return { error: error.message };
    }
  }

  /**
   * Get bounding box grid points for sampling using actual drawn area bounds
   */
  function getBoundingBoxGrid(bounds, gridSize = 3) {
    const northWest = bounds.getNorthWest();
    const southEast = bounds.getSouthEast();

    // Get the 4 corner coordinates
    const minLat = southEast.lat; // South
    const maxLat = northWest.lat; // North
    const minLon = northWest.lng; // West
    const maxLon = southEast.lng; // East

    console.log("=== Area Bounding Box Coordinates ===");
    console.log(`North: ${maxLat.toFixed(6)}`);
    console.log(`South: ${minLat.toFixed(6)}`);
    console.log(`East: ${maxLon.toFixed(6)}`);
    console.log(`West: ${minLon.toFixed(6)}`);
    console.log("=====================================");

    // Generate grid points within the actual drawn area
    const gridPoints = [];
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        const lat = minLat + ((maxLat - minLat) * i) / (gridSize - 1);
        const lon = minLon + ((maxLon - minLon) * j) / (gridSize - 1);
        gridPoints.push({ lat, lon });
      }
    }

    return gridPoints;
  }

  /**
   * Collect comprehensive area data (soil + weather) using actual drawn area bounds
   */
  async function collectAreaData(layer, gridSize = 2) {
    const bounds = layer.getBounds();
    const gridPoints = getBoundingBoxGrid(bounds, gridSize);

    // Get the exact 4 corner coordinates of the drawn area
    const northWest = bounds.getNorthWest();
    const southEast = bounds.getSouthEast();
    const boundingBoxCoords = {
      north: northWest.lat,
      south: southEast.lat,
      east: southEast.lng,
      west: northWest.lng,
    };

    // Get date range (last 30 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 30);

    const formatDate = (date) => {
      return date.toISOString().slice(0, 10).replace(/-/g, "");
    };

    const start = formatDate(startDate);
    const end = formatDate(endDate);

    console.log(
      `Collecting data for ${gridPoints.length} grid points within drawn area...`
    );
    console.log(
      `Area bounds: North ${boundingBoxCoords.north.toFixed(
        6
      )}, South ${boundingBoxCoords.south.toFixed(
        6
      )}, East ${boundingBoxCoords.east.toFixed(
        6
      )}, West ${boundingBoxCoords.west.toFixed(6)}`
    );

    const collectionPromises = gridPoints.map(async (point, idx) => {
      console.log(
        `Fetching data for point ${idx + 1}/${
          gridPoints.length
        }: (${point.lat.toFixed(6)}, ${point.lon.toFixed(6)})`
      );

      const [soilData, weatherData] = await Promise.all([
        fetchSoilData(point.lat, point.lon),
        fetchWeatherData(point.lat, point.lon, start, end),
      ]);

      return {
        point_index: idx + 1,
        coordinates: point,
        soil_data: soilData,
        weather_data: weatherData,
      };
    });

    const results = await Promise.all(collectionPromises);

    return {
      bounding_box: boundingBoxCoords,
      sampling_grid_size: gridSize,
      total_points: gridPoints.length,
      time_period: { start, end },
      collection_timestamp: new Date().toISOString(),
      sampling_points: results,
    };
  }

  // --- VISUAL ANALYSIS LOGIC (WITH INTERSECTION) ---
  const getPolygonFilter = (layer) => {
    // This function needs to handle circles differently
    if (layer instanceof L.Circle) {
      const center = layer.getLatLng();
      const radius = layer.getRadius();
      return `around:${radius},${center.lat},${center.lng}`;
    } else {
      const latlngs = layer.getLatLngs()[0]; // Assumes simple polygon
      return 'poly:"' + latlngs.map((p) => `${p.lat} ${p.lng}`).join(" ") + '"';
    }
  };

  toolButtons.analyze.addEventListener("click", async () => {
    const drawnLayers = drawnItems.getLayers();
    if (drawnLayers.length === 0) return;

    // Clear previous conversation history for fresh analysis
    conversationHistory = [];
    currentAnalysisData = null;

    loadingOverlay.classList.remove("hidden");
    loadingOverlay.querySelector(".loading-text").textContent =
      "Collecting comprehensive area data...";
    analysisLayers.clearLayers();
    analysisLegend.classList.add("hidden");

    // Collect all data types in parallel
    const allPromises = drawnLayers.map(async (userLayer) => {
      const polyFilter = getPolygonFilter(userLayer);
      const query = `
                [out:json][timeout:30];
                (
                  way[building](${polyFilter});
                  relation[building](${polyFilter});
                  way[natural="wood"](${polyFilter});
                  relation[natural="wood"](${polyFilter});
                  way[leisure="park"](${polyFilter});
                  relation[leisure="park"](${polyFilter});
                  way[natural="water"](${polyFilter});
                  relation[natural="water"](${polyFilter});
                  way["landuse"="residential"](${polyFilter});
                  relation["landuse"="residential"](${polyFilter});
                  way["landuse"="commercial"](${polyFilter});
                  relation["landuse"="commercial"](${polyFilter});
                  way["landuse"="industrial"](${polyFilter});
                  relation["landuse"="industrial"](${polyFilter});
                );
                out geom;
            `;

      try {
        // Collect OSM, soil, and weather data in parallel
        loadingOverlay.querySelector(".loading-text").textContent =
          "Fetching map features, soil & weather data...";

        const [osmResponse, environmentalData] = await Promise.all([
          fetch(OVERPASS_API_URL, { method: "POST", body: query }),
          collectAreaData(userLayer, 2), // 2x2 grid for faster collection
        ]);

        if (!osmResponse.ok)
          throw new Error(`API Error: ${osmResponse.statusText}`);
        const osmData = await osmResponse.json();

        return {
          userLayer,
          osmData,
          environmentalData,
        };
      } catch (error) {
        console.error("Data collection error for a layer:", error);
        return null;
      }
    });

    const results = await Promise.all(allPromises);

    let featuresFound = false;
    let comprehensiveData = {
      areas: [],
      collection_timestamp: new Date().toISOString(),
    };

    results.forEach((result) => {
      if (!result) return;

      const { userLayer, osmData, environmentalData } = result;
      const userLayerGeoJSON = userLayer.toGeoJSON();

      // Process and visualize OSM data
      osmData.elements.forEach((element) => {
        if (element.type === "way" && element.geometry) {
          const latlngs = element.geometry.map((pt) => [pt.lat, pt.lon]);
          const osmFeature = L.polygon(latlngs).toGeoJSON();

          try {
            const intersection = turf.intersect(userLayerGeoJSON, osmFeature);

            if (intersection) {
              let style = null;

              if (element.tags.building)
                style = {
                  fillColor: "#FFA500",
                  color: "#D2691E",
                  weight: 1,
                  fillOpacity: 0.5,
                };
              else if (
                element.tags.natural === "wood" ||
                element.tags.leisure === "park"
              )
                style = {
                  fillColor: "#228B22",
                  color: "#006400",
                  weight: 1,
                  fillOpacity: 0.5,
                };
              else if (element.tags.natural === "water")
                style = {
                  fillColor: "#4682B4",
                  color: "#1E90FF",
                  weight: 1,
                  fillOpacity: 0.6,
                };
              else if (element.tags.landuse === "residential")
                style = {
                  fillColor: "#FFC0CB",
                  color: "#FFB6C1",
                  weight: 1,
                  fillOpacity: 0.5,
                };
              else if (element.tags.landuse === "commercial")
                style = {
                  fillColor: "#DA70D6",
                  color: "#BA55D3",
                  weight: 1,
                  fillOpacity: 0.5,
                };
              else if (element.tags.landuse === "industrial")
                style = {
                  fillColor: "#808080",
                  color: "#696969",
                  weight: 1,
                  fillOpacity: 0.5,
                };

              if (style) {
                featuresFound = true;
                L.geoJSON(intersection, { style: style }).addTo(analysisLayers);
              }
            }
          } catch (e) {
            console.error("Error with Turf.js intersection:", e);
          }
        }
      });

      // Store comprehensive data for GPT analysis
      comprehensiveData.areas.push({
        osm_features: osmData,
        environmental_data: environmentalData,
      });
    });

    // Send data to GPT for analysis
    if (OPENAI_API_KEY && comprehensiveData.areas.length > 0) {
      loadingOverlay.querySelector(".loading-text").textContent =
        "Analyzing data with AI...";

      try {
        const analysisResult = await analyzeWithGPT(comprehensiveData);
        console.log("=== GPT Analysis Results ===");
        console.log(analysisResult.formatted);
        console.log("===========================");

        // Clear chat history and add the analysis
        chatBody.innerHTML = "";
        appendMessage("Area Analysis Complete", "ai-message");

        // Add bounding box info
        const firstArea = comprehensiveData.areas[0];
        if (firstArea?.environmental_data?.bounding_box) {
          const bbox = firstArea.environmental_data.bounding_box;
          appendMessage(
            `Analysis Area: North ${bbox.north.toFixed(
              6
            )}, South ${bbox.south.toFixed(6)}, East ${bbox.east.toFixed(
              6
            )}, West ${bbox.west.toFixed(6)}`,
            "ai-message"
          );
        }

        // Display formatted analysis
        appendMessage(analysisResult.formatted, "ai-message");

        // If we have JSON data, also log it for debugging
        if (analysisResult.json) {
          console.log("=== Structured JSON Data ===");
          console.log(analysisResult.json);
          console.log("============================");
        }

        // Automatically open the chat window
        chatbotContainer.classList.remove("hidden");

        // Scroll to bottom of chat
        chatBody.scrollTop = chatBody.scrollHeight;
      } catch (error) {
        console.error("Error in GPT analysis:", error);
        // Show error in chat
        chatBody.innerHTML = "";
        appendMessage("Error in analysis: " + error.message, "ai-message");
        chatbotContainer.classList.remove("hidden");
      }
    }

    loadingOverlay.classList.add("hidden");
    if (featuresFound) {
      analysisLegend.classList.remove("hidden");
    } else {
      console.warn("No analyzable features found.");
    }
  });

  // --- History and Edit/Delete (Undo/Redo etc.) ---
  toolButtons.undo.addEventListener("click", () => {
    if (history.length === 0) return;
    const lastAction = history.pop();

    if (lastAction.action === "add") drawnItems.removeLayer(lastAction.layer);
    else if (lastAction.action === "remove") {
      lastAction.layer.getLayers()[0].addTo(drawnItems);
      addLayerInteractions(lastAction.layer.getLayers()[0]);
    } else if (lastAction.action === "edit")
      lastAction.layer.setLatLngs(lastAction.oldLatLngs);

    redoStack.push(lastAction);
    updateContextualTools();
  });

  toolButtons.redo.addEventListener("click", () => {
    if (redoStack.length === 0) return;
    const nextAction = redoStack.pop();

    if (nextAction.action === "add") drawnItems.addLayer(nextAction.layer);
    else if (nextAction.action === "remove")
      drawnItems.removeLayer(nextAction.layer.getLayers()[0]);
    else if (nextAction.action === "edit") {
    }

    history.push(nextAction);
    updateContextualTools();
  });

  toolButtons.clearAll.addEventListener("click", () => {
    if (drawnItems.getLayers().length > 0)
      clearModal.classList.remove("hidden");
  });

  clearConfirmBtn.addEventListener("click", () => {
    const layersToRemove = drawnItems.getLayers();
    if (layersToRemove.length > 0)
      addToHistory("remove", L.featureGroup(layersToRemove));
    drawnItems.clearLayers();
    updateContextualTools();
    clearModal.classList.add("hidden");
  });

  clearCancelBtn.addEventListener("click", () =>
    clearModal.classList.add("hidden")
  );

  updateContextualTools();

  // --- DRAWING & EDITING LOGIC ---

  function deselectAllLayers() {
    if (selectedLayer) {
      if (selectedLayer.editing?.enabled()) selectedLayer.editing.disable();
      selectedLayer = null;
    }
    contextMenu.classList.remove("visible");
  }

  function selectLayer(layer, latlng) {
    deselectAllLayers();
    selectedLayer = layer;
    const point = map.latLngToContainerPoint(latlng);
    contextMenu.style.left = `${point.x + 15}px`;
    contextMenu.style.top = `${point.y}px`;
    contextMenu.classList.add("visible");
  }

  editBtn.addEventListener("click", () => {
    if (selectedLayer?.editing) {
      selectedLayer.editing.enable();
      const oldLatLngs = JSON.parse(JSON.stringify(selectedLayer.getLatLngs()));
      selectedLayer.once("edit", () =>
        addToHistory("edit", selectedLayer, oldLatLngs)
      );
      contextMenu.classList.remove("visible");
    }
  });

  deleteBtn.addEventListener("click", () => {
    if (selectedLayer) {
      const layerToRemove = selectedLayer;
      deselectAllLayers();
      drawnItems.removeLayer(layerToRemove);
      addToHistory("remove", layerToRemove);
    }
  });

  const deactivateAllTools = () => {
    if (currentDrawer) {
      currentDrawer.disable();
      currentDrawer = null;
    }
    isFreeDrawing = false;
    map.dragging.enable();
    map
      .off("mousedown", handleFreeDrawStart)
      .off("mousemove", handleFreeDrawMove)
      .off("mouseup", handleFreeDrawEnd);
    map.getContainer().style.cursor = "";
    Object.values(toolButtons).forEach((button) =>
      button.classList.remove("active")
    );
    activeTool = null;
  };

  const activateTool = (toolName, buttonEl) => {
    if (activeTool === toolName) {
      deactivateAllTools();
      return;
    }
    deactivateAllTools();
    deselectAllLayers();
    activeTool = toolName;
    buttonEl.classList.add("active");
    toolbarContainer.classList.add("hidden");
    shapesMenu.classList.add("hidden");
  };

  const onDrawCreated = (event) => {
    const layer = event.layer;

    const path = layer.getElement();
    if (path) {
      path.classList.add("shape-drawn-animation");
      setTimeout(() => path.classList.remove("shape-drawn-animation"), 750);
    }

    drawnItems.addLayer(layer);
    addLayerInteractions(layer);
    addToHistory("add", layer);
    deactivateAllTools();

    // Get the bounding box of the drawn layer
    const bounds = layer.getBounds();
    const northWest = bounds.getNorthWest();
    const northEast = bounds.getNorthEast();
    const southWest = bounds.getSouthWest();
    const southEast = bounds.getSouthEast();

    // Log the four corner points to the console
    console.log("--- Bounding Box Coordinates for New Shape ---");
    console.log(
      `Top-Left (North-West):     Lat: ${northWest.lat.toFixed(
        6
      )}, Lng: ${northWest.lng.toFixed(6)}`
    );
    console.log(
      `Top-Right (North-East):    Lat: ${northEast.lat.toFixed(
        6
      )}, Lng: ${northEast.lng.toFixed(6)}`
    );
    console.log(
      `Bottom-Left (South-West):  Lat: ${southWest.lat.toFixed(
        6
      )}, Lng: ${southWest.lng.toFixed(6)}`
    );
    console.log(
      `Bottom-Right (South-East): Lat: ${southEast.lat.toFixed(
        6
      )}, Lng: ${southEast.lng.toFixed(6)}`
    );
    console.log("--------------------------------------------");
  };

  map.on(L.Draw.Event.CREATED, onDrawCreated);

  function addLayerInteractions(layer) {
    layer.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      selectLayer(layer, e.latlng);
    });
  }

  // --- TOOL IMPLEMENTATIONS ---
  toolButtons.polygon.addEventListener("click", () => {
    activateTool("polygon", toolButtons.polygon);
    currentDrawer = new L.Draw.Polygon(map, {
      shapeOptions: { color: "#007bff" },
    });
    currentDrawer.enable();
  });

  const handleFreeDrawStart = (e) => {
    if (!isFreeDrawing) return;
    map.dragging.disable();
    freeDrawPolyline = L.polyline([e.latlng], { color: "#ff5722" }).addTo(map);
  };
  const handleFreeDrawMove = (e) => {
    if (freeDrawPolyline) freeDrawPolyline.addLatLng(e.latlng);
  };
  const handleFreeDrawEnd = () => {
    if (freeDrawPolyline && freeDrawPolyline.getLatLngs().length > 2) {
      onDrawCreated({
        layer: L.polygon(freeDrawPolyline.getLatLngs(), { color: "#ff5722" }),
      });
    }
    if (freeDrawPolyline) map.removeLayer(freeDrawPolyline);
    freeDrawPolyline = null;
    map.dragging.enable();
    deactivateAllTools();
  };

  toolButtons.freeDraw.addEventListener("click", () => {
    activateTool("freeDraw", toolButtons.freeDraw);
    isFreeDrawing = true;
    map.getContainer().style.cursor = "cell";
    map
      .on("mousedown", handleFreeDrawStart)
      .on("mousemove", handleFreeDrawMove)
      .on("mouseup", handleFreeDrawEnd);
  });

  toolButtons.radius.addEventListener("click", () => {
    activateTool("radius", toolButtons.radius);
    map.getContainer().style.cursor = "pointer";
    map.once("click", (e) => {
      if (activeTool !== "radius") return;
      radiusCenterPoint = e.latlng;
      document.getElementById("radius-input").value = "";
      radiusModal.classList.remove("hidden");
      document.getElementById("radius-input").focus();
    });
  });

  radiusConfirmBtn.addEventListener("click", () => {
    const radius = parseFloat(document.getElementById("radius-input").value);
    if (radiusCenterPoint && radius > 0) {
      onDrawCreated({
        layer: L.circle(radiusCenterPoint, { radius, color: "#f03" }),
      });
    }
    radiusModal.classList.add("hidden");
    radiusCenterPoint = null;
    deactivateAllTools();
  });

  radiusCancelBtn.addEventListener("click", () => {
    radiusModal.classList.add("hidden");
    radiusCenterPoint = null;
    deactivateAllTools();
  });

  toolButtons.circle.addEventListener("click", () => {
    activateTool("circle", toolButtons.circle);
    currentDrawer = new L.Draw.Circle(map, {
      shapeOptions: { color: "#4caf50" },
    });
    currentDrawer.enable();
  });
  toolButtons.rectangle.addEventListener("click", () => {
    activateTool("rectangle", toolButtons.rectangle);
    currentDrawer = new L.Draw.Rectangle(map, {
      shapeOptions: { color: "#ffc107" },
    });
    currentDrawer.enable();
  });
  toolButtons.triangle.addEventListener("click", () => {
    activateTool("triangle", toolButtons.triangle);
    currentDrawer = new L.Draw.Polygon(map, {
      shapeOptions: { color: "#9c27b0" },
      maxPoints: 3,
    });
    currentDrawer.enable();
  });

  // --- GPT AGENT INTEGRATION ---

  /**
   * Format structured analysis like main.py
   */
  function formatStructuredAnalysis(analysisJson) {
    let formatted = "";

    formatted += "=".repeat(70) + "\n";
    formatted += "ANALYSIS RESULTS\n";
    formatted += "=".repeat(70) + "\n";

    // Development suitability
    const devSuit = analysisJson.developmentSuitability || {};
    formatted += `\n📊 Development Suitability: ${
      devSuit.score || "N/A"
    }/10 - ${devSuit.level || "N/A"}\n`;

    // Dashboard summary
    const dashboard = analysisJson.dashboardSummary || {};
    formatted += `🎯 Overall Readiness: ${
      dashboard.overallReadiness || "N/A"
    }%\n`;
    formatted += `⚠️  Critical Issues: ${dashboard.criticalIssues || "N/A"}\n`;
    formatted += `📋 Action Items: ${dashboard.actionItemsNeeded || "N/A"}\n`;

    // Data completeness
    const dataComp = analysisJson.dataCompleteness || {};
    formatted += `📊 Data Completeness: ${dataComp.overall || "N/A"}%\n`;

    // Top risks
    const risks = analysisJson.risks || [];
    if (risks.length > 0) {
      formatted += `\n🚨 Top Risks:\n`;
      for (let i = 0; i < Math.min(3, risks.length); i++) {
        const risk = risks[i];
        formatted += `   • ${risk.category || "Unknown"}: ${
          risk.severity || "unknown"
        } severity - ${(risk.impact || "").substring(0, 60)}...\n`;
      }
    }

    // Top recommendations
    const recommendations = analysisJson.recommendations || [];
    if (recommendations.length > 0) {
      formatted += `\n💡 Top Recommendations:\n`;
      for (let i = 0; i < Math.min(3, recommendations.length); i++) {
        const rec = recommendations[i];
        formatted += `   • [${(rec.priority || "unknown").toUpperCase()}] ${(
          rec.action || ""
        ).substring(0, 60)}...\n`;
      }
    }

    formatted += "\n" + "=".repeat(70) + "\n";

    return formatted;
  }

  /**
   * Analyze data using GPT-4o-mini (same prompt as main.py)
   */
  async function analyzeWithGPT(data) {
    if (!OPENAI_API_KEY) {
      throw new Error("OpenAI API key not configured");
    }

    try {
      // Initialize conversation history with system message and analysis request
      conversationHistory = [
        {
          role: "system",
          content:
            "You are an urban planning analysis AI. Analyze the provided environmental data and return ONLY a valid JSON object (no markdown, no explanations, no greetings).",
        },
        {
          role: "user",
          content: `Analyze this comprehensive area data and return ONLY a valid JSON object with the following structure:

Required JSON structure:

{
  "developmentSuitability": {
    "score": <number 0-10>,
    "maxScore": 10,
    "level": "<poor|fair|moderate|good|excellent>",
    "summary": "<brief 1-2 sentence assessment>",
    "factors": [
      {"name": "<factor name>", "score": <0-10>, "impact": "<low|medium|high>"}
    ]
  },
  "risks": [
    {
      "category": "<risk type>",
      "severity": "<low|medium|high|critical>",
      "probability": "<low|medium|high>",
      "impact": "<description of impact>",
      "mitigationPriority": <1-10>,
      "timeframe": "<immediate|short-term|medium-term|long-term>"
    }
  ],
  "keyFindings": [
    {
      "finding": "<concise finding>",
      "confidence": <0.0-1.0>,
      "dataQuality": "<low|medium|high>",
      "category": "<environmental|infrastructure|data_gap|opportunity>"
    }
  ],
  "recommendations": [
    {
      "action": "<recommended action>",
      "priority": "<low|medium|high|critical>",
      "effort": "<low|medium|high>",
      "cost": "<$|$$|$$$|$$$$>",
      "timeframe": "<duration estimate>",
      "impact": "<expected outcome>",
      "category": "<assessment|infrastructure|planning|environmental>"
    }
  ],
  "metrics": {
    "temperature": {
      "current": <average temp>,
      "min": <min temp>,
      "max": <max temp>,
      "trend": "<rising|stable|falling>"
    },
    "precipitation": {
      "total": <total mm>,
      "average": <avg mm/day>,
      "trend": "<increasing|stable|decreasing>"
    },
    "humidity": {
      "average": <percentage>,
      "assessment": "<low|moderate|high>"
    }
  },
  "dataCompleteness": {
    "overall": <percentage 0-100>,
    "categories": [
      {"name": "<category>", "completeness": <0-100>, "critical": <boolean>}
    ]
  },
  "dashboardSummary": {
    "overallReadiness": <percentage 0-100>,
    "criticalIssues": <count>,
    "actionItemsNeeded": <count>,
    "dataGaps": <count>
  }
}

Note: The analysis covers the area bounded by coordinates:
- North: ${
            data.areas[0]?.environmental_data?.bounding_box?.north?.toFixed(
              6
            ) || "N/A"
          }
- South: ${
            data.areas[0]?.environmental_data?.bounding_box?.south?.toFixed(
              6
            ) || "N/A"
          }
- East: ${
            data.areas[0]?.environmental_data?.bounding_box?.east?.toFixed(6) ||
            "N/A"
          }
- West: ${
            data.areas[0]?.environmental_data?.bounding_box?.west?.toFixed(6) ||
            "N/A"
          }

Base your analysis strictly on the provided data. Assess soil properties, weather patterns, risks, and development feasibility. Return ONLY the JSON object.

Data:
${JSON.stringify(data, null, 2)}`,
        },
      ];

      const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: conversationHistory,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error?.message || `API Error: ${response.status}`
        );
      }

      const result = await response.json();
      const rawAnalysis = result.choices[0].message.content;

      // Clean the response (remove markdown code blocks if present)
      let cleanResponse = rawAnalysis.trim();
      if (cleanResponse.startsWith("```json")) {
        cleanResponse = cleanResponse.substring(7);
      }
      if (cleanResponse.startsWith("```")) {
        cleanResponse = cleanResponse.substring(3);
      }
      if (cleanResponse.endsWith("```")) {
        cleanResponse = cleanResponse.substring(0, cleanResponse.length - 3);
      }
      cleanResponse = cleanResponse.trim();

      // Try to parse JSON
      let analysisJson = null;
      let formattedAnalysis = rawAnalysis; // fallback to raw response

      try {
        analysisJson = JSON.parse(cleanResponse);

        // Format the analysis like main.py
        formattedAnalysis = formatStructuredAnalysis(analysisJson);
      } catch (parseError) {
        console.error("JSON parsing failed:", parseError);
        console.log("Raw response:", rawAnalysis);
        formattedAnalysis = `⚠️ Could not parse JSON response: ${parseError.message}\n\nRaw response:\n${rawAnalysis}`;
      }

      // Add the response to conversation history
      conversationHistory.push({
        role: "assistant",
        content: rawAnalysis, // Store raw response for conversation context
      });

      // Store current analysis data for context
      currentAnalysisData = data;

      return {
        formatted: formattedAnalysis,
        json: analysisJson,
        raw: rawAnalysis,
      };
    } catch (error) {
      console.error("GPT API Error:", error);
      throw error;
    }
  }

  /**
   * Ask GPT a question (for chatbot) with conversation history
   */
  async function askGPT(query, context = null) {
    if (!OPENAI_API_KEY) {
      return "Error: OpenAI API key not configured. Please set OPENAI_API_KEY.";
    }

    try {
      // If we have conversation history, use it; otherwise start fresh
      let messages = [];

      if (conversationHistory.length > 0) {
        // Use existing conversation history (keep last 20 messages to avoid token limits)
        messages = conversationHistory.slice(-20);

        // Add current user query
        messages.push({
          role: "user",
          content: query,
        });
      } else {
        // No conversation history, start new conversation
        messages = [
          {
            role: "system",
            content:
              "You are a helpful urban planning assistant with expertise in GIS, environmental analysis, and sustainable development. Provide clear, practical advice.",
          },
        ];

        if (context) {
          messages.push({
            role: "system",
            content: `Context about the current map analysis:\n${JSON.stringify(
              context,
              null,
              2
            )}`,
          });
        }

        messages.push({
          role: "user",
          content: query,
        });
      }

      const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: messages,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error?.message || `API Error: ${response.status}`
        );
      }

      const result = await response.json();
      const response_text = result.choices[0].message.content;

      // Add to conversation history
      if (conversationHistory.length === 0) {
        // First time chatting, add system message
        conversationHistory.push(messages[0]);
        if (messages.length > 2) {
          conversationHistory.push(messages[1]); // context message
        }
      }

      conversationHistory.push({
        role: "user",
        content: query,
      });

      conversationHistory.push({
        role: "assistant",
        content: response_text,
      });

      return response_text;
    } catch (error) {
      console.error("GPT API Error:", error);
      return `Sorry, I encountered an error: ${error.message}`;
    }
  }

  // --- CHATBOT UI INTEGRATION ---
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && chatInput.value.trim() !== "") {
      const userQuery = chatInput.value.trim();
      appendMessage(userQuery, "user-message");
      chatInput.value = "";
      showLoadingIndicator();

      // Get context from drawn layers if any (only if no conversation history exists)
      let context = null;
      if (conversationHistory.length === 0) {
        const drawnLayers = drawnItems.getLayers();
        context =
          drawnLayers.length > 0
            ? {
                num_areas: drawnLayers.length,
                bounds: drawnLayers.map((layer) => layer.getBounds()),
              }
            : null;
      }

      askGPT(userQuery, context)
        .then((response) => {
          removeLoadingIndicator();
          appendMessage(response, "ai-message");
        })
        .catch((error) => {
          removeLoadingIndicator();
          appendMessage("Error: " + error.message, "ai-message");
        });
    }
  });

  const appendMessage = (text, type) => {
    const messageDiv = document.createElement("div");
    messageDiv.classList.add("chat-message", type);
    messageDiv.textContent = text;
    chatBody.appendChild(messageDiv);
    chatBody.scrollTop = chatBody.scrollHeight;
  };

  const showLoadingIndicator = () => {
    const loadingDiv = document.createElement("div");
    loadingDiv.classList.add("loading-indicator");
    loadingDiv.innerHTML = "<span></span><span></span><span></span>";
    chatBody.appendChild(loadingDiv);
    chatBody.scrollTop = chatBody.scrollHeight;
  };

  const removeLoadingIndicator = () => {
    const indicator = chatBody.querySelector(".loading-indicator");
    if (indicator) {
      chatBody.removeChild(indicator);
    }
  };
});
