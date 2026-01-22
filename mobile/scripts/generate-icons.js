/**
 * Icon Generation Script for Cortex
 *
 * This script generates the app icon and splash screen SVG assets
 * using the same gradient ring design as GradientIcon.
 *
 * Run: node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');

// Gradient colors from theme
const GRADIENT_COLORS = ['#7DD3C0', '#A78BFA', '#F472B6'];
const BG_COLOR = '#0A0A0A';

// Icon sizes
const SIZES = {
  icon: 1024,
  adaptiveIcon: 1024,
  favicon: 64,
  splash: 2048,
  notificationIcon: 96
};

function createGradientRingSVG(size, innerRatio = 0.5) {
  const cx = size / 2;
  const cy = size / 2;
  const outerRadius = size / 2;
  const innerRadius = outerRadius * innerRatio;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${GRADIENT_COLORS[0]}"/>
      <stop offset="50%" stop-color="${GRADIENT_COLORS[1]}"/>
      <stop offset="100%" stop-color="${GRADIENT_COLORS[2]}"/>
    </linearGradient>
  </defs>
  <circle cx="${cx}" cy="${cy}" r="${outerRadius}" fill="url(#gradient)"/>
  <circle cx="${cx}" cy="${cy}" r="${innerRadius}" fill="${BG_COLOR}" opacity="0.6"/>
</svg>`;
}

function createSplashSVG(width, height, logoSize) {
  const cx = width / 2;
  const cy = height / 2;
  const outerRadius = logoSize / 2;
  const innerRadius = outerRadius * 0.5;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${GRADIENT_COLORS[0]}"/>
      <stop offset="50%" stop-color="${GRADIENT_COLORS[1]}"/>
      <stop offset="100%" stop-color="${GRADIENT_COLORS[2]}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="${BG_COLOR}"/>
  <circle cx="${cx}" cy="${cy}" r="${outerRadius}" fill="url(#gradient)"/>
  <circle cx="${cx}" cy="${cy}" r="${innerRadius}" fill="${BG_COLOR}" opacity="0.6"/>
</svg>`;
}

// Create assets directory if it doesn't exist
const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// Generate SVG files
console.log('Generating SVG icon templates...');

fs.writeFileSync(path.join(assetsDir, 'icon.svg'), createGradientRingSVG(SIZES.icon));
console.log('Created: assets/icon.svg');

fs.writeFileSync(path.join(assetsDir, 'adaptive-icon.svg'), createGradientRingSVG(SIZES.adaptiveIcon));
console.log('Created: assets/adaptive-icon.svg');

fs.writeFileSync(path.join(assetsDir, 'favicon.svg'), createGradientRingSVG(SIZES.favicon));
console.log('Created: assets/favicon.svg');

fs.writeFileSync(path.join(assetsDir, 'splash.svg'), createSplashSVG(SIZES.splash, SIZES.splash, 400));
console.log('Created: assets/splash.svg');

fs.writeFileSync(path.join(assetsDir, 'notification-icon.svg'), createGradientRingSVG(SIZES.notificationIcon));
console.log('Created: assets/notification-icon.svg');

console.log('\n✅ SVG files created successfully!');
console.log('\nTo convert to PNG, use: https://svgtopng.com/');
