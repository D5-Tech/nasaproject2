// --- Externalized JavaScript Logic from index.html ---

document.addEventListener('DOMContentLoaded', () => {

    // --- VARIABLES & CONFIGURATION ---
    const GEMINI_API_KEY = ''; // IMPORTANT: Leave empty, the execution environment provides the key.
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;
    const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter';
    
    let activeTool = null;
    let currentDrawer = null;
    let isFreeDrawing = false;
    let freeDrawPolyline = null;
    
    let selectedLayer = null;
    let history = [];
    let redoStack = [];

    let radiusCenterPoint = null;
    let searchMarker = null;

    // --- UI ELEMENT SELECTORS ---
    const loadingOverlay = document.getElementById('loading-overlay');
    const toolbarActivator = document.getElementById('toolbar-activator');
    const chatbotActivator = document.getElementById('chatbot-activator');
    const toolbarContainer = document.getElementById('toolbar-container');
    const chatbotContainer = document.getElementById('chatbot-container');
    const closeChatBtn = document.getElementById('close-chat-btn');
    const chatInput = document.getElementById('chat-input');
    const chatBody = document.getElementById('chat-body');
    const shapesTool = document.getElementById('shapes-tool');
    const shapesMenu = document.getElementById('shapes-menu');
    const contextMenu = document.getElementById('context-menu');
    const editBtn = document.getElementById('edit-btn');
    const deleteBtn = document.getElementById('delete-btn');
    const contextualActions = document.getElementById('contextual-actions');
    const streetViewBtn = document.getElementById('street-view-btn');
    const satelliteViewBtn = document.getElementById('satellite-view-btn');
    const analysisLegend = document.getElementById('analysis-legend');
    const legendCloseBtn = document.getElementById('legend-close-btn');
    const searchInput = document.getElementById('search-input');
    const currentLocationBtn = document.getElementById('current-location-btn');
    
    // Modals
    const radiusModal = document.getElementById('radius-modal');
    const radiusConfirmBtn = document.getElementById('radius-confirm-btn');
    const radiusCancelBtn = document.getElementById('radius-cancel-btn');
    const clearModal = document.getElementById('clear-modal');
    const clearConfirmBtn = document.getElementById('clear-confirm-btn');
    const clearCancelBtn = document.getElementById('clear-cancel-btn');
    
    const toolButtons = {
        polygon: document.getElementById('polygon-tool'),
        freeDraw: document.getElementById('free-draw-tool'),
        radius: document.getElementById('radius-tool'),
        circle: document.getElementById('circle-tool'),
        rectangle: document.getElementById('rectangle-tool'),
        triangle: document.getElementById('triangle-tool'),
        analyze: document.getElementById('analyze-tool'),
        undo: document.getElementById('undo-tool'),
        redo: document.getElementById('redo-tool'),
        clearAll: document.getElementById('clear-all-tool'),
    };

    // --- MAP INITIALIZATION ---
    const map = L.map('map', { 
        drawControl: false,
        zoomControl: false
    }).setView([9.5916, 76.5222], 13);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const osmLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    });
    const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri'
    });
    
    // Add a labels-only layer to create a hybrid view
    const labelsLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        attribution: '', // Attribution is already covered
        pane: 'shadowPane' // Ensures labels are on top
    });

    // Create a hybrid layer group
    const hybridLayer = L.layerGroup([satelliteLayer, labelsLayer]);

    osmLayer.addTo(map);

    const drawnItems = new L.FeatureGroup().addTo(map);
    const analysisLayers = new L.FeatureGroup().addTo(map);
    
    // --- UI INTERACTIVITY ---
    toolbarActivator.addEventListener('click', (e) => {
         e.stopPropagation();
         toolbarContainer.classList.toggle('hidden');
         if (!toolbarContainer.classList.contains('hidden')) {
             deactivateAllTools();
         }
    });
    chatbotActivator.addEventListener('click', () => chatbotContainer.classList.remove('hidden'));
    closeChatBtn.addEventListener('click', () => chatbotContainer.classList.add('hidden'));
    
    shapesTool.addEventListener('click', (e) => {
        e.stopPropagation();
        shapesMenu.classList.toggle('hidden');
    });

    legendCloseBtn.addEventListener('click', () => analysisLegend.classList.add('hidden'));

    document.addEventListener('click', (event) => {
        if (!toolbarContainer.contains(event.target) && event.target !== toolbarActivator) {
            toolbarContainer.classList.add('hidden');
        }
        if (!shapesMenu.contains(event.target) && event.target !== shapesTool) {
             shapesMenu.classList.add('hidden');
        }
    });
    map.on('click', deselectAllLayers);

    map.on('contextmenu', (e) => {
        L.popup()
            .setLatLng(e.latlng)
            .setContent(`Lat: ${e.latlng.lat.toFixed(6)}, Lng: ${e.latlng.lng.toFixed(6)}`)
            .openOn(map);
    });

    streetViewBtn.addEventListener('click', () => {
        if (!map.hasLayer(osmLayer)) {
            map.addLayer(osmLayer);
            map.removeLayer(hybridLayer);
            streetViewBtn.classList.add('active');
            satelliteViewBtn.classList.remove('active');
        }
    });
    satelliteViewBtn.addEventListener('click', () => {
         if (!map.hasLayer(hybridLayer)) {
            map.addLayer(hybridLayer);
            map.removeLayer(osmLayer);
            satelliteViewBtn.classList.add('active');
            streetViewBtn.classList.remove('active');
        }
    });
    
    // --- SEARCH & LOCATION ---
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const query = searchInput.value.trim();
            if (query) {
                performSearch(query);
            }
        }
    });

    currentLocationBtn.addEventListener('click', () => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition((position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                map.flyTo([lat, lng], 16);
                L.marker([lat, lng]).addTo(map).bindPopup("You are here.").openPopup();
            }, (error) => {
                console.error("Error getting current location:", error.message);
                alert("Could not retrieve your location. Please ensure location services are enabled.");
            });
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
                searchMarker = L.marker([lat, lng]).addTo(map)
                    .bindPopup(`Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`)
                    .openPopup();
            } else {
                alert("Invalid coordinates provided.");
            }
        } else {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
            try {
                const response = await fetch(url);
                const data = await response.json();
                if (data && data.length > 0) {
                    const { lat, lon, display_name } = data[0];
                    map.flyTo([lat, lon], 16);
                    searchMarker = L.marker([lat, lon]).addTo(map)
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
            contextualActions.classList.add('visible');
        } else {
            contextualActions.classList.remove('visible');
            analysisLayers.clearLayers();
            analysisLegend.classList.add('hidden');
        }
        
        toolButtons.analyze.disabled = !hasDrawings;
        toolButtons.undo.disabled = history.length === 0;
        toolButtons.redo.disabled = redoStack.length === 0;
        toolButtons.clearAll.disabled = !hasDrawings;
    };

    const addToHistory = (action, layer, oldLatLngs = null) => {
        const layerData = action === 'remove' ? L.geoJSON(layer.toGeoJSON()) : layer;
        history.push({ action, layer: layerData, oldLatLngs });
        redoStack = [];
        updateContextualTools();
    };
    
    // --- VISUAL ANALYSIS LOGIC (WITH INTERSECTION) ---
    const getPolygonFilter = (layer) => {
        // This function needs to handle circles differently
        if (layer instanceof L.Circle) {
            const center = layer.getLatLng();
            const radius = layer.getRadius();
            return `around:${radius},${center.lat},${center.lng}`;
        } else {
             const latlngs = layer.getLatLngs()[0]; // Assumes simple polygon
            return 'poly:"' + latlngs.map(p => `${p.lat} ${p.lng}`).join(' ') + '"';
        }
    };

    toolButtons.analyze.addEventListener('click', async () => {
        const drawnLayers = drawnItems.getLayers();
        if (drawnLayers.length === 0) return;

        loadingOverlay.classList.remove('hidden');
        loadingOverlay.querySelector('.loading-text').textContent = "Analyzing Map Data...";
        analysisLayers.clearLayers();
        analysisLegend.classList.add('hidden');

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
                const response = await fetch(OVERPASS_API_URL, { method: 'POST', body: query });
                if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
                const data = await response.json();
                return { userLayer, data }; // Pass userLayer along with data
            } catch (error) {
                console.error("Overpass API Error for a layer:", error);
                return null;
            }
        });

        const results = await Promise.all(allPromises);
        
        let featuresFound = false;
        results.forEach(result => {
            if (!result) return;

            const { userLayer, data } = result;
            const userLayerGeoJSON = userLayer.toGeoJSON();

            data.elements.forEach(element => {
                if (element.type === "way" && element.geometry) {
                    const latlngs = element.geometry.map(pt => [pt.lat, pt.lon]);
                    const osmFeature = L.polygon(latlngs).toGeoJSON();
                    
                    try {
                        const intersection = turf.intersect(userLayerGeoJSON, osmFeature);

                        if (intersection) {
                            let style = null;
                            
                            if (element.tags.building) style = { fillColor: '#FFA500', color: '#D2691E', weight: 1, fillOpacity: 0.5 };
                            else if (element.tags.natural === 'wood' || element.tags.leisure === 'park') style = { fillColor: '#228B22', color: '#006400', weight: 1, fillOpacity: 0.5 };
                            else if (element.tags.natural === 'water') style = { fillColor: '#4682B4', color: '#1E90FF', weight: 1, fillOpacity: 0.6 };
                            else if (element.tags.landuse === 'residential') style = { fillColor: '#FFC0CB', color: '#FFB6C1', weight: 1, fillOpacity: 0.5 };
                            else if (element.tags.landuse === 'commercial') style = { fillColor: '#DA70D6', color: '#BA55D3', weight: 1, fillOpacity: 0.5 };
                            else if (element.tags.landuse === 'industrial') style = { fillColor: '#808080', color: '#696969', weight: 1, fillOpacity: 0.5 };
                            
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
        });
        
        loadingOverlay.classList.add('hidden');
        if (featuresFound) {
            analysisLegend.classList.remove('hidden');
        } else {
            console.warn("No analyzable features found.");
        }
    });


    // --- History and Edit/Delete (Undo/Redo etc.) ---
    toolButtons.undo.addEventListener('click', () => {
        if (history.length === 0) return;
        const lastAction = history.pop();
        
        if (lastAction.action === 'add') drawnItems.removeLayer(lastAction.layer);
        else if (lastAction.action === 'remove') {
             lastAction.layer.getLayers()[0].addTo(drawnItems);
             addLayerInteractions(lastAction.layer.getLayers()[0]);
        } else if (lastAction.action === 'edit') lastAction.layer.setLatLngs(lastAction.oldLatLngs);
        
        redoStack.push(lastAction);
        updateContextualTools();
    });

    toolButtons.redo.addEventListener('click', () => {
        if (redoStack.length === 0) return;
        const nextAction = redoStack.pop();

        if (nextAction.action === 'add') drawnItems.addLayer(nextAction.layer);
        else if (nextAction.action === 'remove') drawnItems.removeLayer(nextAction.layer.getLayers()[0]);
        else if (nextAction.action === 'edit') {}
        
        history.push(nextAction);
        updateContextualTools();
    });
    
    toolButtons.clearAll.addEventListener('click', () => {
        if(drawnItems.getLayers().length > 0) clearModal.classList.remove('hidden');
    });
    
    clearConfirmBtn.addEventListener('click', () => {
        const layersToRemove = drawnItems.getLayers();
        if(layersToRemove.length > 0) addToHistory('remove', L.featureGroup(layersToRemove));
        drawnItems.clearLayers();
        updateContextualTools();
        clearModal.classList.add('hidden');
    });
    
    clearCancelBtn.addEventListener('click', () => clearModal.classList.add('hidden'));

    updateContextualTools();

    // --- DRAWING & EDITING LOGIC ---
    
    function deselectAllLayers() {
        if (selectedLayer) {
            if (selectedLayer.editing?.enabled()) selectedLayer.editing.disable();
            selectedLayer = null;
        }
        contextMenu.classList.remove('visible');
    }

    function selectLayer(layer, latlng) {
        deselectAllLayers();
        selectedLayer = layer;
        const point = map.latLngToContainerPoint(latlng);
        contextMenu.style.left = `${point.x + 15}px`;
        contextMenu.style.top = `${point.y}px`;
        contextMenu.classList.add('visible');
    }

    editBtn.addEventListener('click', () => {
        if (selectedLayer?.editing) {
            selectedLayer.editing.enable();
            const oldLatLngs = JSON.parse(JSON.stringify(selectedLayer.getLatLngs())); 
            selectedLayer.once('edit', () => addToHistory('edit', selectedLayer, oldLatLngs));
            contextMenu.classList.remove('visible');
        }
    });

    deleteBtn.addEventListener('click', () => {
        if (selectedLayer) {
            const layerToRemove = selectedLayer;
            deselectAllLayers();
            drawnItems.removeLayer(layerToRemove);
            addToHistory('remove', layerToRemove);
        }
    });

    const deactivateAllTools = () => {
        if (currentDrawer) {
            currentDrawer.disable();
            currentDrawer = null;
        }
        isFreeDrawing = false;
        map.dragging.enable();
        map.off('mousedown', handleFreeDrawStart).off('mousemove', handleFreeDrawMove).off('mouseup', handleFreeDrawEnd);
        map.getContainer().style.cursor = '';
        Object.values(toolButtons).forEach(button => button.classList.remove('active'));
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
        buttonEl.classList.add('active');
        toolbarContainer.classList.add('hidden');
        shapesMenu.classList.add('hidden');
    };

    const onDrawCreated = (event) => {
        const layer = event.layer;
        
        const path = layer.getElement();
        if (path) {
            path.classList.add('shape-drawn-animation');
            setTimeout(() => path.classList.remove('shape-drawn-animation'), 750);
        }
        
        drawnItems.addLayer(layer);
        addLayerInteractions(layer);
        addToHistory('add', layer);
        deactivateAllTools();

        // Get the bounding box of the drawn layer
        const bounds = layer.getBounds();
        const northWest = bounds.getNorthWest();
        const northEast = bounds.getNorthEast();
        const southWest = bounds.getSouthWest();
        const southEast = bounds.getSouthEast();

        // Log the four corner points to the console
        console.log("--- Bounding Box Coordinates for New Shape ---");
        console.log(`Top-Left (North-West):     Lat: ${northWest.lat.toFixed(6)}, Lng: ${northWest.lng.toFixed(6)}`);
        console.log(`Top-Right (North-East):    Lat: ${northEast.lat.toFixed(6)}, Lng: ${northEast.lng.toFixed(6)}`);
        console.log(`Bottom-Left (South-West):  Lat: ${southWest.lat.toFixed(6)}, Lng: ${southWest.lng.toFixed(6)}`);
        console.log(`Bottom-Right (South-East): Lat: ${southEast.lat.toFixed(6)}, Lng: ${southEast.lng.toFixed(6)}`);
        console.log("--------------------------------------------");
    };
    
    map.on(L.Draw.Event.CREATED, onDrawCreated);
    
    function addLayerInteractions(layer) {
        layer.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            selectLayer(layer, e.latlng);
        });
    }
    
    // --- TOOL IMPLEMENTATIONS ---
    toolButtons.polygon.addEventListener('click', () => {
        activateTool('polygon', toolButtons.polygon);
        currentDrawer = new L.Draw.Polygon(map, { shapeOptions: { color: '#007bff' } });
        currentDrawer.enable();
    });
    
    const handleFreeDrawStart = (e) => {
        if (!isFreeDrawing) return;
        map.dragging.disable();
        freeDrawPolyline = L.polyline([e.latlng], { color: '#ff5722' }).addTo(map);
    };
    const handleFreeDrawMove = (e) => { if (freeDrawPolyline) freeDrawPolyline.addLatLng(e.latlng); };
    const handleFreeDrawEnd = () => {
        if (freeDrawPolyline && freeDrawPolyline.getLatLngs().length > 2) {
            onDrawCreated({ layer: L.polygon(freeDrawPolyline.getLatLngs(), { color: '#ff5722' }) });
        }
        if(freeDrawPolyline) map.removeLayer(freeDrawPolyline);
        freeDrawPolyline = null;
        map.dragging.enable();
        deactivateAllTools();
    };

    toolButtons.freeDraw.addEventListener('click', () => {
        activateTool('freeDraw', toolButtons.freeDraw);
        isFreeDrawing = true;
        map.getContainer().style.cursor = 'cell';
        map.on('mousedown', handleFreeDrawStart).on('mousemove', handleFreeDrawMove).on('mouseup', handleFreeDrawEnd);
    });

    toolButtons.radius.addEventListener('click', () => {
        activateTool('radius', toolButtons.radius);
        map.getContainer().style.cursor = 'pointer';
        map.once('click', (e) => {
            if (activeTool !== 'radius') return;
            radiusCenterPoint = e.latlng;
            document.getElementById('radius-input').value = ''; 
            radiusModal.classList.remove('hidden');
            document.getElementById('radius-input').focus();
        });
    });
    
    radiusConfirmBtn.addEventListener('click', () => {
        const radius = parseFloat(document.getElementById('radius-input').value);
        if (radiusCenterPoint && radius > 0) {
            onDrawCreated({ layer: L.circle(radiusCenterPoint, { radius, color: '#f03' }) });
        }
        radiusModal.classList.add('hidden');
        radiusCenterPoint = null;
        deactivateAllTools();
    });

    radiusCancelBtn.addEventListener('click', () => {
        radiusModal.classList.add('hidden');
        radiusCenterPoint = null;
        deactivateAllTools();
    });

    toolButtons.circle.addEventListener('click', () => {
        activateTool('circle', toolButtons.circle);
        currentDrawer = new L.Draw.Circle(map, { shapeOptions: { color: '#4caf50' } });
        currentDrawer.enable();
    });
    toolButtons.rectangle.addEventListener('click', () => {
        activateTool('rectangle', toolButtons.rectangle);
        currentDrawer = new L.Draw.Rectangle(map, { shapeOptions: { color: '#ffc107' } });
        currentDrawer.enable();
    });
    toolButtons.triangle.addEventListener('click', () => {
         activateTool('triangle', toolButtons.triangle);
         currentDrawer = new L.Draw.Polygon(map, { shapeOptions: { color: '#9c27b0' }, maxPoints: 3 });
         currentDrawer.enable();
    });

    // --- GEMINI CHATBOT INTEGRATION ---
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && chatInput.value.trim() !== '') {
            const userQuery = chatInput.value.trim();
            appendMessage(userQuery, 'user-message');
            chatInput.value = '';
            showLoadingIndicator();
            askGemini(userQuery);
        }
    });

    const appendMessage = (text, type) => {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('chat-message', type);
        messageDiv.textContent = text;
        chatBody.appendChild(messageDiv);
        chatBody.scrollTop = chatBody.scrollHeight; 
    };
    
    const showLoadingIndicator = () => {
        const loadingDiv = document.createElement('div');
        loadingDiv.classList.add('loading-indicator');
        loadingDiv.innerHTML = '<span></span><span></span><span></span>';
        chatBody.appendChild(loadingDiv);
        chatBody.scrollTop = chatBody.scrollHeight;
    };

    const removeLoadingIndicator = () => {
        const indicator = chatBody.querySelector('.loading-indicator');
        if (indicator) {
            chatBody.removeChild(indicator);
        }
    };
    
    const askGemini = async (query) => {
        try {
            const response = await fetch(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: query }] }] })
            });
            
            removeLoadingIndicator();

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error.message || `API request failed with status ${response.status}`);
            }
            const data = await response.json();
            const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

            if (aiResponse) {
                appendMessage(aiResponse, 'ai-message');
            } else {
                throw new Error("Invalid response structure from API.");
            }
        } catch (error) {
            console.error("Gemini API Error:", error);
            removeLoadingIndicator();
            const errorMessage = `Sorry, I encountered an error. Please check the console for details.`;
            appendMessage(errorMessage, 'ai-message');
        }
    };
});
