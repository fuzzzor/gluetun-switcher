// API wrapper to communicate with the backend
const api = {
    async _request(method, endpoint, body = null) {
        try {
            const options = {
                method,
                headers: {}
            };
            if (body) {
                options.headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(body);
            }
            const response = await fetch(`/api/${endpoint}`, options);
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || `Erreur ${response.status}`);
            }
            // Handle responses that do not have a JSON body
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") !== -1) {
                return response.json();
            }
            return { success: true }; // For requests like DELETE that return nothing
        } catch (error) {
            console.error(`API Error on ${method} /api/${endpoint}:`, error);
            throw error;
        }
    },
    get(endpoint) { return this._request('GET', endpoint); },
    post(endpoint, body) { return this._request('POST', endpoint, body); },
    delete(endpoint) { return this._request('DELETE', endpoint); },

    // Application-specific functions
    getOperationHistory: () => api.get('operation-history'),
    saveOperationHistory: (history) => api.post('operation-history', { history }),
    clearOperationHistory: () => api.delete('operation-history'),
    listWireguardFiles: () => api.get('wireguard-files'),
    getCurrentConfigInfo: () => api.get('current-config-info'),
    activateConfig: (sourcePath) => api.post('activate-config', { sourcePath }),
    getLocations: () => api.get('locations'),
    getMapConfig: () => api.get('config/map'),
};


// Global variables
let selectedFile = null;
let wireguardFiles = [];
let operationHistory = [];
let translations = {};
let locationData = {};
let mapConfig = {};
let currentIpInfo = null; // Store current IP information

// DOM Elements
const refreshBtn = document.getElementById('refreshBtn');
const fileList = document.getElementById('fileList');
const activateBtn = document.getElementById('activateBtn');
const resetBtn = document.getElementById('resetBtn');
const currentConfig = document.getElementById('currentConfig');

const operationHistoryContainer = document.getElementById('operationHistory');
const notificationsContainer = document.getElementById('notifications');
const clearHistoryBtn = document.getElementById('clearHistoryBtn'); // New button

const confirmModal = document.getElementById('confirmModal');
const confirmMessage = document.getElementById('confirmMessage');
const confirmYes = document.getElementById('confirmYes');
const confirmNo = document.getElementById('confirmNo');
const modalClose = document.querySelector('.modal-close');
 
// Initialization
async function loadTranslations() {
    const lang = navigator.language.startsWith('fr') ? 'fr' : 'en';
    document.documentElement.lang = lang;
    try {
        const response = await fetch(`locales/${lang}.json`);
        translations = await response.json();
        applyTranslations();
    } catch (error) {
        console.error('Could not load translations:', error);
        throw error; // Re-throw to stop initialization
    }
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[key]) {
            el.textContent = translations[key];
        }
    });
}

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Load critical data first. If this fails, the app can't start.
        await Promise.all([
            loadTranslations(),
            loadLocations(),
            loadMapConfig()
        ]);

        // Initialize the rest of the app
        initializeEventListeners();
        operationHistory = await api.getOperationHistory();
        updateHistoryDisplay();
        loadWireguardFiles();
        checkCurrentConfig();

    } catch (error) {
        console.error('Application initialization failed:', error);
        const mainContent = document.querySelector('.main-content');
        const header = document.querySelector('.header');

        if (header) {
            header.innerHTML = `<h1><i class="fas fa-times-circle"></i> Application Error</h1>`;
        }
        if (mainContent) {
            mainContent.innerHTML = `
                <div class="card">
                    <div class="card-body no-files" style="color: var(--danger-color);">
                        <i class="fas fa-exclamation-triangle fa-3x" style="margin-bottom: 15px;"></i>
                        <h2>Failed to Start</h2>
                        <p>The application could not load critical data. Please check the browser's console for more details and try refreshing the page.</p>
                    </div>
                </div>
            `;
        }
    }
});

