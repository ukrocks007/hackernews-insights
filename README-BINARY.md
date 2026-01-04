# Running as a Binary on Raspberry Pi

> **⚠️ DEPRECATED:** Due to native module (SQLite3) binding issues with packaged binaries, we now recommend using the local build approach via the install script. See the main [README.md](README.md) for the recommended installation method.

To save space and simplify deployment, you can package this application into a single executable binary.

## Prerequisites

- **Raspberry Pi** (ARM64 recommended, e.g., Pi 3, 4, 5 with 64-bit OS)
- **Node.js** installed on the machine where you build (can be the Pi itself or your dev machine)

## Building the Binary

### Option 1: Build on the Raspberry Pi (Recommended)

This is the most reliable method because it ensures the native modules (like `sqlite3`) are built for the correct architecture.

1.  **Clone the repository** on your Pi.
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Build the binary**:
    ```bash
    npm run package
    ```
    This will create a `bin/hackernews-insights` executable.

### Option 2: Build on macOS/Windows for Pi

**Note:** This is complex because `sqlite3` is a native module. `pkg` cannot automatically cross-compile it. You would need to manually download the Linux ARM64 bindings for `sqlite3` and place them where `pkg` expects them, or use a Docker container to build.

If you try to run `npm run package` on macOS, the resulting binary might fail on the Pi with an error about `sqlite3` bindings.

## Running the Binary

1.  **Copy the binary** (`bin/hackernews-insights`) to your desired location on the Pi.
2.  **Create a `config` directory** next to the binary and place your `interests.json` inside it.
    ```
    /path/to/app/
      ├── hackernews-insights  (the binary)
      ├── .env                 (your environment variables)
      └── config/
          └── interests.json
    ```
3.  **Set up Environment Variables**:
    Create a `.env` file next to the binary with your configuration (Ollama URL, Pushover keys, etc.).

4.  **Install Playwright Browsers**:
    The binary does **not** include the web browsers required by Playwright. You need to install them on the Pi.
    
    If you have `node` installed on the Pi:
    ```bash
    npx playwright install chromium
    ```
    
    Or install system dependencies if needed:
    ```bash
    npx playwright install-deps chromium
    ```

5.  **Run the application**:
    ```bash
    ./hackernews-insights
    ```

## Troubleshooting

-   **Sqlite3 Error**: If you see an error like `Error: Cannot find module .../node_sqlite3.node`, it means the native binding was not included or is for the wrong architecture. **Recommended solution:** Use the local build approach with the install script from the main README instead of the binary approach.
-   **Playwright Error**: If it complains about missing browsers, ensure you've run `npx playwright install`.

## Recommended Alternative

For a more reliable installation that avoids all native module issues, use the automated installer:

```bash
curl -sSL https://raw.githubusercontent.com/ukrocks007/hackernews-insights/main/install.sh | bash
```

This clones the repository and builds locally, ensuring all native modules are compiled correctly for your system.
