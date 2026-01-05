#!/bin/sh

# Define paths
CONFIG_DIR="/usr/src/app/config"
HISTORY_DIR="$CONFIG_DIR/history"
SECURITY_DIR="$CONFIG_DIR/security"
DEFAULTS_DIR="/app-defaults"

# Ensure the main configuration directory exists
mkdir -p "$CONFIG_DIR"
mkdir -p "$SECURITY_DIR"

# Check if the main configuration file exists
if [ ! -f "$CONFIG_DIR/locations.json" ]; then
  echo "locations.json file does not exist in the mounted volume."
  echo "Copying default configuration..."
  
  # Copy the configuration file and the flags directory
  cp "$DEFAULTS_DIR/locations.json" "$CONFIG_DIR/locations.json"
  cp -r "$DEFAULTS_DIR/flags" "$CONFIG_DIR/"
  
  echo "Default configuration copied."
else
  echo "Existing configuration found."
fi

# Ensure the subdirectory for history exists
mkdir -p "$HISTORY_DIR"
echo "History directory is ready."

# Initialize security users file if missing
if [ ! -f "$SECURITY_DIR/users.json" ]; then
  echo "users.json not found, initializing security configuration"
  if [ -f "$DEFAULTS_DIR/security/users.json" ]; then
    cp "$DEFAULTS_DIR/security/users.json" "$SECURITY_DIR/users.json"
    echo "Default users.json copied"
  else
    echo "{ \"users\": [] }" > "$SECURITY_DIR/users.json"
    echo "Empty users.json created"
  fi
fi

echo "Starting the application..."
# Execute the main application command (start the Node.js server)
exec "$@"