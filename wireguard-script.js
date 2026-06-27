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
    // Gluetun API proxies
    getGluetunVpnStatus: () => api.get('gluetun/vpn-status'),
    getGluetunDnsStatus: () => api.get('gluetun/dns-status'),
    getGluetunPortForwarding: () => api.get('gluetun/portforwarding'),
    getGluetunVpnType: () => api.get('gluetun/vpn-type'),
    getGluetunVpnHistory: () => api.get('gluetun/vpn-history'),
};


// Global variables
let selectedFile = null;
let wireguardFiles = [];
let operationHistory = [];
let translations = {};
let locationData = {};
let mapConfig = {};
let currentIpInfo = null; // Store current IP information
let lastKnownIp = null; // Store last known IP to detect changes
let isWaitingForIpChange = false; // Flag to indicate we're waiting for IP change

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

        // Ensure proper initial state for accessibility
        const isCurrentlyCollapsed = content.classList.contains('collapsed');
        toggleButton.setAttribute('aria-expanded', !isCurrentlyCollapsed);

        // Collapse history by default if not already set
        if (contentId === 'historyContent' && !content.classList.contains('collapsed')) {
            content.classList.add('collapsed');
            toggleIcon.classList.add('rotated');
            toggleButton.setAttribute('aria-expanded', 'false');
        }

        const toggle = () => {
            const isCollapsed = content.classList.toggle('collapsed');
            toggleIcon.classList.toggle('rotated');
            toggleButton.setAttribute('aria-expanded', !isCollapsed);
        };

        // Header click handles everything (including the button via propagation)
        header.style.cursor = 'pointer';
        header.addEventListener('click', () => {
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

// Function to get current IP from any working API
async function getCurrentIpOnly() {
    // Try geolocation API (configured via environment)
    try {
        if (mapConfig && mapConfig.geolocationApiUrl) {
            const response = await fetch(mapConfig.geolocationApiUrl, {
                signal: AbortSignal.timeout(3000)
            });
            if (response.ok) {
                const data = await response.json();
                return data.public_ip || data.ip || null;
            }
        }
    } catch (error) {
        // Silent fail
    }
    
    return null;
}

// Function to wait for IP change after VPN switch
async function waitForIpChange(expectedOldIp, maxWaitTime = 30000) {
    const startTime = Date.now();
    const checkInterval = 2000; // Check every 2 seconds
    
    while (Date.now() - startTime < maxWaitTime) {
        const currentIp = await getCurrentIpOnly();
        
        if (currentIp && currentIp !== expectedOldIp) {
            return true;
        }
        
        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
    
    return false;
}

// Function to fetch IP information with smart waiting for VPN changes
async function fetchIpInfo(waitForChange = false) {
    // If we're waiting for a change, do the smart waiting first
    if (waitForChange && lastKnownIp) {
        isWaitingForIpChange = true;
        await waitForIpChange(lastKnownIp, 30000);
        isWaitingForIpChange = false;
    }
    
    // Try the geolocation API (configured via environment)
    try {
        if (mapConfig && mapConfig.geolocationApiUrl) {
            const response = await fetch(mapConfig.geolocationApiUrl, {
                signal: AbortSignal.timeout(8000)
            });
            
            if (response.ok) {
                const data = await response.json();
                
                // Parse coordinates from location string "47.366829,8.549790"
                let lat = null, lon = null;
                if (data.location && typeof data.location === 'string') {
                    const coords = data.location.split(',');
                    if (coords.length === 2) {
                        lat = parseFloat(coords[0]);
                        lon = parseFloat(coords[1]);
                    }
                }
                
                const ipFromGeoApi = data.public_ip || data.ip;
                if (ipFromGeoApi) {
                    lastKnownIp = ipFromGeoApi; // Store for future change detection
                }
                
                // Use data from geolocation API properly
                currentIpInfo = {
                    ip: ipFromGeoApi || translations.notAvailable,
                    timezone: data.timezone || translations.notAvailable,
                    location: data.location,
                    latitude: lat || data.latitude || data.lat,
                    longitude: lon || data.longitude || data.lon || data.lng,
                    country: data.country || data.country_name || translations.notAvailable,
                    city: data.city || translations.notAvailable,
                    org: data.organization || data.org || data.isp || null,
                    postal: data.postal || data.postal_code || data.zip || null
                };
                
                return currentIpInfo;
            }
        }
    } catch (error) {
        console.error('Geolocation API error:', error);
    }
    
    // Last resort: provide default values
    currentIpInfo = {
        ip: translations.notAvailable,
        timezone: translations.notAvailable,
        location: null,
        latitude: null,
        longitude: null,
        country: translations.notAvailable,
        city: translations.notAvailable
    };
    
    return currentIpInfo;
}

// ── Populate Gluetun info panels ──────────────────────────────────────────────
// locationInfo: result of getLocationInfo(configName) — used to fill Provider/Country/City
// configName: the active .conf filename (e.g. "protonvpn-us-denver.conf")
async function loadGluetunPanels(ipInfo, locationInfo, configName) {
    const panelsEl = document.getElementById('gluetunPanels');
    const mapWrapper = document.getElementById('currentMapWrapper');
    if (!panelsEl) return;

    // Helper: set text + optional status colour class
    function setVal(id, text, statusClass) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text || '—';
        el.className = 'ginfo-value' + (statusClass ? ` ${statusClass}` : '');
    }

    function resolveStatusClass(val) {
        if (!val) return 'status-unknown';
        const v = String(val).toLowerCase();
        if (v === 'running') return 'status-running';
        if (v === 'stopped' || v === 'disabled') return 'status-stopped';
        return 'status-unknown';
    }

    // Capitalise first letter of a string
    function capitalize(str) {
        if (!str) return str;
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    // Detect IPv4 / IPv6 from an IP or hostname string
    function detectIpType(host) {
        if (!host) return null;
        if (/^[\da-fA-F:]+$/.test(host) && host.includes(':')) return 'IPv6';
        if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return 'IPv4';
        return null; // hostname — unknown until resolved
    }

    // ── IP / Geolocation ──────────────────────────────────────────────────────
    if (ipInfo) {
        setVal('giIp',         ipInfo.ip);
        setVal('giCountry',    ipInfo.country);
        setVal('giCity',       ipInfo.city);
        setVal('giOrg',        ipInfo.org);
        setVal('giPostalCode', ipInfo.postal);
        setVal('giTimezone',   ipInfo.timezone);
    }

    // ── VPN status (/v1/vpn/status — works for WireGuard AND OpenVPN) ─────────
    try {
        const vpnStatus = await api.getGluetunVpnStatus();
        console.debug('[Gluetun] vpn-status raw:', JSON.stringify(vpnStatus));
        const status = vpnStatus.status || vpnStatus.Status || null;
        setVal('gvStatus', status, resolveStatusClass(status));
    } catch (e) {
        setVal('gvStatus', 'N/A', 'status-unknown');
        console.warn('Gluetun VPN status unavailable:', e.message);
    }

    // ── Protocol + Provider + Server + IP Type — read from wg0.conf ──────────
    try {
        const vpnType = await api.getGluetunVpnType();
        if (vpnType) {
            // Protocol (capitalized)
            if (vpnType.vpn_type) setVal('gvProtocol', capitalize(vpnType.vpn_type));

            // Server: actual Endpoint host from conf
            const serverHost = vpnType.server_host || null;
            if (serverHost) {
                setVal('gvServer', serverHost);
                // IPv4 / IPv6 detection
                const ipType = detectIpType(serverHost);
                setVal('gvIpType', ipType || '—');
            } else if (configName) {
                setVal('gvServer', configName.replace(/\.conf$/, ''));
                setVal('gvIpType', '—');
            }

            // Provider (capitalized)
            let providerText = null;
            if (vpnType.provider) {
                providerText = capitalize(vpnType.provider);
            } else if (configName) {
                const nameLower = configName.toLowerCase().replace(/\.conf$/, '');
                const knownProviders = ['protonvpn', 'mullvad', 'nordvpn', 'expressvpn', 'surfshark', 'pia', 'ipvanish', 'cyberghost', 'hidemyass', 'privado'];
                const detected = knownProviders.find(p => nameLower.includes(p)) || null;
                if (detected) providerText = capitalize(detected);
            }
            if (providerText) setVal('gvProvider', providerText);

            // Show WireGuard logo badge if protocol is wireguard
            const badge = document.getElementById('gvProtocolBadge');
            if (badge && vpnType.vpn_type && vpnType.vpn_type.toLowerCase() === 'wireguard') {
                badge.style.display = 'flex';
            } else if (badge) {
                badge.style.display = 'none';
            }
        }
    } catch (e) {
        // Fallback to config name only
        if (configName) setVal('gvServer', configName.replace(/\.conf$/, ''));
        console.warn('VPN type/provider detection unavailable:', e.message);
    }

    // ── DNS status ────────────────────────────────────────────────────────────
    try {
        const dnsStatus = await api.getGluetunDnsStatus();
        console.debug('[Gluetun] dns-status raw:', JSON.stringify(dnsStatus));
        const status = dnsStatus.status || dnsStatus.Status || null;
        setVal('gdStatus', status, resolveStatusClass(status));
    } catch (e) {
        setVal('gdStatus', 'N/A', 'status-unknown');
        console.warn('Gluetun DNS status unavailable:', e.message);
    }

    // ── Port forwarding ───────────────────────────────────────────────────────
    try {
        const pf = await api.getGluetunPortForwarding();
        const port = pf.port || pf.Port || pf.forwarded_port || null;
        setVal('gpPort', port ? String(port) : '—');
    } catch (e) {
        setVal('gpPort', '—');
        console.warn('Gluetun port forwarding unavailable:', e.message);
    }

    // ── VPN Status History ────────────────────────────────────────────────────
    try {
        const histResult = await api.getGluetunVpnHistory();
        if (histResult && histResult.history) {
            renderVpnHistory(histResult.history);
        }
    } catch (e) {
        console.warn('VPN history unavailable:', e.message);
    }

    // Show panels & map
    panelsEl.style.display = 'flex';
    if (mapWrapper) mapWrapper.style.display = 'block';
}

// Render VPN status history squares
function renderVpnHistory(history) {
    const panel = document.getElementById('vpnHistoryPanel');
    const squaresEl = document.getElementById('vpnHistorySquares');
    if (!panel || !squaresEl) return;

    if (!history || history.length === 0) {
        panel.style.display = 'none';
        return;
    }

    const colorMap = {
        connected:    'sq-connected',
        paused:       'sq-paused',
        disconnected: 'sq-disconnected',
        unknown:      'sq-unknown'
    };

    squaresEl.innerHTML = history.map(entry => {
        const cls = colorMap[entry.status] || 'sq-unknown';
        const ts = entry.ts ? new Date(entry.ts).toLocaleTimeString() : '';
        return `<span class="vpn-sq ${cls}" title="${entry.status} — ${ts}"></span>`;
    }).join('');

    panel.style.display = 'block';
}

// Checking the current configuration
async function checkCurrentConfig() {
    try {
        const configInfo = await api.getCurrentConfigInfo();

        if (configInfo.success) {
            const location = getLocationInfo(configInfo.name);

            // Show loading banner
            currentConfig.innerHTML = `
                <span class="current-config-spinner"><i class="fas fa-circle-notch fa-spin"></i></span>
                <div>
                    <h4>${location.flag} ${configInfo.name} (${translations.active})</h4>
                    <p>Fetching VPN information…</p>
                </div>
            `;
            currentConfig.style.background = '';

            // Fetch IP info
            const ipInfo = await fetchIpInfo(false);

            // Update banner with IP
            const ipAddress = (ipInfo && ipInfo.ip) ? ipInfo.ip : (translations.notAvailable || 'N/A');
            currentConfig.innerHTML = `
                <i class="fas fa-check-circle"></i>
                <div>
                    <h4>${location.flag} ${configInfo.name} (${translations.active})</h4>
                    <p>Public IP: <strong>${ipAddress}</strong></p>
                </div>
            `;

            // Populate panels
            await loadGluetunPanels(ipInfo, location, configInfo.name);

            // Initialize map
            setTimeout(() => initCurrentMap(location), 200);

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
            throw new Error(configInfo.error || translations.unknownErrorChecking);
        }
    } catch (error) {
        console.error('Error in checkCurrentConfig:', error);
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
    if (!mapContainer) return;

    mapContainer.innerHTML = '';

    try {
        // Use already fetched IP data
        const data = currentIpInfo;
        if (!data) {
            mapContainer.innerHTML = `<div style="height: 100%; display: flex; align-items: center; justify-content: center;"><img src="icons/nondispo.jpg" alt="Carte non disponible" style="max-width: 100%; max-height: 100%; border-radius: 8px;"></div>`;
            return;
        }

        // Parse coordinates from location string format "47.498249,19.039780"
        let lat = null, lon = null;
        
        if (data.location && typeof data.location === 'string') {
            const coords = data.location.split(',');
            if (coords.length === 2) {
                lat = parseFloat(coords[0]);
                lon = parseFloat(coords[1]);
            }
        }
        
        // Fallback to common property names if location string format not available
        if (lat === null || lon === null) {
            lat = data.latitude ?? data.lat ?? null;
            lon = data.longitude ?? data.lon ?? data.lng ?? null;
        }

        if (lat == null || lon == null) {
            // Show fallback image when coordinates are not available
            mapContainer.innerHTML = `<div style="height: 100%; display: flex; align-items: center; justify-content: center;"><img src="icons/nondispo.jpg" alt="Carte non disponible" style="max-width: 100%; max-height: 100%; border-radius: 8px;"></div>`;
            return;
        }

        if (!window.maplibregl) {
            // Show fallback image when map library is not loaded
            mapContainer.innerHTML = `<div style="height: 100%; display: flex; align-items: center; justify-content: center;"><img src="icons/nondispo.jpg" alt="Carte non disponible" style="max-width: 100%; max-height: 100%; border-radius: 8px;"></div>`;
            return;
        }

        // Use configured map tile URL
        const mapTileUrl = mapConfig.mapTileUrl;
        if (!mapTileUrl) {
            // Show fallback image when map tile URL is not configured
            mapContainer.innerHTML = `<div style="height: 100%; display: flex; align-items: center; justify-content: center;"><img src="icons/nondispo.jpg" alt="Carte non disponible" style="max-width: 100%; max-height: 100%; border-radius: 8px;"></div>`;
            return;
        }

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
            
            // Wait for IP change before updating the current config display
            showNotification('Attente du changement d\'IP...', 'info');
            setTimeout(async () => {
                await checkCurrentConfigWithIpWait();
            }, 2000); // Wait 2 seconds for VPN to stabilize first

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

// Special version of checkCurrentConfig that waits for IP change
async function checkCurrentConfigWithIpWait() {
    try {
        const configInfo = await api.getCurrentConfigInfo();

        if (configInfo.success) {
            const location = getLocationInfo(configInfo.name);

            // Show waiting banner
            currentConfig.innerHTML = `
                <span class="current-config-spinner"><i class="fas fa-circle-notch fa-spin"></i></span>
                <div>
                    <h4>${location.flag} ${configInfo.name} (${translations.active})</h4>
                    <p>Waiting for IP change…</p>
                </div>
            `;
            currentConfig.style.background = '';

            // Fetch IP info with smart waiting for change
            const ipInfo = await fetchIpInfo(true);

            const ipAddress = (ipInfo && ipInfo.ip) ? ipInfo.ip : (translations.notAvailable || 'N/A');
            currentConfig.innerHTML = `
                <i class="fas fa-check-circle"></i>
                <div>
                    <h4>${location.flag} ${configInfo.name} (${translations.active})</h4>
                    <p>Public IP: <strong>${ipAddress}</strong></p>
                </div>
            `;

            // Populate panels
            await loadGluetunPanels(ipInfo, location, configInfo.name);

            // Initialize map
            setTimeout(() => initCurrentMap(location), 200);

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
            throw new Error(configInfo.error || translations.unknownErrorChecking);
        }
    } catch (error) {
        console.error('Error in checkCurrentConfigWithIpWait:', error);
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