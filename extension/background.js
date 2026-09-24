chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "filter-product",
      title: "Filter this product",
      contexts: ["page", "link"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "filter-product" || !tab?.id) return;
  const link = info.linkUrl && /^https?:/i.test(info.linkUrl) ? info.linkUrl : "";
  await chrome.storage.session.set({
    pending: {
      tabId: tab.id,
      url: link || tab.url || "",
      navigate: Boolean(link && link !== tab.url),
      at: Date.now(),
    },
  });
  await chrome.sidePanel.open({ tabId: tab.id });
  chrome.runtime.sendMessage({ type: "FILTER_PENDING" }).catch(() => {});
});
