#!/bin/bash
set -e

# =============================================================================
# HackerNews Insights - Raspberry Pi Installer
# =============================================================================
# Usage: curl -sSL https://raw.githubusercontent.com/ukrocks007/hackernews-insights/main/install.sh | bash
# =============================================================================

REPO_OWNER="ukrocks007"
REPO_NAME="hackernews-insights"
INSTALL_DIR="$HOME/hackernews-insights"
SERVICE_NAME="hackernews-insights"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║          HackerNews Insights - Pi Installer                ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_step() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[i]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Check architecture and determine binary name
check_architecture() {
    ARCH=$(uname -m)
    if [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
        BINARY_SUFFIX="linux-arm64"
        print_info "Detected ARM64 architecture."
    elif [[ "$ARCH" == "x86_64" || "$ARCH" == "amd64" ]]; then
        BINARY_SUFFIX="linux-x64"
        print_info "Detected x64 architecture."
    else
        print_warn "Unsupported architecture: $ARCH"
        print_warn "This script supports linux-arm64 and linux-x64."
        echo -n "Continue anyway (will try linux-x64)? (y/N): "
        read confirm < /dev/tty
        if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
            exit 1
        fi
        BINARY_SUFFIX="linux-x64"
    fi
}

# Check and install dependencies
install_dependencies() {
    print_info "Checking system dependencies..."
    
    # Check for required packages
    PACKAGES_NEEDED=""
    
    if ! command -v curl &> /dev/null; then
        PACKAGES_NEEDED="$PACKAGES_NEEDED curl"
    fi
    
    if ! command -v git &> /dev/null; then
        PACKAGES_NEEDED="$PACKAGES_NEEDED git"
    fi
    
    # Check for build essentials (needed for native modules)
    if ! command -v gcc &> /dev/null; then
        PACKAGES_NEEDED="$PACKAGES_NEEDED build-essential"
    fi
    
    if [[ -n "$PACKAGES_NEEDED" ]]; then
        print_info "Installing missing packages:$PACKAGES_NEEDED"
        sudo apt-get update -qq
        sudo apt-get install -y $PACKAGES_NEEDED
    fi
    
    print_step "System dependencies OK"
}

# Install Node.js
install_nodejs() {
    print_info "Checking Node.js..."
    
    if ! command -v node &> /dev/null; then
        print_info "Installing Node.js 20.x..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
        print_step "Node.js installed: $(node --version)"
    else
        NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
        if [[ "$NODE_VERSION" -lt 18 ]]; then
            print_warn "Node.js version is too old ($NODE_VERSION). Upgrading to 20.x..."
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
            print_step "Node.js upgraded: $(node --version)"
        else
            print_step "Node.js already installed: $(node --version)"
        fi
    fi
}

# Install Playwright browsers
install_playwright() {
    print_info "Checking Playwright browsers..."
    
    if [[ ! -d "$HOME/.cache/ms-playwright" ]]; then
        print_info "Installing Playwright browsers (this may take a few minutes)..."
        
        # Install Node.js if not present (needed for npx)
        if ! command -v node &> /dev/null; then
            print_info "Installing Node.js..."
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
        fi
        
        # Install playwright and browsers
        npx playwright install chromium
        npx playwright install-deps chromium
        
        print_step "Playwright browsers installed"
    else
        print_step "Playwright browsers already installed"
    fi
}

# Clone and build the project
clone_and_build() {
    print_info "Creating installation directory..."
    
    # Remove old installation if exists
    if [[ -d "$INSTALL_DIR" ]]; then
        print_warn "Existing installation found at $INSTALL_DIR"
        
        # Backup config and db
        if [[ -f "$INSTALL_DIR/config/interests.json" ]]; then
            print_info "Backing up existing config..."
            cp "$INSTALL_DIR/config/interests.json" /tmp/interests.json.backup
        fi
        
        if [[ -d "$INSTALL_DIR/db" ]]; then
            print_info "Backing up existing database..."
            cp -r "$INSTALL_DIR/db" /tmp/db.backup
        fi
        
        rm -rf "$INSTALL_DIR"
    fi
    
    print_info "Cloning repository..."
    git clone --depth 1 "https://github.com/$REPO_OWNER/$REPO_NAME.git" "$INSTALL_DIR"
    
    cd "$INSTALL_DIR"
    
    print_info "Installing dependencies (this may take a few minutes)..."
    npm install --production
    
    print_info "Building project..."
    npm run build

    print_info "Applying Prisma schema..."
    mkdir -p "$INSTALL_DIR/db"
    DATABASE_URL="file:$INSTALL_DIR/db/hn.sqlite" npm run prisma:deploy
    
    # Restore backups if they exist
    if [[ -f /tmp/interests.json.backup ]]; then
        print_info "Restoring config backup..."
        mkdir -p "$INSTALL_DIR/config"
        cp /tmp/interests.json.backup "$INSTALL_DIR/config/interests.json"
        rm /tmp/interests.json.backup
    fi
    
    if [[ -d /tmp/db.backup ]]; then
        print_info "Restoring database backup..."
        cp -r /tmp/db.backup "$INSTALL_DIR/db"
        rm -rf /tmp/db.backup
    fi
    
    # Create necessary directories
    mkdir -p "$INSTALL_DIR/config"
    mkdir -p "$INSTALL_DIR/db"
    
    print_step "Project built successfully"
}

# Configure interests
configure_interests() {
    echo ""
    print_info "Let's configure your interests for filtering HN stories."
    echo ""
    
    if [[ -f "$INSTALL_DIR/config/interests.json" ]]; then
        print_info "Existing interests found:"
        cat "$INSTALL_DIR/config/interests.json"
        echo ""
        echo -n "Keep existing interests? (Y/n): "
        read keep < /dev/tty
        if [[ "$keep" == "y" || "$keep" == "Y" || -z "$keep" ]]; then
            print_step "Keeping existing interests"
            return
        fi
    fi
    
    echo "Enter your interests (comma-separated)."
    echo "Examples: AI, LLMs, Open source, Rust, Startups, Productivity"
    echo ""
    echo -n "Your interests: "
    read interests_input < /dev/tty
    
    # Convert to JSON array
    IFS=',' read -ra INTERESTS <<< "$interests_input"
    JSON_ARRAY="["
    first=true
    for interest in "${INTERESTS[@]}"; do
        # Trim whitespace
        interest=$(echo "$interest" | xargs)
        if [[ -n "$interest" ]]; then
            if $first; then
                first=false
            else
                JSON_ARRAY+=","
            fi
            JSON_ARRAY+="\"$interest\""
        fi
    done
    JSON_ARRAY+="]"
    
    echo "$JSON_ARRAY" > "$INSTALL_DIR/config/interests.json"
    print_step "Interests saved to $INSTALL_DIR/config/interests.json"
}

# Configure environment variables
configure_env() {
    echo ""
    print_info "Configuring environment variables..."
    
    if [[ -f "$INSTALL_DIR/.env" ]]; then
        print_info "Existing .env found."
        echo -n "Reconfigure? (y/N): "
        read reconf < /dev/tty
        if [[ "$reconf" != "y" && "$reconf" != "Y" ]]; then
            print_step "Keeping existing .env"
            return
        fi
    fi
    echo -n "Ollama URL [http://localhost:11434]: "
    read ollama_url < /dev/tty
    ollama_url=${ollama_url:-http://localhost:11434}
    
    echo -n "Ollama Model [qwen2.5:0.5b]: "
    read ollama_model < /dev/tty
    ollama_model=${ollama_model:-qwen2.5:0.5b}
    
    echo ""
    echo "=== Pushover Notifications (optional) ==="
    echo "Get your keys from https://pushover.net"
    echo -n "Pushover User Key (leave empty to skip): "
    read pushover_user < /dev/tty
    echo -n "Pushover API Token (leave empty to skip): "
    read pushover_token < /dev/tty
    
    cat > "$INSTALL_DIR/.env" << EOF
# Ollama Configuration
OLLAMA_BASE_URL=$ollama_url
OLLAMA_MODEL=$ollama_model

# Pushover Configuration
PUSHOVER_USER_KEY=$pushover_user
PUSHOVER_API_TOKEN=$pushover_token

# Scraper Configuration
HEADLESS=true
EOF

    print_step "Environment saved to $INSTALL_DIR/.env"
}

# Setup cron job
setup_cron() {
    echo ""
    print_info "Setting up scheduled runs..."
    
    echo "How often should the agent run?"
    echo "1) Every hour"
    echo "2) Every 6 hours"
    echo "3) Once daily (9 AM)"
    echo "4) Twice daily (9 AM and 6 PM)"
    echo "5) Skip cron setup"
    echo ""
    echo -n "Choose [1-5]: "
    read cron_choice < /dev/tty
    
    case $cron_choice in
        1) CRON_SCHEDULE="0 * * * *" ;;
        2) CRON_SCHEDULE="0 */6 * * *" ;;
        3) CRON_SCHEDULE="0 9 * * *" ;;
        4) CRON_SCHEDULE="0 9,18 * * *" ;;
        5) 
            print_info "Skipping cron setup. Run manually with: cd $INSTALL_DIR && npm start"
            return
            ;;
        *) CRON_SCHEDULE="0 9 * * *" ;;
    esac
    
    # Remove existing cron job if any
    crontab -l 2>/dev/null | grep -v "$INSTALL_DIR" | crontab - 2>/dev/null || true
    
    # Add new cron job
    (crontab -l 2>/dev/null; echo "$CRON_SCHEDULE cd $INSTALL_DIR && npm start >> $INSTALL_DIR/cron.log 2>&1") | crontab -
    
    print_step "Cron job configured: $CRON_SCHEDULE"
    print_info "Logs will be written to $INSTALL_DIR/cron.log"
}

