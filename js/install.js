/**
 * Quartz Family — installation PWA (beforeinstallprompt).
 */

let deferredPrompt = null;
let initialized = false;
let installed = false;

export function initInstallPrompt() {
  if (initialized) return;
  initialized = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    window.dispatchEvent(new CustomEvent('quartz:install'));
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    window.dispatchEvent(new CustomEvent('quartz:install'));
  });
}

export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

export function canInstall() {
  return Boolean(deferredPrompt) && !isStandalone() && !installed;
}

/**
 * Ouvre l'invite d'installation native.
 * @returns {Promise<'accepted'|'dismissed'|'unavailable'>}
 */
export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  const prompt = deferredPrompt;
  deferredPrompt = null;

  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    window.dispatchEvent(new CustomEvent('quartz:install'));
    return choice && choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'unavailable';
  }
}
