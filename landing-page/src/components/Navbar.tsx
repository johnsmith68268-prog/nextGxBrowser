import { motion } from 'framer-motion';
import { Download, Github } from 'lucide-react';
import { REPO_URL } from '../data/releases';

interface NavbarProps {
  version: string;
  onJumpDownload: () => void;
}

export function Navbar({ version, onJumpDownload }: NavbarProps) {
  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="fixed top-0 inset-x-0 z-40 border-b border-white/[0.07] bg-[#07060b]/80 backdrop-blur-xl"
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <a href="#top" className="group flex items-center gap-3">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.04] ring-1 ring-fuchsia-500/30 transition group-hover:ring-fuchsia-400/70">
            <img
              src="./assets/logo.png"
              alt="nextGx Browser"
              className="h-7 w-7 rounded-lg object-contain"
            />
          </div>
          <div className="flex items-center gap-2.5">
            <span className="font-[var(--font-display)] text-lg font-bold tracking-tight text-white">
              next<span className="text-fuchsia-400">Gx</span>
            </span>
            <span className="hidden items-center rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-2.5 py-0.5 font-mono text-[11px] font-medium text-fuchsia-300 sm:inline-flex">
              v{version}
            </span>
          </div>
        </a>

        <nav className="hidden items-center gap-7 text-sm font-medium text-zinc-400 md:flex">
          <a href="#features" className="transition hover:text-white">
            Features
          </a>
          <a href="#security" className="transition hover:text-white">
            Security
          </a>
          <a href="#gallery" className="transition hover:text-white">
            Screenshots
          </a>
          <a href="#downloads" className="transition hover:text-white">
            Downloads
          </a>
        </nav>

        <div className="flex items-center gap-2.5">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-xs font-medium text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-white"
          >
            <Github className="h-4 w-4" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
          <button
            type="button"
            onClick={onJumpDownload}
            className="gx-btn-primary inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3.5 text-xs font-semibold text-white transition active:scale-[0.98]"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Download</span>
          </button>
        </div>
      </div>
    </motion.header>
  );
}
