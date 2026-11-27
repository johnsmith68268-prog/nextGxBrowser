import { motion } from 'framer-motion';
import { Camera, Expand } from 'lucide-react';
import { GALLERY_ITEMS } from '../data/features';

interface ScreenshotGalleryProps {
  onOpenLightbox: (image: string, title: string, caption: string) => void;
}

export function ScreenshotGallery({ onOpenLightbox }: ScreenshotGalleryProps) {
  return (
    <section id="gallery" className="relative py-24 sm:py-32">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-500/30 to-transparent" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-3xl text-center"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1 text-xs font-semibold tracking-wide text-violet-300 uppercase">
            <Camera className="h-3.5 w-3.5" />
            Real Product Gallery
          </span>
          <h2 className="mt-4 font-[var(--font-display)] text-3xl font-bold tracking-tight text-white sm:text-5xl">
            See every corner of <span className="gx-gradient-text">nextGx.</span>
          </h2>
          <p className="mt-4 text-base text-zinc-400 sm:text-lg">
            Click any capture to inspect full-resolution UI details in the interactive viewer.
          </p>
        </motion.div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {GALLERY_ITEMS.map((item, idx) => (
            <motion.button
              key={item.id}
              type="button"
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ duration: 0.4, delay: (idx % 4) * 0.05 }}
              onClick={() => onOpenLightbox(item.image, item.title, item.caption)}
              className="gx-card group flex cursor-pointer flex-col overflow-hidden rounded-2xl text-left transition hover:-translate-y-1 hover:border-fuchsia-500/40"
            >
              <div className="relative aspect-video w-full overflow-hidden bg-black">
                <img
                  src={item.image}
                  alt={item.title}
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-60 transition group-hover:opacity-80" />
                <span className="absolute top-2.5 left-2.5 rounded-md border border-white/15 bg-black/65 px-2 py-0.5 font-mono text-[10px] font-medium text-fuchsia-200 backdrop-blur-md">
                  {item.category}
                </span>
                <span className="absolute right-2.5 bottom-2.5 flex h-7 w-7 items-center justify-center rounded-lg border border-white/15 bg-black/70 text-white opacity-0 backdrop-blur-md transition group-hover:opacity-100">
                  <Expand className="h-3.5 w-3.5 text-fuchsia-300" />
                </span>
              </div>
              <div className="flex flex-1 flex-col p-4">
                <h3 className="font-[var(--font-display)] text-sm font-semibold text-white">
                  {item.title}
                </h3>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-400">
                  {item.caption}
                </p>
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    </section>
  );
}
