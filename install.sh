#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# Function to clean up temporary files
cleanup() {
    echo "Cleaning up temporary files..."
    if [ -f "$MODIFIED_INDEX_JS" ]; then
        rm -f "$MODIFIED_INDEX_JS"
    fi
    if [ -f "clip2drive" ]; then
        rm -f "clip2drive"
    fi
}

# Set a trap to clean up temporary files on script exit (success or error)
trap cleanup EXIT

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

echo "Starting clip2drive installation..."

# Function to load environment variables from a file
load_env_file() {
    local env_file=$1
    if [ -f "$env_file" ] && [ -s "$env_file" ]; then
        echo "Loading environment variables from $env_file"
        set -o allexport
        # shellcheck source=/dev/null
        source "$env_file"
        set +o allexport
    else
        echo "Environment file is either missing or empty. Exiting..."
        exit 1
    fi
}

# Check if the -e parameter is passed
ENV_FILE=""
if [ "$1" == "-e" ] && [ -n "$2" ]; then
    ENV_FILE="$2"
    load_env_file "$ENV_FILE"
else
    # If -e parameter is not passed, check if a local .env file exists and is not empty
    if [ -f ".env" ] && [ -s ".env" ]; then
        load_env_file ".env"
    fi
fi

# Set repository URL and directory name
REPO_URL="https://github.com/JoobyPM/clip2drive.git"
REPO_DIR="clip2drive"

# Check if running from the cloned project directory
if [ -d ".git" ] && [ -f "install.sh" ]; then
    echo "Detected that the script is being run from the clip2drive project directory."

    read -p "Would you like to update the project? (y/n): " update_choice
    if [[ "$update_choice" =~ ^[Yy]$ ]]; then
        echo "Updating the clip2drive repository..."
        git pull origin main || git pull origin master
    else
        echo "Skipping project update..."
    fi
else
    # If not in the project directory, clone or update the repository
    if [ ! -d "$REPO_DIR/.git" ]; then
        echo "Cloning the clip2drive repository..."
        git clone "$REPO_URL"
    else
        echo "Updating the clip2drive repository..."
        cd "$REPO_DIR"
        git pull origin main || git pull origin master
        cd ..
    fi

    cd "$REPO_DIR"
fi

# 1. Install Bun.js if not installed
if command_exists bun; then
    echo "Bun.js is already installed."
else
    echo "Installing Bun.js..."
    curl -fsSL https://bun.sh/install | bash
    # Add Bun to PATH for the current session
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
fi

# 2. Get CLIENT_ID, CLIENT_SECRET, and FOLDER_ID from environment variables or prompt user
if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ] || [ -z "$FOLDER_ID" ]; then
    echo ""
    echo "Please enter your Google API credentials and Google Drive folder ID."
    echo "These will be used to configure clip2drive."
    echo ""
    read -p "Enter your CLIENT_ID: " CLIENT_ID
    read -p "Enter your CLIENT_SECRET: " CLIENT_SECRET
    read -p "Enter your Google Drive FOLDER_ID: " FOLDER_ID
fi

# 3. Inject credentials into index.js and obfuscate them
echo "Injecting credentials into index.js..."

# Encode credentials using base64 for simple obfuscation
ENCODED_CLIENT_ID=$(echo -n "$CLIENT_ID" | base64)
ENCODED_CLIENT_SECRET=$(echo -n "$CLIENT_SECRET" | base64)
ENCODED_FOLDER_ID=$(echo -n "$FOLDER_ID" | base64)

# Create a temporary modified index.js
MODIFIED_INDEX_JS="index_modified.js"

# Replace placeholders in index.js with base64-encoded credentials
sed \
    -e "s|__ENCODED_CLIENT_ID__|$ENCODED_CLIENT_ID|g" \
    -e "s|__ENCODED_CLIENT_SECRET__|$ENCODED_CLIENT_SECRET|g" \
    -e "s|__ENCODED_FOLDER_ID__|$ENCODED_FOLDER_ID|g" \
    index.js > "$MODIFIED_INDEX_JS"

# 4. Install dependencies
echo "Installing dependencies..."
bun install

# 5. Build the bundled script targeting Node.js
echo "Building the clip2drive script..."
bun build "$MODIFIED_INDEX_JS" --outfile clip2drive --minify --target node

# 6. Set up the clip2drive script
echo "Setting up the clip2drive script..."

# Negative space programming assertion: Ensure clip2drive exists
if [ ! -f "clip2drive" ]; then
    echo "Error: Bundled clip2drive file not found."
    exit 1
fi

chmod +x clip2drive

# Check if /usr/local/bin/clip2drive exists
if [ -f "/usr/local/bin/clip2drive" ]; then
    echo "Previous version of clip2drive found. Updating to the new version..."
    sudo rm -f /usr/local/bin/clip2drive
fi

sudo cp clip2drive /usr/local/bin/clip2drive

# Clean up temporary files (handled by trap)
# 7. Instruct the user to create the Automator Quick Action manually
echo ""
echo "Please create the Automator Quick Action manually using the following steps:"
echo "1. Open Automator (Applications > Automator)."
echo "2. Choose 'Quick Action' and click 'Choose'."
echo "3. Set 'Workflow receives' to 'no input' in 'any application'."
echo "4. From the Actions library, add 'Run Shell Script' to the workflow."
echo "5. Set 'Shell' to '/bin/bash' and 'Pass input' to 'as arguments'."
echo "6. Enter the following script:"
echo ""
echo "   /usr/local/bin/clip2drive &"
echo ""
echo "7. Save the Quick Action as 'clip2drive'."
echo ""
echo "After creating the Quick Action, assign a hotkey via System Preferences > Keyboard > Shortcuts."

echo ""
echo "clip2drive installation and setup completed successfully!"

# Run the clip2drive to authenticate the user
echo "Running clip2drive to authenticate the user from his Google Account in browser..."
/usr/local/bin/clip2drive --auth-only