document.addEventListener('DOMContentLoaded', () => {
    const displayFrame = document.getElementById('displayFrame');
    const endpointSelect = document.getElementById('endpoint-select');
    const switchButton = document.getElementById('switch-button');
    const statusElement = document.getElementById('status');
    // Get reference to the new checkbox
    const switchScopeAllCheckbox = document.getElementById('switch-scope-all');

    let ws;
    let connectInterval;
    let currentUrlFromServer = null; // Keep track of the latest URL from server

    function updateStatus(message, isError = false) {
        console.log(`Status: ${message}`);
        statusElement.textContent = message;
        statusElement.style.color = isError ? '#ff6b6b' : '#aaa';
    }

    function populateEndpointDropdown(endpoints) {
        endpointSelect.innerHTML = ''; // Clear existing options

        if (!endpoints || endpoints.length === 0) {
             const option = document.createElement('option');
             option.textContent = "No endpoints configured";
             option.disabled = true;
             endpointSelect.appendChild(option);
             switchButton.disabled = true; // Disable button if no options
             return;
        }

        endpoints.forEach(ep => {
            const option = document.createElement('option');
            option.value = ep.url;
            option.textContent = ep.name; // Use the name from the server
            endpointSelect.appendChild(option);
        });

         switchButton.disabled = false; // Enable button
        // After populating, try to select the current endpoint
        updateDropdownSelection(currentUrlFromServer);
    }

    function updateDropdownSelection(url) {
        if (!url) return; // Don't try to select if url is null/empty
        currentUrlFromServer = url; // Store the latest known URL
        for (let i = 0; i < endpointSelect.options.length; i++) {
            if (endpointSelect.options[i].value === url) {
                endpointSelect.selectedIndex = i;
                break;
            }
        }
    }

    // --- Function to update the iframe source locally ---
    function updateIframeLocally(url) {
        if (!url) return;
        updateStatus(`Switching locally to: ${url}`);
        console.log(`Updating iframe src locally to: ${url}`);

        if (displayFrame.src !== url) {
            displayFrame.src = url;
            // Optionally update the dropdown selection to match the local change
            updateDropdownSelection(url);
            // Set status back to connected after a short delay
            setTimeout(() => updateStatus('Connected'), 1500);
        } else {
             console.log(`Iframe already at: ${url}`);
             updateStatus('Connected');
        }
    }
    // --- End function ---


    function connectWebSocket() {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}`;
        ws = new WebSocket(wsUrl);
        updateStatus('Connecting...');
        // Disable controls initially
        endpointSelect.disabled = true;
        switchButton.disabled = true;


        ws.onopen = () => {
            updateStatus('Connected');
            console.log('WebSocket connection established');
            clearInterval(connectInterval);
             // Re-enable controls on connect
            endpointSelect.disabled = false;
            // switchButton remains disabled until list is populated
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                console.log('Message from server:', message);

                // HANDLE ENDPOINT_LIST
                if (message.type === 'ENDPOINT_LIST' && message.payload) {
                    console.log('Received endpoint list:', message.payload);
                    populateEndpointDropdown(message.payload);
                }
                // END HANDLE ENDPOINT_LIST

                // HANDLE ENDPOINT_UPDATE (from server broadcast)
                else if (message.type === 'ENDPOINT_UPDATE' && message.url) {
                    // This handles updates broadcast by the server (scheduled or manual 'all devices')
                    updateStatus(`Server switched to: ${message.url}`);
                    console.log(`Updating iframe src from server: ${message.url}`);

                    if (displayFrame.src !== message.url) {
                        displayFrame.src = message.url;
                        setTimeout(() => updateStatus('Connected'), 1500);
                    } else {
                         console.log(`Iframe already at: ${message.url}`);
                         updateStatus('Connected');
                    }
                     // Update the dropdown selection based on the current URL from server
                    updateDropdownSelection(message.url);
                }
            } catch (error) {
                console.error('Failed to parse message or invalid message format:', event.data, error);
                 updateStatus('Error processing message', true);
            }
        };

        ws.onclose = (event) => {
             let reason = '';
             // Simple reason mapping
             if (event.code === 1000) reason = "Normal closure";
             else if (event.code === 1001) reason = "Going away";
             else if (event.code === 1006) reason = "Abnormal closure"; // Common for network issues
             else reason = `Unknown code ${event.code}`;

            console.log(`WebSocket closed: ${reason} (Code: ${event.code}). Clean close: ${event.wasClean}`);
            updateStatus(`Disconnected: ${reason}. Retrying...`, true);
            ws = null;
            // Disable controls on disconnect
             endpointSelect.disabled = true;
             switchButton.disabled = true;
             endpointSelect.innerHTML = '<option>Disconnected</option>'; // Clear dropdown

            // Start reconnection attempts if not already trying
            if (!connectInterval) {
                connectInterval = setInterval(() => {
                    if (!ws || ws.readyState === WebSocket.CLOSED) {
                         console.log('Attempting to reconnect WebSocket...');
                        connectWebSocket();
                    }
                }, 5000); // Retry every 5 seconds
            }
        };

        ws.onerror = (error) => {
             console.error('WebSocket error:', error);
             updateStatus('WebSocket connection error', true);
             // Attempt to close the socket if it exists to trigger the onclose handler for reconnection
             if (ws) {
                ws.close();
            }
        };
    }

    // --- MODIFIED Event Listeners ---
    switchButton.addEventListener('click', () => {
        const selectedUrl = endpointSelect.value;
        const applyToAll = switchScopeAllCheckbox.checked; // Check the checkbox state

         // Check if button is enabled and selection is valid
        if (!switchButton.disabled && selectedUrl) {
            if (applyToAll) {
                // --- Switch for Everyone ---
                if (ws && ws.readyState === WebSocket.OPEN) {
                    updateStatus(`Requesting switch for all to: ${selectedUrl}`);
                    console.log(`Sending manual switch request for: ${selectedUrl}`);
                    ws.send(JSON.stringify({ type: 'MANUAL_SWITCH', url: selectedUrl }));
                } else {
                    updateStatus('Cannot switch all: Not connected', true);
                    console.warn('Attempted manual switch (all) while WebSocket is not open.');
                }
            } else {
                // --- Switch for Me Only ---
                console.log(`Switching endpoint locally to: ${selectedUrl}`);
                updateIframeLocally(selectedUrl); // Use the new local update function
            }
        } else if (!selectedUrl) {
             updateStatus('Cannot switch: No endpoint selected', true);
            console.warn('Manual switch attempt without valid selection.');
        } else {
             // This case should ideally not be reachable if button disable logic is correct
             updateStatus('Cannot switch: Button disabled or invalid state', true);
            console.warn('Manual switch attempt while button is disabled or state is invalid.');
        }
    });
    // --- END MODIFIED Event Listeners ---


    // --- Initial Connection ---
    connectWebSocket();

});