async function loadLocations() {
    try {
        const result = await api.getLocations();
        if (result.success) {
            locationData = result.locations;
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('Could not load locations:', error);
        // Re-throw to be caught by the main initializer
        throw new Error(`Failed to load location data: ${error.message}`);
    }
}

async function loadMapConfig() {
    try {
        const result = await api.getMapConfig();
        if (result.success) {
            mapConfig = result.config;
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('Could not load map configuration:', error);
        // Re-throw to be caught by the main initializer
        throw new Error(`Failed to load map configuration: ${error.message}`);
    }
}
 
// Event Handlers
function initializeEventListeners() {
    refreshBtn.addEventListener('click', loadWireguardFiles);
    activateBtn.addEventListener('click', showConfirmationModal);
    resetBtn.addEventListener('click', resetSelection);

    // Handler for the history clear button
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', clearOperationHistory);
    }

    // Modal events
    confirmYes.addEventListener('click', executeActivation);
    confirmNo.addEventListener('click', hideConfirmationModal);
    modalClose.addEventListener('click', hideConfirmationModal);
    
    // Close the modal by clicking outside
    confirmModal.addEventListener('click', (e) => {
        if (e.target === confirmModal) {
            hideConfirmationModal();
        }
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideConfirmationModal();
        }
        if (e.key === 'F5') {
            e.preventDefault();
            loadWireguardFiles();
        }
    });

    // Initialize collapsible sections
    document.querySelectorAll('[data-collapsible]').forEach(header => {
        const contentId = header.getAttribute('data-collapsible');
        const content = document.getElementById(contentId);
        const toggleButton = header.querySelector('.collapse-toggle');
        const toggleIcon = header.querySelector('.collapse-toggle i');

        if (!content || !toggleButton || !toggleIcon) return;

        // Collapse history by default
        if (contentId === 'historyContent') {
            content.classList.add('collapsed');
            toggleIcon.classList.add('rotated');
        }

        const toggle = () => {
            content.classList.toggle('collapsed');
            toggleIcon.classList.toggle('rotated');
        };

        // Click on header (excluding button)
        header.addEventListener('click', (e) => {
            if (e.target.closest('.collapse-toggle')) return;
            toggle();
        });

        // Click directly on chevron button
        toggleButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggle();
        });
    });
}

