export interface FeatureShowcaseItem {
  id: string;
  tabLabel: string;
  badge: string;
  title: string;
  description: string;
  image: string;
  highlights: string[];
}

export interface GalleryItem {
  id: string;
  title: string;
  category: string;
  caption: string;
  image: string;
}

export interface SecurityPillar {
  id: string;
  title: string;
  tag: string;
  description: string;
  iconName: 'shield' | 'lock' | 'cpu' | 'key' | 'eyeOff' | 'refresh';
}

export const FEATURE_SHOWCASE: FeatureShowcaseItem[] = [
  {
    id: 'splitview',
    tabLabel: 'Split View Pro',
    badge: 'Multitasking',
    title: 'Two live websites, one seamless frame.',
    description:
      'Snap any two tabs side-by-side with a precision draggable divider. Merge tabs, reverse Left/Right panes in one click, or pick your second tab from an in-pane picker — no window juggling required.',
    image: './screenshots/03-sidebar-splitview.jpg',
    highlights: [
      'Instant side-by-side tab merging & pane swapping',
      'Smooth FLIP tab strip reordering without jitter',
      'Smart hibernation skips visible split partner tabs'
    ]
  },
  {
    id: 'gxcontrol',
    tabLabel: 'GX Control',
    badge: 'Performance',
    title: 'Hard-cap RAM, CPU & bandwidth on the fly.',
    description:
      'Keep games, IDEs, and streams silky smooth. Monitor real-time browser RAM and multi-core normalized CPU usage, hibernate background tabs with one click, or enable 8 GB Auto-Memory Saver.',
    image: './screenshots/04-gx-control.jpg',
    highlights: [
      'Live circular RAM gauge & Hot Tab Killer',
      'Per-tab RAM, CPU, and Network bandwidth limiters',
      'Auto-Memory Saver suspends idle tabs automatically'
    ]
  },
  {
    id: 'shield',
    tabLabel: 'Privacy Shield',
    badge: 'Ad & Tracker Blocking',
    title: 'Zero-bloat AdBlock + YouTube ad-free playback.',
    description:
      'Engine-level network blocking paired with bundled AdGuard MV3 compatibility strips ads, trackers, and pre-roll video interruptions before they render — with live per-site & session counters.',
    image: './screenshots/07-downloads-shield.jpg',
    highlights: [
      'Dual-layer native engine blocker + AdGuard MV3',
      'Clean YouTube playback without ad overlays',
      'One-click per-origin shield toggle & tracker stats'
    ]
  },
  {
    id: 'omnibox',
    tabLabel: 'Smart Omnibox',
    badge: 'Speed',
    title: 'Instant suggestions, history & tab switching.',
    description:
      'Type once and jump anywhere. Full-width Opera GX inspired omnibox surfaces live search suggestions, clean single-line history rows with favicons, and instant Switch-to-Tab shortcuts.',
    image: './screenshots/02-omnibox-search.jpg',
    highlights: [
      'Clean domain-only URL elision when unfocused',
      'Live search autocomplete + instant history matching',
      'Zero-focus popover never interrupts your typing flow'
    ]
  },
  {
    id: 'easysetup',
    tabLabel: 'Easy Setup',
    badge: 'Personalization',
    title: '8 neon themes & curated wallpapers in one drawer.',
    description:
      'Switch between Ultraviolet, GX Crimson, Neon Pink, Sub Zero, Matrix, and more without leaving your tab. Pair with 6 built-in curated wallpapers or drop in your own custom artwork.',
    image: './screenshots/05-easy-setup.jpg',
    highlights: [
      'Floating zero-resize drawer keeps pages steady',
      '8 precision accent themes + custom wallpaper upload',
      'Toggle browser SFX, keyboard sounds & bookmarks bar'
    ]
  },
  {
    id: 'settings',
    tabLabel: 'Settings Suite',
    badge: 'Control Center',
    title: 'Unified nextgx:// command center.',
    description:
      'Manage Appearance, GX Features, Passwords & Passkeys, DNS-over-HTTPS, WebRTC policy, Extensions, Downloads, and History inside one blazing-fast internal WebUI.',
    image: './screenshots/06-settings.jpg',
    highlights: [
      '14 clean settings categories with live instant search',
      'Built-in Passkey manager & OS-encrypted credentials',
      'DNS-over-HTTPS & WebRTC leak protection built in'
    ]
  },
  {
    id: 'onboarding',
    tabLabel: 'Quick Onboarding',
    badge: 'First Run',
    title: 'Ready your way in under 30 seconds.',
    description:
      'First launch greets you with a focused setup wizard to pick your theme, wallpaper, privacy tier, and favorite sidebar apps — zero accounts, zero forced telemetry.',
    image: './screenshots/08-gx-corner-or-onboarding.jpg',
    highlights: [
      'Zero account sign-in or cloud lock-in required',
      'Configure default browser, privacy & dock in seconds',
      'Re-launch anytime from Settings'
    ]
  }
];

