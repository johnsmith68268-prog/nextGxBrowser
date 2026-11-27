export type PlatformId = 'windows' | 'linux' | 'macos';

export interface DownloadVariant {
  id: string;
  platform: PlatformId;
  label: string;
  shortLabel: string;
  format: string;
  arch: string;
  badge?: string;
  description: string;
  fileName: string;
  downloadUrl: string;
  sizeBytes?: number;
  available: boolean;
  recommended?: boolean;
}

export interface ReleaseInfo {
  version: string;
  tag: string;
  publishedAt: string;
  releaseUrl: string;
  sha256Url: string;
  variants: Record<PlatformId, DownloadVariant[]>;
  isLiveFetched: boolean;
}

export const REPO_OWNER = 'johnsmith68268-prog';
export const REPO_NAME = 'nextGxBrowser';
export const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
export const RELEASES_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
export const FALLBACK_VERSION = '3.2.2';

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubReleaseResponse {
  tag_name?: string;
  published_at?: string;
  html_url?: string;
  assets?: GitHubAsset[];
}

export function detectUserPlatform(): PlatformId {
  if (typeof navigator === 'undefined') return 'windows';
  const uaDataPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform;
  const raw = `${uaDataPlatform || ''} ${navigator.platform || ''} ${navigator.userAgent || ''}`.toLowerCase();
  if (raw.includes('mac') || raw.includes('darwin')) return 'macos';
  if (raw.includes('linux') || raw.includes('x11') || raw.includes('ubuntu')) return 'linux';
  return 'windows';
}

export function formatBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function formatReleaseDate(iso?: string): string {
  if (!iso) return 'Latest Release';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Latest Release';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return 'Latest Release';
  }
}

export function buildFallbackRelease(version = FALLBACK_VERSION): ReleaseInfo {
  const tag = version.startsWith('v') ? version : `v${version}`;
  const cleanVer = tag.replace(/^v/i, '');
  const base = `${REPO_URL}/releases/download/${tag}`;

  return {
    version: cleanVer,
    tag,
    publishedAt: '',
    releaseUrl: `${REPO_URL}/releases/tag/${tag}`,
    sha256Url: `${base}/SHA256SUMS.txt`,
    isLiveFetched: false,
    variants: {
      windows: [
        {
          id: 'win-setup',
          platform: 'windows',
          label: 'Windows Setup Installer',
          shortLabel: 'Setup (.exe)',
          format: 'NSIS .exe',
          arch: 'x64 • Win 10/11',
          badge: 'Recommended',
          description: 'Full desktop installer with Start Menu shortcut, URL associations, and silent verified auto-updates.',
          fileName: `nextGx-Browser-Setup-${cleanVer}-x64.exe`,
          downloadUrl: `${base}/nextGx-Browser-Setup-${cleanVer}-x64.exe`,
          available: true,
          recommended: true
        },
        {
          id: 'win-portable',
          platform: 'windows',
          label: 'Windows Portable Edition',
          shortLabel: 'Portable (.exe)',
          format: 'Portable .exe',
          arch: 'x64 • Zero Install',
          badge: 'No Admin Needed',
          description: 'Self-contained executable ready to run from any folder or USB drive without modifying registry keys.',
          fileName: `nextGx-Browser-Portable-${cleanVer}-x64.exe`,
          downloadUrl: `${base}/nextGx-Browser-Portable-${cleanVer}-x64.exe`,
          available: true
        },
        {
          id: 'win-msix',
          platform: 'windows',
          label: 'Windows MSIX Package',
          shortLabel: 'MSIX (.msix)',
          format: '.msix',
          arch: 'x64 • Modern AppX',
          description: 'Clean container-style Windows package with native install/uninstall lifecycle.',
          fileName: `nextGx-Browser-${cleanVer}-x64.msix`,
          downloadUrl: `${base}/nextGx-Browser-${cleanVer}-x64.msix`,
          available: true
        }
      ],
      linux: [
        {
          id: 'linux-appimage',
          platform: 'linux',
          label: 'Linux AppImage (Universal)',
          shortLabel: 'AppImage',
          format: '.AppImage',
          arch: 'x86_64 • Any Distro',
          badge: 'Recommended',
          description: 'Runs directly on Ubuntu, Fedora, Arch, Mint, and Pop!_OS — chmod +x and launch instantly.',
          fileName: `nextGx-Browser-${cleanVer}-x86_64.AppImage`,
          downloadUrl: `${base}/nextGx-Browser-${cleanVer}-x86_64.AppImage`,
          available: true,
          recommended: true
        },
        {
          id: 'linux-deb',
          platform: 'linux',
          label: 'Debian / Ubuntu Package',
          shortLabel: 'Debian (.deb)',
          format: '.deb',
          arch: 'amd64 • APT Native',
          badge: 'Ubuntu / Mint',
          description: 'Native Debian package with desktop entry, protocol handlers, and system launcher integration.',
          fileName: `nextGx-Browser-${cleanVer}-amd64.deb`,
          downloadUrl: `${base}/nextGx-Browser-${cleanVer}-amd64.deb`,
          available: true
        }
      ],
      macos: [
        {
          id: 'macos-dmg',
          platform: 'macos',
          label: 'macOS Universal Installer',
          shortLabel: 'Apple Silicon / Intel (.dmg)',
          format: '.dmg',
          arch: 'arm64 & x64',
          badge: 'Coming Soon',
          description: 'Signed macOS .dmg builds are planned for an upcoming release. Meanwhile, you can run nextGx directly from source on macOS.',
          fileName: `nextGx-Browser-${cleanVer}-universal.dmg`,
          downloadUrl: `${REPO_URL}/releases`,
          available: false,
          recommended: true
        },
        {
          id: 'macos-source',
          platform: 'macos',
          label: 'Build from Source (macOS)',
          shortLabel: 'From Source',
          format: 'Git + Node.js',
          arch: 'macOS 13+',
          badge: 'Available Now',
          description: 'Clone the MIT repository and launch natively with Electron 45 in under 60 seconds.',
          fileName: 'git clone nextGxBrowser',
          downloadUrl: REPO_URL,
          available: true
        }
      ]
    }
  };
}

