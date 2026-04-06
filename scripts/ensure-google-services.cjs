const fs = require('fs');
const path = require('path');

function ensureGoogleServicesJson() {
  const root = process.cwd();
  const src = path.join(root, 'google-services.json');
  const destDir = path.join(root, 'android', 'app');
  const dest = path.join(destDir, 'google-services.json');

  if (!fs.existsSync(src)) {
    console.log('[ensure-google-services] root google-services.json not found; skipping.');
    return;
  }

  if (!fs.existsSync(destDir)) {
    console.log('[ensure-google-services] android/app not found; skipping.');
    return;
  }

  fs.copyFileSync(src, dest);
  console.log('[ensure-google-services] Synced google-services.json -> android/app/google-services.json');
}

try {
  ensureGoogleServicesJson();
} catch (e) {
  console.log('[ensure-google-services] Failed:', e && e.message ? e.message : String(e));
  // Don't fail the whole build/install for this helper.
}

