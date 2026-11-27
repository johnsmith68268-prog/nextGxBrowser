import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

export interface LightboxPayload {
  image: string;
  title: string;
  caption: string;
}

interface LightboxProps {
  item: LightboxPayload | null;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

export function Lightbox({ item, onClose, onPrev, onNext }: LightboxProps) {
  useEffect(() => {
    if (!item) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && onPrev) onPrev();
      else if (e.key === 'ArrowRight' && onNext) onNext();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [item, onClose, onPrev, onNext]);

  return (
    <AnimatePresence>
      {item && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-xl sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label={item.title}
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0c0814] shadow-2xl"
          >
            {/* Header Bar */}
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
              <div>
                <h3 className="font-[var(--font-display)] text-sm font-bold text-white sm:text-base">
                  {item.title}
                </h3>
                <p className="text-xs text-zinc-400">{item.caption}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close preview"
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:border-fuchsia-400/50 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Image Container */}
            <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black p-2 sm:p-4">
              {onPrev && (
                <button
                  type="button"
                  onClick={onPrev}
                  aria-label="Previous screenshot"
                  className="absolute left-4 z-10 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/75 text-white backdrop-blur-md transition hover:border-fuchsia-400/60 hover:bg-fuchsia-500/20"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              )}

              <img
                src={item.image}
                alt={item.title}
                className="max-h-[75vh] w-auto rounded-lg object-contain shadow-2xl"
              />

              {onNext && (
                <button
                  type="button"
                  onClick={onNext}
                  aria-label="Next screenshot"
                  className="absolute right-4 z-10 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/75 text-white backdrop-blur-md transition hover:border-fuchsia-400/60 hover:bg-fuchsia-500/20"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
