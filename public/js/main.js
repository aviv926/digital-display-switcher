document.addEventListener('DOMContentLoaded', () => {
    const displayFrame = document.getElementById('displayFrame');
    const endpointSelect = document.getElementById('endpoint-select');
    const switchButton = document.getElementById('switch-button');
    const statusElement = document.getElementById('status');

    let ws;
    let connectInterval;
    let currentUrlFromServer = null; // Keep track of the latest URL from server

    // --- Remove the hardcoded array ---
    // const manualEndpointOptions = [ ... ]; // DELETE THIS ARRAY

    function updateStatus(message, isError = false) {
        console.log(`Status: ${message}`);
        statusElement.textContent = message;
        statusElement.style.color = isError ? '#ff6b6b' : '#aaa';
    }

     // --- NEW: Function to populate dropdown ---
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

    // --- NEW: Function to update dropdown selection ---
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
             // Request the current endpoint state upon connection (server sends list automatically now)
            // ws.send(JSON.stringify({ type: 'GET_CURRENT_ENDPOINT' })); // No longer strictly needed here
             // Re-enable controls on connect
            endpointSelect.disabled = false;
            // switchButton remains disabled until list is populated
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                console.log('Message from server:', message);

                // *** HANDLE ENDPOINT_LIST ***
                if (message.type === 'ENDPOINT_LIST' && message.payload) {
                    console.log('Received endpoint list:', message.payload);
                    populateEndpointDropdown(message.payload);
                }
                // *** END HANDLE ENDPOINT_LIST ***

                else if (message.type === 'ENDPOINT_UPDATE' && message.url) {
                    updateStatus(`Switching to: ${message.url}`);
                    console.log(`Updating iframe src to: ${message.url}`);

                    if (displayFrame.src !== message.url) {
                        displayFrame.src = message.url;
                        setTimeout(() => updateStatus('Connected'), 1500);
                    } else {
                         console.log(`Iframe already at: ${message.url}`);
                         updateStatus('Connected');
                    }
                     // Update the dropdown selection based on the current URL
                    updateDropdownSelection(message.url); // *** Use the new function ***
                }
            } catch (error) {
                console.error('Failed to parse message or invalid message format:', event.data, error);
                 updateStatus('Error processing message', true);
            }
        };

        ws.onclose = (event) => {
             // ... (keep existing onclose logic) ... //
             let reason = '';
             // (keep reason mapping logic)
             if (event.code === 1000) reason = "Normal closure";
             else if (event.code === 1001) reason = "Going away";
             else if (event.code === 1002) reason = "Protocol error";
             else if (event.code === 1003) reason = "Unsupported data";
             else if (event.code === 1005) reason = "No status received";
             else if (event.code === 1006) reason = "Abnormal closure";
             else if (event.code === 1007) reason = "Invalid frame payload data";
             else if (event.code === 1008) reason = "Policy violation";
             else if (event.code === 1009) reason = "Message too big";
             else if (event.code === 1010) reason = "Missing extension";
             else if (event.code === 1011) reason = "Internal server error";
             else if (event.code === 1012) reason = "Service restart";
             else if (event.code === 1013) reason = "Try again later";
             else if (event.code === 1014) reason = "Bad gateway";
             else if (event.code === 1015) reason = "TLS handshake";
             else reason = `Unknown code ${event.code}`;

            console.log(`WebSocket closed: ${reason} (Code: ${event.code}). Clean close: ${event.wasClean}`);
            updateStatus(`Disconnected: ${reason}. Retrying...`, true);
            ws = null;
            // Disable controls on disconnect
             endpointSelect.disabled = true;
             switchButton.disabled = true;
             endpointSelect.innerHTML = '<option>Disconnected</option>'; // Clear dropdown

            if (!connectInterval) {
                connectInterval = setInterval(() => {
                    if (!ws || ws.readyState === WebSocket.CLOSED) {
                         console.log('Attempting to reconnect WebSocket...');
                        connectWebSocket();
                    }
                }, 5000);
            }
        };

        ws.onerror = (error) => {
            // ... (keep existing onerror logic) ... //
             console.error('WebSocket error:', error);
             updateStatus('WebSocket connection error', true);
             if (ws) {
                ws.close();
            }
        };
    }

    // --- Event Listeners ---
    switchButton.addEventListener('click', () => {
        const selectedUrl = endpointSelect.value;
         // Check if button is enabled and selection is valid
        if (!switchButton.disabled && selectedUrl && ws && ws.readyState === WebSocket.OPEN) {
            updateStatus(`Manual switch to: ${selectedUrl}`);
            console.log(`Sending manual switch request for: ${selectedUrl}`);
            ws.send(JSON.stringify({ type: 'MANUAL_SWITCH', url: selectedUrl }));
        } else if (!ws || ws.readyState !== WebSocket.OPEN) {
             updateStatus('Cannot switch: Not connected', true);
            console.warn('Attempted manual switch while WebSocket is not open.');
        } else {
             updateStatus('Cannot switch: No valid endpoint', true);
            console.warn('Manual switch attempt without valid selection or connection.');
        }
    });

    // --- Initial Connection ---
    connectWebSocket();

});