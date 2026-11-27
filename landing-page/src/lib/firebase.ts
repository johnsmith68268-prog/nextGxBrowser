import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAnalytics, isSupported, logEvent, type Analytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: 'AIzaSyD5ovetqJjxdzopygq7JK8RWn-1kAopl0U',
  authDomain: 'nextgx-browser.firebaseapp.com',
  projectId: 'nextgx-browser',
  storageBucket: 'nextgx-browser.firebasestorage.app',
  messagingSenderId: '75808028545',
  appId: '1:75808028545:web:6ff02f898adb121efdda80',
  measurementId: 'G-JJHVM8QF6S'
};

export const firebaseApp: FirebaseApp = initializeApp(firebaseConfig);

let analyticsInstance: Analytics | null = null;

export const analyticsReady: Promise<Analytics | null> = isSupported()
  .then((supported) => {
    if (!supported) return null;
    analyticsInstance = getAnalytics(firebaseApp);
    return analyticsInstance;
  })
  .catch(() => null);

export function trackDownloadClick(params: {
  platform: string;
  variant: string;
  version: string;
  fileName: string;
}) {
  const send = (instance: Analytics | null) => {
    if (!instance) return;
    try {
      logEvent(instance, 'download_click', params);
    } catch {
      // Ignore analytics transport errors (e.g. strict ad-blockers)
    }
  };
  if (analyticsInstance) {
    send(analyticsInstance);
  } else {
    void analyticsReady.then(send);
  }
}
