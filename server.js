require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const schedule = require('node-schedule');
const moment = require('moment-timezone');

// --- Configuration ---
const PORT = process.env.SERVER_PORT || 3000;
const TIMEZONE = process.env.TZ || 'UTC'; // Default to UTC if not set
let defaultEndpoint = process.env.DEFAULT_ENDPOINT_URL || '';
let currentEndpoint = defaultEndpoint;
const scheduledEndpoints = [];

// --- State ---
let revertJob = null; // Holds the scheduled job to revert to default

// --- Initialize Express ---
const app = express();
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files

// --- Initialize HTTP Server ---
const server = http.createServer(app);

// --- Initialize WebSocket Server ---
const wss = new WebSocket.Server({ server });

console.log(`WebSocket Server created.`);

// --- Helper Functions ---
function broadcast(data) {
    console.log(`Broadcasting: ${JSON.stringify(data)}`);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

function setCurrentEndpoint(url, isTemporary = false) {
    console.log(`Setting current endpoint to: ${url}`);
    currentEndpoint = url;

    // Cancel any existing revert job if we are setting a new endpoint (manual or scheduled)
    if (revertJob) {
        console.log("Cancelling previous revert job.");
        revertJob.cancel();
        revertJob = null;
    }

    broadcast({ type: 'ENDPOINT_UPDATE', url: currentEndpoint });
}

function getEndpointsForFrontend() {
    const endpoints = [];

    // Add the default endpoint first if it exists
    if (defaultEndpoint) {
        endpoints.push({ name: 'Default', url: defaultEndpoint });
    }

    // Add scheduled/configured endpoints, ensuring uniqueness by URL
    const uniqueUrls = new Set(endpoints.map(ep => ep.url));
    const envKeys = Object.keys(process.env);
    const endpointUrlKeys = envKeys.filter(key => /^ENDPOINT_\d+_URL$/.test(key));

    endpointUrlKeys.forEach(urlKey => {
        const url = process.env[urlKey];
        if (url && !uniqueUrls.has(url)) {
            const match = urlKey.match(/^ENDPOINT_(\d+)_URL$/);
            const id = match ? match[1] : 'Unknown';
            // Allow defining a name via ENDPOINT_{N}_NAME, otherwise use a default name
            const nameKey = `ENDPOINT_${id}_NAME`;
            const name = process.env[nameKey] || `Endpoint ${id}`;
            endpoints.push({ name: name, url: url });
            uniqueUrls.add(url);
        }
    });

    console.log("Endpoints prepared for frontend:", endpoints);
    return endpoints;
}


function scheduleRevertToDefault(delayMinutes) {
    const revertTime = moment().tz(TIMEZONE).add(delayMinutes, 'minutes').toDate();
    console.log(`Scheduling revert to default endpoint (${defaultEndpoint}) at ${revertTime} (${delayMinutes} minutes from now)`);

    // Cancel previous revert job if one exists (e.g., manual override during scheduled slot)
     if (revertJob) {
        console.log("Cancelling existing revert job before scheduling new one.");
        revertJob.cancel();
    }

    revertJob = schedule.scheduleJob(revertTime, () => {
        console.log(`Reverting to default endpoint: ${defaultEndpoint}`);
        setCurrentEndpoint(defaultEndpoint); // isTemporary is false by default
        revertJob = null; // Clear the job reference
    });
}

// --- Parse Endpoints from .env ---
function parseScheduledEndpoints() {
    console.log("Parsing endpoints from environment variables...");
    scheduledEndpoints.length = 0; // Clear existing parsed endpoints
    const envKeys = Object.keys(process.env);
    const endpointUrlKeys = envKeys.filter(key => /^ENDPOINT_\d+_URL$/.test(key));

    endpointUrlKeys.forEach(urlKey => {
        const match = urlKey.match(/^ENDPOINT_(\d+)_URL$/);
        if (match) {
            const id = match[1];
            const scheduleKey = `ENDPOINT_${id}_SCHEDULE`;
            const url = process.env[urlKey];
            const scheduleString = process.env[scheduleKey];

            if (url && scheduleString) {
                console.log(`Found Endpoint ${id}: URL=${url}, Schedule=${scheduleString}`);
                const scheduleEntries = scheduleString.split(',');
                scheduleEntries.forEach(entry => {
                    const parts = entry.trim().split('|');
                    if (parts.length === 3) {
                        const [dayOrWildcard, timeOrHourly, durationStr] = parts;
                        const durationMinutes = parseInt(durationStr, 10);

                        if (!isNaN(durationMinutes) && durationMinutes > 0) {
                            scheduledEndpoints.push({
                                id,
                                url,
                                rule: { dayOrWildcard, timeOrHourly },
                                durationMinutes
                            });
                        } else {
                             console.warn(`Invalid duration for endpoint ${id}, entry ${entry}: ${durationStr}`);
                        }
                    } else {
                        console.warn(`Invalid schedule format for endpoint ${id}: ${entry}`);
                    }
                });
            } else if (url && !scheduleString) {
                 // Endpoint URL defined but no schedule - useful for manual switching list
                 console.log(`Found Endpoint ${id}: URL=${url} (no schedule, available for manual switch)`);
            } else {
                 console.warn(`Missing URL for endpoint ID ${id} defined by key ${urlKey}`);
            }
        }
    });
    console.log(`Parsed ${scheduledEndpoints.length} schedule rules.`);
}

// --- Setup Schedules ---
function setupSchedules() {
    console.log(`Setting up schedules in timezone: ${TIMEZONE}`);
    // Cancel all existing jobs before setting up new ones (e.g., on restart)
    schedule.gracefulShutdown().then(() => {
        console.log("Cancelled existing scheduled jobs (if any).");

        scheduledEndpoints.forEach(endpoint => {
            const { url, rule, durationMinutes, id } = endpoint;
            // Skip if rule is missing (can happen if only URL/Name are defined for manual list)
            if (!rule) return;

            const { dayOrWildcard, timeOrHourly } = rule;

            try {
                let cronRule;
                if (timeOrHourly.toLowerCase() === 'hourly') {
                    // Schedule for every hour, slightly offset to avoid conflicts at :00
                    cronRule = `1 * * * ${dayOrWildcard}`; // 1 minute past every hour
                     console.log(`Scheduling hourly job for Endpoint ${id} (${url}) with rule "${cronRule}"`);
                } else {
                    const timeParts = timeOrHourly.split(':');
                    if (timeParts.length === 2) {
                        const hour = parseInt(timeParts[0], 10);
                        const minute = parseInt(timeParts[1], 10);

                        if (!isNaN(hour) && !isNaN(minute)) {
                            // Specific time schedule
                            cronRule = `${minute} ${hour} * * ${dayOrWildcard}`;
                            console.log(`Scheduling timed job for Endpoint ${id} (${url}) with rule "${cronRule}"`);
                        } else {
                            console.warn(`Invalid time format in rule for ${url}: ${timeOrHourly}`);
                            return; // Skip scheduling this rule
                        }
                    } else {
                        console.warn(`Invalid time format in rule for ${url}: ${timeOrHourly}`);
                        return; // Skip scheduling this rule
                    }
                }

                // Schedule the actual job
                schedule.scheduleJob({ rule: cronRule, tz: TIMEZONE }, () => {
                     console.log(`Triggered schedule for Endpoint ${id} (${url})`);
                    setCurrentEndpoint(url, true); // Mark as temporary for potential revert
                    scheduleRevertToDefault(durationMinutes);
                });

            } catch (error) {
                console.error(`Error scheduling job for Endpoint ${id} (${url}) with rule ${JSON.stringify(rule)}:`, error);
            }
        });
         console.log("Schedules setup complete.");
    });
}


// --- WebSocket Connection Handling ---
wss.on('connection', (ws) => {
    console.log('Client connected');

    // Send the current endpoint immediately upon connection
    ws.send(JSON.stringify({ type: 'ENDPOINT_UPDATE', url: currentEndpoint }));

    // Send the list of available endpoints for the dropdown
    const endpointList = getEndpointsForFrontend();
    ws.send(JSON.stringify({ type: 'ENDPOINT_LIST', payload: endpointList }));

    ws.on('message', (message) => {
         try {
            const data = JSON.parse(message);
            console.log('Received message:', data);

            if (data.type === 'MANUAL_SWITCH' && data.url) {
                // This handles the "Apply to all devices" case from the client
                console.log(`Manual switch requested (broadcast) to: ${data.url}`);
                setCurrentEndpoint(data.url); // isTemporary = false, manual overrides don't auto-revert by default
                // Note: setCurrentEndpoint already cancels any active revertJob
            }
             else if (data.type === 'GET_CURRENT_ENDPOINT') { // Still useful if client needs to re-sync
                 // Send back the current endpoint to the requesting client
                 console.log(`Client requested current endpoint. Sending: ${currentEndpoint}`);
                 ws.send(JSON.stringify({ type: 'ENDPOINT_UPDATE', url: currentEndpoint }));
            }
            // Add other message types if needed

        } catch (error) {
            console.error('Failed to parse message or invalid message format:', message.toString(), error); // Log raw message
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// --- Initial Setup and Start Server ---
parseScheduledEndpoints(); // Parse .env variables
setupSchedules();         // Set up node-schedule jobs

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Default endpoint: ${defaultEndpoint || 'Not set'}`);
    console.log(`Timezone: ${TIMEZONE}`);
    // Log the rules that were successfully parsed and scheduled
    console.log("Active Scheduled Endpoints Rules:", scheduledEndpoints.filter(ep => ep.rule));
    console.log(`Current endpoint on startup: ${currentEndpoint}`);
});

// --- Graceful Shutdown ---
function gracefulShutdown(signal) {
    console.log(`${signal} signal received: closing HTTP server`);
    server.close(() => {
        console.log('HTTP server closed');
        schedule.gracefulShutdown()
            .then(() => console.log('Scheduled jobs stopped.'))
            .catch(err => console.error('Error stopping scheduled jobs:', err))
            .finally(() => process.exit(0));
    });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT')); // Handle Ctrl+C