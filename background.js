'use strict';

const CONTEXT_MENU_ID = 'open-safari-favorites';
const OPEN_FAVORITES_COMMAND = 'open-safari-favorites';

async function showFavoritesInTab(tabId) {
  if (!Number.isInteger(tabId)) return;
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

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== OPEN_FAVORITES_COMMAND) return;
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  await showFavoritesInTab(tab?.id);
});
