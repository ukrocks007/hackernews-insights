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
BINARY_NAME="hackernews-insights"

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

# Check if running on ARM (Raspberry Pi)
check_architecture() {
    ARCH=$(uname -m)
    if [[ "$ARCH" != "aarch64" && "$ARCH" != "arm64" ]]; then
        print_warn "This script is designed for Raspberry Pi (ARM64)."
        print_warn "Detected architecture: $ARCH"
        read -p "Continue anyway? (y/N): " confirm
        if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
            exit 1
        fi
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
    
    if ! command -v unzip &> /dev/null; then
        PACKAGES_NEEDED="$PACKAGES_NEEDED unzip"
    fi
    
    if [[ -n "$PACKAGES_NEEDED" ]]; then
        print_info "Installing missing packages:$PACKAGES_NEEDED"
        sudo apt-get update -qq
        sudo apt-get install -y $PACKAGES_NEEDED
    fi
    
    print_step "System dependencies OK"
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

# Download the binary
download_binary() {
    print_info "Creating installation directory..."
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR/config"
    mkdir -p "$INSTALL_DIR/db"
    
    print_info "Downloading latest binary..."
    
    # Try GitHub releases first
    RELEASE_URL="https://github.com/$REPO_OWNER/$REPO_NAME/releases/latest/download/$BINARY_NAME-linux-arm64"
    
    HTTP_CODE=$(curl -sSL -o /dev/null -w "%{http_code}" "$RELEASE_URL" 2>/dev/null || echo "000")
    
    if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "302" ]]; then
        curl -sSL -L "$RELEASE_URL" -o "$INSTALL_DIR/$BINARY_NAME"
        print_step "Downloaded from GitHub Releases"
    else
        print_warn "No release found (HTTP $HTTP_CODE). Building is required."
        print_info "Please create a release on GitHub first:"
        echo ""
        echo "  1. Clone the repo: git clone https://github.com/$REPO_OWNER/$REPO_NAME"
        echo "  2. Build: npm install && npm run package:pi"
        echo "  3. Create a release and upload bin/hackernews-insights as hackernews-insights-linux-arm64"
        echo ""
        echo "Or trigger the GitHub Action by creating a tag:"
        echo "  git tag v1.0.0 && git push --tags"
        echo ""
        exit 1
    fi
    
    chmod +x "$INSTALL_DIR/$BINARY_NAME"
    print_step "Binary downloaded to $INSTALL_DIR/$BINARY_NAME"
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
        read -p "Keep existing interests? (Y/n): " keep
        if [[ "$keep" == "y" || "$keep" == "Y" || -z "$keep" ]]; then
            print_step "Keeping existing interests"
            return
        fi
    fi
    
    echo "Enter your interests (comma-separated)."
    echo "Examples: AI, LLMs, Open source, Rust, Startups, Productivity"
    echo ""
    read -p "Your interests: " interests_input
    
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
        read -p "Reconfigure? (y/N): " reconf
        if [[ "$reconf" != "y" && "$reconf" != "Y" ]]; then
            print_step "Keeping existing .env"
            return
        fi
    fi
    
    echo ""
    echo "=== Ollama Configuration ==="
    read -p "Ollama URL [http://localhost:11434]: " ollama_url
    ollama_url=${ollama_url:-http://localhost:11434}
    
    read -p "Ollama Model [qwen2.5:0.5b]: " ollama_model
    ollama_model=${ollama_model:-qwen2.5:0.5b}
    
    echo ""
    echo "=== Pushover Notifications (optional) ==="
    echo "Get your keys from https://pushover.net"
    read -p "Pushover User Key (leave empty to skip): " pushover_user
    read -p "Pushover API Token (leave empty to skip): " pushover_token
    
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
    read -p "Choose [1-5]: " cron_choice
    
    case $cron_choice in
        1) CRON_SCHEDULE="0 * * * *" ;;
        2) CRON_SCHEDULE="0 */6 * * *" ;;
        3) CRON_SCHEDULE="0 9 * * *" ;;
        4) CRON_SCHEDULE="0 9,18 * * *" ;;
        5) 
            print_info "Skipping cron setup. Run manually with: $INSTALL_DIR/$BINARY_NAME"
            return
            ;;
        *) CRON_SCHEDULE="0 9 * * *" ;;
    esac
    
    # Remove existing cron job if any
    crontab -l 2>/dev/null | grep -v "$INSTALL_DIR/$BINARY_NAME" | crontab - 2>/dev/null || true
    
    # Add new cron job
    (crontab -l 2>/dev/null; echo "$CRON_SCHEDULE cd $INSTALL_DIR && ./$BINARY_NAME >> $INSTALL_DIR/cron.log 2>&1") | crontab -
    
    print_step "Cron job configured: $CRON_SCHEDULE"
    print_info "Logs will be written to $INSTALL_DIR/cron.log"
}

# Test the installation
test_installation() {
    echo ""
    print_info "Testing installation..."
    
    cd "$INSTALL_DIR"
    
    # Quick test - just check if binary runs
    if timeout 10s ./$BINARY_NAME 2>&1 | head -5 | grep -q "Starting HN Insights Agent"; then
        print_step "Binary starts correctly!"
    else
        print_warn "Could not verify binary execution. Please test manually."
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
    echo "  - $INSTALL_DIR/$BINARY_NAME (executable)"
    echo "  - $INSTALL_DIR/config/interests.json"
    echo "  - $INSTALL_DIR/.env"
    echo "  - $INSTALL_DIR/db/ (database folder)"
    echo ""
    echo "Commands:"
    echo "  Run manually:     cd $INSTALL_DIR && ./$BINARY_NAME"
    echo "  View logs:        tail -f $INSTALL_DIR/cron.log"
    echo "  Edit interests:   nano $INSTALL_DIR/config/interests.json"
    echo "  Edit settings:    nano $INSTALL_DIR/.env"
    echo "  View cron jobs:   crontab -l"
    echo ""
    echo "Make sure Ollama is running before executing the agent!"
    echo ""
}

# Uninstall function
uninstall() {
    echo ""
    print_warn "Uninstalling HackerNews Insights..."
    
    # Remove cron job
    crontab -l 2>/dev/null | grep -v "$INSTALL_DIR/$BINARY_NAME" | crontab - 2>/dev/null || true
    
    # Remove installation directory
    if [[ -d "$INSTALL_DIR" ]]; then
        read -p "Remove $INSTALL_DIR and all data? (y/N): " confirm
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
    
    check_architecture
    install_dependencies
    download_binary
    install_playwright
    configure_interests
    configure_env
    setup_cron
    test_installation
    print_summary
}

main "$@"
