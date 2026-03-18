
(function () {
  function createElement(tagName, className, textContent) {
    var element = document.createElement(tagName);
    if (className) element.className = className;
    if (textContent !== undefined && textContent !== null) element.textContent = textContent;
    return element;
  }

  function createStatusRow(label, value, valueClass) {
    var row = createElement("div", "status-row");
    row.appendChild(createElement("span", "status-label", label));
    row.appendChild(createElement("span", "status-value" + (valueClass ? " " + valueClass : ""), value));
    return row;
  }

  function render(data) {
    var content = document.getElementById("content");
    if (!content) return;
    content.textContent = "";

    if (!data.channel) {
      content.appendChild(createElement("div", "no-channel", "Navigate to a Twitch stream to see status"));
    } else {
      var statusText;
      var statusClass;
      if (data.enabled === false) {
        statusText = "Disabled";
        statusClass = "status-disabled";
      } else if (data.adActive) {
        statusText = "Blocking Ads";
        statusClass = "status-blocking";
      } else {
        statusText = "Enabled";
        statusClass = "status-enabled";
      }

      var statusCard = createElement("div", "status-card");
      statusCard.appendChild(createStatusRow("Channel", data.channel));
      statusCard.appendChild(createStatusRow("Status", statusText, statusClass));
      content.appendChild(statusCard);
    }

    var toggleRow = createElement("div", "toggle-row");
    toggleRow.appendChild(createElement("span", "toggle-label", "Ad Blocking"));

    var toggleLabel = createElement("label", "toggle");
    var toggleInput = createElement("input");
    toggleInput.type = "checkbox";
    toggleInput.id = "toggleEnabled";
    toggleInput.setAttribute("aria-label", "Toggle ad blocking");
    toggleInput.checked = data.enabled !== false;
    toggleInput.addEventListener("change", function () {
      chrome.runtime.sendMessage({ type: "SET_ENABLED", enabled: toggleInput.checked });
    });

    toggleLabel.appendChild(toggleInput);
    toggleLabel.appendChild(createElement("span", "toggle-slider"));
    toggleRow.appendChild(toggleLabel);
    content.appendChild(toggleRow);
  }

  function refreshState() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || !tabs[0]) return;
      chrome.runtime.sendMessage({ type: "GET_POPUP_STATE", tabId: tabs[0].id }, function (response) {
        render(response || { channel: null });
      });
    });
  }

  document.getElementById("openSettings").addEventListener("click", function () {
    chrome.runtime.openOptionsPage();
  });

  document.querySelector(".version").textContent = "v" + chrome.runtime.getManifest().version;

  refreshState();

  setInterval(function () {
    refreshState();
  }, 2000);
})();
