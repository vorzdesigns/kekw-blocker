
(function () {
  function render(data) {
    var content = document.getElementById("content");

    if (!data.channel) {
      content.innerHTML = '<div class="no-channel">Navigate to a Twitch stream to see status</div>';
      return;
    }

    var statusText, statusClass;
    if (data.enabled === false) {
      statusText = "Disabled"; statusClass = "status-disabled";
    } else if (data.adActive) {
      statusText = "Blocking Ads"; statusClass = "status-blocking";
    } else {
      statusText = "Enabled"; statusClass = "status-enabled";
    }

    var html = '<div class="status-card">' +
      '<div class="status-row">' +
        '<span class="status-label">Channel</span>' +
        '<span class="status-value">' + escapeHtml(data.channel) + '</span>' +
      '</div>' +
      '<div class="status-row">' +
        '<span class="status-label">Status</span>' +
        '<span class="status-value ' + statusClass + '">' + statusText + '</span>' +
      '</div>' +
    '</div>';

    html += '<div class="toggle-row">' +
      '<span class="toggle-label">Ad Blocking</span>' +
      '<label class="toggle"><input type="checkbox" id="toggleEnabled" aria-label="Toggle ad blocking" ' + (data.enabled !== false ? 'checked' : '') + '><span class="toggle-slider"></span></label>' +
    '</div>';

    content.innerHTML = html;

    var toggle = document.getElementById("toggleEnabled");
    if (toggle) {
      toggle.addEventListener("change", function () {
        chrome.runtime.sendMessage({ type: "SET_ENABLED", enabled: toggle.checked });
      });
    }
  }

  document.getElementById("openSettings").addEventListener("click", function () {
    chrome.runtime.openOptionsPage();
  });

  document.querySelector(".version").textContent = "v" + chrome.runtime.getManifest().version;

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs || !tabs[0]) return;
    chrome.runtime.sendMessage({ type: "GET_POPUP_STATE", tabId: tabs[0].id }, function (response) {
      if (response) {
        render(response);
      } else {
        render({ channel: null });
      }
    });
  });

  // Auto-refresh every 2s while popup is open
  setInterval(function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || !tabs[0]) return;
      chrome.runtime.sendMessage({ type: "GET_POPUP_STATE", tabId: tabs[0].id }, function (response) {
        if (response) render(response);
      });
    });
  }, 2000);
})();