export const SECURITY_PILLARS: SecurityPillar[] = [
  {
    id: 'csp',
    title: "Strict CSP (script-src 'self')",
    tag: 'Hardened UI',
    description:
      'Every internal nextGx UI surface enforces strict script-src self with zero inline scripts, zero eval, and sanitized favicon/URL boundaries.',
    iconName: 'shield'
  },
  {
    id: 'updater',
    title: 'Fail-Closed SHA256 Auto-Updater',
    tag: 'Supply Chain',
    description:
      'Downloads strictly from official GitHub Releases over HTTPS and verifies cryptographic SHA-256 checksums before executing any installer.',
    iconName: 'refresh'
  },
  {
    id: 'passkeys',
    title: 'Passkeys & Encrypted Vault',
    tag: 'Auth Security',
    description:
      'Built-in WebAuthn Passkeys with Public Suffix List RP-ID validation, OS-backed async safeStorage encryption, and 30s clipboard auto-clear.',
    iconName: 'key'
  },
  {
    id: 'private',
    title: 'True Private Window Isolation',
    tag: 'Zero Leakage',
    description:
      'Incognito windows run on isolated in-memory sessions with separate cookie stores, scoped certificate exceptions, and zero disk history.',
    iconName: 'eyeOff'
  },
  {
    id: 'adblock',
    title: 'Dual-Layer Ad & Tracker Shield',
    tag: 'Network Defense',
    description:
      'Combines an ultra-fast Set-based native network blocker with a pre-shimmed AdGuard MV3 engine and SSRF/local-network protections.',
    iconName: 'lock'
  },
  {
    id: 'memory',
    title: '8 GB Auto-Memory Saver',
    tag: 'Efficiency',
    description:
      'Multi-core normalized CPU tracking and intelligent background tab hibernation keep RAM usage lean even with dozens of tabs open.',
    iconName: 'cpu'
  }
];

export const GALLERY_ITEMS: GalleryItem[] = [
  {
    id: 'g-startpage',
    title: 'Smoked-Glass Start Page',
    category: 'Workspace',
    caption: 'Minimal clock, Speed Dial glass tiles, live adblock & RAM readout, and instant wallpaper switcher.',
    image: './screenshots/01-hero-startpage.jpg'
  },
  {
    id: 'g-splitview',
    title: 'Split View Pro',
    category: 'Multitasking',
    caption: 'Google and SoundCloud side-by-side with a glowing resizable splitter and unified toolbar controls.',
    image: './screenshots/03-sidebar-splitview.jpg'
  },
  {
    id: 'g-gxcontrol',
    title: 'GX Control Panel',
    category: 'Performance',
    caption: 'Circular Browser RAM gauge, System CPU monitor, Network/CPU/RAM limiters, and Hot Tab Killer.',
    image: './screenshots/04-gx-control.jpg'
  },
  {
    id: 'g-shield',
    title: 'Live Privacy Shield on YouTube',
    category: 'AdBlock',
    caption: 'Per-site adblock counter, instant origin toggle, and tracker protection running cleanly on YouTube.',
    image: './screenshots/07-downloads-shield.jpg'
  },
  {
    id: 'g-omnibox',
    title: 'Expanded Smart Omnibox',
    category: 'Navigation',
    caption: 'Unified search suggestions and rich history dropdown aligned cleanly below the address capsule.',
    image: './screenshots/02-omnibox-search.jpg'
  },
  {
    id: 'g-easysetup',
    title: 'Easy Setup Floating Drawer',
    category: 'Themes',
    caption: 'Live theme previews, 6 curated wallpapers, custom wallpaper upload, and quick appearance toggles.',
    image: './screenshots/05-easy-setup.jpg'
  },
  {
    id: 'g-settings',
    title: 'Unified Settings WebUI',
    category: 'Configuration',
    caption: 'Grid-styled nextgx://settings with visual theme cards, privacy controls, and extension manager.',
    image: './screenshots/06-settings.jpg'
  },
  {
    id: 'g-onboarding',
    title: 'Welcome Onboarding Wizard',
    category: 'First Launch',
    caption: 'Clean 30-second personalization flow with zero sign-up barriers.',
    image: './screenshots/08-gx-corner-or-onboarding.jpg'
  }
];

export const SIDEBAR_APPS = [
  { name: 'YouTube Music', accent: '#fa1e4e' },
  { name: 'Spotify', accent: '#1db954' },
  { name: 'SoundCloud', accent: '#ff5500' },
  { name: 'Twitch', accent: '#9146ff' },
  { name: 'ChatGPT', accent: '#10a37f' },
  { name: 'Gemini', accent: '#a855f7' },
  { name: 'WhatsApp', accent: '#25d366' },
  { name: 'Discord', accent: '#5865f2' }
];
