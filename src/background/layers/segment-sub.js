// Redirects /stitched-ad/ segments to a silent blank .ts file.

const SEGMENT_URL_PATTERNS = TTV_CONFIG.hls.segmentUrlPatterns.slice();
const AD_SEGMENT_RE = new RegExp(TTV_CONFIG.hls.adSegmentUrlPattern, 'i');

const SegmentSub = {
  _blankSegmentUrl: null,

  init() {
    this._blankSegmentUrl = chrome.runtime.getURL('assets/blank.ts');

    chrome.webRequest.onBeforeRequest.addListener(
      this._onBeforeRequest.bind(this),
      { urls: SEGMENT_URL_PATTERNS },
      ['blocking']
    );

    console.log('[TTV] Segment substitution initialized — stitched-ad redirect active');
  },

  _onBeforeRequest(details) {
    if (!Orchestrator._enabled) return;
    if (AD_SEGMENT_RE.test(details.url)) {
      Badge.recordBlock('segment');
      return { redirectUrl: this._blankSegmentUrl };
    }
  },
};
