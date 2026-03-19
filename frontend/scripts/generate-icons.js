// scripts/generate-icons.js — generate all app icons from an SVG source
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../public');
const ELECTRON_OUT = resolve(__dirname, '../electron/assets');

mkdirSync(OUT, { recursive: true });
mkdirSync(ELECTRON_OUT, { recursive: true });

// CareWatch icon: blue circle with a white heart-pulse (ECG) line
const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1D4ED8"/>
      <stop offset="100%" style="stop-color:#2563EB"/>
    </linearGradient>
  </defs>
  <!-- Background circle -->
  <rect width="1024" height="1024" rx="224" fill="url(#bg)"/>
  <!-- White cross / medical plus -->
  <rect x="412" y="212" width="200" height="600" rx="40" fill="white" opacity="0.95"/>
  <rect x="212" y="412" width="600" height="200" rx="40" fill="white" opacity="0.95"/>
  <!-- Small heartbeat line overlay -->
  <polyline points="212,532 312,532 362,412 432,652 502,452 552,532 662,532 712,412 762,532 812,532"
    fill="none" stroke="#1D4ED8" stroke-width="28" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>
</svg>`;

const svgBuf = Buffer.from(svgIcon);

const sizes = [
  // PWA / web
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  // iOS App Store
  { name: 'icon-1024.png', size: 1024 },
];

// Electron sizes
const electronSizes = [
  { name: 'icon-16.png',   size: 16  },
  { name: 'icon-32.png',   size: 32  },
  { name: 'icon-64.png',   size: 64  },
  { name: 'icon-128.png',  size: 128 },
  { name: 'icon-256.png',  size: 256 },
  { name: 'icon-512.png',  size: 512 },
  { name: 'icon-1024.png', size: 1024 },
];

async function generate() {
  // Web icons
  for (const { name, size } of sizes) {
    await sharp(svgBuf)
      .resize(size, size)
      .png()
      .toFile(resolve(OUT, name));
    console.log(`✅ ${name}`);
  }

  // Electron icons
  for (const { name, size } of electronSizes) {
    await sharp(svgBuf)
      .resize(size, size)
      .png()
      .toFile(resolve(ELECTRON_OUT, name));
    console.log(`✅ electron/${name}`);
  }

  // macOS .icns equivalent — electron-builder uses the 512/1024 PNG
  // iOS AppIcon (1024px for App Store submission)
  const iosIconPath = resolve(__dirname, '../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
  await sharp(svgBuf).resize(1024, 1024).png().toFile(iosIconPath);
  console.log('✅ iOS AppIcon-512@2x.png');

  console.log('\n🎉 All icons generated!');
}

generate().catch(err => { console.error(err); process.exit(1); });