// Loading WireGuard files
async function loadWireguardFiles() {
    try {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${translations.loading}`;
        
        fileList.innerHTML = `
            <div class="no-files">
                <i class="fas fa-spinner fa-spin"></i> ${translations.loadingFiles}
            </div>
        `;
        
        // We now primarily use the enriched locations endpoint
        await loadLocations();
        wireguardFiles = locationData; // The location data is now our source of truth
        displayFileList();
        
        const availableCount = locationData.filter(loc => loc.isAvailable).length;
        showNotification(translations.configsFound.replace('{count}', availableCount), 'success');
        
    } catch (error) {
        showNotification(translations.errorLoading.replace('{error}', error.message), 'error');
        fileList.innerHTML = `
            <div class="no-files">
                <i class="fas fa-exclamation-triangle"></i><br>
                ${translations.errorLoadingShort}
            </div>
        `;
    } finally {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = `<i class="fas fa-sync-alt"></i> ${translations.refreshList}`;
    }
}

// Displaying the file list
function displayFileList() {
    if (wireguardFiles.length === 0) {
        fileList.innerHTML = `
            <div class="no-files">
                <i class="fas fa-info-circle"></i><br>
                ${translations.noConfigAvailable}<br>
                <small>${translations.onlyConfAllowed}</small>
            </div>
        `;
        return;
    }
    
    fileList.innerHTML = wireguardFiles.map(location => {
        const { countryCode, countryNameKey, keywords, isAvailable, fileName } = location;
        const countryName = translations[countryNameKey] || countryNameKey;
        const city = keywords.length > 1 ? keywords[keywords.length - 1] : '';
        const locationString = city ? `${countryName}, ${city.charAt(0).toUpperCase() + city.slice(1)}` : countryName;
        const flag = `<img src="config/flags/${countryCode}.svg" class="country-flag" alt="${countryName}" title="${countryName}">`;
        const statusClass = isAvailable ? 'status-available' : 'status-unavailable';
        const statusText = isAvailable ? translations.available : translations.unavailable;
        const clickHandler = isAvailable ? `onclick="selectFile('${fileName}')"` : '';
        const itemClass = isAvailable ? 'file-item' : 'file-item disabled';

        return `
        <div class="${itemClass}" data-file="${fileName || countryCode}" ${clickHandler}>
            <div class="file-info">
                <div class="file-icon">
                    <i class="fas fa-shield-alt"></i>
                </div>
                <div class="file-details">
                    <h4>${flag} ${fileName || countryName}</h4>
                    <p>${locationString}</p>
                </div>
            </div>
            <div class="file-status">
                <span class="status-badge ${statusClass}">${statusText}</span>
            </div>
        </div>
    `}).join('');
}

// Selecting a file
function selectFile(fileName) {
    document.querySelectorAll('.file-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    const fileItem = document.querySelector(`[data-file="${fileName}"]`);
    if (fileItem) {
        fileItem.classList.add('selected');
        selectedFile = wireguardFiles.find(f => f.fileName === fileName);
        activateBtn.disabled = false;
        showNotification(translations.configSelected.replace('{fileName}', fileName), 'info');
    }
}

// Function to fetch IP information from the primary API with minimal fallbacks
async function fetchIpInfo() {
    console.log('DEBUG: Starting fetchIpInfo()');
    
    // Try the primary API first with a longer timeout to ensure it works
    try {
        console.log('DEBUG: Trying primary API: http://192.168.0.242:8000/v1/publicip/ip');
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 seconds timeout
        
        const response = await fetch('http://192.168.0.242:8000/v1/publicip/ip', {
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
            const data = await response.json();
            console.log('DEBUG: Primary API response:', data);
            
            // Use the data exactly as returned by the primary API
            if (data) {
                currentIpInfo = data;
                console.log('DEBUG: Successfully got IP info from primary API:', data);
                return data;
            }
        } else {
            console.log('DEBUG: Primary API response not OK:', response.status, response.statusText);
        }
    } catch (error) {
        console.error('DEBUG: Error with primary API:', error.message);
    }
    
    // Only use geolocation API for coordinates if primary API fails
    try {
        console.log('DEBUG: Primary API failed, trying geolocation API for coordinates only');
        if (mapConfig && mapConfig.geolocationApiUrl) {
            const response = await fetch(mapConfig.geolocationApiUrl);
            if (response.ok) {
                const data = await response.json();
                console.log('DEBUG: Geolocation API data:', data);
                
                // Use minimal data from geolocation API, keeping IP and timezone as "Non disponible"
                currentIpInfo = {
                    ip: 'Non disponible',
                    timezone: 'Non disponible',
                    location: data.location,
                    latitude: data.latitude || data.lat,
                    longitude: data.longitude || data.lon || data.lng,
                    country: data.country || data.country_name || 'Non disponible',
                    city: data.city || 'Non disponible'
                };
                
                console.log('DEBUG: Using geolocation API for coordinates only:', currentIpInfo);
                return currentIpInfo;
            }
        }
    } catch (error) {
        console.error('DEBUG: Geolocation API error:', error);
    }
    
    // Last resort: provide default values
    console.log('DEBUG: All APIs failed, using default values');
    currentIpInfo = {
        ip: 'Non disponible',
        timezone: 'Non disponible',
        location: null,
        latitude: null,
        longitude: null,
        country: 'Non disponible',
        city: 'Non disponible'
    };
    
    return currentIpInfo;
}

// Checking the current configuration
async function checkCurrentConfig() {
    console.log('DEBUG: Starting checkCurrentConfig()');
    
    try {
        const configInfo = await api.getCurrentConfigInfo();
        console.log('DEBUG: Config info:', configInfo);

        if (configInfo.success) {
            const location = getLocationInfo(configInfo.name);
            console.log('DEBUG: Location info:', location);
            const locationString = location.city ? `${location.name}, ${location.city}` : location.name;
            
            // Show loading state first
            currentConfig.innerHTML = `
                <div class="current-config-content">
                    <i class="fas fa-spinner fa-spin"></i>
                    <div class="current-config-text">
                        <h4>${location.flag} ${configInfo.name} (${translations.active})</h4>
                        <p>Récupération des informations IP...</p>
                    </div>
                </div>
                <div class="current-config-map">
                    <div id="currentMap"></div>
                </div>
            `;
            currentConfig.style.background = '';
            
            // Fetch IP info
            console.log('DEBUG: Fetching IP info...');
            const ipInfo = await fetchIpInfo();
            console.log('DEBUG: IP info result:', ipInfo);
            
            // Build the display with IP and timezone info
            let ipInfoHTML = '';
            if (ipInfo && (ipInfo.timezone || ipInfo.ip)) {
                const timezone = ipInfo.timezone || 'Timezone non disponible';
                const ipAddress = ipInfo.ip || 'IP non disponible';
                ipInfoHTML = `<p>${locationString} - ${timezone}</p><p><strong>IP: ${ipAddress}</strong></p>`;
                console.log('DEBUG: IP info HTML built successfully');
            } else {
                console.log('DEBUG: No IP info available, using defaults');
                ipInfoHTML = `<p>${locationString} - Timezone non disponible</p><p><strong>IP: Non disponible</strong></p>`;
            }
            
            // Update the display with final info
            console.log('DEBUG: Updating currentConfig innerHTML with IP info');
            currentConfig.innerHTML = `
                <div class="current-config-content">
                    <i class="fas fa-check-circle"></i>
                    <div class="current-config-text">
                        <h4>${location.flag} ${configInfo.name} (${translations.active})</h4>
                        ${ipInfoHTML}
                    </div>
                </div>
                <div class="current-config-map">
                    <div id="currentMap"></div>
                </div>
            `;
            
            console.log('DEBUG: Scheduling map initialization');
            // Initialize the map after the DOM is updated
            setTimeout(() => {
                console.log('DEBUG: Calling initCurrentMap');
                initCurrentMap(location);
            }, 200);
            
        } else if (configInfo.reason === 'not_found') {
            currentConfig.innerHTML = `
                <i class="fas fa-exclamation-triangle"></i>
                <div>
                    <h4>${translations.noActiveConfig}</h4>
                    <p>${translations.wg0NotFound}</p>
                </div>
            `;
            currentConfig.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
        } else {
            // Handle read errors or other server errors
            throw new Error(configInfo.error || translations.unknownErrorChecking);
        }
    } catch (error) {
        console.error('DEBUG: Error in checkCurrentConfig:', error);
        currentConfig.innerHTML = `
            <i class="fas fa-times-circle"></i>
            <div>
                <h4>${translations.errorChecking}</h4>
                <p>${translations.cantCheck}</p>
                <p style="color: red; font-size: 0.8em; margin-top: 10px;">Debug: ${error.message}</p>
            </div>
        `;
        currentConfig.style.background = 'linear-gradient(135deg, #dc2626, #b91c1c)';
    }
}


// Initialize the MapLibre map in the #currentMap container using the stored IP data
async function initCurrentMap(locationInfo) {
    const mapContainer = document.getElementById('currentMap');
    if (!mapContainer) {
        console.log('DEBUG: Map container not found');
        return;
    }

    mapContainer.innerHTML = '';

    try {
        // Use already fetched IP data
        const data = currentIpInfo;
        if (!data) {
            console.log('DEBUG: No IP data available');
            mapContainer.innerHTML = `<div style="height: 100%; display: flex; align-items: center; justify-content: center;"><img src="icons/nondispo.jpg" alt="Carte non disponible" style="max-width: 100%; max-height: 100%; border-radius: 8px;"></div>`;
            return;
        }

        console.log('DEBUG: Using stored IP data:', data);

        // Parse coordinates from location string format "47.498249,19.039780"
        let lat = null, lon = null;
        
        if (data.location && typeof data.location === 'string') {
            console.log('DEBUG: Found location string:', data.location);
            const coords = data.location.split(',');
            console.log('DEBUG: Split coords:', coords);
            if (coords.length === 2) {
                lat = parseFloat(coords[0]);
                lon = parseFloat(coords[1]);
                console.log('DEBUG: Parsed coordinates:', lat, lon);
            }
        }
        
        // Fallback to common property names if location string format not available
        if (lat === null || lon === null) {
            console.log('DEBUG: Using fallback coordinates from:', data);
            lat = data.latitude ?? data.lat ?? null;
            lon = data.longitude ?? data.lon ?? data.lng ?? null;
            console.log('DEBUG: Fallback coordinates:', lat, lon);
        }

        if (lat == null || lon == null) {
            console.log('DEBUG: No valid coordinates found');
            // Show fallback image when coordinates are not available
            mapContainer.innerHTML = `<div style="height: 100%; display: flex; align-items: center; justify-content: center;"><img src="icons/nondispo.jpg" alt="Carte non disponible" style="max-width: 100%; max-height: 100%; border-radius: 8px;"></div>`;
            return;
        }

        console.log('DEBUG: Final coordinates for map:', lat, lon);

        if (!window.maplibregl) {
            console.log('DEBUG: MapLibre not available');
            // Show fallback image when map library is not loaded
            mapContainer.innerHTML = `<div style="height: 100%; display: flex; align-items: center; justify-content: center;"><img src="icons/nondispo.jpg" alt="Carte non disponible" style="max-width: 100%; max-height: 100%; border-radius: 8px;"></div>`;
            return;
        }

        // Use configured map tile URL
        const mapTileUrl = mapConfig.mapTileUrl;
        if (!mapTileUrl) {
            console.log('DEBUG: No map tile URL configured');
            // Show fallback image when map tile URL is not configured
            mapContainer.innerHTML = `<div style="height: 100%; display: flex; align-items: center; justify-content: center;"><img src="icons/nondispo.jpg" alt="Carte non disponible" style="max-width: 100%; max-height: 100%; border-radius: 8px;"></div>`;
            return;
        }

        console.log('DEBUG: Creating map with tile URL:', mapTileUrl);

        // Create map
        const map = new maplibregl.Map({
            container: mapContainer,
            style: mapTileUrl,
            center: [Number(lon), Number(lat)],
            zoom: 10
        });

        // Add a marker
        new maplibregl.Marker().setLngLat([Number(lon), Number(lat)]).addTo(map);

        // Optional popup with location name
        if (locationInfo && (locationInfo.name || locationInfo.city)) {
            const popup = new maplibregl.Popup({ offset: 25 }).setText(`${locationInfo.name}${locationInfo.city ? (', ' + locationInfo.city) : ''}`);
            new maplibregl.Marker().setLngLat([Number(lon), Number(lat)]).setPopup(popup).addTo(map);
        }

        console.log('DEBUG: Map created successfully');

    } catch (error) {
        console.error('Erreur initialisation carte:', error);
        // Show fallback image when there's an error loading the map
        mapContainer.innerHTML = `<div style="height: 100%; display: flex; align-items: center; justify-content: center;"><img src="icons/nondispo.jpg" alt="Carte non disponible" style="max-width: 100%; max-height: 100%; border-radius: 8px;"></div>`;
    }
}

// Resetting the selection
function resetSelection() {
    selectedFile = null;
    activateBtn.disabled = true;
    
    document.querySelectorAll('.file-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    showNotification(translations.selectionReset, 'info');
}

// Displaying the confirmation modal
function showConfirmationModal() {
    if (!selectedFile) return;
    
    const location = getLocationInfo(selectedFile.fileName);
    const locationString = location.city ? `${location.name}, ${location.city}` : location.name;
    confirmMessage.innerHTML = `
        <strong>${translations.activateConfigTitle}</strong><br><br>
        <strong>${translations.fileSelected}</strong> ${location.flag} ${selectedFile.fileName} (${locationString})<br>
        <strong>${translations.action}</strong> ${translations.activateThisConfig}<br><br>
        ${translations.thisActionWillActivate}
    `;
    
    confirmModal.classList.remove('hidden');
}

// Hiding the confirmation modal
function hideConfirmationModal() {
    confirmModal.classList.add('hidden');
}

// Executing the activation
async function executeActivation() {
    hideConfirmationModal();
    if (!selectedFile) return;
    
    try {
        showNotification(translations.activationInProgress, 'info');
        
        const result = await api.activateConfig(selectedFile.fullPath);
        
        if (result.success) {
            const locationInfo = getLocationInfo(result.activated.sourceName);
            const locationString = locationInfo.city ? `${locationInfo.name}, ${locationInfo.city}` : locationInfo.name;
            
            let message = translations.activationSuccessLocation.replace('{location}', locationString);
            
            result.restarts.forEach(r => {
                if (r.status === 'success') {
                    message += translations.restartedContainer.replace('{containerName}', r.containerName);
                } else {
                    message += translations.restartedContainerError.replace('{containerName}', r.containerName).replace('{error}', r.message);
                }
            });

            showNotification(message, 'success');
            addToHistory({
                type: 'success',
                message: message,
                timestamp: new Date()
            });
            
            resetSelection();
            loadWireguardFiles();
            checkCurrentConfig();

        } else {
            showNotification(result.error, 'error');
            addToHistory({ type: 'error', message: result.error, timestamp: new Date() });
        }
    } catch (error) {
        const errorMessage = `${translations.unexpectedError}: ${error.message}`;
        showNotification(errorMessage, 'error');
        addToHistory({ type: 'error', message: errorMessage, timestamp: new Date() });
    }
}

// Adding to the operation history
async function addToHistory(operation) {
    operationHistory.unshift(operation);
    
    if (operationHistory.length > 20) {
        operationHistory = operationHistory.slice(0, 20);
    }
    
    updateHistoryDisplay();
    await api.saveOperationHistory(operationHistory);
}

// Updating the history display
function updateHistoryDisplay() {
    const noOperationsMsg = operationHistoryContainer.querySelector('.no-operations');
    
    if (operationHistory.length === 0) {
        if (!noOperationsMsg) {
            operationHistoryContainer.innerHTML = `<p class="no-operations">${translations.noOperation}</p>`;
        }
        return;
    }
    
    if (noOperationsMsg) {
        noOperationsMsg.remove();
    }
    
    operationHistoryContainer.innerHTML = operationHistory.map(op => `
        <div class="operation-item ${op.type}">
            <div class="operation-time">${formatTimestamp(new Date(op.timestamp))}</div>
            <div class="operation-message">${op.message}</div>
        </div>
    `).join('');
}

// Displaying notifications
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    
    const icon = type === 'success' ? 'fas fa-check-circle' :
                type === 'error' ? 'fas fa-exclamation-circle' :
                'fas fa-info-circle';
    
    notification.innerHTML = `
        <i class="${icon}"></i>
        <span>${message}</span>
    `;
    
    notificationsContainer.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 5000);
    
    notification.addEventListener('click', () => {
        notification.remove();
    });
}

// Utility functions

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTimestamp(date) {
    const lang = document.documentElement.lang === 'fr' ? 'fr-FR' : 'en-GB';
    return new Intl.DateTimeFormat(lang, {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(date);
}
function getLocationInfo(fileName) {
    const defaultLocation = {
        flag: `<i class="fas fa-globe country-flag" title="${translations.unknown || 'Unknown'}"></i>`,
        name: translations.wireguardConfig || 'WireGuard Config',
        city: null
    };

    if (!fileName) {
        return defaultLocation;
    }

    const name = fileName.toLowerCase();

    // 1. Build a flat list of keywords with their associated location data
    const allKeywords = [];
    if (Array.isArray(locationData)) {
        for (const location of locationData) {
            if (location.keywords && location.countryCode) {
                const displayCity = location.keywords[location.keywords.length - 1];
                for (const keyword of location.keywords) {
                    allKeywords.push({
                        keyword,
                        countryCode: location.countryCode,
                        countryNameKey: location.countryNameKey,
                        displayCity
                    });
                }
            }
        }
    }

    // 2. Sort by keyword length to match more specific keywords first (e.g., "us-newyork" before "us")
    allKeywords.sort((a, b) => b.keyword.length - a.keyword.length);

    // 3. Find the first matching keyword in the file name
    for (const { keyword, countryCode, countryNameKey, displayCity } of allKeywords) {
        const regex = new RegExp(`\\b${keyword}\\b`, 'i'); // Use case-insensitive regex
        if (regex.test(name)) {
            const countryName = translations[countryNameKey] || countryNameKey;
            return {
                flag: `<img src="config/flags/${countryCode}.svg" class="country-flag" alt="${countryName}" title="${countryName}">`,
                name: countryName,
                city: displayCity.charAt(0).toUpperCase() + displayCity.slice(1)
            };
        }
    }

    // 4. Fallback for generic names if no keyword matches
    if (name.includes('server')) return { flag: `<i class="fas fa-server country-flag" title="${translations.server || 'Server'}"></i>`, name: translations.genericServer || 'Generic Server', city: null };
    if (name.includes('test')) return { flag: `<i class="fas fa-flask country-flag" title="${translations.test || 'Test'}"></i>`, name: translations.testConfig || 'Test Config', city: null };
    if (name.includes('backup')) return { flag: `<i class="fas fa-save country-flag" title="${translations.backup || 'Backup'}"></i>`, name: translations.backupConfig || 'Backup Config', city: null };

    // 5. Return default if no match at all
    return defaultLocation;
}

async function clearOperationHistory() {
    try {
        const result = await api.clearOperationHistory();
        if (result.success) {
            operationHistory = [];
            updateHistoryDisplay();
            showNotification(translations.historyCleared, 'success');
        } else {
            showNotification(translations.errorClearingHistory, 'error');
        }
    } catch (error) {
        showNotification(`Erreur: ${error.message}`, 'error');
    }
}
 
// Global error handling
window.addEventListener('error', (e) => {
    console.error('Erreur JavaScript:', e.error);
    showNotification(translations.unexpectedError, 'error');
});
 
window.addEventListener('unhandledrejection', (e) => {
    console.error('Promise rejetée:', e.reason);
    showNotification(translations.rejectedPromise.replace('{reason}', e.reason.message || e.reason), 'error');
});