# Gluetun switcher

Gluetun switcher is a lightweight web interface designed to simplify the management of WireGuard switch configurations on Gluetun, especially in a Docker environment. It allows you to quickly switch configurations and automatically restart dependent containers (like Gluetun, qBittorrent, etc.) to apply the new network settings.

![Screenshot](https://raw.githubusercontent.com/fuzzzor/gluetun-switcher/main/screenshot.png)

## Features

- **Secure authentication (v2)**
- **Argon2id password hashing**
- **Mandatory password change on first login**
- **Environment-driven password policy**
- **Temporary account lock after failed attempts**
- **Optional HTTPS support**

- **Simple Web Interface:** A clean interface to view and manage your configuration files.
- **One-Click Activation:** Select a `.conf` file and activate it. The application automatically copies it as `wg0.conf`.
- **Automatic Restart:** Restarts one or more specified Docker containers after activating a new configuration.
- **Status View:** Displays the currently active configuration (`wg0.conf`).
- **Operation History:** Keeps a log of the latest actions performed.
- **Notifications:** Provides real-time feedback on the success or failure of operations.

---

## Prerequisites

### WireGuard Configuration Files

This application does not generate WireGuard configurations. You must provide your own `.conf` files.

- **Source:** These files are typically provided by your WireGuard-compatible VPN service (e.g., Mullvad, ProtonVPN, etc.).
- **Placement:** You must place these `.conf` files in a folder on your host machine. This folder will then be mounted as a volume into the WireGuard Manager container. This is how the application reads and manages them.

For instance, if you use the `gluetun` container, you likely already have a folder containing your configurations. You will mount this same folder into WireGuard Manager.

---

## Deployment

You can deploy Gluetun-switcher using Docker Compose (recommended) or a simple `docker run` command.

### 1. Docker Compose (Recommended)

Here is an example `docker-compose.yml` file:

```yaml
services:
  app:
    image: ghcr.io/fuzzzor/gluetun-switcher:latest
    container_name: Gluetun-switcher
    restart: unless-stopped
    ports:
      - "3003:3003"
    environment:
      - SESSION_SECRET=CHANGE_ME_RANDOM_64_CHARS
      - WIREGUARD_DIR=/etc/wireguard
      - NODE_ENV=production
      - CONTAINER_TO_RESTART=gluetun,qBittorrent
      - TZ=Europe/Paris
    volumes:
      # For application configuration & history persistence
      - /{your_host_volume}/gluetun-switcher/config:/usr/src/app/config
      
      # --- IMPORTANT VOLUME ---
      # Mount the folder containing your .conf files here
      - /{your_gluetun_volume}/wireguard:/etc/wireguard
      
      # --- MANDATORY VOLUME ---
      # Required to allow restarting other containers
      - /var/run/docker.sock:/var/run/docker.sock
```
Select your own volume !

**To launch:**
```bash
docker-compose up -d
```

### 2. `docker run` Command Line

You can also launch the container with the following command:

```bash
docker run -d \
  --name=gluetun-switcher \
  --restart=unless-stopped \
  -p 3003:3003 \
  -e WIREGUARD_DIR=/etc/wireguard \
  -e NODE_ENV=production \
  -e CONTAINER_TO_RESTART="gluetun,qBittorrent" \
  -e TZ=Europe/Paris \
  -v /{your_host_volume}/gluetun-switcher/config:/usr/src/app/config \
  -v /{your_gluetun_volume}/wireguard:/etc/wireguard \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ghcr.io/fuzzzor/gluetun-switcher:latest
```
Select your own volume !
---

## Configuration

### Security & Authentication (v2)

The following environment variables are required to enable the new authentication, password policy, and HTTPS features.

#### Session & Authentication

| Variable | Required | Description |
|---------|----------|-------------|
| `SESSION_SECRET` | **Yes** | Secret used to sign session cookies. Must be long, random and unique per deployment. |
| `SESSION_NAME` | No | Session cookie name (default: `gluetun-switcher.sid`). |

#### Admin Bootstrap

| Variable | Required | Description |
|---------|----------|-------------|
| `ADMIN_USERNAME` | No | Initial administrator username (default: `admin`). |
| `ADMIN_DEFAULT_PASSWORD` | No | Initial admin password, **forced to be changed on first login** (default: `switcher`). |

#### Password Policy

| Variable | Required | Description |
|---------|----------|-------------|
| `PASSWORD_MIN_LENGTH` | No | Minimum password length (default: 12). |
| `PASSWORD_REQUIRE_UPPERCASE` | No | Require at least one uppercase letter. |
| `PASSWORD_REQUIRE_LOWERCASE` | No | Require at least one lowercase letter. |
| `PASSWORD_REQUIRE_DIGIT` | No | Require at least one numeric digit. |
| `PASSWORD_REQUIRE_SPECIAL` | No | Require at least one special character. |
| `PASSWORD_MAX_ATTEMPTS` | No | Number of failed attempts before account lock. |
| `PASSWORD_LOCK_TIME` | No | Account lock duration in seconds (default: 900). |

#### HTTPS (Optional)

| Variable | Required | Description |
|---------|----------|-------------|
| `HTTPS_ENABLED` | No | Enable HTTPS server (`true` or `false`). |
| `HTTPS_KEY_PATH` | If HTTPS | Path to TLS private key inside container. |
| `HTTPS_CERT_PATH` | If HTTPS | Path to TLS certificate inside container. |

> When HTTPS is enabled, you must mount a volume containing your certificates (e.g. `/certs`).


**On first access, the admin user is forced to change the default password.**

### Environment Variables

- `WIREGUARD_DIR`: (Required) The path *inside the container* where your `.conf` files are located. This path must match the destination of the volume you mount.
- `CONTAINER_TO_RESTART`: (Required) The name(s) of the Docker container(s) to restart after a configuration change. Separate names with a comma (e.g., `gluetun,qbittorrent`).
- `TZ`: (Optional) The timezone to use for timestamps in the history (e.g., `Europe/Paris`).

### Volumes

- `/{your_host_volume}/gluetun-switcher/config:/usr/src/app/config`: (Recommended) This volume ensures the persistence of the operation history & configuration.
- `/{your_gluetun_volume}/wireguard:/etc/wireguard`: (Required) This is the core of the application.
    - The left path (`./gluetun/wireguard`) is the folder on your **host** machine where you have stored your `.conf` files.
    - The right path (`/etc/wireguard`) is the folder **inside the container** where the application will look for the files. It must match the `WIREGUARD_DIR` variable.
- `/var/run/docker.sock:/var/run/docker.sock`: (Required) This volume is crucial for the restart functionality.
    - **Why is this necessary?** The `docker.sock` file is a Unix socket that allows communication with the host's Docker daemon. By mounting this volume, you grant the WireGuard Manager container permission to send commands (like "restart") to the Docker daemon, thus allowing it to restart other containers on the same host. Without it, the automatic restart feature will not work.

---
<br>
