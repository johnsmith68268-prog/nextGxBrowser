import { Github, Heart } from 'lucide-react';
import { REPO_URL, type ReleaseInfo } from '../data/releases';

interface FooterProps {
  release: ReleaseInfo;
}

export function Footer({ release }: FooterProps) {
  return (
    <footer className="border-t border-white/[0.08] bg-[#06050a] py-12">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 sm:flex-row sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <img
            src="./assets/logo.png"
            alt="nextGx Browser"
            className="h-8 w-8 rounded-lg object-contain"
          />
          <div>
            <div className="font-[var(--font-display)] text-sm font-bold text-white">
              next<span className="text-fuchsia-400">Gx</span> Browser{' '}
              <span className="font-mono text-xs font-normal text-zinc-500">v{release.version}</span>
            </div>
            <p className="flex items-center gap-1 text-xs text-zinc-500">
              <span>Built with</span>
              <Heart className="h-3 w-3 fill-fuchsia-500 text-fuchsia-500" />
              <span>by Marjan • Open-Source MIT License</span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-5 text-xs font-medium text-zinc-400">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 transition hover:text-white"
          >
            <Github className="h-3.5 w-3.5" />
            <span>Source Code</span>
          </a>
          <a
            href={release.releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="transition hover:text-white"
          >
            Releases
          </a>
          <a
            href={`${REPO_URL}/issues`}
            target="_blank"
            rel="noopener noreferrer"
            className="transition hover:text-white"
          >
            Report Issue
          </a>
          <a
            href={release.sha256Url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono transition hover:text-fuchsia-300"
          >
            SHA256SUMS.txt
          </a>
        </div>
      </div>
    </footer>
  );
}
