import { useEffect, useState } from 'react';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { FeatureShowcase } from './components/FeatureShowcase';
import { SecurityGrid } from './components/SecurityGrid';
import { ScreenshotGallery } from './components/ScreenshotGallery';
import { DownloadCenter } from './components/DownloadCenter';
import { Footer } from './components/Footer';
import { Lightbox, type LightboxPayload } from './components/Lightbox';
import { GALLERY_ITEMS } from './data/features';
import {
  buildFallbackRelease,
  detectUserPlatform,
  fetchLatestRelease,
  type PlatformId,
  type ReleaseInfo
} from './data/releases';

export function App() {
  const [release, setRelease] = useState<ReleaseInfo>(() => buildFallbackRelease());
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformId>(() => detectUserPlatform());
  const [selectedVariantByPlatform, setSelectedVariantByPlatform] = useState<Record<PlatformId, string>>({
    windows: 'win-setup',
    linux: 'linux-appimage',
    macos: 'macos-dmg'
  });
  const [lightboxItem, setLightboxItem] = useState<LightboxPayload | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchLatestRelease(controller.signal).then((live) => {
      setRelease(live);
    });
    return () => controller.abort();
  }, []);

  const selectedVariantId = selectedVariantByPlatform[selectedPlatform];

  const handleSelectVariant = (variantId: string) => {
    setSelectedVariantByPlatform((prev) => ({
      ...prev,
      [selectedPlatform]: variantId
    }));
  };

  const handleJumpDownload = () => {
    const el = document.getElementById('downloads');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  const handleOpenLightbox = (image: string, title: string, caption: string) => {
    setLightboxItem({ image, title, caption });
  };

  const galleryIdx = lightboxItem
    ? GALLERY_ITEMS.findIndex((g) => g.image === lightboxItem.image)
    : -1;

  const handleLightboxPrev =
    galleryIdx >= 0
      ? () => {
          const prev = GALLERY_ITEMS[(galleryIdx - 1 + GALLERY_ITEMS.length) % GALLERY_ITEMS.length];
          setLightboxItem({ image: prev.image, title: prev.title, caption: prev.caption });
        }
      : undefined;

  const handleLightboxNext =
    galleryIdx >= 0
      ? () => {
          const next = GALLERY_ITEMS[(galleryIdx + 1) % GALLERY_ITEMS.length];
          setLightboxItem({ image: next.image, title: next.title, caption: next.caption });
        }
      : undefined;

  return (
    <div className="gx-grid-bg min-h-screen bg-[#07060b] text-zinc-100">
      <Navbar version={release.version} onJumpDownload={handleJumpDownload} />

      <main>
        <Hero
          release={release}
          selectedPlatform={selectedPlatform}
          selectedVariantId={selectedVariantId}
          onSelectPlatform={setSelectedPlatform}
          onSelectVariant={handleSelectVariant}
          onOpenLightbox={handleOpenLightbox}
        />

        <FeatureShowcase onOpenLightbox={handleOpenLightbox} />

        <SecurityGrid />

        <ScreenshotGallery onOpenLightbox={handleOpenLightbox} />

        <DownloadCenter
          release={release}
          selectedPlatform={selectedPlatform}
          selectedVariantId={selectedVariantId}
          onSelectPlatform={setSelectedPlatform}
          onSelectVariant={handleSelectVariant}
        />
      </main>

      <Footer release={release} />

      <Lightbox
        item={lightboxItem}
        onClose={() => setLightboxItem(null)}
        onPrev={handleLightboxPrev}
        onNext={handleLightboxNext}
      />
    </div>
  );
}

export default App;
