 
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

    // Cancel any existing revert job if we are setting a new endpoint
    if (revertJob) {
        console.log("Cancelling previous revert job.");
        revertJob.cancel();
        revertJob = null;
    }

    broadcast({ type: 'ENDPOINT_UPDATE', url: currentEndpoint });
}

function scheduleRevertToDefault(delayMinutes) {
    const revertTime = moment().tz(TIMEZONE).add(delayMinutes, 'minutes').toDate();
    console.log(`Scheduling revert to default endpoint (${defaultEndpoint}) at ${revertTime} (${delayMinutes} minutes from now)`);

    // Cancel previous revert job if one exists (e.g., manual override during scheduled slot)
     if (revertJob) {
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
            } else {
                 console.warn(`Missing URL or SCHEDULE for endpoint ID ${id}`);
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
        console.log("Cancelled existing scheduled jobs.");

        scheduledEndpoints.forEach(endpoint => {
            const { url, rule, durationMinutes } = endpoint;
            const { dayOrWildcard, timeOrHourly } = rule;

            try {
                if (timeOrHourly.toLowerCase() === 'hourly') {
                    // Schedule for every hour, slightly offset to avoid conflicts at :00
                    const cronRule = `1 * * * ${dayOrWildcard}`; // 1 minute past every hour
                     console.log(`Scheduling hourly job for ${url} with rule "${cronRule}"`);
                    schedule.scheduleJob({ rule: cronRule, tz: TIMEZONE }, () => {
                         console.log(`Hourly trigger for ${url}`);
                        setCurrentEndpoint(url, true);
                        scheduleRevertToDefault(durationMinutes);
                    });
                } else {
                    const timeParts = timeOrHourly.split(':');
                    if (timeParts.length === 2) {
                        const hour = parseInt(timeParts[0], 10);
                        const minute = parseInt(timeParts[1], 10);

                        if (!isNaN(hour) && !isNaN(minute)) {
                            // Specific time schedule
                            const cronRule = `${minute} ${hour} * * ${dayOrWildcard}`;
                            console.log(`Scheduling timed job for ${url} with rule "${cronRule}"`);
                            schedule.scheduleJob({ rule: cronRule, tz: TIMEZONE }, () => {
                                console.log(`Timed trigger for ${url}`);
                                setCurrentEndpoint(url, true);
                                scheduleRevertToDefault(durationMinutes);
                            });
                        } else {
                            console.warn(`Invalid time format in rule for ${url}: ${timeOrHourly}`);
                        }
                    } else {
                        console.warn(`Invalid time format in rule for ${url}: ${timeOrHourly}`);
                    }
                }
            } catch (error) {
                console.error(`Error scheduling job for ${url} with rule ${JSON.stringify(rule)}:`, error);
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

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received message:', data);

            if (data.type === 'MANUAL_SWITCH' && data.url) {
                console.log(`Manual switch requested to: ${data.url}`);
                setCurrentEndpoint(data.url); // isTemporary = false, manual overrides don't auto-revert
                // Note: setCurrentEndpoint already cancels any active revertJob
            }
             else if (data.type === 'GET_CURRENT_ENDPOINT') {
                 // Send back the current endpoint to the requesting client
                 ws.send(JSON.stringify({ type: 'ENDPOINT_UPDATE', url: currentEndpoint }));
            }
            // Add other message types if needed

        } catch (error) {
            console.error('Failed to parse message or invalid message format:', message, error);
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
parseScheduledEndpoints();
setupSchedules();

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Default endpoint: ${defaultEndpoint}`);
    console.log(`Timezone: ${TIMEZONE}`);
    console.log("Scheduled Endpoints Rules:", scheduledEndpoints);
    console.log(`Current endpoint on startup: ${currentEndpoint}`);
});

// --- Graceful Shutdown ---
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        schedule.gracefulShutdown()
            .then(() => console.log('Scheduled jobs stopped.'))
            .catch(err => console.error('Error stopping scheduled jobs:', err))
            .finally(() => process.exit(0));
    });
});

process.on('SIGINT', () => {
     console.log('SIGINT signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
         schedule.gracefulShutdown()
            .then(() => console.log('Scheduled jobs stopped.'))
            .catch(err => console.error('Error stopping scheduled jobs:', err))
            .finally(() => process.exit(0));
    });
});