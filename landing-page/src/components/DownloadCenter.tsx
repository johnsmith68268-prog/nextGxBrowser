import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Apple,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  Monitor,
  Terminal
} from 'lucide-react';
import {
  formatBytes,
  formatReleaseDate,
  REPO_URL,
  type PlatformId,
  type ReleaseInfo
} from '../data/releases';
import { trackDownloadClick } from '../lib/firebase';

interface DownloadCenterProps {
  release: ReleaseInfo;
  selectedPlatform: PlatformId;
  selectedVariantId: string;
  onSelectPlatform: (platform: PlatformId) => void;
  onSelectVariant: (variantId: string) => void;
}

const OS_TABS: { id: PlatformId; name: string; subtitle: string; icon: typeof Monitor }[] = [
  { id: 'windows', name: 'Windows', subtitle: 'Setup • Portable • MSIX', icon: Monitor },
  { id: 'linux', name: 'Linux', subtitle: 'AppImage • Debian .deb', icon: Terminal },
  { id: 'macos', name: 'macOS', subtitle: 'Apple Silicon & Intel', icon: Apple }
];

const MACOS_BUILD_CMD = `git clone ${REPO_URL}.git && cd nextGxBrowser && npm install && npm start`;

export function DownloadCenter({
  release,
  selectedPlatform,
  selectedVariantId,
  onSelectPlatform,
  onSelectVariant
}: DownloadCenterProps) {
  const [copiedCmd, setCopiedCmd] = useState(false);
  const variants = release.variants[selectedPlatform];

  const handleCopyMacCmd = async () => {
    try {
      await navigator.clipboard.writeText(MACOS_BUILD_CMD);
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2200);
    } catch {
      // Clipboard unavailable in insecure context
    }
  };

  return (
    <section id="downloads" className="relative py-24 sm:py-32">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-fuchsia-500/35 to-transparent" />
      <div className="pointer-events-none absolute bottom-0 left-1/2 h-[420px] w-[760px] -translate-x-1/2 rounded-full bg-fuchsia-600/14 blur-[150px]" />

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-3xl text-center"
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-3.5 py-1 font-mono text-xs font-semibold text-fuchsia-200">
            <span>Release v{release.version}</span>
            <span className="text-fuchsia-400/50">•</span>
            <span>{formatReleaseDate(release.publishedAt)}</span>
          </span>
          <h2 className="mt-4 font-[var(--font-display)] text-3xl font-bold tracking-tight text-white sm:text-5xl">
            Download <span className="gx-gradient-text">nextGx Browser</span>
          </h2>
          <p className="mt-4 text-base text-zinc-400 sm:text-lg">
            Choose your operating system and preferred package format. Every release artifact is published directly from GitHub Actions with SHA-256 checksums.
          </p>
        </motion.div>

        {/* OS Switcher Cards */}
        <div className="mx-auto mt-10 grid max-w-3xl grid-cols-3 gap-3">
          {OS_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = selectedPlatform === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectPlatform(tab.id)}
                className={`relative flex cursor-pointer flex-col items-center rounded-2xl border p-4 text-center transition ${
                  active
                    ? 'border-fuchsia-400/60 bg-fuchsia-500/14 text-white shadow-[0_0_32px_-10px_rgba(236,72,153,0.5)]'
                    : 'border-white/10 bg-white/[0.025] text-zinc-400 hover:border-white/20 hover:text-zinc-200'
                }`}
              >
                <Icon className={`h-6 w-6 ${active ? 'text-fuchsia-300' : 'text-zinc-400'}`} />
                <span className="mt-2 font-[var(--font-display)] text-sm font-bold sm:text-base">
                  {tab.name}
                </span>
                <span className="mt-0.5 hidden text-[11px] text-zinc-400 sm:block">
                  {tab.subtitle}
                </span>
              </button>
            );
          })}
        </div>

        {/* Selectable Format Cards for Selected OS */}
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedPlatform}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="mt-8"
          >
            <div
              className={`grid gap-5 ${
                variants.length === 3 ? 'md:grid-cols-3' : 'mx-auto max-w-4xl md:grid-cols-2'
              }`}
            >
              {variants.map((variant) => {
                const isSelected = variant.id === selectedVariantId;
                return (
                  <div
                    key={variant.id}
                    onClick={() => onSelectVariant(variant.id)}
                    className={`flex cursor-pointer flex-col justify-between rounded-2xl p-6 transition ${
                      isSelected ? 'gx-card-accent' : 'gx-card hover:border-white/20'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1 font-mono text-xs font-semibold text-zinc-200">
                          {variant.format}
                        </span>
                        {variant.badge && (
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                              variant.available
                                ? 'bg-fuchsia-500/20 text-fuchsia-200 ring-1 ring-fuchsia-500/40'
                                : 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/35'
                            }`}
                          >
                            {variant.badge}
                          </span>
                        )}
                      </div>

                      <h3 className="mt-4 font-[var(--font-display)] text-xl font-bold text-white">
                        {variant.label}
                      </h3>
                      <p className="mt-1 font-mono text-xs text-zinc-400">
                        {variant.arch}
                        {variant.sizeBytes ? ` • ${formatBytes(variant.sizeBytes)}` : ''}
                      </p>
                      <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                        {variant.description}
                      </p>
                    </div>

                    <div className="mt-6">
                      <div className="mb-3 truncate rounded-lg border border-white/[0.06] bg-black/35 px-3 py-1.5 font-mono text-[11px] text-zinc-400">
                        {variant.fileName}
                      </div>

                      {variant.available ? (
                        <a
                          href={variant.downloadUrl}
                          target={variant.id === 'macos-source' ? '_blank' : undefined}
                          rel={variant.id === 'macos-source' ? 'noopener noreferrer' : undefined}
                          onClick={() =>
                            trackDownloadClick({
                              platform: variant.platform,
                              variant: variant.id,
                              version: release.version,
                              fileName: variant.fileName
                            })
                          }
                          className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] ${
                            variant.recommended
                              ? 'gx-btn-primary text-white'
                              : 'border border-white/15 bg-white/[0.06] text-white hover:border-fuchsia-400/50 hover:bg-fuchsia-500/15'
                          }`}
                        >
                          {variant.id === 'macos-source' ? (
                            <>
                              <ExternalLink className="h-4 w-4" />
                              <span>Open Repository</span>
                            </>
                          ) : (
                            <>
                              <Download className="h-4 w-4" />
                              <span>Download {variant.shortLabel}</span>
                            </>
                          )}
                        </a>
                      ) : (
                        <a
                          href={release.releaseUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-200 transition hover:bg-amber-500/20"
                        >
                          <ExternalLink className="h-4 w-4" />
                          <span>Track macOS Release</span>
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Platform-Specific Helpful Note */}
            {selectedPlatform === 'windows' && (
              <div className="mx-auto mt-6 flex max-w-4xl items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-500/[0.06] p-4 text-xs leading-relaxed text-zinc-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <p>
                  <strong className="text-amber-200">Windows SmartScreen Note:</strong> Because nextGx Browser is an independent open-source release without a paid commercial code-signing certificate yet, Windows may display <em>"Windows protected your PC"</em> on first launch. Click <strong className="text-white">More info → Run anyway</strong>, or verify the binary hash against <a href={release.sha256Url} target="_blank" rel="noopener noreferrer" className="text-fuchsia-300 underline underline-offset-2 hover:text-fuchsia-200">SHA256SUMS.txt</a> before running.
                </p>
              </div>
            )}

            {selectedPlatform === 'linux' && (
              <div className="mx-auto mt-6 flex max-w-4xl items-start gap-3 rounded-2xl border border-violet-400/20 bg-violet-500/[0.07] p-4 text-xs leading-relaxed text-zinc-300">
                <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
                <p>
                  <strong className="text-violet-200">Quick Linux Tip:</strong> For AppImage, run{' '}
                  <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-fuchsia-200">
                    chmod +x nextGx-Browser-{release.version}-x86_64.AppImage
                  </code>{' '}
                  and launch. For Debian/Ubuntu, install cleanly via{' '}
                  <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-fuchsia-200">
                    sudo apt install ./nextGx-Browser-{release.version}-amd64.deb
                  </code>
                  .
                </p>
              </div>
            )}

            {selectedPlatform === 'macos' && (
              <div className="mx-auto mt-6 max-w-4xl rounded-2xl border border-fuchsia-400/25 bg-[#120c1c] p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-fuchsia-200">
                    <Terminal className="h-4 w-4 text-fuchsia-400" />
                    <span>Run natively on macOS right now (Node.js 20+)</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyMacCmd}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.05] px-2.5 py-1 text-xs font-medium text-zinc-200 transition hover:border-fuchsia-400/50 hover:text-white"
                  >
                    {copiedCmd ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="text-emerald-300">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy command</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="mt-3 overflow-x-auto rounded-xl border border-white/[0.07] bg-black/60 p-3 font-mono text-xs text-zinc-200">
                  <code>{MACOS_BUILD_CMD}</code>
                </pre>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Checksum & Release Transparency Bar */}
        <div className="gx-card mx-auto mt-8 flex max-w-4xl flex-col items-center justify-between gap-4 rounded-2xl px-6 py-4 sm:flex-row">
          <div className="flex items-center gap-3 text-center sm:text-left">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30">
              <FileCheck2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white">Cryptographic Integrity Verification</div>
              <div className="text-xs text-zinc-400">
                Verify every installer offline using official GitHub Actions SHA-256 checksums.
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <a
              href={release.sha256Url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/35 bg-emerald-500/12 px-3.5 py-2 font-mono text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
            >
              SHA256SUMS.txt
            </a>
            <a
              href={release.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-zinc-200 transition hover:border-white/25 hover:text-white"
            >
              <span>Release Notes</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
