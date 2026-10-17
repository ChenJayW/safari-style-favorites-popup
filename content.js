(() => {
  'use strict';

  const INSTANCE_KEY = '__safariStyleFavoritesOverlay';
  const MESSAGE_SOURCE = 'safari-style-favorites-popup';
  const previousInstance = globalThis[INSTANCE_KEY];

  if (previousInstance?.show) {
    previousInstance.show();
    return;
  }

  let host = null;
  let iframe = null;
  let messageHandler = null;
  let keyHandler = null;
  let visibilityHandler = null;
  let closeFallbackTimer = null;

  function close() {
    if (!host) return;
    clearTimeout(closeFallbackTimer);
    closeFallbackTimer = null;
    window.removeEventListener('message', messageHandler);
    document.removeEventListener('keydown', keyHandler, true);
    document.removeEventListener('visibilitychange', visibilityHandler);
    host.remove();
    host = null;
    iframe = null;
  }

  function requestClose() {
    if (!iframe?.contentWindow) {
      close();
      return;
    }
    iframe.contentWindow.postMessage({source: MESSAGE_SOURCE, type: 'request-close'}, '*');
    clearTimeout(closeFallbackTimer);
    closeFallbackTimer = setTimeout(close, 1500);
  }

  function show() {
    if (host?.isConnected) {
      iframe?.focus();
      return;
    }

    host = document.createElement('div');
    host.setAttribute('data-safari-favorites-overlay', '');
    const shadow = host.attachShadow({mode: 'closed'});

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: grid;
        place-items: center;
        box-sizing: border-box;
        padding: 16px;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      *, *::before, *::after { box-sizing: border-box; }
      .backdrop {
        position: absolute;
        inset: 0;
        background: rgba(24, 31, 49, .32);
        backdrop-filter: blur(10px) saturate(.92);
        -webkit-backdrop-filter: blur(10px) saturate(.92);
        animation: safari-favorites-fade-in .18s ease-out;
      }
      .dialog {
        position: relative;
        width: min(800px, calc(100vw - 32px));
        height: min(590px, calc(100vh - 32px));
        overflow: hidden;
        border: 0;
        border-radius: 24px;
        background: #f2f5fb;
        box-shadow: 0 34px 100px rgba(14, 23, 47, .34), 0 8px 28px rgba(14, 23, 47, .18);
        animation: safari-favorites-dialog-in .22s cubic-bezier(.2, .8, .2, 1);
      }
      iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: #f2f5fb;
      }
      .loading {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        background: #f2f5fb;
        color: #73819b;
        font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
        transition: opacity .16s ease;
        pointer-events: none;
      }
      .loading.hidden { opacity: 0; }
      @keyframes safari-favorites-fade-in { from { opacity: 0; } }
      @keyframes safari-favorites-dialog-in {
        from { opacity: 0; transform: translateY(10px) scale(.975); }
      }
      @media (max-width: 520px), (max-height: 480px) {
        :host { padding: 8px; }
        .dialog {
          width: calc(100vw - 16px);
          height: calc(100vh - 16px);
          border-radius: 18px;
        }
      }
      @media (prefers-color-scheme: dark) {
        .dialog, iframe, .loading { background: #11182a; }
        .loading { color: #abb6d0; }
      }
      @media (prefers-reduced-motion: reduce) {
        .backdrop, .dialog { animation: none; }
      }
    `;

    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    const dialog = document.createElement('section');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Safari 风格收藏夹');

    iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL('popup.html?embedded=1');
    iframe.title = 'Safari 风格收藏夹';
    iframe.referrerPolicy = 'no-referrer';

    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.textContent = '正在打开收藏夹…';

    iframe.addEventListener('load', () => {
      loading.classList.add('hidden');
      iframe.focus();
    }, {once: true});
    backdrop.addEventListener('click', requestClose);
    host.addEventListener('wheel', (event) => event.preventDefault(), {passive: false});
    host.addEventListener('touchmove', (event) => event.preventDefault(), {passive: false});

    messageHandler = (event) => {
      if (event.source !== iframe?.contentWindow || event.data?.source !== MESSAGE_SOURCE) return;
      if (event.data.type === 'close') close();
    };
    keyHandler = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        requestClose();
      }
    };
    visibilityHandler = () => {
      if (document.visibilityState === 'hidden') requestClose();
    };
    window.addEventListener('message', messageHandler);
    document.addEventListener('keydown', keyHandler, true);
    document.addEventListener('visibilitychange', visibilityHandler);

    dialog.append(iframe, loading);
    shadow.append(style, backdrop, dialog);
    document.documentElement.append(host);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.source !== MESSAGE_SOURCE || message.type !== 'show') return;
    show();
    sendResponse({handled: true});
  });

  globalThis[INSTANCE_KEY] = {show, close: requestClose};
  show();
})();
