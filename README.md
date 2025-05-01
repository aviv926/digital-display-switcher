# Digital Display Switcher

Switch between different web endpoints (URLs) on connected digital displays based on a predefined schedule or manual override. Ideal for managing content on information screens, dashboards, or digital signage.

## Features

*   **Scheduled Endpoint Switching:** Configure specific URLs to be displayed at certain times or intervals.
*   **Manual Override:** Manually switch all connected displays to a specific configured endpoint via a simple web interface.
*   **Automatic Revert:** Scheduled endpoints are displayed for a configured duration before automatically reverting to a default endpoint.
*   **Real-time Updates:** Uses WebSockets to instantly push the current target URL to all connected displays.
*   **Flexible Scheduling:** Supports daily schedules at specific times, specific days of the week, or hourly intervals.
*   **Dockerized:** Easy setup and deployment using Docker and Docker Compose.

## Prerequisites

*   [Docker](https://docs.docker.com/get-docker/)
*   [Docker Compose](https://docs.docker.com/compose/install/) (usually included with Docker Desktop)

## Configuration

Configuration is managed through a `.env` file in the root directory. Create this file if it doesn't exist, potentially by copying `.env.example` if one is provided, or create it from scratch.

**Key Configuration Variables:**

*   `SERVER_PORT`: The port number the application server will listen on *inside* the container (e.g., `8009`). The `docker-compose.yml` file maps a host port (e.g., 3000) to this container port.
*   `TZ`: The timezone for scheduling (e.g., `America/New_York`, `UTC`). Use a valid TZ database name.
*   `DEFAULT_ENDPOINT_URL`: The URL to display when no schedule is active or after a temporary schedule expires.
*   `ENDPOINT_{N}_URL`: The URL for a specific endpoint, where `{N}` is a number (e.g., `ENDPOINT_1_URL`, `ENDPOINT_2_URL`).
*   `ENDPOINT_{N}_NAME` (Optional): A friendly name for the endpoint `{N}` to be displayed in the control panel (e.g., `ENDPOINT_1_NAME=Main Dashboard`). Defaults to `Endpoint {N}` if not set.
*   `ENDPOINT_{N}_SCHEDULE` (Optional): The schedule for endpoint `{N}`. If omitted, the endpoint is only available for manual switching.
    *   **Format:** Comma-separated list of schedule entries.
    *   **Schedule Entry Format:**
        *   `DayOfWeek|HH:MM|DurationMinutes` (e.g., `1|08:00|30` for Monday at 8:00 AM for 30 minutes). `DayOfWeek`: 0=Sun, 1=Mon, ..., 6=Sat.
        *   `*|HH:MM|DurationMinutes` (e.g., `*|14:00|15` for every day at 2:00 PM for 15 minutes).
        *   `*|hourly|DurationMinutes` (e.g., `*|hourly|5` for every hour, displaying for 5 minutes starting shortly after the hour).

**Example `.env`:**

```dotenv
# Server Configuration
SERVER_PORT=8009
TZ=Asia/Jerusalem

# Default Endpoint URL
DEFAULT_ENDPOINT_URL=http://192.168.1.100/default-dashboard

# Scheduled Endpoints Configuration

# Endpoint 1: Weekday Evenings News Feed
ENDPOINT_1_URL=http://192.168.1.150:8007/news
ENDPOINT_1_NAME=Evening News
ENDPOINT_1_SCHEDULE=1-5|19:00|60 # Mon-Fri at 7:00 PM for 60 mins

# Endpoint 2: Hourly Weather Update
ENDPOINT_2_URL=http://192.168.1.150:8008/weather
ENDPOINT_2_NAME=Weather Update
ENDPOINT_2_SCHEDULE=*|hourly|5 # Every hour for 5 mins

# Endpoint 3: Manual Only - Special Event Screen
ENDPOINT_3_URL=http://192.168.1.200/special-event
ENDPOINT_3_NAME=Special Event Display
# No schedule - only available for manual switch
```

## Setup & Running
### Use docker image

1.  **Pull the Latest Image (Recommended):**
    The Docker image is automatically built and published to GitHub Packages. Pull the latest version:
    ```bash
    docker compose pull
    ```

2.  **Start the Service:**
    This command starts the container in the background (`-d`). It will use the pulled image and read your configuration from the `.env` file.
    ```bash
    docker compose up -d
    ```

### (Alternative) Build Locally:

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/aviv926/digital-display-switcher.git
    cd digital-display-switcher
    ```
2.  **Create and configure `.env`:**
    Create the `.env` file in the project root and add your configuration as described above.
3.  **Build and run using Docker Compose:**
    ```bash
    docker-compose up -d --build
    ```
    This will build the Docker image and start the application container in detached mode. The server will be accessible on the host port mapped in `docker-compose.yml` (default is port 3000).

## Usage

### Connecting Displays (Clients)

Your digital displays (or any web browser client) need to connect to the WebSocket server provided by this application.

*   **WebSocket URL:** `ws://<server-ip>:<host-port>` (e.g., `ws://192.168.1.50:3000` if the server is running on `192.168.1.50` and using the default host port 3000).
*   **Client Logic:** The client should:
    1.  Establish a WebSocket connection to the server.
    2.  Listen for messages from the server.
    3.  When a message of type `ENDPOINT_UPDATE` is received, parse the JSON message (`{ "type": "ENDPOINT_UPDATE", "url": "http://..." }`) and navigate the display's browser/webview to the `url` provided.
    4.  Implement reconnection logic if the WebSocket connection drops.

### Control Panel

Access the simple web-based control panel by navigating your browser to the application's HTTP URL:

*   **Control Panel URL:** `http://<server-ip>:<host-port>` (e.g., `http://192.168.1.50:3000`)

The control panel will:

*   Show the currently active URL being broadcast to displays.
*   Provide a dropdown list of all configured endpoints (default, scheduled, and manual-only).
*   Allow you to select an endpoint from the dropdown and click "Apply to all devices" to manually override the current schedule and switch all connected displays to the selected URL. Manual switches do not automatically revert unless overridden by a later schedule.

## Stopping the Application

```bash
docker-compose down
```
