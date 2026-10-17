'use strict';

const CONTEXT_MENU_ID = 'open-safari-favorites';
const OPEN_FAVORITES_COMMAND = 'open-safari-favorites';
const MESSAGE_SOURCE = 'safari-style-favorites-popup';

async function showFavoritesInTab(tabId) {
  if (!Number.isInteger(tabId)) return;

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      source: MESSAGE_SOURCE,
      type: 'show'
    });
    if (response?.handled) return;
  } catch {
    // No content script is present on the first opening.
  }

  try {
    await chrome.scripting.executeScript({
      target: {tabId},
      files: ['content.js']
    });
  } catch (error) {
    console.warn('无法在当前网页打开收藏夹', error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: '打开 Safari 风格收藏夹',
      contexts: ['all'],
      documentUrlPatterns: ['http://*/*', 'https://*/*']
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !Number.isInteger(tab?.id)) return;

  showFavoritesInTab(tab.id);
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== OPEN_FAVORITES_COMMAND) return;
  if (Number.isInteger(tab?.id)) {
    await showFavoritesInTab(tab.id);
    return;
  }

  const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
  await showFavoritesInTab(activeTab?.id);
});
