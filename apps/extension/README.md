# Cortex Chrome Extension

Save anything to your AI memory. Never forget what matters.

## Features

- **🔖 One-Click Save**: Save any webpage with Cmd+Shift+S (Mac) or Ctrl+Shift+S (Windows)
- **🐦 Twitter Integration**: Save tweets with inline "Save" button
- **✂️ Save Selection**: Highlight text and save with Cmd+Shift+C
- **🎯 Context Menu**: Right-click to save page or selection
- **🔒 Secure**: End-to-end encrypted with your Cortex API key

## Installation

### From Source (Development)

1. Install dependencies:
```bash
pnpm install
```

2. Build the extension:
```bash
pnpm run build
```

3. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select `.output/chrome-mv3` directory

### For Firefox

```bash
pnpm run build:firefox
```

Then load from `.output/firefox-mv3` directory in `about:debugging`.

## Setup

1. Click the Cortex extension icon
2. Click "Settings" ⚙️
3. Enter your API key from [Cortex Settings](https://app.askcortex.plutas.in/settings)
4. Click "Save API Key"

## Usage

### Save Current Page
- Click extension icon → "Save to Cortex"
- OR press `Cmd+Shift+S` (Mac) / `Ctrl+Shift+S` (Windows)
- OR right-click → "Save to Cortex"

### Save Selection
- Highlight text
- Press `Cmd+Shift+C` (Mac) / `Ctrl+Shift+C` (Windows)
- OR right-click → "Save selection to Cortex"

### Save Tweets
- Browse Twitter/X
- Click blue "Save" button on any tweet
- Tweet saved with author and timestamp

## Privacy

- Your API key is stored locally in browser storage
- All data sent directly to your Cortex account
- No tracking, no analytics, no third parties

## Development

```bash
# Start dev server with hot reload
pnpm run dev

# Build for production
pnpm run build

# Create ZIP for Chrome Web Store
pnpm run zip
```

## Tech Stack

- **WXT Framework**: Modern web extension development
- **React 18**: UI components
- **TypeScript**: Type safety
- **Tailwind CSS**: Styling
- **Lucide React**: Icons

## License

MIT

## Support

- Documentation: https://docs.askcortex.plutas.in
- Issues: https://github.com/cortex/extension/issues
- Email: support@askcortex.plutas.in