function matchAsset(assets: GitHubAsset[], predicate: (lowerName: string) => boolean): GitHubAsset | undefined {
  return assets.find((a) => predicate(a.name.toLowerCase()));
}

export async function fetchLatestRelease(signal?: AbortSignal): Promise<ReleaseInfo> {
  const fallback = buildFallbackRelease();
  try {
    const res = await fetch(RELEASES_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as GitHubReleaseResponse;
    if (!data || !data.tag_name || !Array.isArray(data.assets)) return fallback;

    const cleanVer = data.tag_name.replace(/^v/i, '');
    const info = buildFallbackRelease(cleanVer);
    info.publishedAt = data.published_at || '';
    info.releaseUrl = data.html_url || info.releaseUrl;
    info.isLiveFetched = true;

    const assets = data.assets;
    const shaAsset = matchAsset(assets, (n) => n === 'sha256sums.txt');
    if (shaAsset) info.sha256Url = shaAsset.browser_download_url;

    const winSetup = matchAsset(assets, (n) => n.endsWith('.exe') && n.includes('setup'));
    const winPortable = matchAsset(assets, (n) => n.endsWith('.exe') && n.includes('portable'));
    const winMsix = matchAsset(assets, (n) => n.endsWith('.msix'));
    const linuxAppImage = matchAsset(assets, (n) => n.endsWith('.appimage'));
    const linuxDeb = matchAsset(assets, (n) => n.endsWith('.deb'));
    const macDmg = matchAsset(assets, (n) => n.endsWith('.dmg'));

    const applyAsset = (variant: DownloadVariant, asset?: GitHubAsset) => {
      if (!asset) return;
      variant.fileName = asset.name;
      variant.downloadUrl = asset.browser_download_url;
      variant.sizeBytes = asset.size;
      variant.available = true;
    };

    applyAsset(info.variants.windows[0], winSetup);
    applyAsset(info.variants.windows[1], winPortable);
    applyAsset(info.variants.windows[2], winMsix);
    applyAsset(info.variants.linux[0], linuxAppImage);
    applyAsset(info.variants.linux[1], linuxDeb);

    if (macDmg) {
      applyAsset(info.variants.macos[0], macDmg);
      info.variants.macos[0].badge = 'Recommended';
      info.variants.macos[0].description = 'Native macOS drag-to-Applications installer with full Chromium hardware acceleration.';
    }

    return info;
  } catch {
    return fallback;
  }
}