# Test the installation
test_installation() {
    echo ""
    print_info "Testing installation..."
    
    cd "$INSTALL_DIR"
    
    # Quick test - just check if the app starts
    if timeout 10s npm start 2>&1 | head -10 | grep -q "Starting"; then
        print_step "Application starts correctly!"
    else
        print_warn "Could not verify execution. Please test manually with: cd $INSTALL_DIR && npm start"
    fi
}

# Print final instructions
print_summary() {
    echo ""
    echo -e "${GREEN}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║              Installation Complete! 🎉                     ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo ""
    echo "Installation directory: $INSTALL_DIR"
    echo ""
    echo "Files created:"
    echo "  - $INSTALL_DIR/dist/ (built application)"
    echo "  - $INSTALL_DIR/config/interests.json"
    echo "  - $INSTALL_DIR/.env"
    echo "  - $INSTALL_DIR/db/ (database folder)"
    echo ""
    echo "Commands:"
    echo "  Run manually:     cd $INSTALL_DIR && npm start"
    echo "  View logs:        tail -f $INSTALL_DIR/cron.log"
    echo "  Edit interests:   nano $INSTALL_DIR/config/interests.json"
    echo "  Edit settings:    nano $INSTALL_DIR/.env"
    echo "  View cron jobs:   crontab -l"
    echo "  Update:           cd $INSTALL_DIR && git pull && npm install && npm run build"
    echo ""
    echo "Make sure Ollama is running before executing the agent!"
    echo ""
}

# Uninstall function
uninstall() {
    echo ""
    print_warn "Uninstalling HackerNews Insights..."
    
    # Remove cron job
    crontab -l 2>/dev/null | grep -v "$INSTALL_DIR" | crontab - 2>/dev/null || true
    
    # Remove installation directory
    if [[ -d "$INSTALL_DIR" ]]; then
        echo -n "Remove $INSTALL_DIR and all data? (y/N): "
        read confirm < /dev/tty
        if [[ "$confirm" == "y" || "$confirm" == "Y" ]]; then
            rm -rf "$INSTALL_DIR"
            print_step "Removed $INSTALL_DIR"
        fi
    fi
    
    print_step "Uninstallation complete"
}

# Main
main() {
    print_header
    
    # Check for uninstall flag
    if [[ "$1" == "--uninstall" || "$1" == "-u" ]]; then
        uninstall
        exit 0
    fi
    
    install_dependencies
    install_nodejs
    clone_and_build
    install_playwright
    configure_interests
    configure_env
    setup_cron
    test_installation
    print_summary
}

main "$@"
