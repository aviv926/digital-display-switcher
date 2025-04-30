document.addEventListener('DOMContentLoaded', () => {
    const displayFrame = document.getElementById('displayFrame');
    const endpointSelect = document.getElementById('endpoint-select');
    const switchButton = document.getElementById('switch-button');
    const statusElement = document.getElementById('status');

    let ws;
    let connectInterval;

    // --- Populate Endpoints ---
    // These endpoints are just for the manual switch dropdown.
    // Add more options here if you want them manually selectable,
    // or fetch them from the server if needed (more complex).
    // We get the INITIAL endpoint via WebSocket.
    const manualEndpointOptions = [
        { name: "Default (Display 1)", url: "http://192.168.1.230:3007/main" },
        { name: "News (Display 2)", url: "http://192.168.1.153:8007" },
        { name: "Weather (Display 3)", url: "http://192.168.1.153:8007" }
        // Add more entries here mirroring your .env if you want them selectable
        // { name: "Custom Endpoint X", url: "http://your.other.endpoint" }
    ];

    manualEndpointOptions.forEach(ep => {
        const option = document.createElement('option');
        option.value = ep.url;
        option.textContent = ep.name;
        endpointSelect.appendChild(option);
    });

    function updateStatus(message, isError = false) {
        console.log(`Status: ${message}`);
        statusElement.textContent = message;
        statusElement.style.color = isError ? '#ff6b6b' : '#aaa';
    }

    function connectWebSocket() {
        // Use window.location.host to connect to the same host serving the page
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}`;
        ws = new WebSocket(wsUrl);
        updateStatus('Connecting...');

        ws.onopen = () => {
            updateStatus('Connected');
            console.log('WebSocket connection established');
            clearInterval(connectInterval); // Stop trying to reconnect
            // Request the current endpoint state upon connection
            ws.send(JSON.stringify({ type: 'GET_CURRENT_ENDPOINT' }));
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                console.log('Message from server:', message);

                if (message.type === 'ENDPOINT_UPDATE' && message.url) {
                    updateStatus(`Switching to: ${message.url}`);
                    console.log(`Updating iframe src to: ${message.url}`);
                    if (displayFrame.src !== message.url) {
                        displayFrame.src = message.url; // Update iframe source
                        // Optionally add a slight delay before clearing status
                        setTimeout(() => updateStatus('Connected'), 1500);
                    } else {
                         console.log(`Iframe already at: ${message.url}`);
                         updateStatus('Connected');
                    }

                    // Update the dropdown selection if the URL matches an option
                    for (let i = 0; i < endpointSelect.options.length; i++) {
                        if (endpointSelect.options[i].value === message.url) {
                            endpointSelect.selectedIndex = i;
                            break;
                        }
                    }
                }
            } catch (error) {
                console.error('Failed to parse message or invalid message format:', event.data, error);
                 updateStatus('Error processing message', true);
            }
        };

        ws.onclose = (event) => {
            let reason = '';
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
            ws = null; // Ensure ws is null so retry logic works
            // Attempt to reconnect after a delay
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
            // The onclose event will likely follow, triggering the reconnect logic
             if (ws) {
                ws.close(); // Ensure closure if error occurs before open
            }
        };
    }

    // --- Event Listeners ---
    switchButton.addEventListener('click', () => {
        const selectedUrl = endpointSelect.value;
        if (selectedUrl && ws && ws.readyState === WebSocket.OPEN) {
            updateStatus(`Manual switch to: ${selectedUrl}`);
            console.log(`Sending manual switch request for: ${selectedUrl}`);
            ws.send(JSON.stringify({ type: 'MANUAL_SWITCH', url: selectedUrl }));
        } else if (!ws || ws.readyState !== WebSocket.OPEN) {
             updateStatus('Cannot switch: Not connected', true);
            console.warn('Attempted manual switch while WebSocket is not open.');
        } else {
            console.warn('No endpoint selected for manual switch.');
        }
    });

    // --- Initial Connection ---
    connectWebSocket();

});