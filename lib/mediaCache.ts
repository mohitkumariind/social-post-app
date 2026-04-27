import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

type CacheKind = 'frame' | 'daily';

type DailyManifestRow = {
  url: string;
  localUri: string; // file://...
  downloadedAt: number;
  expiresAt: number;
};

const MANIFEST_KEY = 'mediaCache:dailyContentManifest:v1';

const ROOT = (FileSystem.documentDirectory || '').replace(/\/?$/, '/');
const FRAMES_DIR = `${ROOT}frames/`;
const DAILY_DIR = `${ROOT}daily-content/`;

const TTL_48H_MS = 48 * 60 * 60 * 1000;

function withFileScheme(pathOrUri: string): string {
  if (!pathOrUri) return pathOrUri;
  return pathOrUri.startsWith('file://') ? pathOrUri : `file://${pathOrUri}`;
}

async function ensureDir(dir: string): Promise<void> {
  if (!FileSystem.documentDirectory) return;
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch {
    // ignore (already exists / not supported)
  }
}

async function sha256(input: string): Promise<string> {
  return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input);
}

function guessExtFromUrl(url: string): string {
  const clean = url.split('?')[0].split('#')[0];
  const m = clean.match(/\.([a-zA-Z0-9]{2,6})$/);
  const ext = m?.[1]?.toLowerCase();
  if (!ext) return 'bin';
  // common image/video only; else fallback to bin
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'm4v'].includes(ext)) return ext;
  return 'bin';
}

async function readDailyManifest(): Promise<Record<string, DailyManifestRow>> {
  const raw = await AsyncStorage.getItem(MANIFEST_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, DailyManifestRow>) : {};
  } catch {
    return {};
  }
}

async function writeDailyManifest(next: Record<string, DailyManifestRow>): Promise<void> {
  await AsyncStorage.setItem(MANIFEST_KEY, JSON.stringify(next));
}

export async function downloadMediaToCache(opts: {
  kind: CacheKind;
  url: string;
  ext?: string; // optional override
}): Promise<string | null> {
  const url = String(opts.url ?? '').trim();
  if (!url) return null;
  if (!FileSystem.documentDirectory) return url; // fallback to remote if FS unavailable

  const dir = opts.kind === 'frame' ? FRAMES_DIR : DAILY_DIR;
  await ensureDir(dir);

  const key = await sha256(url);
  const ext = (opts.ext ?? guessExtFromUrl(url)).replace(/^\./, '');
  const localPath = `${dir}${opts.kind}_${key}.${ext}`;
  const localUri = withFileScheme(localPath);

  // 1) Check-before-download
  try {
    const info = await FileSystem.getInfoAsync(localPath);
    if (info.exists) return localUri;
  } catch {
    // ignore
  }

  // 2) Download once (guard against transient FS errors)
  let res: FileSystem.FileSystemDownloadResult;
  try {
    res = await FileSystem.downloadAsync(url, localPath);
  } catch {
    return null;
  }
  if (res.status < 200 || res.status >= 300) return null;

  // 3) Track only daily-content in manifest (48h expiry)
  if (opts.kind === 'daily') {
    const now = Date.now();
    const expiresAt = now + TTL_48H_MS;
    const manifest = await readDailyManifest();
    manifest[url] = { url, localUri, downloadedAt: now, expiresAt };
    await writeDailyManifest(manifest);
  }

  return localUri;
}

export async function cleanupDailyContentCache(nowMs: number = Date.now()): Promise<{
  scanned: number;
  deleted: number;
}> {
  if (!FileSystem.documentDirectory) return { scanned: 0, deleted: 0 };

  const manifest = await readDailyManifest();
  const entries = Object.values(manifest);
  let deleted = 0;

  for (const row of entries) {
    if (!row?.localUri || !row?.expiresAt) continue;
    if (row.expiresAt > nowMs) continue;

    const localPath = row.localUri.replace(/^file:\/\//, '');
    try {
      await FileSystem.deleteAsync(localPath, { idempotent: true });
      deleted += 1;
    } catch {
      // ignore
    }

    delete manifest[row.url];
  }

  await writeDailyManifest(manifest);
  return { scanned: entries.length, deleted };
}

