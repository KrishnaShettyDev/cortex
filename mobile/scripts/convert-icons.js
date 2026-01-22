const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'assets');

async function convertSVGtoPNG(svgFile, pngFile, width, height) {
  const svgPath = path.join(assetsDir, svgFile);
  const pngPath = path.join(assetsDir, pngFile);
  
  if (!fs.existsSync(svgPath)) {
    console.log(`Skipping ${svgFile} - file not found`);
    return;
  }
  
  await sharp(svgPath)
    .resize(width, height)
    .png()
    .toFile(pngPath);
    
  console.log(`Created: ${pngFile} (${width}x${height})`);
}

async function main() {
  console.log('Converting SVG to PNG...\n');
  
  await convertSVGtoPNG('icon.svg', 'icon.png', 1024, 1024);
  await convertSVGtoPNG('adaptive-icon.svg', 'adaptive-icon.png', 1024, 1024);
  await convertSVGtoPNG('favicon.svg', 'favicon.png', 64, 64);
  await convertSVGtoPNG('splash.svg', 'splash.png', 2048, 2048);
  await convertSVGtoPNG('notification-icon.svg', 'notification-icon.png', 96, 96);
  
  console.log('\n✅ All icons converted!');
}

main().catch(console.error);
