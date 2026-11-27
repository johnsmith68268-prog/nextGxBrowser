import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Expand, Layers } from 'lucide-react';
import { FEATURE_SHOWCASE } from '../data/features';

interface FeatureShowcaseProps {
  onOpenLightbox: (image: string, title: string, caption: string) => void;
}

export function FeatureShowcase({ onOpenLightbox }: FeatureShowcaseProps) {
  const [activeId, setActiveId] = useState<string>(FEATURE_SHOWCASE[0].id);
  const current = FEATURE_SHOWCASE.find((f) => f.id === activeId) || FEATURE_SHOWCASE[0];

  return (
    <section id="features" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-3xl text-center"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1 text-xs font-semibold tracking-wide text-fuchsia-300 uppercase">
            <Layers className="h-3.5 w-3.5" />
            Inside nextGx Browser
          </span>
          <h2 className="mt-4 font-[var(--font-display)] text-3xl font-bold tracking-tight text-white sm:text-5xl">
            Every feature engineered for <span className="gx-gradient-text">zero friction.</span>
          </h2>
          <p className="mt-4 text-base text-zinc-400 sm:text-lg">
            Explore real screenshots captured directly from nextGx Browser — no mockups, no vaporware.
          </p>
        </motion.div>

        {/* Feature Selector Pill Bar */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
          {FEATURE_SHOWCASE.map((item) => {
            const active = item.id === current.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveId(item.id)}
                className={`relative cursor-pointer rounded-xl px-4 py-2 text-xs font-semibold transition sm:text-sm ${
                  active
                    ? 'text-white'
                    : 'border border-white/[0.07] bg-white/[0.02] text-zinc-400 hover:border-white/15 hover:text-zinc-200'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="feature-tab-pill"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-0 rounded-xl border border-fuchsia-500/50 bg-gradient-to-r from-fuchsia-500/25 via-pink-500/20 to-violet-500/25 shadow-[0_0_24px_-6px_rgba(236,72,153,0.55)]"
                  />
                )}
                <span className="relative z-10">{item.tabLabel}</span>
              </button>
            );
          })}
        </div>

        {/* Animated Interactive Showcase Panel */}
        <div className="gx-card mt-8 overflow-hidden rounded-3xl p-5 sm:p-8 lg:p-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="grid items-center gap-8 lg:grid-cols-12"
            >
              {/* Left Copy */}
              <div className="lg:col-span-5">
                <span className="inline-block rounded-md border border-fuchsia-400/30 bg-fuchsia-500/10 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-wider text-fuchsia-300 uppercase">
                  {current.badge}
                </span>
                <h3 className="mt-4 font-[var(--font-display)] text-2xl font-bold tracking-tight text-white sm:text-3xl">
                  {current.title}
                </h3>
                <p className="mt-4 text-sm leading-relaxed text-zinc-400 sm:text-base">
                  {current.description}
                </p>

                <ul className="mt-6 space-y-3">
                  {current.highlights.map((bullet) => (
                    <li key={bullet} className="flex items-start gap-3 text-sm text-zinc-200">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fuchsia-500/20 text-fuchsia-300 ring-1 ring-fuchsia-500/40">
                        <Check className="h-3 w-3" />
                      </span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  onClick={() => onOpenLightbox(current.image, current.tabLabel, current.description)}
                  className="mt-7 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/12 bg-white/[0.04] px-4 py-2.5 text-xs font-semibold text-zinc-200 transition hover:border-fuchsia-400/50 hover:bg-fuchsia-500/10 hover:text-white"
                >
                  <Expand className="h-3.5 w-3.5 text-fuchsia-400" />
                  <span>Open Full-Resolution View</span>
                </button>
              </div>

              {/* Right Screenshot Frame */}
              <div className="lg:col-span-7">
                <div
                  onClick={() => onOpenLightbox(current.image, current.tabLabel, current.description)}
                  className="gx-browser-frame group relative cursor-zoom-in overflow-hidden"
                >
                  <div className="overflow-hidden rounded-[15px] bg-[#09070f]">
                    <img
                      src={current.image}
                      alt={current.title}
                      loading="lazy"
                      className="block w-full object-cover transition duration-500 group-hover:scale-[1.015]"
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
