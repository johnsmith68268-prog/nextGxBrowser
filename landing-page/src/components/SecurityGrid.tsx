import { motion } from 'framer-motion';
import {
  Cpu,
  EyeOff,
  KeyRound,
  Lock,
  PanelLeft,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';
import { SECURITY_PILLARS, SIDEBAR_APPS, type SecurityPillar } from '../data/features';

const ICON_MAP: Record<SecurityPillar['iconName'], typeof ShieldCheck> = {
  shield: ShieldCheck,
  lock: Lock,
  cpu: Cpu,
  key: KeyRound,
  eyeOff: EyeOff,
  refresh: RefreshCw
};

export function SecurityGrid() {
  return (
    <section id="security" className="relative py-24 sm:py-32">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-fuchsia-500/30 to-transparent" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-3xl text-center"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-300 uppercase">
            <ShieldCheck className="h-3.5 w-3.5" />
            Security & Architecture
          </span>
          <h2 className="mt-4 font-[var(--font-display)] text-3xl font-bold tracking-tight text-white sm:text-5xl">
            Audited, hardened & <span className="gx-gradient-text">built to trust.</span>
          </h2>
          <p className="mt-4 text-base text-zinc-400 sm:text-lg">
            Engineered with defense-in-depth across every process — verified by 168 automated security and regression tests.
          </p>
        </motion.div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SECURITY_PILLARS.map((pillar, idx) => {
            const Icon = ICON_MAP[pillar.iconName];
            return (
              <motion.div
                key={pillar.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.45, delay: idx * 0.05 }}
                className="gx-card group rounded-2xl p-6 transition hover:border-fuchsia-500/35"
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/12 text-fuchsia-300 transition group-hover:scale-105 group-hover:border-fuchsia-400/60">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 font-mono text-[10px] font-medium text-zinc-400">
                    {pillar.tag}
                  </span>
                </div>
                <h3 className="mt-5 font-[var(--font-display)] text-lg font-semibold text-white">
                  {pillar.title}
                </h3>
                <p className="mt-2.5 text-sm leading-relaxed text-zinc-400">
                  {pillar.description}
                </p>
              </motion.div>
            );
          })}
        </div>

        {/* Built-in Sidebar Dock Strip */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5 }}
          className="gx-card mt-12 rounded-2xl p-6 sm:p-8"
        >
          <div className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-fuchsia-300 uppercase">
                <PanelLeft className="h-4 w-4" />
                <span>Integrated Sidebar Dock</span>
              </div>
              <h3 className="mt-2 font-[var(--font-display)] text-xl font-bold text-white sm:text-2xl">
                Music, AI & Messengers always one click away.
              </h3>
              <p className="mt-1.5 text-sm text-zinc-400">
                Pin or float your daily apps in a resizable side drawer — idle sidebar views suspend automatically to save memory.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {SIDEBAR_APPS.map((app) => (
                <span
                  key={app.name}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-xs font-medium text-zinc-200"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: app.accent, boxShadow: `0 0 10px ${app.accent}` }}
                  />
                  {app.name}
                </span>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
