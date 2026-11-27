import { motion } from 'framer-motion';
import {
  ArrowRight,
  CheckCircle2,
  Download,
  Expand,
  Monitor,
  ShieldCheck,
  Terminal,
  Apple
} from 'lucide-react';
import {
  formatBytes,
  type DownloadVariant,
  type PlatformId,
  type ReleaseInfo
} from '../data/releases';
import { trackDownloadClick } from '../lib/firebase';

interface HeroProps {
  release: ReleaseInfo;
  selectedPlatform: PlatformId;
  selectedVariantId: string;
  onSelectPlatform: (platform: PlatformId) => void;
  onSelectVariant: (variantId: string) => void;
  onOpenLightbox: (image: string, title: string, caption: string) => void;
}

const PLATFORMS: { id: PlatformId; label: string; icon: typeof Monitor }[] = [
  { id: 'windows', label: 'Windows', icon: Monitor },
  { id: 'linux', label: 'Linux', icon: Terminal },
  { id: 'macos', label: 'macOS', icon: Apple }
];

export function Hero({
  release,
  selectedPlatform,
  selectedVariantId,
  onSelectPlatform,
  onSelectVariant,
  onOpenLightbox
}: HeroProps) {
  const platformVariants = release.variants[selectedPlatform];
  const activeVariant: DownloadVariant =
    platformVariants.find((v) => v.id === selectedVariantId) || platformVariants[0];

  return (
    <section id="top" className="relative overflow-hidden pt-28 pb-20 sm:pt-36 sm:pb-28">
      {/* Ambient Neon Auras */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[540px] w-[860px] -translate-x-1/2 rounded-full bg-fuchsia-600/18 blur-[140px]" />
        <div className="absolute top-24 left-[15%] h-[320px] w-[320px] rounded-full bg-rose-600/12 blur-[120px]" />
        <div className="absolute top-28 right-[15%] h-[340px] w-[340px] rounded-full bg-violet-600/16 blur-[130px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          {/* Live Release Badge */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="mb-6 inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-4 py-1.5 text-xs font-medium text-fuchsia-200"
          >
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]" />
            <span>nextGx Browser v{release.version} is live</span>
            <span className="text-fuchsia-400/50">•</span>
            <span className="text-zinc-300">Strict CSP + AdGuard MV3 + Split View Pro</span>
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.06 }}
            className="font-[var(--font-display)] text-4xl font-bold tracking-tight text-white sm:text-6xl lg:text-7xl lg:leading-[1.04]"
          >
            The Browser Built for{' '}
            <span className="gx-gradient-text">Total Control.</span>
          </motion.h1>

          {/* Subheadline */}
          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.12 }}
            className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg"
          >
            Hard-cap RAM, CPU, and network bandwidth with <strong className="text-zinc-200">GX Control</strong>.
            Browse ad-free with dual-layer protection, snap tabs in <strong className="text-zinc-200">Split View Pro</strong>,
            and keep your apps docked in a razor-sharp dark sidebar.
          </motion.p>

          {/* Interactive OS & Package Picker */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.18 }}
            className="mx-auto mt-9 max-w-2xl rounded-2xl border border-white/10 bg-[#100b19]/85 p-3 shadow-2xl backdrop-blur-xl"
          >
            {/* OS Selector Tabs */}
            <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-black/40 p-1">
              {PLATFORMS.map((p) => {
                const Icon = p.icon;
                const active = selectedPlatform === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectPlatform(p.id)}
                    className={`relative flex cursor-pointer items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition sm:text-sm ${
                      active ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="hero-os-pill"
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                        className="absolute inset-0 rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/20"
                      />
                    )}
                    <Icon className="relative z-10 h-4 w-4" />
                    <span className="relative z-10">{p.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Package Format Selector Pills */}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              {platformVariants.map((variant) => {
                const isSelected = variant.id === activeVariant.id;
                return (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => onSelectVariant(variant.id)}
                    className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                      isSelected
                        ? 'border-fuchsia-400/70 bg-fuchsia-500/15 text-fuchsia-100'
                        : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:text-zinc-200'
                    }`}
                  >
                    <span>{variant.shortLabel}</span>
                    {variant.badge && (
                      <span
                        className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          variant.available
                            ? 'bg-fuchsia-500/25 text-fuchsia-200'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {variant.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Primary Download Action Row */}
            <div className="mt-4 flex flex-col items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 sm:flex-row">
              <div className="text-center sm:text-left">
                <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  <span className="text-sm font-semibold text-white">{activeVariant.label}</span>
                  <span className="font-mono text-[11px] text-zinc-400">{activeVariant.arch}</span>
                  {activeVariant.sizeBytes ? (
                    <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
                      {formatBytes(activeVariant.sizeBytes)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-zinc-400">{activeVariant.description}</p>
              </div>

              {activeVariant.available ? (
                <a
                  href={activeVariant.downloadUrl}
                  target={activeVariant.id === 'macos-source' ? '_blank' : undefined}
                  rel={activeVariant.id === 'macos-source' ? 'noopener noreferrer' : undefined}
                  onClick={() =>
                    trackDownloadClick({
                      platform: activeVariant.platform,
                      variant: activeVariant.id,
                      version: release.version,
                      fileName: activeVariant.fileName
                    })
                  }
                  className="gx-btn-primary inline-flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98]"
                >
                  <Download className="h-4 w-4" />
                  <span>{activeVariant.id === 'macos-source' ? 'View Source' : 'Download Free'}</span>
                </a>
              ) : (
                <a
                  href="#downloads"
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-500/15 px-4 py-2.5 text-sm font-semibold text-amber-200 transition hover:bg-amber-500/25"
                >
                  <span>Build Instructions</span>
                  <ArrowRight className="h-4 w-4" />
                </a>
              )}
            </div>

            {/* Trust Micro-Bar */}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[11px] text-zinc-400">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                Open-Source MIT
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-fuchsia-400" />
                <a
                  href={release.sha256Url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-white/25 underline-offset-2 transition hover:text-white"
                >
                  SHA-256 Verified
                </a>
              </span>
              <span>Zero Telemetry • No Account Required</span>
            </div>
          </motion.div>
        </div>

        {/* Hero Product Showcase Frame */}
        <motion.div
          initial={{ opacity: 0, y: 36, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.75, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
          className="relative mx-auto mt-14 max-w-6xl"
        >
          <div className="gx-browser-frame group relative overflow-hidden">
            <div className="relative overflow-hidden rounded-[15px] bg-[#09070f]">
              <img
                src="./screenshots/01-hero-startpage.jpg"
                alt="nextGx Browser Start Page with smoked-glass Speed Dial and sidebar dock"
                className="block w-full select-none object-cover transition duration-500 group-hover:scale-[1.008]"
              />
              <button
                type="button"
                onClick={() =>
                  onOpenLightbox(
                    './screenshots/01-hero-startpage.jpg',
                    'nextGx Browser — Smoked-Glass Start Page',
                    'Minimal clock, Speed Dial glass tiles, live adblock & RAM readout, and sleek left sidebar dock.'
                  )
                }
                aria-label="Inspect full-resolution Start Page screenshot"
                className="absolute right-4 bottom-4 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/15 bg-black/70 px-3.5 py-2 text-xs font-medium text-zinc-200 opacity-0 backdrop-blur-md transition group-hover:opacity-100 hover:border-fuchsia-400/50 hover:text-white"
              >
                <Expand className="h-3.5 w-3.5 text-fuchsia-400" />
                <span>Inspect Full Size</span>
              </button>
            </div>
          </div>

          {/* Floating Highlights Strip under Hero Image */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { value: '100%', label: 'Free & Open Source' },
              { value: 'Dual-Layer', label: 'Native + AdGuard MV3 Shield' },
              { value: '8 GB Mode', label: 'Auto-Memory Tab Saver' },
              { value: 'Strict CSP', label: 'Hardened Zero-Inline UI' }
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-center backdrop-blur-sm"
              >
                <div className="font-[var(--font-display)] text-lg font-bold text-white sm:text-xl">
                  {stat.value}
                </div>
                <div className="mt-0.5 text-xs text-zinc-400">{stat.label}</div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
