/**
 * Hongkong Post Postcard Postage Calculator — Main Application Logic
 * Follows Google Material Design 1 (m1.material.io) interactions, palette & motion
 */

(function () {
  'use strict';

  const STORAGE_KEY_STATE = 'hkpost_postcard_calc_v1';
  const STORAGE_KEY_LANG = 'hkpost_postcard_lang_v1';
  const STORAGE_KEY_THEME = 'hkpost_postcard_theme_v2'; // v2 defaults to Pillar Box Crimson
  const STORAGE_KEY_SCHEME = 'hkpost_postcard_scheme_v1'; // 'auto' | 'light' | 'dark'
  const STORAGE_KEY_OPERATOR = 'hkpost_postcard_operator_v1'; // 'hkpost' | 'chinapost'

  // Map destinations by uppercase ISO code for O(1) lookup
  const DEST_MAP = new Map();
  window.HKPOST_DESTINATIONS.forEach(d => {
    DEST_MAP.set(d.code.toUpperCase(), d);
  });

  /**
   * Detect browser language automatically on first visit:
   * - zh-HK / zh-TW / zh-MO / zh-Hant -> 'zh-HK'
   * - zh-CN / zh-SG / zh-Hans / zh -> 'zh-CN'
   * - otherwise -> 'en'
   */
  function detectDeviceLanguage() {
    const saved = localStorage.getItem(STORAGE_KEY_LANG);
    if (saved && window.HKPOST_I18N[saved]) {
      return saved;
    }
    const langs = navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language || navigator.userLanguage || 'zh-HK'];

    for (const raw of langs) {
      if (!raw) continue;
      const lower = raw.toLowerCase();
      if (
        lower.includes('zh-hk') ||
        lower.includes('zh-tw') ||
        lower.includes('zh-mo') ||
        lower.includes('zh-hant')
      ) {
        return 'zh-HK';
      }
      if (lower.startsWith('zh')) {
        return 'zh-CN';
      }
      if (lower.startsWith('en')) {
        return 'en';
      }
    }
    return 'zh-HK';
  }

  /**
   * Resolve effective 'light' or 'dark' scheme from preference ('auto' | 'light' | 'dark')
   */
  function resolveEffectiveColorScheme(pref) {
    if (pref === 'dark' || pref === 'light') {
      return pref;
    }
    const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    return (mq && mq.matches) ? 'dark' : 'light';
  }

  const savedSchemePref = localStorage.getItem(STORAGE_KEY_SCHEME);
  const initialSchemePref = (savedSchemePref === 'light' || savedSchemePref === 'dark' || savedSchemePref === 'auto')
    ? savedSchemePref
    : 'auto';

  const savedOperator = localStorage.getItem(STORAGE_KEY_OPERATOR);
  const initialOperator = (savedOperator === 'chinapost' || savedOperator === 'hkpost')
    ? savedOperator
    : 'hkpost';

  const defaultThemeForOperator = initialOperator === 'chinapost' ? 'chinapost_green' : 'royal_crimson';

  // Application State
  const state = {
    operator: initialOperator, // 'hkpost' | 'chinapost'
    lang: detectDeviceLanguage(),
    theme: localStorage.getItem(STORAGE_KEY_THEME) || defaultThemeForOperator,
    colorSchemePref: initialSchemePref,
    effectiveScheme: resolveEffectiveColorScheme(initialSchemePref),
    defaultMode: 'air',     // 'air' | 'surface'
    weightTier: '20g',      // '20g' | '30g' (for Hongkong Post)
    cnSurfaceMode: 'surface', // 'surface' | 'sal' (for China Post international non-air)
    selectedOldStamp: 3.7,  // Default HK Post old stamp face value for top-up calculator
    items: [],              // Array of { code, airQty, surfaceQty, regQty }
    importedPcIds: [],      // Array of normalized Postcrossing IDs kept in input box (e.g. ['DE-123456', 'US-654321'])
    undoStack: [],          // History stack for Undo (stores { items, importedPcIds, inputVal })
    acMatches: [],
    acActiveIndex: 0,
    refExpanded: window.innerWidth > 880, // Collapsed by default on mobile for compact QoL
    mobileChipsExpanded: false,
    lastAddedCode: null,
    lastPulsedCode: null,
    lastGrandTotal: null
  };

  /**
   * Push current state to Undo History Stack before any list mutation
   */
  function pushUndoSnapshot() {
    const inputEl = document.getElementById('countrySearchInput');
    state.undoStack.push({
      items: state.items.map(it => ({ ...it })),
      importedPcIds: [...state.importedPcIds],
      inputVal: inputEl ? inputEl.value : ''
    });
    if (state.undoStack.length > 30) {
      state.undoStack.shift();
    }
    syncUndoButtonUI();
  }

  /**
   * Update Toolbar Undo Button enabled/disabled state
   */
  function syncUndoButtonUI() {
    const btnUndo = document.getElementById('btnUndoAction');
    if (btnUndo) {
      btnUndo.disabled = state.undoStack.length === 0;
    }
  }

  /**
   * Perform Undo (restores items, imported Postcrossing IDs, and search box text)
   */
  function performUndo() {
    if (state.undoStack.length === 0) return;
    const prev = state.undoStack.pop();
    state.items = prev.items.map(it => ({ ...it }));
    state.importedPcIds = [...(prev.importedPcIds || [])];
    state.lastAddedCode = null;
    state.lastPulsedCode = null;
    setSearchInputValue(prev.inputVal || '');
    saveState();
    renderAll();
    syncUndoButtonUI();
    showSnackbar(t().restoredToast);
  }

  /**
   * Helper to set search input value and sync MD1 floating label & clear button
   */
  function setSearchInputValue(val) {
    const input = document.getElementById('countrySearchInput');
    const tf = document.getElementById('searchTextField');
    const clearBtn = document.getElementById('btnClearSearch');
    const menu = document.getElementById('autocompleteMenu');
    if (input) input.value = val;
    if (tf) tf.classList.toggle('has-value', Boolean(val && val.length > 0));
    if (clearBtn) clearBtn.style.display = (val && val.length > 0) ? 'inline-flex' : 'none';
    if (menu) menu.classList.remove('is-open');
    state.acMatches = [];
  }

  /**
   * Load shared URL parameters (?op=hkpost&w=20g&m=air&sal=surface&list=DE:2.1.0,US:1.0.0)
   * or persisted destination list, or initialize with helpful Postcrossing sample
   */
  function loadInitialState() {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlOp = params.get('op');
      const urlList = params.get('list');
      if (urlOp === 'hkpost' || urlOp === 'chinapost') {
        state.operator = urlOp;
        localStorage.setItem(STORAGE_KEY_OPERATOR, urlOp);
        if (!localStorage.getItem(STORAGE_KEY_THEME)) {
          state.theme = urlOp === 'chinapost' ? 'chinapost_green' : 'royal_crimson';
        }
      }
      const urlWeight = params.get('w');
      if (urlWeight === '20g' || urlWeight === '30g') {
        state.weightTier = urlWeight;
      }
      const urlMode = params.get('m');
      if (urlMode === 'air' || urlMode === 'surface') {
        state.defaultMode = urlMode;
      }
      const urlSal = params.get('sal');
      if (urlSal === 'sal' || urlSal === 'surface') {
        state.cnSurfaceMode = urlSal;
      }
      if (urlList !== null) {
        const parsedItems = [];
        const entries = urlList.split(',').filter(Boolean);
        for (const entry of entries) {
          const [rawCode, rawNums] = entry.split(':');
          if (!rawCode) continue;
          const code = rawCode.trim().toUpperCase();
          if (!DEST_MAP.has(code)) continue;
          const nums = (rawNums || '1.0.0').split('.').map(n => Math.max(0, parseInt(n, 10) || 0));
          const airQty = nums[0] !== undefined ? nums[0] : 1;
          const surfaceQty = nums[1] !== undefined ? nums[1] : 0;
          const regQty = Math.min(airQty + surfaceQty, nums[2] !== undefined ? nums[2] : 0);
          const existing = parsedItems.find(it => it.code === code);
          if (existing) {
            existing.airQty += airQty;
            existing.surfaceQty += surfaceQty;
            existing.regQty = Math.min(existing.airQty + existing.surfaceQty, existing.regQty + regQty);
          } else {
            parsedItems.push({ code, airQty, surfaceQty, regQty });
          }
        }
        if (parsedItems.length > 0) {
          state.items = parsedItems;
          saveState();
          setTimeout(() => showSnackbar(t().loadedShareToast), 250);
          return;
        }
      }
    } catch (e) {
      // Ignore URL parse errors
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY_STATE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items)) {
          state.items = parsed.items.filter(it => DEST_MAP.has(it.code));
          if (parsed.defaultMode === 'air' || parsed.defaultMode === 'surface') {
            state.defaultMode = parsed.defaultMode;
          }
          if (parsed.weightTier === '20g' || parsed.weightTier === '30g') {
            state.weightTier = parsed.weightTier;
          }
          if (parsed.cnSurfaceMode === 'surface' || parsed.cnSurfaceMode === 'sal') {
            state.cnSurfaceMode = parsed.cnSurfaceMode;
          }
          if (Array.isArray(parsed.importedPcIds)) {
            state.importedPcIds = parsed.importedPcIds;
          }
          return;
        }
      }
    } catch (e) {
      // Ignore storage errors
    }

    // Default starter destinations for Postcrossing demonstration
    state.items = [
      { code: 'DE', airQty: 2, surfaceQty: 1, regQty: 0 },
      { code: 'US', airQty: 1, surfaceQty: 0, regQty: 0 },
      { code: 'JP', airQty: 1, surfaceQty: 1, regQty: 1 },
      { code: 'TW', airQty: 1, surfaceQty: 0, regQty: 0 }
    ];
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify({
        defaultMode: state.defaultMode,
        weightTier: state.weightTier,
        cnSurfaceMode: state.cnSurfaceMode,
        importedPcIds: state.importedPcIds,
        items: state.items
      }));
    } catch (e) {
      // Ignore storage errors
    }
  }

  /**
   * Generate and copy shareable calculation URL
   */
  function shareCalculationUrl() {
    const dict = t();
    const params = new URLSearchParams();
    params.set('op', state.operator);
    if (state.operator === 'hkpost') {
      params.set('w', state.weightTier);
    } else {
      params.set('sal', state.cnSurfaceMode);
    }
    params.set('m', state.defaultMode);
    if (state.items.length > 0) {
      const listStr = state.items
        .map(it => `${it.code}:${it.airQty}.${it.surfaceQty}.${it.regQty}`)
        .join(',');
      params.set('list', listStr);
    }
    const shareUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    try {
      window.history.replaceState(null, '', `?${params.toString()}`);
    } catch (e) {
      // Ignore history API restrictions on file://
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareUrl).then(() => {
        showSnackbar(dict.sharedToast);
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = shareUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showSnackbar(dict.sharedToast);
    }
  }

  /**
   * Get current translation dictionary
   */
  function t() {
    return window.HKPOST_I18N[state.lang] || window.HKPOST_I18N['zh-HK'];
  }

  /**
   * Get active currency prefix (e.g. 'HK$' vs '¥' / 'CN¥') and compact symbol ('$' vs '¥')
   */
  function curSym() {
    const dict = t();
    return state.operator === 'chinapost' ? (dict.currencySymbolCN || '¥') : (dict.currencySymbolHK || 'HK$');
  }

  function curShort() {
    return state.operator === 'chinapost' ? '¥' : '$';
  }

  /**
   * Format currency number to 1 decimal place (e.g. 5.7, 15.5, 0.8, 5.0)
   */
  function fmtHKD(num) {
    const val = Number(num) || 0;
    return val.toFixed(1);
  }

  /**
   * Smoothly animate the Grand Total number counter (MD1 Deceleration Curve)
   */
  let totalAnimFrame = null;
  function updateGrandTotalWithAnimation(targetVal) {
    const el = document.getElementById('grandTotalAmount');
    const wrap = document.getElementById('grandTotalValueWrap');
    if (!el) return;

    if (state.lastGrandTotal === null || Math.abs(state.lastGrandTotal - targetVal) < 0.01) {
      el.textContent = fmtHKD(targetVal);
      state.lastGrandTotal = targetVal;
      return;
    }

    const startVal = state.lastGrandTotal;
    state.lastGrandTotal = targetVal;
    const duration = 240;
    const startTime = performance.now();

    if (wrap) {
      wrap.classList.add('is-popping');
      setTimeout(() => wrap.classList.remove('is-popping'), 220);
    }

    if (totalAnimFrame) cancelAnimationFrame(totalAnimFrame);

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      // Cubic-bezier(0, 0, 0.2, 1) approximation (easeOutCubic)
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = startVal + (targetVal - startVal) * eased;
      el.textContent = fmtHKD(current);
      if (progress < 1) {
        totalAnimFrame = requestAnimationFrame(step);
      } else {
        el.textContent = fmtHKD(targetVal);
      }
    }

    totalAnimFrame = requestAnimationFrame(step);
  }

  /**
   * Get Air Mail, Surface/SAL Mail, and Registration unit rates for a destination
   * under a specified postal operator ('hkpost' | 'chinapost')
   */
  function getRatesForDestinationByOperator(dest, operator) {
    if (operator === 'chinapost') {
      const cp = window.CHINAPOST_RATES;
      if (dest.code === 'CN') {
        return {
          airRate: cp.domestic.air,
          surfaceRate: cp.domestic.surface,
          regRate: cp.domestic.reg
        };
      }
      if (dest.code === 'HK' || dest.code === 'MO' || dest.code === 'TW') {
        return {
          airRate: cp.hkmotw.air,
          surfaceRate: cp.hkmotw.surface,
          regRate: cp.hkmotw.reg
        };
      }
      const intlSurface = state.cnSurfaceMode === 'sal' ? cp.international.sal : cp.international.surface;
      return {
        airRate: cp.international.air,
        surfaceRate: intlSurface,
        regRate: cp.international.reg
      };
    }

    const tierRates = window.HKPOST_RATES.weightTiers[state.weightTier];
    const airRate = dest.airZone ? tierRates.air[dest.airZone] : null;
    const surfaceRate = dest.surfaceZone ? tierRates.surface[dest.surfaceZone] : null;
    const regRate = window.HKPOST_RATES.registrationFee;
    return { airRate, surfaceRate, regRate };
  }

  /**
   * Get Air Mail, Surface/SAL Mail, and Registration unit rates for a destination
   * Automatically adapts to Master Switch ('hkpost' vs 'chinapost')
   */
  function getRatesForDestination(dest) {
    return getRatesForDestinationByOperator(dest, state.operator);
  }

  /**
   * Check whether Air Mail is available for a destination under the current operator
   */
  function canDestinationAir(dest) {
    return getRatesForDestination(dest).airRate !== null;
  }

  /**
   * Get localized zone display string for a destination
   */
  function getZoneLabel(dest, shortForMobile = false) {
    const dict = t();
    const mapObj = shortForMobile ? dict.zoneShort : dict.zoneNames;

    if (state.operator === 'chinapost') {
      if (dest.code === 'CN') {
        return `${mapObj.CN_DOMESTIC} · ${dict.noAirServiceCN}`;
      }
      if (dest.code === 'HK' || dest.code === 'MO' || dest.code === 'TW') {
        return mapObj.CN_HKMOTW;
      }
      return mapObj.CN_INTL;
    }

    if (dest.surfaceZone === 'LOCAL') {
      return mapObj.LOCAL;
    }
    if (dest.code === 'MO') {
      return `${dict.zoneShort.CN_MO_TW} · ${dict.noAirService}`;
    }
    if (dest.airZone === 'CN_TW') {
      return mapObj.CN_TW;
    }
    if (dest.airZone === null && dest.surfaceZone) {
      return `${mapObj[dest.surfaceZone]} · ${dict.noAirService}`;
    }
    return mapObj[dest.airZone] || dest.airZone;
  }

  /**
   * Search destinations by ISO code, localized name, or alias
   */
  function searchDestinations(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];

    const exactCodeMatches = [];
    const prefixMatches = [];
    const substringMatches = [];

    for (const dest of window.HKPOST_DESTINATIONS) {
      const codeLower = dest.code.toLowerCase();
      const nameSC = dest.names['zh-CN'].toLowerCase();
      const nameTC = dest.names['zh-HK'].toLowerCase();
      const nameEN = dest.names['en'].toLowerCase();
      const aliasesLower = dest.aliases.map(a => a.toLowerCase());

      if (codeLower === q || aliasesLower.includes(q) || nameSC === q || nameTC === q || nameEN === q) {
        exactCodeMatches.push(dest);
      } else if (
        codeLower.startsWith(q) ||
        nameSC.startsWith(q) ||
        nameTC.startsWith(q) ||
        nameEN.startsWith(q) ||
        aliasesLower.some(a => a.startsWith(q))
      ) {
        prefixMatches.push(dest);
      } else if (
        nameSC.includes(q) ||
        nameTC.includes(q) ||
        nameEN.includes(q) ||
        aliasesLower.some(a => a.includes(q))
      ) {
        substringMatches.push(dest);
      }
    }

    return [...exactCodeMatches, ...prefixMatches, ...substringMatches].slice(0, 12);
  }

  /**
   * Add or increment a destination in state.items
   */
  function addOrIncrementDestination(code, count = 1, explicitMode = null) {
    const dest = DEST_MAP.get(code.toUpperCase());
    if (!dest) return false;

    pushUndoSnapshot();

    const qtyToAdd = Math.max(1, parseInt(count, 10) || 1);
    const desiredMode = explicitMode || state.defaultMode;
    const canAir = canDestinationAir(dest);
    const actualMode = (desiredMode === 'air' && canAir) ? 'air' : 'surface';

    const existing = state.items.find(it => it.code === dest.code);
    if (existing) {
      if (actualMode === 'air') {
        existing.airQty += qtyToAdd;
      } else {
        existing.surfaceQty += qtyToAdd;
      }
      state.lastPulsedCode = dest.code;
      state.lastAddedCode = null;
    } else {
      state.items.push({
        code: dest.code,
        airQty: actualMode === 'air' ? qtyToAdd : 0,
        surfaceQty: actualMode === 'surface' ? qtyToAdd : 0,
        regQty: 0
      });
      state.lastAddedCode = dest.code;
      state.lastPulsedCode = null;
    }

    const dict = t();
    if (desiredMode === 'air' && !canAir) {
      const noAirMsg = (state.operator === 'chinapost' && dest.code === 'CN') ? dict.noAirTooltipCN : dict.noAirToast;
      showSnackbar(`${dest.flag} ${dest.names[state.lang]}: ${noAirMsg}`, dict.undoBtn, performUndo);
    } else {
      showSnackbar(`${dict.addedToast} ${dest.flag} ${dest.names[state.lang]} (+${qtyToAdd})`, dict.undoBtn, performUndo);
    }

    saveState();
    renderAll();
    return true;
  }

  /**
   * Decrement 1 card for a destination code (used when user deletes a Postcrossing ID from the input box)
   */
  function decrementDestinationCard(code) {
    const idx = state.items.findIndex(it => it.code === code);
    if (idx === -1) return;
    const item = state.items[idx];
    if (state.defaultMode === 'air' && item.airQty > 0) {
      item.airQty -= 1;
    } else if (item.surfaceQty > 0) {
      item.surfaceQty -= 1;
    } else if (item.airQty > 0) {
      item.airQty -= 1;
    }
    const newTotal = item.airQty + item.surfaceQty;
    if (item.regQty > newTotal) {
      item.regQty = newTotal;
    }
    if (newTotal <= 0) {
      state.items.splice(idx, 1);
    }
  }

  /**
   * Extract normalized Postcrossing IDs (e.g. ["DE-1234567", "US-8901234"]) from any string
   */
  function extractNormalizedPcIds(rawText) {
    if (!rawText) return [];
    const pcRegex = /\b([A-Za-z]{2})\s*[-–—]\s*(\d{3,10})\b/g;
    const result = [];
    let match;
    while ((match = pcRegex.exec(rawText)) !== null) {
      const rawIso = match[1].toUpperCase();
      const numPart = match[2];
      let lookupIso = rawIso;
      if (lookupIso === 'UK') lookupIso = 'GB';
      if (lookupIso === 'EL') lookupIso = 'GR';
      if (DEST_MAP.has(lookupIso)) {
        result.push({
          displayId: `${rawIso}-${numPart}`,
          code: lookupIso
        });
      }
    }
    return result;
  }

  /**
   * Sync & Import Postcrossing IDs while keeping them in the input box separated by spaces!
   * Supports adding new IDs, pasting additional IDs, or deleting an ID from the box.
   */
  function syncPostcrossingIdsFromText(fullInputText) {
    const extracted = extractNormalizedPcIds(fullInputText);
    if (extracted.length === 0 && state.importedPcIds.length === 0) {
      return false;
    }

    // Deduplicate by displayId while preserving order
    const seen = new Set();
    const currentEntries = [];
    for (const entry of extracted) {
      if (!seen.has(entry.displayId)) {
        seen.add(entry.displayId);
        currentEntries.push(entry);
      }
    }

    const prevSet = new Set(state.importedPcIds);
    const nextIds = currentEntries.map(e => e.displayId);
    const nextSet = new Set(nextIds);

    const addedEntries = currentEntries.filter(e => !prevSet.has(e.displayId));
    const removedIds = state.importedPcIds.filter(id => !nextSet.has(id));

    // Format input box with space-separated Postcrossing IDs and keep them in the input box!
    const formattedBoxStr = nextIds.length > 0 ? `${nextIds.join(' ')} ` : '';

    if (addedEntries.length === 0 && removedIds.length === 0) {
      if (nextIds.length > 0) {
        setSearchInputValue(formattedBoxStr);
        return true;
      }
      return false;
    }

    pushUndoSnapshot();

    // Apply added Postcrossing IDs
    for (const entry of addedEntries) {
      const dest = DEST_MAP.get(entry.code);
      if (!dest) continue;
      const canAir = canDestinationAir(dest);
      const actualMode = (state.defaultMode === 'air' && canAir) ? 'air' : 'surface';
      const existing = state.items.find(it => it.code === dest.code);
      if (existing) {
        if (actualMode === 'air') existing.airQty += 1;
        else existing.surfaceQty += 1;
        state.lastPulsedCode = dest.code;
      } else {
        state.items.push({
          code: dest.code,
          airQty: actualMode === 'air' ? 1 : 0,
          surfaceQty: actualMode === 'surface' ? 1 : 0,
          regQty: 0
        });
        state.lastAddedCode = dest.code;
      }
    }

    // Apply removed Postcrossing IDs (if user deleted an ID from the box)
    for (const remId of removedIds) {
      let rawIso = remId.split('-')[0].toUpperCase();
      if (rawIso === 'UK') rawIso = 'GB';
      if (rawIso === 'EL') rawIso = 'GR';
      decrementDestinationCard(rawIso);
    }

    state.importedPcIds = nextIds;
    setSearchInputValue(formattedBoxStr);
    saveState();
    renderAll();

    const dict = t();
    if (addedEntries.length > 0) {
      const previewIds = addedEntries.slice(0, 3).map(e => e.displayId).join(' ');
      const moreSuffix = addedEntries.length > 3 ? ` (+${addedEntries.length} ${dict.unitCard})` : ` (+${addedEntries.length} ${dict.unitCard})`;
      showSnackbar(`${dict.batchImportToast}${previewIds}${moreSuffix}`, dict.undoBtn, performUndo);
    } else if (removedIds.length > 0) {
      showSnackbar(`${dict.pcIdRemovedToast}${removedIds.join(' ')}`, dict.undoBtn, performUndo);
    }

    return true;
  }

  /**
   * Parse single, Postcrossing ID batch, or country batch input string
   */
  function handleSearchSubmit(rawInput) {
    const trimmed = (rawInput || '').trim();
    if (!trimmed) {
      // If user cleared the box that previously had imported Postcrossing IDs and pressed Enter
      if (state.importedPcIds.length > 0) {
        return syncPostcrossingIdsFromText('');
      }
      return false;
    }

    // 0. Smart Postcrossing ID recognition (keeps IDs in the box separated by spaces!)
    const hasPcIdPattern = /\b([A-Za-z]{2})\s*[-–—]\s*(\d{3,10})\b/.test(trimmed);
    if (hasPcIdPattern || state.importedPcIds.length > 0) {
      // Check if user also typed a non-ID country token after existing Postcrossing IDs
      const strippedOfPcIds = trimmed.replace(/\b([A-Za-z]{2})\s*[-–—]\s*(\d{3,10})\b/g, '').trim();
      const synced = syncPostcrossingIdsFromText(trimmed);
      if (!strippedOfPcIds) {
        return synced;
      }
      // If there's a trailing non-ID token (e.g. user typed "DE-123456 JP"), also process "JP"
      // while keeping the Postcrossing IDs in the input box!
      const extraMatches = searchDestinations(strippedOfPcIds);
      if (extraMatches.length > 0) {
        addOrIncrementDestination(extraMatches[0].code, 1);
        const formattedBoxStr = state.importedPcIds.length > 0 ? `${state.importedPcIds.join(' ')} ` : '';
        setSearchInputValue(formattedBoxStr);
        return true;
      }
      return synced;
    }

    // 1. Single destination + optional quantity like "德国 3" or "DE*3"
    const singleWithQtyMatch = trimmed.match(/^(.+?)[*\s×xX:：]+(\d+)$/);
    if (singleWithQtyMatch) {
      const namePart = singleWithQtyMatch[1].trim();
      const qtyPart = parseInt(singleWithQtyMatch[2], 10);
      const matches = searchDestinations(namePart);
      if (matches.length > 0 && qtyPart > 0) {
        addOrIncrementDestination(matches[0].code, qtyPart);
        clearSearchInput();
        return true;
      }
    }

    // 2. Space/comma separated batch like "DE US JP TW" or "DE*2, US, JP*3"
    const tokens = trimmed.split(/[,，;；\s]+/).filter(Boolean);
    if (tokens.length > 1) {
      let addedCount = 0;
      let pushedSnapshot = false;
      for (const token of tokens) {
        const subMatch = token.match(/^([a-zA-Z\u4e00-\u9fa5]+)(?:[*×xX:：](\d+))?$/);
        const queryPart = subMatch ? subMatch[1] : token;
        const qtyPart = (subMatch && subMatch[2]) ? parseInt(subMatch[2], 10) : 1;
        const found = searchDestinations(queryPart);
        if (found.length > 0) {
          if (!pushedSnapshot) {
            pushUndoSnapshot();
            pushedSnapshot = true;
          }
          const dest = found[0];
          const canAir = canDestinationAir(dest);
          const actualMode = (state.defaultMode === 'air' && canAir) ? 'air' : 'surface';
          const existing = state.items.find(it => it.code === dest.code);
          if (existing) {
            if (actualMode === 'air') existing.airQty += qtyPart;
            else existing.surfaceQty += qtyPart;
            state.lastPulsedCode = dest.code;
          } else {
            state.items.push({
              code: dest.code,
              airQty: actualMode === 'air' ? qtyPart : 0,
              surfaceQty: actualMode === 'surface' ? qtyPart : 0,
              regQty: 0
            });
            state.lastAddedCode = dest.code;
          }
          addedCount++;
        }
      }
      if (addedCount > 0) {
        saveState();
        renderAll();
        clearSearchInput();
        const dict = t();
        showSnackbar(`${dict.addedToast} ${addedCount} ${dict.totalDestinationsUnit}`, dict.undoBtn, performUndo);
        return true;
      }
    }

    // 3. Highlighted autocomplete item or top search match
    if (state.acMatches.length > 0) {
      const chosen = state.acMatches[state.acActiveIndex] || state.acMatches[0];
      addOrIncrementDestination(chosen.code, 1);
      clearSearchInput();
      return true;
    }

    const fallbackMatches = searchDestinations(trimmed);
    if (fallbackMatches.length > 0) {
      addOrIncrementDestination(fallbackMatches[0].code, 1);
      clearSearchInput();
      return true;
    }

    return false;
  }

  /**
   * Update row quantities while keeping Total = Air + Surface consistent
   */
  function updateRowQty(code, field, newValue) {
    const item = state.items.find(it => it.code === code);
    const dest = DEST_MAP.get(code);
    if (!item || !dest) return;

    const val = Math.max(0, parseInt(newValue, 10) || 0);
    const canAir = canDestinationAir(dest);

    if ((field === 'air' || field === 'switch_all_air') && !canAir) {
      const noAirMsg = (state.operator === 'chinapost' && dest.code === 'CN') ? t().noAirTooltipCN : t().noAirToast;
      showSnackbar(`${dest.flag} ${dest.names[state.lang]}: ${noAirMsg}`);
      return;
    }

    pushUndoSnapshot();

    state.lastAddedCode = null;
    state.lastPulsedCode = null;

    if (field === 'total') {
      const currentTotal = item.airQty + item.surfaceQty;
      const diff = val - currentTotal;
      if (diff > 0) {
        if (state.defaultMode === 'air' && canAir) {
          item.airQty += diff;
        } else {
          item.surfaceQty += diff;
        }
      } else if (diff < 0) {
        let toRemove = -diff;
        if (state.defaultMode === 'air') {
          const remSurface = Math.min(item.surfaceQty, toRemove);
          item.surfaceQty -= remSurface;
          toRemove -= remSurface;
          item.airQty = Math.max(0, item.airQty - toRemove);
        } else {
          const remAir = Math.min(item.airQty, toRemove);
          item.airQty -= remAir;
          toRemove -= remAir;
          item.surfaceQty = Math.max(0, item.surfaceQty - toRemove);
        }
      }
    } else if (field === 'air') {
      item.airQty = val;
    } else if (field === 'surface') {
      item.surfaceQty = val;
    } else if (field === 'reg') {
      const totalCards = item.airQty + item.surfaceQty;
      if (totalCards > 0 && val > totalCards) {
        item.regQty = totalCards;
      } else {
        item.regQty = val;
      }
    } else if (field === 'switch_all_air') {
      const total = item.airQty + item.surfaceQty;
      item.airQty = total;
      item.surfaceQty = 0;
      state.lastPulsedCode = code;
    } else if (field === 'switch_all_surface') {
      const total = item.airQty + item.surfaceQty;
      item.surfaceQty = total;
      item.airQty = 0;
      state.lastPulsedCode = code;
    } else if (field === 'toggle_all_reg') {
      const total = item.airQty + item.surfaceQty;
      item.regQty = item.regQty === total ? 0 : total;
      state.lastPulsedCode = code;
    }

    // Clamp regQty if total cards dropped below regQty
    const newTotal = item.airQty + item.surfaceQty;
    if (item.regQty > newTotal) {
      item.regQty = newTotal;
    }

    saveState();
    renderAll();
  }

  /**
   * Remove row with MD1 acceleration exit animation + Undo Snackbar
   */
  function removeRow(code) {
    const dest = DEST_MAP.get(code);
    const dict = t();
    const removedLabel = dest ? `${dict.removedToast} ${dest.flag} ${dest.names[state.lang]}` : dict.removedToast;

    const finalizeRemoval = () => {
      pushUndoSnapshot();
      state.items = state.items.filter(it => it.code !== code);
      state.importedPcIds = state.importedPcIds.filter(id => {
        let iso = id.split('-')[0].toUpperCase();
        if (iso === 'UK') iso = 'GB';
        if (iso === 'EL') iso = 'GR';
        return iso !== code;
      });
      if (state.importedPcIds.length > 0) {
        setSearchInputValue(`${state.importedPcIds.join(' ')} `);
      }
      state.lastAddedCode = null;
      state.lastPulsedCode = null;
      saveState();
      renderAll();
      showSnackbar(removedLabel, dict.undoBtn, performUndo);
    };

    const rowEl = document.querySelector(`tr[data-row-code="${code}"]`);
    if (rowEl) {
      rowEl.classList.add('row-exit-anim');
      setTimeout(finalizeRemoval, 190);
    } else {
      finalizeRemoval();
    }
  }

  /**
   * Trigger MD1 Radial Reveal + Ink Wave Transition when switching Themes or Dark/Light Mode
   */
  function runWithThemeWaveTransition(eventOrEl, waveColor, mutatorFn) {
    let x = window.innerWidth / 2;
    let y = 32;

    if (eventOrEl && typeof eventOrEl.clientX === 'number' && (eventOrEl.clientX > 0 || eventOrEl.clientY > 0)) {
      x = eventOrEl.clientX;
      y = eventOrEl.clientY;
    } else if (eventOrEl && eventOrEl.getBoundingClientRect) {
      const rect = eventOrEl.getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top + rect.height / 2;
    } else if (eventOrEl && eventOrEl.currentTarget && eventOrEl.currentTarget.getBoundingClientRect) {
      const rect = eventOrEl.currentTarget.getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top + rect.height / 2;
    }

    const maxRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    // 1. Spawn tactile MD1 Radial Ink Wave Ring
    const overlay = document.getElementById('mdThemeWaveOverlay');
    if (overlay) {
      const wave = document.createElement('div');
      wave.className = 'md-theme-wave-circle';
      const diameter = Math.ceil(maxRadius * 2.15);
      wave.style.width = `${diameter}px`;
      wave.style.height = `${diameter}px`;
      wave.style.left = `${x}px`;
      wave.style.top = `${y}px`;
      if (waveColor) {
        wave.style.setProperty('--wave-color', waveColor);
      }
      overlay.appendChild(wave);
      wave.addEventListener('animationend', () => wave.remove());
    }

    // 2. Use View Transitions API circular clip-path reveal when supported
    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (document.startViewTransition && !prefersReducedMotion) {
      const root = document.documentElement;
      root.style.setProperty('--vt-x', `${x}px`);
      root.style.setProperty('--vt-y', `${y}px`);
      root.style.setProperty('--vt-r', `${Math.ceil(maxRadius)}px`);
      root.classList.add('is-theme-transitioning');

      try {
        const vt = document.startViewTransition(() => {
          mutatorFn();
        });
        vt.finished.finally(() => {
          root.classList.remove('is-theme-transitioning');
        });
        return;
      } catch (e) {
        root.classList.remove('is-theme-transitioning');
      }
    }

    mutatorFn();
  }

  /**
   * Open & Close Dialog with Smooth MD1 Point-of-Origin Deceleration & Acceleration
   */
  function openDialogWithOrigin(backdropEl, triggerEl) {
    if (!backdropEl) return;
    const dialogEl = backdropEl.querySelector('.md-dialog');
    if (dialogEl && triggerEl && triggerEl.getBoundingClientRect) {
      const btnRect = triggerEl.getBoundingClientRect();
      const btnCenterX = btnRect.left + btnRect.width / 2;
      const btnCenterY = btnRect.top + btnRect.height / 2;
      // Compute approximate origin relative to centered dialog
      const vpCenterX = window.innerWidth / 2;
      const vpCenterY = window.innerHeight / 2;
      const offsetX = Math.round(50 + ((btnCenterX - vpCenterX) / Math.max(window.innerWidth, 320)) * 90);
      const offsetY = Math.round(50 + ((btnCenterY - vpCenterY) / Math.max(window.innerHeight, 320)) * 90);
      dialogEl.style.setProperty('--dialog-origin-x', `${Math.max(5, Math.min(95, offsetX))}%`);
      dialogEl.style.setProperty('--dialog-origin-y', `${Math.max(0, Math.min(95, offsetY))}%`);
    }
    backdropEl.classList.add('is-open');
  }

  function closeDialog(backdropEl) {
    if (!backdropEl) return;
    backdropEl.classList.remove('is-open');
  }

  /**
   * Apply Color Scheme ('auto' | 'light' | 'dark')
   */
  function applyColorScheme(pref) {
    if (pref !== 'light' && pref !== 'dark' && pref !== 'auto') {
      pref = 'auto';
    }
    state.colorSchemePref = pref;
    state.effectiveScheme = resolveEffectiveColorScheme(pref);
    localStorage.setItem(STORAGE_KEY_SCHEME, pref);
    document.documentElement.setAttribute('data-color-scheme', state.effectiveScheme);
  }

  /**
   * Update Dynamic SVG Favicon to match active Theme / Postal Operator
   */
  function updateDynamicFavicon(primaryHex, accentHex) {
    const linkEl = document.getElementById('dynamicFavicon');
    if (!linkEl) return;
    const pColor = encodeURIComponent(primaryHex || '#C62828');
    const aColor = encodeURIComponent(accentHex || '#FFB300');
    const svgUri = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='${pColor}'/%3E%3Crect x='10' y='16' width='44' height='32' rx='4' fill='%23ffffff'/%3E%3Cpath d='M10 20l22 15L54 20' fill='none' stroke='${pColor}' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Crect x='41' y='21' width='8' height='9' rx='1.5' fill='${aColor}'/%3E%3C/svg%3E`;
    linkEl.setAttribute('href', svgUri);
  }

  /**
   * Render Theme & Apply CSS Custom Properties Dynamically
   */
  function applyTheme(themeId) {
    if (!window.HKPOST_THEMES[themeId]) {
      themeId = 'royal_crimson';
    }
    state.theme = themeId;
    localStorage.setItem(STORAGE_KEY_THEME, themeId);
    document.documentElement.setAttribute('data-theme', themeId);

    const themeObj = window.HKPOST_THEMES[themeId];
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--md-primary-500', themeObj.primary500);
    rootStyle.setProperty('--md-primary-700', themeObj.primary700);
    rootStyle.setProperty('--md-primary-100', themeObj.primary100);
    rootStyle.setProperty('--md-dark-primary-text', themeObj.darkPrimaryText || themeObj.primary100);
    rootStyle.setProperty('--md-dark-badge-bg', themeObj.darkBadgeBg || 'rgba(255, 255, 255, 0.14)');
    rootStyle.setProperty('--md-accent-a200', themeObj.accentA200);
    rootStyle.setProperty('--md-accent-a700', themeObj.accentA700);

    const metaTheme = document.getElementById('metaThemeColor');
    if (metaTheme) {
      metaTheme.setAttribute('content', themeObj.primary500);
    }
    updateDynamicFavicon(themeObj.primary500, themeObj.swatchSecondary || themeObj.accentA200);

    const themeLabel = document.getElementById('currentThemeLabel');
    if (themeLabel) {
      const shortNames = themeObj.shortNames || themeObj.names;
      themeLabel.textContent = shortNames[state.lang] || shortNames['zh-HK'];
    }
  }

  /**
   * Sync Operator-Dependent Labels, Currency Symbols, Disclaimers & Official Links
   */
  function syncOperatorDynamicUI() {
    const dict = t();
    const isCN = state.operator === 'chinapost';
    const cSym = curSym();

    const activeTitle = isCN ? dict.appTitleCN : dict.appTitle;
    document.title = activeTitle;
    const appTitleEl = document.querySelector('[data-i18n="appTitle"]');
    if (appTitleEl) appTitleEl.textContent = activeTitle;

    const rateTagEl = document.querySelector('[data-i18n="rateEffectiveTag"]');
    if (rateTagEl) rateTagEl.textContent = isCN ? dict.rateEffectiveTagCN : dict.rateEffectiveTag;

    const grandCurrencyEl = document.getElementById('grandTotalCurrency');
    if (grandCurrencyEl) grandCurrencyEl.textContent = cSym;

    const mobileCurrencyEl = document.getElementById('mobileBarCurrency');
    if (mobileCurrencyEl) mobileCurrencyEl.textContent = cSym;

    const colSubtotalEl = document.querySelector('[data-i18n="colSubtotal"]');
    if (colSubtotalEl) colSubtotalEl.textContent = isCN ? dict.colSubtotalCN : dict.colSubtotal;

    const colSurfaceEl = document.querySelector('[data-i18n="colSurfaceQty"]');
    if (colSurfaceEl) {
      colSurfaceEl.textContent = (isCN && state.cnSurfaceMode === 'sal') ? dict.colSurfaceQtySAL : dict.colSurfaceQty;
    }

    const breakdownSurfaceEl = document.querySelector('[data-i18n="breakdownSurface"]');
    if (breakdownSurfaceEl) {
      breakdownSurfaceEl.textContent = (isCN && state.cnSurfaceMode === 'sal') ? dict.breakdownSurfaceSAL : dict.breakdownSurface;
    }

    // Toggle Weight Tier (Hongkong Post) vs Surface/SAL Mode (China Post)
    const weightField = document.getElementById('weightTierField');
    const cnSurfaceField = document.getElementById('cnSurfaceModeField');
    if (weightField) weightField.style.display = isCN ? 'none' : '';
    if (cnSurfaceField) cnSurfaceField.style.display = isCN ? '' : 'none';

    // Reference Card Titles, Disclaimer & Official URL
    const rateTitleEl = document.querySelector('[data-i18n="rateTableTitle"]');
    if (rateTitleEl) rateTitleEl.textContent = isCN ? dict.rateTableTitleCN : dict.rateTableTitle;

    const rateSubEl = document.querySelector('[data-i18n="rateTableSubtitle"]');
    if (rateSubEl) rateSubEl.textContent = isCN ? dict.rateTableSubtitleCN : dict.rateTableSubtitle;

    const disclaimerEl = document.querySelector('[data-i18n="rateDisclaimer"]');
    if (disclaimerEl) disclaimerEl.textContent = isCN ? dict.rateDisclaimerCN : dict.rateDisclaimer;

    const linksGroup = document.getElementById('officialLinksGroup');
    if (linksGroup) {
      if (isCN) {
        linksGroup.innerHTML = `
          <a href="https://www.chinapost.com.cn/html1/folder/19114/3697-1.htm" target="_blank" rel="noopener noreferrer" class="md-official-link">
            <span>${dict.cnIntlRatesLinkText}</span>
            <span class="material-icons" style="font-size:15px;">open_in_new</span>
          </a>
          <span class="md-links-sep" aria-hidden="true">·</span>
          <a href="https://www.chinapost.com.cn/html1/folder/19104/8916-1.htm" target="_blank" rel="noopener noreferrer" class="md-official-link">
            <span>${dict.cnHkmotwRatesLinkText}</span>
            <span class="material-icons" style="font-size:15px;">open_in_new</span>
          </a>
          <span class="md-links-sep" aria-hidden="true">·</span>
          <a href="https://www.chinapost.com.cn/html1/folder/26053/7817-1.htm" target="_blank" rel="noopener noreferrer" class="md-official-link">
            <span>${dict.cnDomesticRatesLinkText}</span>
            <span class="material-icons" style="font-size:15px;">open_in_new</span>
          </a>
        `;
      } else {
        const langSegment = state.lang === 'zh-CN' ? 'sc' : (state.lang === 'en' ? 'en' : 'tc');
        linksGroup.innerHTML = `
          <a href="https://www.hongkongpost.hk/${langSegment}/postage_calculator/index.html" target="_blank" rel="noopener noreferrer" class="md-official-link">
            <span>${dict.hkRatesLinkText}</span>
            <span class="material-icons" style="font-size:15px;">open_in_new</span>
          </a>
          <span class="md-links-sep" aria-hidden="true">·</span>
          <a href="https://www.hongkongpost.hk/${langSegment}/preparation/posting/zoning/index.html" target="_blank" rel="noopener noreferrer" class="md-official-link" id="officialZoningLink">
            <span>${dict.officialLinkText}</span>
            <span class="material-icons" style="font-size:15px;">open_in_new</span>
          </a>
        `;
      }
    }

    // Master Switch Active State & Tooltip
    const btnHK = document.getElementById('btnOperatorHK');
    const btnCN = document.getElementById('btnOperatorCN');
    const switchWrap = document.getElementById('operatorMasterSwitch');
    if (btnHK) btnHK.classList.toggle('is-active', !isCN);
    if (btnCN) btnCN.classList.toggle('is-active', isCN);
    if (switchWrap && dict.operatorSwitchTip) {
      switchWrap.title = dict.operatorSwitchTip;
    }
  }

  /**
   * Switch Origin Postal Service ('hkpost' | 'chinapost') with Automatic Default Theme Linkage
   */
  function applyOperator(nextOperator) {
    if (nextOperator !== 'hkpost' && nextOperator !== 'chinapost') {
      nextOperator = 'hkpost';
    }
    state.operator = nextOperator;
    localStorage.setItem(STORAGE_KEY_OPERATOR, nextOperator);

    // Automatic theme linkage when using default themes:
    // - Hongkong Post default -> 'royal_crimson' (Pillar Box Crimson)
    // - China Post default -> 'chinapost_green' (China Post Green)
    if (nextOperator === 'chinapost' && state.theme === 'royal_crimson') {
      applyTheme('chinapost_green');
    } else if (nextOperator === 'hkpost' && state.theme === 'chinapost_green') {
      applyTheme('royal_crimson');
    }

    state.lastGrandTotal = null; // Reset counter animation baseline on currency switch
    syncOperatorDynamicUI();
  }

  /**
   * Apply Language & Update Static i18n Nodes + Strict Font Glyphs
   */
  function applyLanguage(langCode) {
    if (!window.HKPOST_I18N[langCode]) {
      langCode = 'zh-HK';
    }
    state.lang = langCode;
    document.documentElement.setAttribute('lang', langCode);

    const dict = t();

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (dict[key]) {
        el.textContent = dict[key];
      }
    });

    // Update mobile chips expand/collapse label
    const chipsToggleText = document.getElementById('mobileChipsToggleText');
    if (chipsToggleText) {
      chipsToggleText.textContent = state.mobileChipsExpanded ? dict.collapseChips : dict.expandChips;
    }

    // Update language label in toolbar
    const langNames = {
      'zh-HK': '繁體（香港）',
      'zh-CN': '简体中文',
      'en': 'English'
    };
    const langLabel = document.getElementById('currentLangLabel');
    if (langLabel) {
      langLabel.textContent = langNames[langCode];
    }

    // Update theme button text
    const themeObj = window.HKPOST_THEMES[state.theme];
    const themeLabel = document.getElementById('currentThemeLabel');
    if (themeLabel && themeObj) {
      const shortNames = themeObj.shortNames || themeObj.names;
      themeLabel.textContent = shortNames[state.lang];
    }
    syncOperatorDynamicUI();
  }

  /**
   * Render Desktop Rate Schedule Table (Dynamically adapts to Hongkong Post vs China Post)
   */
  function renderDesktopRateSchedule() {
    const thead = document.getElementById('desktopRateTableHead');
    const tbody = document.getElementById('desktopRateTableBody');
    if (!thead || !tbody) return;

    const dict = t();
    if (state.operator === 'chinapost') {
      thead.innerHTML = `
        <tr>
          <th>${dict.rateColZone}</th>
          <th>${dict.rateColScope}</th>
          <th class="th-right">${dict.cnRateColSurface}</th>
          <th class="th-right">${dict.cnRateColSAL}</th>
          <th class="th-right">${dict.cnRateColAir}</th>
          <th class="th-right">${dict.rateColReg}</th>
        </tr>
      `;
      tbody.innerHTML = `
        <tr>
          <td><strong>${dict.zoneNames.CN_DOMESTIC}</strong></td>
          <td>${dict.cnScopeDomestic}</td>
          <td class="td-right"><strong>¥ 0.8</strong></td>
          <td class="td-right" style="color:var(--md-text-hint);">—</td>
          <td class="td-right" style="color:var(--md-text-hint);">${dict.noAirServiceCN}</td>
          <td class="td-right">+ ¥ 3.0</td>
        </tr>
        <tr>
          <td><strong>${dict.zoneNames.CN_HKMOTW}</strong></td>
          <td>${dict.cnScopeHkMoTw}</td>
          <td class="td-right"><strong>¥ 3.5</strong></td>
          <td class="td-right" style="color:var(--md-text-hint);">—</td>
          <td class="td-right"><strong>¥ 4.0</strong></td>
          <td class="td-right">+ ¥ 16.0</td>
        </tr>
        <tr>
          <td><strong>${dict.zoneNames.CN_INTL}</strong></td>
          <td>${dict.cnScopeIntl}</td>
          <td class="td-right"><strong>¥ 3.5</strong></td>
          <td class="td-right"><strong>¥ 4.5</strong></td>
          <td class="td-right"><strong>¥ 5.0</strong></td>
          <td class="td-right">+ ¥ 16.0</td>
        </tr>
      `;
      return;
    }

    thead.innerHTML = `
      <tr>
        <th>${dict.rateColZone}</th>
        <th>${dict.rateColScope}</th>
        <th class="th-right">${dict.rateColSurface20}</th>
        <th class="th-right">${dict.rateColAir20}</th>
        <th class="th-right">${dict.rateColSurface30}</th>
        <th class="th-right">${dict.rateColAir30}</th>
        <th class="th-right">${dict.rateColReg}</th>
      </tr>
    `;
    tbody.innerHTML = `
      <tr>
        <td><strong>${dict.zoneNames.LOCAL}</strong></td>
        <td>${dict.scopeLocal}</td>
        <td class="td-right"><strong>HK$ 2.4</strong></td>
        <td class="td-right" style="color:var(--md-text-hint);">—</td>
        <td class="td-right">HK$ 2.4 <span style="font-size:11px;color:var(--md-text-secondary);">(≤30g)</span></td>
        <td class="td-right" style="color:var(--md-text-hint);">—</td>
        <td class="td-right">+ HK$ 15.5</td>
      </tr>
      <tr>
        <td><strong>${dict.zoneNames.CN_MO_TW}</strong></td>
        <td>${dict.scopeCnTw}</td>
        <td class="td-right"><strong>HK$ 3.0</strong></td>
        <td class="td-right"><strong>HK$ 3.9</strong></td>
        <td class="td-right">HK$ 4.7</td>
        <td class="td-right">HK$ 6.7</td>
        <td class="td-right">+ HK$ 15.5</td>
      </tr>
      <tr>
        <td><strong>${dict.zoneNames.Z1}</strong></td>
        <td>${dict.scopeZ1}</td>
        <td class="td-right"><strong>HK$ 3.7</strong></td>
        <td class="td-right"><strong>HK$ 4.2</strong></td>
        <td class="td-right">HK$ 6.5</td>
        <td class="td-right">HK$ 6.8</td>
        <td class="td-right">+ HK$ 15.5</td>
      </tr>
      <tr>
        <td><strong>${dict.zoneNames.Z2}</strong></td>
        <td>${dict.scopeZ2}</td>
        <td class="td-right"><strong>HK$ 5.3</strong></td>
        <td class="td-right"><strong>HK$ 5.7</strong></td>
        <td class="td-right">HK$ 8.3</td>
        <td class="td-right">HK$ 8.6</td>
        <td class="td-right">+ HK$ 15.5</td>
      </tr>
      <tr>
        <td><strong>${dict.zoneNames.Z3}</strong></td>
        <td>${dict.scopeZ3}</td>
        <td class="td-right"><strong>HK$ 5.6</strong></td>
        <td class="td-right"><strong>HK$ 5.8</strong></td>
        <td class="td-right">HK$ 8.7</td>
        <td class="td-right">HK$ 8.8</td>
        <td class="td-right">+ HK$ 15.5</td>
      </tr>
    `;
  }

  /**
   * Render Mobile Rate Schedule Cards (Zero Horizontal Scroll on Mobile)
   */
  function renderMobileRateCards() {
    const container = document.getElementById('mobileRateCardsContainer');
    if (!container) return;

    const dict = t();
    const airLabel = dict.modeAir.split(' ')[0];
    const surfaceLabel = dict.modeSurface.split(' ')[0];
    const regLabel = dict.colRegQty.split(' ')[0];

    if (state.operator === 'chinapost') {
      const cnZones = [
        {
          title: dict.zoneNames.CN_DOMESTIC,
          surface: '¥0.8',
          air: dict.noAirServiceCN,
          reg: '+¥3.0',
          scope: dict.cnScopeDomestic
        },
        {
          title: dict.zoneNames.CN_HKMOTW,
          surface: '¥3.5',
          air: '¥4.0',
          reg: '+¥16.0',
          scope: dict.cnScopeHkMoTw
        },
        {
          title: dict.zoneNames.CN_INTL,
          surface: state.cnSurfaceMode === 'sal' ? '¥4.5 (SAL)' : '¥3.5',
          air: '¥5.0',
          reg: '+¥16.0',
          scope: dict.cnScopeIntl
        }
      ];

      container.innerHTML = cnZones.map(z => `
        <div class="m-rate-card">
          <div class="m-rate-card-top">
            <span class="m-rate-zone-title">${z.title}</span>
            <div class="m-rate-badges">
              <span class="m-rate-badge">${surfaceLabel} <strong>${z.surface}</strong></span>
              <span class="m-rate-badge">${airLabel} <strong>${z.air}</strong></span>
              <span class="m-rate-badge">${regLabel} <strong>${z.reg}</strong></span>
            </div>
          </div>
          <div class="m-rate-scope">${z.scope}</div>
        </div>
      `).join('');
      return;
    }

    const is20g = state.weightTier === '20g';
    const zones = [
      {
        title: dict.zoneNames.LOCAL,
        surface: '$2.4',
        air: dict.noAirService,
        scope: dict.scopeLocal
      },
      {
        title: dict.zoneNames.CN_MO_TW,
        surface: is20g ? '$3.0' : '$4.7',
        air: is20g ? '$3.9' : '$6.7',
        scope: dict.scopeCnTw
      },
      {
        title: dict.zoneNames.Z1,
        surface: is20g ? '$3.7' : '$6.5',
        air: is20g ? '$4.2' : '$6.8',
        scope: dict.scopeZ1
      },
      {
        title: dict.zoneNames.Z2,
        surface: is20g ? '$5.3' : '$8.3',
        air: is20g ? '$5.7' : '$8.6',
        scope: dict.scopeZ2
      },
      {
        title: dict.zoneNames.Z3,
        surface: is20g ? '$5.6' : '$8.7',
        air: is20g ? '$5.8' : '$8.8',
        scope: dict.scopeZ3
      }
    ];

    container.innerHTML = zones.map(z => `
      <div class="m-rate-card">
        <div class="m-rate-card-top">
          <span class="m-rate-zone-title">${z.title}</span>
          <div class="m-rate-badges">
            <span class="m-rate-badge">${surfaceLabel} <strong>${z.surface}</strong></span>
            <span class="m-rate-badge">${airLabel} <strong>${z.air}</strong></span>
            <span class="m-rate-badge">${regLabel} <strong>+$15.5</strong></span>
          </div>
        </div>
        <div class="m-rate-scope">${z.scope}</div>
      </div>
    `).join('');
  }

  /**
   * Render Popular Postcrossing Chips
   */
  function renderPopularChips() {
    const container = document.getElementById('popularChipsContainer');
    if (!container) return;

    const selectedCodes = new Set(state.items.map(it => it.code));
    const popularDests = window.HKPOST_DESTINATIONS.filter(d => d.popular);

    container.classList.toggle('is-mobile-collapsed', !state.mobileChipsExpanded);

    container.innerHTML = popularDests.map(dest => {
      const isSelected = selectedCodes.has(dest.code);
      const itemInList = state.items.find(it => it.code === dest.code);
      const totalCards = itemInList ? (itemInList.airQty + itemInList.surfaceQty) : 0;
      const badgeText = totalCards > 0 ? ` · ${totalCards}` : '';

      return `
        <button
          type="button"
          class="md-chip md-ripple-surface ${isSelected ? 'is-selected' : ''}"
          data-chip-code="${dest.code}"
          title="${dest.names[state.lang]} (${dest.code})"
        >
          <span class="flag-emoji">${dest.flag}</span>
          <span>${dest.names[state.lang]}</span>
          <span class="md-chip-code">${dest.code}${badgeText}</span>
        </button>
      `;
    }).join('');

    container.querySelectorAll('[data-chip-code]').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.getAttribute('data-chip-code');
        addOrIncrementDestination(code, 1);
      });
    });
  }

  /**
   * Render Destinations Table (Desktop) & Compact Cards (Mobile) + Calculate Totals
   */
  function renderDestinationsAndTotals() {
    const dict = t();
    const isCN = state.operator === 'chinapost';
    const cSym = curSym();
    const cShort = curShort();
    const tbody = document.getElementById('destinationsTableBody');
    const emptyBox = document.getElementById('emptyStateBox');
    const tableEl = document.getElementById('destinationsTable');

    let grandTotal = 0;
    let airTotalAmount = 0;
    let surfaceTotalAmount = 0;
    let regTotalAmount = 0;

    let totalAirCards = 0;
    let totalSurfaceCards = 0;
    let totalRegItems = 0;
    let activeDestinations = 0;

    let compareAllAir = 0;
    let compareAllSurface = 0;
    let compareAllRegAddon = 0;

    const airShortLabel = dict.modeAir.split(' ')[0];
    const surfaceShortLabel = (isCN && state.cnSurfaceMode === 'sal') ? 'SAL' : dict.modeSurface.split(' ')[0];
    const regShortLabel = dict.colRegQty.split(' ')[0];

    if (state.items.length === 0) {
      if (tbody) tbody.innerHTML = '';
      if (tableEl) tableEl.style.display = 'none';
      if (emptyBox) emptyBox.style.display = 'flex';
    } else {
      if (tableEl) tableEl.style.display = '';
      if (emptyBox) emptyBox.style.display = 'none';

      const rowsHtml = state.items.map(item => {
        const dest = DEST_MAP.get(item.code);
        if (!dest) return '';

        const { airRate, surfaceRate, regRate } = getRatesForDestination(dest);
        const canAir = airRate !== null;

        if (!canAir && item.airQty > 0) {
          item.surfaceQty += item.airQty;
          item.airQty = 0;
        }

        const rowTotalCards = item.airQty + item.surfaceQty;
        if (rowTotalCards > 0) {
          activeDestinations++;
        }

        const rowAirCost = canAir ? (item.airQty * airRate) : 0;
        const rowSurfaceCost = item.surfaceQty * surfaceRate;
        const rowRegCost = item.regQty * regRate;
        const rowSubtotal = rowAirCost + rowSurfaceCost + rowRegCost;

        grandTotal += rowSubtotal;
        airTotalAmount += rowAirCost;
        surfaceTotalAmount += rowSurfaceCost;
        regTotalAmount += rowRegCost;

        totalAirCards += item.airQty;
        totalSurfaceCards += item.surfaceQty;
        totalRegItems += item.regQty;

        const refAirForThisRow = canAir
          ? (rowTotalCards * airRate)
          : (rowTotalCards * surfaceRate);
        const refSurfaceForThisRow = rowTotalCards * surfaceRate;
        const refRegForThisRow = rowTotalCards * regRate;

        compareAllAir += refAirForThisRow;
        compareAllSurface += refSurfaceForThisRow;
        compareAllRegAddon += refRegForThisRow;

        const formulaParts = [];
        if (item.airQty > 0 && canAir) {
          formulaParts.push(`${item.airQty}×${cShort}${fmtHKD(airRate)}`);
        }
        if (item.surfaceQty > 0) {
          formulaParts.push(`${item.surfaceQty}×${cShort}${fmtHKD(surfaceRate)}`);
        }
        if (item.regQty > 0) {
          formulaParts.push(`${item.regQty}×${cShort}${fmtHKD(regRate)}`);
        }
        const formulaStr = formulaParts.length > 0 ? formulaParts.join(' + ') : `${cSym} 0.0`;

        const noAirBadgeLabel = (isCN && dest.code === 'CN') ? dict.noAirServiceCN : dict.noAirService;
        const noAirTipText = (isCN && dest.code === 'CN') ? dict.noAirTooltipCN : dict.noAirTooltip;

        // Point 4: China Post Chinese country name annotation badge for non-CN destinations
        const cnAnnotateHtml = (isCN && dest.code !== 'CN')
          ? `<span class="cn-annotate-tag" title="${dict.tipCnWriteCountry}"><span class="material-icons" style="font-size:13px;">edit_note</span><span>${dict.cnAnnotatePrefix}${dest.names['zh-CN']}${dict.cnAnnotateSuffix}</span></span>`
          : '';

        const animClass = state.lastAddedCode === dest.code
          ? 'row-enter-anim'
          : (state.lastPulsedCode === dest.code ? 'row-pulse-anim' : '');

        return `
          <tr data-row-code="${dest.code}" class="${animClass}">
            <!-- DESKTOP CELLS (> 880px) -->
            <td class="desktop-only-cell">
              <div class="dest-cell">
                <span class="flag-emoji dest-flag">${dest.flag}</span>
                <div class="dest-info">
                  <div class="dest-name-row">
                    <span class="dest-name">${dest.names[state.lang]}</span>
                    <span class="dest-iso-badge">${dest.code}</span>
                  </div>
                  <span class="dest-zone-text">${getZoneLabel(dest, false)}</span>
                  ${cnAnnotateHtml}
                </div>
              </div>
            </td>

            <td class="td-center desktop-only-cell">
              <div class="stepper-group">
                <div class="stepper-box is-highlighted">
                  <button type="button" class="stepper-btn" data-step-code="${dest.code}" data-step-field="total" data-step-delta="-1" ${rowTotalCards <= 0 ? 'disabled' : ''} aria-label="Decrease total">−</button>
                  <input type="number" min="0" max="999" class="stepper-input" value="${rowTotalCards}" data-input-code="${dest.code}" data-input-field="total" aria-label="Total postcards">
                  <button type="button" class="stepper-btn" data-step-code="${dest.code}" data-step-field="total" data-step-delta="1" aria-label="Increase total">+</button>
                </div>
                <span class="unit-rate-tag">${dict.unitCard}</span>
              </div>
            </td>

            <td class="td-center desktop-only-cell">
              ${canAir ? `
                <div class="stepper-group">
                  <div class="stepper-box">
                    <button type="button" class="stepper-btn" data-step-code="${dest.code}" data-step-field="air" data-step-delta="-1" ${item.airQty <= 0 ? 'disabled' : ''} aria-label="Decrease air mail">−</button>
                    <input type="number" min="0" max="999" class="stepper-input" value="${item.airQty}" data-input-code="${dest.code}" data-input-field="air" aria-label="Air mail postcards">
                    <button type="button" class="stepper-btn" data-step-code="${dest.code}" data-step-field="air" data-step-delta="1" aria-label="Increase air mail">+</button>
                  </div>
                  <span class="unit-rate-tag">${cSym} ${fmtHKD(airRate)}${dict.perCard}</span>
                </div>
              ` : `
                <div class="stepper-group" title="${noAirTipText}">
                  <span class="no-air-badge">
                    <span class="material-icons" style="font-size:14px;">info_outline</span>
                    <span>${noAirBadgeLabel}</span>
                  </span>
                </div>
              `}
            </td>

            <td class="td-center desktop-only-cell">
              <div class="stepper-group">
                <div class="stepper-box">
                  <button type="button" class="stepper-btn" data-step-code="${dest.code}" data-step-field="surface" data-step-delta="-1" ${item.surfaceQty <= 0 ? 'disabled' : ''} aria-label="Decrease surface mail">−</button>
                  <input type="number" min="0" max="999" class="stepper-input" value="${item.surfaceQty}" data-input-code="${dest.code}" data-input-field="surface" aria-label="Surface mail postcards">
                  <button type="button" class="stepper-btn" data-step-code="${dest.code}" data-step-field="surface" data-step-delta="1" aria-label="Increase surface mail">+</button>
                </div>
                <span class="unit-rate-tag">${cSym} ${fmtHKD(surfaceRate)}${dict.perCard}</span>
              </div>
            </td>

            <td class="td-center desktop-only-cell">
              <div class="stepper-group">
                <div class="stepper-box">
                  <button type="button" class="stepper-btn" data-step-code="${dest.code}" data-step-field="reg" data-step-delta="-1" ${item.regQty <= 0 ? 'disabled' : ''} aria-label="Decrease registered">−</button>
                  <input type="number" min="0" max="${rowTotalCards}" class="stepper-input" value="${item.regQty}" data-input-code="${dest.code}" data-input-field="reg" aria-label="Registered items">
                  <button type="button" class="stepper-btn" data-step-code="${dest.code}" data-step-field="reg" data-step-delta="1" ${item.regQty >= rowTotalCards ? 'disabled' : ''} aria-label="Increase registered">+</button>
                </div>
                <span class="unit-rate-tag">+${cSym} ${fmtHKD(regRate)}${dict.perItem}</span>
              </div>
            </td>

            <td class="desktop-only-cell">
              <div class="row-compare-list">
                <div class="row-compare-line ${canAir ? 'is-clickable' : ''}" ${canAir ? `data-quick-switch="${dest.code}" data-switch-mode="switch_all_air" title="${dict.quickSwitchTip}"` : ''}>
                  <span>${dict.refAllAir}:</span>
                  <strong>${canAir ? `${cSym} ${fmtHKD(rowTotalCards * airRate)}` : '—'}</strong>
                </div>
                <div class="row-compare-line is-clickable" data-quick-switch="${dest.code}" data-switch-mode="switch_all_surface" title="${dict.quickSwitchTip}">
                  <span>${dict.refAllSurface}:</span>
                  <strong>${cSym} ${fmtHKD(refSurfaceForThisRow)}</strong>
                </div>
                <div class="row-compare-line is-clickable" data-quick-switch="${dest.code}" data-switch-mode="toggle_all_reg" title="${dict.quickSwitchTip}">
                  <span>${dict.refAllReg}:</span>
                  <strong>+${cSym} ${fmtHKD(refRegForThisRow)}</strong>
                </div>
              </div>
            </td>

            <td class="td-right desktop-only-cell">
              <div class="row-subtotal-amount">${cSym} ${fmtHKD(rowSubtotal)}</div>
              <div class="row-subtotal-formula">${formulaStr}</div>
            </td>

            <td class="td-center desktop-only-cell">
              <button type="button" class="md-icon-btn md-ripple-surface" data-remove-code="${dest.code}" title="${dict.removeBtn}" aria-label="${dict.removeBtn}">
                <span class="material-icons">delete_outline</span>
              </button>
            </td>

            <!-- MOBILE ULTRA-COMPACT QoL CARD CELL (<= 880px) -->
            <td class="mobile-card-cell" style="display:none;">
              <div class="mobile-compact-card">
                <!-- Row 1: Country Name + Zone + Subtotal + Delete -->
                <div class="mcc-top-row">
                  <div class="mcc-dest">
                    <span class="flag-emoji mcc-flag">${dest.flag}</span>
                    <div class="mcc-title-group">
                      <div class="mcc-name-line">
                        <span class="mcc-name">${dest.names[state.lang]}</span>
                        <span class="dest-iso-badge">${dest.code}</span>
                      </div>
                      <div class="mcc-Zone">${getZoneLabel(dest, true)}</div>
                      ${cnAnnotateHtml}
                    </div>
                  </div>
                  <div class="mcc-subtotal-group">
                    <div class="mcc-subtotal-text">
                      <div class="mcc-subtotal-val">${cSym} ${fmtHKD(rowSubtotal)}</div>
                      <div class="mcc-subtotal-formula">${formulaStr}</div>
                    </div>
                    <button type="button" class="md-icon-btn md-ripple-surface" data-remove-code="${dest.code}" aria-label="${dict.removeBtn}">
                      <span class="material-icons" style="font-size:20px;">close</span>
                    </button>
                  </div>
                </div>

                <!-- Row 2: 3-Column Side-by-Side Steppers (Air / Surface / Reg) -->
                <div class="mcc-controls-grid">
                  <!-- Air Mail Column -->
                  <div class="mcc-control-box">
                    <div class="mcc-control-label">
                      <span>${airShortLabel}</span>
                      <span class="mcc-control-rate">${canAir ? `${cShort}${fmtHKD(airRate)}` : '—'}</span>
                    </div>
                    ${canAir ? `
                      <div class="mcc-stepper">
                        <button type="button" class="mcc-step-btn" data-step-code="${dest.code}" data-step-field="air" data-step-delta="-1" ${item.airQty <= 0 ? 'disabled' : ''}>−</button>
                        <span class="mcc-step-val">${item.airQty}</span>
                        <button type="button" class="mcc-step-btn" data-step-code="${dest.code}" data-step-field="air" data-step-delta="1">+</button>
                      </div>
                    ` : `
                      <span class="no-air-badge" style="font-size:11px;padding:3px 6px;">${noAirBadgeLabel}</span>
                    `}
                  </div>

                  <!-- Surface Mail Column -->
                  <div class="mcc-control-box">
                    <div class="mcc-control-label">
                      <span>${surfaceShortLabel}</span>
                      <span class="mcc-control-rate">${cShort}${fmtHKD(surfaceRate)}</span>
                    </div>
                    <div class="mcc-stepper">
                      <button type="button" class="mcc-step-btn" data-step-code="${dest.code}" data-step-field="surface" data-step-delta="-1" ${item.surfaceQty <= 0 ? 'disabled' : ''}>−</button>
                      <span class="mcc-step-val">${item.surfaceQty}</span>
                      <button type="button" class="mcc-step-btn" data-step-code="${dest.code}" data-step-field="surface" data-step-delta="1">+</button>
                    </div>
                  </div>

                  <!-- Registered Column -->
                  <div class="mcc-control-box">
                    <div class="mcc-control-label">
                      <span>${regShortLabel}</span>
                      <span class="mcc-control-rate">+${cShort}${fmtHKD(regRate)}</span>
                    </div>
                    <div class="mcc-stepper">
                      <button type="button" class="mcc-step-btn" data-step-code="${dest.code}" data-step-field="reg" data-step-delta="-1" ${item.regQty <= 0 ? 'disabled' : ''}>−</button>
                      <span class="mcc-step-val">${item.regQty}</span>
                      <button type="button" class="mcc-step-btn" data-step-code="${dest.code}" data-step-field="reg" data-step-delta="1" ${item.regQty >= rowTotalCards ? 'disabled' : ''}>+</button>
                    </div>
                  </div>
                </div>

                <!-- Row 3: Total Count Pill + 1-Tap Quick Mode Reference Pills -->
                <div class="mcc-bottom-bar">
                  <span class="mcc-total-pill">
                    ${dict.mobileTotalPrefix} ${rowTotalCards} ${dict.unitCard}
                  </span>
                  <div class="mcc-quick-refs">
                    ${canAir ? `
                      <button type="button" class="mcc-ref-chip" data-quick-switch="${dest.code}" data-switch-mode="switch_all_air">
                        ${dict.refAllAir} <strong>${cShort}${fmtHKD(rowTotalCards * airRate)}</strong>
                      </button>
                    ` : ''}
                    <button type="button" class="mcc-ref-chip" data-quick-switch="${dest.code}" data-switch-mode="switch_all_surface">
                      ${dict.refAllSurface} <strong>${cShort}${fmtHKD(refSurfaceForThisRow)}</strong>
                    </button>
                    <button type="button" class="mcc-ref-chip" data-quick-switch="${dest.code}" data-switch-mode="toggle_all_reg">
                      ${dict.refAllReg} <strong>+${cShort}${fmtHKD(refRegForThisRow)}</strong>
                    </button>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      if (tbody) {
        tbody.innerHTML = rowsHtml;

        // Bind stepper buttons
        tbody.querySelectorAll('[data-step-code]').forEach(btn => {
          btn.addEventListener('click', () => {
            const code = btn.getAttribute('data-step-code');
            const field = btn.getAttribute('data-step-field');
            const delta = parseInt(btn.getAttribute('data-step-delta'), 10);
            const item = state.items.find(it => it.code === code);
            if (!item) return;

            let currentVal = 0;
            if (field === 'total') currentVal = item.airQty + item.surfaceQty;
            else if (field === 'air') currentVal = item.airQty;
            else if (field === 'surface') currentVal = item.surfaceQty;
            else if (field === 'reg') currentVal = item.regQty;

            updateRowQty(code, field, Math.max(0, currentVal + delta));
          });
        });

        // Bind numeric inputs
        tbody.querySelectorAll('[data-input-code]').forEach(input => {
          input.addEventListener('change', () => {
            const code = input.getAttribute('data-input-code');
            const field = input.getAttribute('data-input-field');
            updateRowQty(code, field, input.value);
          });
        });

        // Bind 1-tap quick switch reference pills
        tbody.querySelectorAll('[data-quick-switch]').forEach(el => {
          el.addEventListener('click', () => {
            const code = el.getAttribute('data-quick-switch');
            const mode = el.getAttribute('data-switch-mode');
            updateRowQty(code, mode, 0);
          });
        });

        // Bind remove buttons
        tbody.querySelectorAll('[data-remove-code]').forEach(btn => {
          btn.addEventListener('click', () => {
            const code = btn.getAttribute('data-remove-code');
            removeRow(code);
          });
        });
      }
    }

    // Update Summary Card Totals with Smooth Animation
    const totalCards = totalAirCards + totalSurfaceCards;
    updateGrandTotalWithAnimation(grandTotal);

    document.getElementById('totalDestinationsCount').textContent = String(activeDestinations);
    document.getElementById('totalCardsCount').textContent = String(totalCards);
    document.getElementById('totalRegCount').textContent = String(totalRegItems);

    document.getElementById('airSubtotalAmount').textContent = `${cSym} ${fmtHKD(airTotalAmount)}`;
    document.getElementById('airSubtotalCount').textContent = `${totalAirCards} ${dict.unitCard}`;

    document.getElementById('surfaceSubtotalAmount').textContent = `${cSym} ${fmtHKD(surfaceTotalAmount)}`;
    document.getElementById('surfaceSubtotalCount').textContent = `${totalSurfaceCards} ${dict.unitCard}`;

    const regUnitDisplay = isCN ? `${cSym} 3.0 / 16.0${dict.perItem}` : `HK$ 15.5${dict.perItem}`;
    document.getElementById('regSubtotalAmount').textContent = `${cSym} ${fmtHKD(regTotalAmount)}`;
    document.getElementById('regSubtotalCount').textContent = `${totalRegItems} (${regUnitDisplay})`;

    // Update Batch Comparison Strip
    document.getElementById('compareAllAirValue').textContent = `${cSym} ${fmtHKD(compareAllAir)}`;
    document.getElementById('compareAllSurfaceValue').textContent = `${cSym} ${fmtHKD(compareAllSurface)}`;
    document.getElementById('compareAllAirRegValue').textContent = `${cSym} ${fmtHKD(compareAllAir + compareAllRegAddon)}`;
    document.getElementById('compareAllSurfaceRegValue').textContent = `${cSym} ${fmtHKD(compareAllSurface + compareAllRegAddon)}`;

    // Point 7: Cross-Operator Rate Comparison Bar (HK Post vs China Post for same batch)
    const crossBar = document.getElementById('crossOperatorCompareBar');
    if (crossBar) {
      if (totalCards <= 0 && totalRegItems <= 0) {
        crossBar.style.display = 'none';
        crossBar.innerHTML = '';
      } else {
        const otherOp = isCN ? 'hkpost' : 'chinapost';
        const otherSym = isCN ? (dict.currencySymbolHK || 'HK$') : (dict.currencySymbolCN || '¥');
        let otherTotal = 0;
        let otherAllAir = 0;
        let otherAllSurface = 0;

        state.items.forEach(item => {
          const dest = DEST_MAP.get(item.code);
          if (!dest) return;
          const { airRate: oAir, surfaceRate: oSurf, regRate: oReg } = getRatesForDestinationByOperator(dest, otherOp);
          const rowTotal = item.airQty + item.surfaceQty;
          if (oAir !== null) {
            otherTotal += (item.airQty * oAir) + (item.surfaceQty * oSurf) + (item.regQty * oReg);
            otherAllAir += rowTotal * oAir;
          } else {
            // Destination only has surface in the other operator (e.g. CN domestic in China Post, or HK/MO in HK Post)
            otherTotal += (rowTotal * oSurf) + (item.regQty * oReg);
            otherAllAir += rowTotal * oSurf;
          }
          otherAllSurface += rowTotal * oSurf;
        });

        const prefixLabel = isCN ? dict.crossCompareLabelToHK : dict.crossCompareLabelToCN;
        // Reference conversion (~1 HKD = 0.92 RMB / ~1 RMB = 1.09 HKD)
        const approxConverted = isCN ? (otherTotal * 0.92) : (otherTotal * 1.09);
        const approxStr = `${dict.crossCompareApprox} ${cSym} ${fmtHKD(approxConverted)}`;
        crossBar.style.display = 'flex';
        crossBar.innerHTML = `
          <div class="md-cross-compare-left">
            <span>${prefixLabel}</span>
            <strong>${otherSym} ${fmtHKD(otherTotal)}</strong>
            <span class="md-cross-compare-approx">(${approxStr} · ${dict.refAllAir} ${otherSym} ${fmtHKD(otherAllAir)} / ${dict.refAllSurface} ${otherSym} ${fmtHKD(otherAllSurface)})</span>
          </div>
          <button type="button" class="md-cross-switch-btn md-ripple-surface" id="btnQuickCrossSwitch">
            <span class="material-icons" style="font-size:15px;">swap_horiz</span>
            <span>${dict.crossCompareSwitchBtn}</span>
          </button>
        `;
        const btnCross = document.getElementById('btnQuickCrossSwitch');
        if (btnCross) {
          btnCross.addEventListener('click', (e) => {
            const targetOp = isCN ? 'hkpost' : 'chinapost';
            const waveColor = targetOp === 'chinapost' ? '#006837' : '#C62828';
            runWithThemeWaveTransition(e, waveColor, () => {
              applyOperator(targetOp);
              renderAll();
            });
          });
        }
      }
    }

    // Points 4 & 8: Contextual Postal Tips Strip (Par Avion, China Post Chinese Country Annotation, Registration R-Label)
    const tipsStrip = document.getElementById('postalTipsStrip');
    if (tipsStrip) {
      const tipPills = [];
      if (totalAirCards > 0) {
        const parAvionText = isCN ? dict.parAvionTipCN : dict.parAvionTipHK;
        tipPills.push(`
          <div class="md-postal-tip-row">
            <span class="par-avion-sticker"><span class="material-icons" style="font-size:13px;">flight</span>PAR AVION · 航空</span>
            <span>${parAvionText}</span>
          </div>
        `);
      }
      const hasNonCnCards = state.items.some(it => it.code !== 'CN' && (it.airQty + it.surfaceQty) > 0);
      if (isCN && hasNonCnCards) {
        tipPills.push(`
          <div class="md-postal-tip-row">
            <span class="material-icons" style="font-size:16px;color:var(--md-primary-text);">translate</span>
            <span>${dict.tipCnWriteCountry}</span>
          </div>
        `);
      }
      if (totalRegItems > 0) {
        const regTipText = isCN ? dict.regTipCN : dict.regTipHK;
        tipPills.push(`
          <div class="md-postal-tip-row">
            <span class="reg-r-sticker">R</span>
            <span>${regTipText}</span>
          </div>
        `);
      }

      if (tipPills.length > 0) {
        tipsStrip.style.display = 'flex';
        tipsStrip.innerHTML = tipPills.join('');
      } else {
        tipsStrip.style.display = 'none';
        tipsStrip.innerHTML = '';
      }
    }

    // Update Mobile Sticky Bottom Bar
    const mobileBarTotal = document.getElementById('mobileBarTotalAmount');
    const mobileBarMeta = document.getElementById('mobileBarMeta');
    if (mobileBarTotal) mobileBarTotal.textContent = fmtHKD(grandTotal);
    if (mobileBarMeta) mobileBarMeta.textContent = `(${totalCards} ${dict.unitCard})`;
  }

  /**
   * Render Autocomplete Dropdown Menu
   */
  function renderAutocomplete(query) {
    const menu = document.getElementById('autocompleteMenu');
    if (!menu) return;

    const rawStr = query || '';
    const trimmed = rawStr.trim();
    if (!trimmed || /\s$/.test(rawStr)) {
      state.acMatches = [];
      menu.classList.remove('is-open');
      menu.innerHTML = '';
      return;
    }

    const parts = trimmed.split(/[,，;；\s]+/);
    const lastToken = parts[parts.length - 1] || '';
    // If user is typing a Postcrossing ID (e.g. DE-12345), don't show country autocomplete dropdown
    if (/^[A-Za-z]{2}[-–—]\d*$/.test(lastToken)) {
      state.acMatches = [];
      menu.classList.remove('is-open');
      menu.innerHTML = '';
      return;
    }

    const activeToken = lastToken.replace(/[*×xX:：]\d+$/, '');
    const matches = searchDestinations(activeToken || trimmed);
    state.acMatches = matches;
    state.acActiveIndex = 0;

    if (matches.length === 0) {
      menu.classList.remove('is-open');
      menu.innerHTML = '';
      return;
    }

    const dict = t();
    const cShort = curShort();
    const isCN = state.operator === 'chinapost';
    const secondaryLang = state.lang === 'en' ? 'zh-HK' : 'en';

    menu.innerHTML = matches.map((dest, idx) => {
      const { airRate, surfaceRate } = getRatesForDestination(dest);
      const secondaryName = dest.names[secondaryLang];
      const noAirText = (isCN && dest.code === 'CN') ? dict.noAirServiceCN : dict.noAirService;
      const airText = airRate !== null ? `${dict.modeAir.split(' ')[0]} ${cShort}${fmtHKD(airRate)}` : noAirText;
      const surfaceText = `${dict.modeSurface.split(' ')[0]} ${cShort}${fmtHKD(surfaceRate)}`;

      return `
        <div
          class="md-autocomplete-item ${idx === state.acActiveIndex ? 'is-active' : ''}"
          data-ac-code="${dest.code}"
          role="option"
        >
          <div class="md-ac-left">
            <span class="flag-emoji md-ac-flag">${dest.flag}</span>
            <div>
              <span class="md-ac-name" lang="${state.lang}">${dest.names[state.lang]}</span>
              <span class="md-ac-subname" lang="${secondaryLang}">${secondaryName}</span>
            </div>
            <span class="md-ac-code">${dest.code}</span>
          </div>
          <div class="md-ac-right">
            <span>${airText}</span>
            <span>·</span>
            <span>${surfaceText}</span>
          </div>
        </div>
      `;
    }).join('');

    menu.classList.add('is-open');

    menu.querySelectorAll('[data-ac-code]').forEach(itemEl => {
      itemEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const code = itemEl.getAttribute('data-ac-code');
        addOrIncrementDestination(code, 1);
        clearSearchInput();
      });
    });
  }

  function clearSearchInput() {
    const input = document.getElementById('countrySearchInput');
    const tf = document.getElementById('searchTextField');
    const clearBtn = document.getElementById('btnClearSearch');
    const menu = document.getElementById('autocompleteMenu');
    if (input) input.value = '';
    if (tf) tf.classList.remove('has-value');
    if (clearBtn) clearBtn.style.display = 'none';
    if (menu) {
      menu.classList.remove('is-open');
    }
    state.acMatches = [];
  }

  /**
   * Render Segment Controls (Default Mode, Weight Step & China Post Surface/SAL Mode)
   */
  function renderSegmentedControls() {
    document.getElementById('btnDefaultAir').classList.toggle('is-active', state.defaultMode === 'air');
    document.getElementById('btnDefaultSurface').classList.toggle('is-active', state.defaultMode === 'surface');
    document.getElementById('btnWeight20g').classList.toggle('is-active', state.weightTier === '20g');
    document.getElementById('btnWeight30g').classList.toggle('is-active', state.weightTier === '30g');

    const btnCnSurface = document.getElementById('btnCnSurface');
    const btnCnSAL = document.getElementById('btnCnSAL');
    if (btnCnSurface) btnCnSurface.classList.toggle('is-active', state.cnSurfaceMode === 'surface');
    if (btnCnSAL) btnCnSAL.classList.toggle('is-active', state.cnSurfaceMode === 'sal');
  }

  /**
   * Render Theme & MD1 Palette Dialog Options + Appearance Mode + Language Dialog Options
   */
  function renderDialogOptions() {
    const dict = t();
    const themeContainer = document.getElementById('themeOptionsContainer');
    if (themeContainer) {
      const allThemes = Object.values(window.HKPOST_THEMES);
      const postalThemes = allThemes.filter(th => th.category === 'postal');
      const md1Palettes = allThemes.filter(th => th.category === 'md1');

      const schemes = [
        { id: 'auto', icon: 'brightness_auto', label: dict.schemeAuto },
        { id: 'light', icon: 'light_mode', label: dict.schemeLight },
        { id: 'dark', icon: 'dark_mode', label: dict.schemeDark }
      ];

      const schemeSelectorHtml = schemes.map(sc => {
        const isSelected = state.colorSchemePref === sc.id;
        return `
          <button type="button" class="md-scheme-btn md-ripple-surface ${isSelected ? 'is-selected' : ''}" data-select-scheme="${sc.id}">
            <span class="material-icons">${sc.icon}</span>
            <span>${sc.label}</span>
          </button>
        `;
      }).join('');

      const postalHtml = postalThemes.map(th => {
        const isSelected = state.theme === th.id;
        return `
          <button type="button" class="md-option-card md-ripple-surface ${isSelected ? 'is-selected' : ''}" data-select-theme="${th.id}">
            <div class="md-option-info">
              <div class="md-option-title">${th.names[state.lang]}</div>
              <div class="md-option-desc">${th.descriptions[state.lang]}</div>
            </div>
            <div class="md-theme-swatches">
              <span class="md-palette-dot" style="background-color:${th.primary500};">
                ${isSelected ? '<span class="material-icons" style="font-size:15px;">check</span>' : ''}
                <span class="md-palette-dot-accent" style="background-color:${th.swatchSecondary};"></span>
              </span>
            </div>
          </button>
        `;
      }).join('');

      const paletteGridHtml = md1Palettes.map(th => {
        const isSelected = state.theme === th.id;
        const shortName = (th.shortNames && th.shortNames[state.lang]) || th.names[state.lang];
        return `
          <button type="button" class="md-palette-swatch-btn md-ripple-surface ${isSelected ? 'is-selected' : ''}" data-select-theme="${th.id}" title="${th.descriptions[state.lang]}">
            <span class="md-palette-dot" style="background-color:${th.primary500};">
              ${isSelected ? '<span class="material-icons" style="font-size:14px;">check</span>' : ''}
              <span class="md-palette-dot-accent" style="background-color:${th.swatchSecondary};"></span>
            </span>
            <span class="md-palette-name">${shortName}</span>
          </button>
        `;
      }).join('');

      themeContainer.innerHTML = `
        <div class="md-dialog-section-label">${dict.colorSchemeSection}</div>
        <div class="md-scheme-selector-grid">
          ${schemeSelectorHtml}
        </div>
        <div class="md-dialog-section-label">${dict.postalThemesSection}</div>
        <div class="md-postal-themes-grid">
          ${postalHtml}
        </div>
        <div class="md-dialog-section-label">${dict.md1PaletteSection}</div>
        <div class="md-palette-grid">
          ${paletteGridHtml}
        </div>
      `;

      themeContainer.querySelectorAll('[data-select-scheme]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const schemePref = btn.getAttribute('data-select-scheme');
          const nextEffective = resolveEffectiveColorScheme(schemePref);
          const waveColor = nextEffective === 'dark' ? '#212121' : '#FAFAFA';
          runWithThemeWaveTransition(e, waveColor, () => {
            applyColorScheme(schemePref, true);
            renderDialogOptions();
          });
        });
      });

      themeContainer.querySelectorAll('[data-select-theme]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const thId = btn.getAttribute('data-select-theme');
          const targetTheme = window.HKPOST_THEMES[thId];
          const waveColor = targetTheme ? targetTheme.primary500 : null;
          runWithThemeWaveTransition(e, waveColor, () => {
            applyTheme(thId);
            renderDialogOptions();
          });
          closeDialog(document.getElementById('themeDialogBackdrop'));
        });
      });
    }

    const langContainer = document.getElementById('langOptionsContainer');
    if (langContainer) {
      const langs = [
        { id: 'zh-HK', title: '繁體中文（香港）' },
        { id: 'zh-CN', title: '简体中文' },
        { id: 'en', title: 'English' }
      ];
      langContainer.innerHTML = langs.map(l => {
        const isSelected = state.lang === l.id;
        return `
          <button type="button" lang="${l.id}" class="md-option-card md-ripple-surface ${isSelected ? 'is-selected' : ''}" data-select-lang="${l.id}">
            <div class="md-option-info" lang="${l.id}">
              <div class="md-option-title">${l.title}</div>
            </div>
            <span class="material-icons" style="color:${isSelected ? 'var(--md-primary-text)' : 'transparent'};">check_circle</span>
          </button>
        `;
      }).join('');

      langContainer.querySelectorAll('[data-select-lang]').forEach(btn => {
        btn.addEventListener('click', () => {
          const langId = btn.getAttribute('data-select-lang');
          localStorage.setItem(STORAGE_KEY_LANG, langId);
          applyLanguage(langId);
          renderAll();
          closeDialog(document.getElementById('langDialogBackdrop'));
        });
      });
    }
  }

  /**
   * Decompose HK$ difference into minimum HK Post make-up stamps ($5, $2, $1, $0.5, $0.2, $0.1)
   */
  function getHkMakeUpStamps(diffAmount) {
    let tenths = Math.round(diffAmount * 10);
    const denoms = [50, 20, 10, 5, 2, 1];
    const parts = [];
    for (const d of denoms) {
      if (tenths >= d) {
        const count = Math.floor(tenths / d);
        tenths -= count * d;
        const valStr = (d / 10).toFixed(1);
        parts.push(count > 1 ? `$${valStr}×${count}` : `$${valStr}`);
      }
    }
    return parts.join(' + ');
  }

  /**
   * Get recommended stamp combinations for a specific unit rate under HK Post or China Post
   */
  function getStampCombosForRate(rateVal, isCN) {
    const key = Number(rateVal).toFixed(1);
    if (isCN) {
      const cnMap = {
        '0.8': {
          exact: ['¥0.80 × 1'],
          commem: ['80分 × 1 (0超额)']
        },
        '3.0': {
          exact: ['¥3.00 × 1', '¥1.20×2 + ¥0.60'],
          commem: ['¥1.20×2 + ¥0.80 = ¥3.2 (超¥0.2)']
        },
        '3.5': {
          exact: ['¥1.50 + ¥1.20 + ¥0.80', '¥2.00 + ¥1.50'],
          commem: ['¥1.20×2 + ¥0.80 + ¥0.30补资', '¥1.20 + ¥0.80×3 = ¥3.6 (超¥0.1)']
        },
        '4.0': {
          exact: ['¥1.20×2 + ¥0.80×2', '¥2.00 × 2'],
          commem: ['¥1.20×2 + ¥0.80×2 = ¥4.0 (0超额)']
        },
        '4.5': {
          exact: ['¥3.00 + ¥1.50', '¥1.50 × 3'],
          commem: ['¥1.20×3 + ¥0.80 + ¥0.10补资', '¥1.20×2 + ¥0.80×3 = ¥4.8 (超¥0.3)']
        },
        '5.0': {
          exact: ['¥4.20 + ¥0.80', '¥3.00 + ¥1.20 + ¥0.80'],
          commem: ['¥1.20×4 + ¥0.20补资', '¥1.20×3 + ¥0.80×2 = ¥5.2 (超¥0.2)']
        },
        '16.0': {
          exact: ['¥10.00 + ¥6.00', '柜台机打挂号签条'],
          commem: ['柜台办理挂号并机打资费签条']
        }
      };
      return cnMap[key] || { exact: [`¥${key}`], commem: [`¥${key}`] };
    }

    const hkMap = {
      '2.4': ['$2.4 × 1', '$2.0 + $0.2×2'],
      '3.0': ['$3.0 × 1', '$2.0 + $1.0'],
      '3.7': ['$3.7 × 1', '$3.0 + $0.5 + $0.2'],
      '3.9': ['$3.9 × 1', '$3.7 + $0.2'],
      '4.2': ['$4.2 × 1', '$3.7 + $0.5', '$2.0×2 + $0.2'],
      '4.7': ['$4.7 × 1', '$3.7 + $1.0'],
      '5.3': ['$5.3 × 1', '$5.0 + $0.2 + $0.1', '$3.7 + $1.0 + $0.5 + $0.1'],
      '5.6': ['$5.6 × 1', '$5.0 + $0.5 + $0.1', '$3.7 + $1.0 + $0.5 + $0.2×2'],
      '5.7': ['$5.7 × 1', '$5.0 + $0.5 + $0.2', '$3.7 + $2.0'],
      '5.8': ['$5.8 × 1', '$5.0 + $0.5 + $0.2 + $0.1', '$3.7 + $2.0 + $0.1'],
      '6.5': ['$5.0 + $1.0 + $0.5'],
      '6.7': ['$5.0 + $1.0 + $0.5 + $0.2'],
      '6.8': ['$5.0 + $1.0 + $0.5 + $0.2 + $0.1'],
      '8.3': ['$5.0 + $2.0 + $1.0 + $0.2 + $0.1'],
      '8.6': ['$5.0 + $2.0 + $1.0 + $0.5 + $0.1'],
      '8.7': ['$5.0 + $2.0 + $1.0 + $0.5 + $0.2'],
      '8.8': ['$5.0 + $2.0 + $1.0 + $0.5 + $0.2 + $0.1'],
      '15.5': ['$10.0 + $5.0 + $0.5', '$5.0×3 + $0.5']
    };
    return hkMap[key] || [getHkMakeUpStamps(rateVal)];
  }

  /**
   * Point 2: Render Dual-Operator Stamp Combinator & Old Stamp Top-Up Helper Dialog
   */
  function renderStampHelperDialog() {
    const container = document.getElementById('stampHelperContainer');
    if (!container) return;

    const dict = t();
    const isCN = state.operator === 'chinapost';
    const cSym = curSym();

    const titleEl = document.querySelector('[data-i18n="stampDialogTitle"]');
    if (titleEl) {
      titleEl.textContent = isCN ? dict.stampDialogTitleCN : dict.stampDialogTitle;
    }

    // 1. Collect active unit rates in current list
    const rateGroups = new Map();
    state.items.forEach(item => {
      const dest = DEST_MAP.get(item.code);
      if (!dest) return;
      const { airRate, surfaceRate, regRate } = getRatesForDestination(dest);
      if (item.airQty > 0 && airRate !== null) {
        const k = airRate.toFixed(1);
        if (!rateGroups.has(k)) rateGroups.set(k, { rate: airRate, count: 0, unit: dict.unitCard });
        rateGroups.get(k).count += item.airQty;
      }
      if (item.surfaceQty > 0) {
        const k = surfaceRate.toFixed(1);
        if (!rateGroups.has(k)) rateGroups.set(k, { rate: surfaceRate, count: 0, unit: dict.unitCard });
        rateGroups.get(k).count += item.surfaceQty;
      }
      if (item.regQty > 0) {
        const k = regRate.toFixed(1);
        if (!rateGroups.has(k)) rateGroups.set(k, { rate: regRate, count: 0, unit: dict.totalRegisteredUnit });
        rateGroups.get(k).count += item.regQty;
      }
    });

    let currentListHtml = '';
    if (rateGroups.size === 0) {
      currentListHtml = `<div class="stamp-note-banner">${dict.stampBatchEmpty}</div>`;
    } else {
      const sortedGroups = Array.from(rateGroups.values()).sort((a, b) => b.rate - a.rate);
      currentListHtml = `
        <div class="stamp-batch-list">
          ${sortedGroups.map(g => {
            const combos = getStampCombosForRate(g.rate, isCN);
            if (isCN) {
              const exactBadges = combos.exact.map(c => `<span class="stamp-combo-pill"><strong>${dict.stampCnSectionExact.split('（')[0]}:</strong> ${c}</span>`).join('');
              const commemBadges = combos.commem.map(c => `<span class="stamp-combo-pill"><small>1.20+80分:</small> ${c}</span>`).join('');
              return `
                <div class="stamp-rate-card">
                  <div class="stamp-rate-header">
                    <span class="stamp-rate-badge">${cSym} ${fmtHKD(g.rate)} / ${dict.unitCard}</span>
                    <span class="stamp-rate-count">× ${g.count} ${g.unit}</span>
                  </div>
                  <div class="stamp-combos-wrap">
                    ${exactBadges}
                    ${commemBadges}
                  </div>
                </div>
              `;
            } else {
              const badges = combos.map(c => `<span class="stamp-combo-pill">${c}</span>`).join('');
              return `
                <div class="stamp-rate-card">
                  <div class="stamp-rate-header">
                    <span class="stamp-rate-badge">${cSym} ${fmtHKD(g.rate)}</span>
                    <span class="stamp-rate-count">× ${g.count} ${g.unit}</span>
                  </div>
                  <div class="stamp-combos-wrap">
                    ${badges}
                  </div>
                </div>
              `;
            }
          }).join('')}
        </div>
      `;
    }

    // 2. Operator-Specific Interactive Tool (HK Old Stamp Top-Up Calculator vs CN Full Stamp Reference)
    let operatorToolHtml = '';
    if (!isCN) {
      const oldValues = [2.0, 2.2, 2.6, 2.8, 3.7, 4.0, 4.8, 4.9, 5.0, 5.4, 5.5];
      const oldChipsHtml = oldValues.map(val => {
        const active = Math.abs(state.selectedOldStamp - val) < 0.01;
        return `<button type="button" class="stamp-old-chip md-ripple-surface ${active ? 'is-selected' : ''}" data-old-stamp="${val.toFixed(1)}">HK$ ${val.toFixed(1)}</button>`;
      }).join('');

      const targetZones = [
        { label: `${dict.zoneShort.LOCAL} (${dict.modeSurface.split(' ')[0]})`, rate: 2.4 },
        { label: `${dict.zoneShort.CN_MO_TW} (${dict.modeSurface.split(' ')[0]})`, rate: 3.0 },
        { label: `${dict.zoneShort.CN_TW} (${dict.modeAir.split(' ')[0]})`, rate: 3.9 },
        { label: `${dict.zoneShort.Z1} (${dict.modeSurface.split(' ')[0]})`, rate: 3.7 },
        { label: `${dict.zoneShort.Z1} (${dict.modeAir.split(' ')[0]})`, rate: 4.2 },
        { label: `${dict.zoneShort.Z2} (${dict.modeSurface.split(' ')[0]})`, rate: 5.3 },
        { label: `${dict.zoneShort.Z2} (${dict.modeAir.split(' ')[0]})`, rate: 5.7 },
        { label: `${dict.zoneShort.Z3} (${dict.modeSurface.split(' ')[0]})`, rate: 5.6 },
        { label: `${dict.zoneShort.Z3} (${dict.modeAir.split(' ')[0]})`, rate: 5.8 }
      ];

      const topupRowsHtml = targetZones.map(z => {
        const diff = +(z.rate - state.selectedOldStamp).toFixed(1);
        if (diff <= 0) {
          const overStr = diff < 0 ? ` (${dict.stampHkOverpaid} $${Math.abs(diff).toFixed(1)})` : '';
          return `
            <div class="stamp-topup-item">
              <div class="stamp-topup-zone">
                <span>${z.label}</span>
                <span class="stamp-topup-Zone-rate">HK$ ${z.rate.toFixed(1)}</span>
              </div>
              <div class="stamp-topup-Action" style="color:#2E7D32;">✓ ${dict.stampHkExactMatch}${overStr}</div>
            </div>
          `;
        }
        const makeupStr = getHkMakeUpStamps(diff);
        return `
          <div class="stamp-topup-item">
            <div class="stamp-topup-zone">
              <span>${z.label}</span>
              <span class="stamp-topup-Zone-rate">HK$ ${z.rate.toFixed(1)}</span>
            </div>
            <div class="stamp-topup-Action">${dict.stampHkNeedTopup} +$${diff.toFixed(1)}</div>
            <div class="stamp-topup-formula">→ ${makeupStr}</div>
          </div>
        `;
      }).join('');

      operatorToolHtml = `
        <div class="md-dialog-section-label">${dict.stampHkOldSection}</div>
        <div class="stamp-note-banner">${dict.stampHkDefinitiveNote}</div>
        <div class="stamp-old-chips">
          ${oldChipsHtml}
        </div>
        <div class="stamp-topup-grid">
          ${topupRowsHtml}
        </div>
      `;
    } else {
      const cnRefRates = [
        { label: `${dict.zoneShort.CN_DOMESTIC} (${dict.modeSurface.split(' ')[0]})`, rate: 0.8 },
        { label: `${dict.zoneShort.CN_HKMOTW}/${dict.zoneShort.CN_INTL} (${dict.modeSurface.split(' ')[0]})`, rate: 3.5 },
        { label: `${dict.zoneShort.CN_HKMOTW} (${dict.modeAir.split(' ')[0]})`, rate: 4.0 },
        { label: `${dict.zoneShort.CN_INTL} (SAL)`, rate: 4.5 },
        { label: `${dict.zoneShort.CN_INTL} (${dict.modeAir.split(' ')[0]})`, rate: 5.0 }
      ];

      operatorToolHtml = `
        <div class="md-dialog-section-label">${dict.stampCnSection}</div>
        <div class="stamp-note-banner">${dict.stampCnNote}</div>
        <div class="stamp-batch-list">
          ${cnRefRates.map(r => {
            const c = getStampCombosForRate(r.rate, true);
            return `
              <div class="stamp-rate-card">
                <div class="stamp-rate-header">
                  <span class="stamp-rate-badge">¥ ${r.rate.toFixed(1)}</span>
                  <span class="stamp-rate-count">${r.label}</span>
                </div>
                <div class="stamp-combos-wrap">
                  ${c.exact.map(x => `<span class="stamp-combo-pill"><strong>0溢资:</strong> ${x}</span>`).join('')}
                  ${c.commem.map(x => `<span class="stamp-combo-pill"><small>1.20+80分:</small> ${x}</span>`).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    container.innerHTML = `
      <div class="md-dialog-section-label">${dict.stampBatchSection}</div>
      ${currentListHtml}
      ${operatorToolHtml}
    `;

    container.querySelectorAll('[data-old-stamp]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.selectedOldStamp = parseFloat(btn.getAttribute('data-old-stamp')) || 3.7;
        renderStampHelperDialog();
      });
    });
  }

  /**
   * Show MD1 Snackbar Notification (with optional Undo Action Button)
   */
  let snackbarTimer = null;
  let currentSnackbarActionHandler = null;

  function showSnackbar(message, actionLabel = null, onAction = null) {
    const bar = document.getElementById('mdSnackbar');
    const text = document.getElementById('mdSnackbarText');
    const actionBtn = document.getElementById('mdSnackbarAction');
    if (!bar || !text) return;

    text.textContent = message;

    if (actionBtn) {
      if (actionLabel && typeof onAction === 'function') {
        actionBtn.textContent = actionLabel;
        actionBtn.style.display = 'inline-flex';
        currentSnackbarActionHandler = () => {
          if (snackbarTimer) clearTimeout(snackbarTimer);
          bar.classList.remove('is-visible');
          onAction();
        };
      } else {
        actionBtn.style.display = 'none';
        currentSnackbarActionHandler = null;
      }
    }

    bar.classList.add('is-visible');
    if (snackbarTimer) clearTimeout(snackbarTimer);
    const timeoutMs = (actionLabel && onAction) ? 5000 : 2600;
    snackbarTimer = setTimeout(() => {
      bar.classList.remove('is-visible');
      currentSnackbarActionHandler = null;
    }, timeoutMs);
  }

  /**
   * Copy formatted summary to clipboard
   */
  function copySummaryToClipboard() {
    const dict = t();
    const isCN = state.operator === 'chinapost';
    const cSym = curSym();
    const headerTitle = isCN ? dict.appTitleCN : dict.appTitle;
    const subTag = isCN
      ? (state.cnSurfaceMode === 'sal' ? dict.cnModeSAL : dict.cnModeSurface)
      : (state.weightTier === '20g' ? dict.weight20g : dict.weight30g);

    const lines = [`📮 ${headerTitle} (${subTag})`];
    let grandTotal = 0;

    state.items.forEach(item => {
      const dest = DEST_MAP.get(item.code);
      if (!dest) return;
      const totalCards = item.airQty + item.surfaceQty;
      if (totalCards === 0 && item.regQty === 0) return;

      const { airRate, surfaceRate, regRate } = getRatesForDestination(dest);
      const cost = (airRate ? item.airQty * airRate : 0) + (item.surfaceQty * surfaceRate) + (item.regQty * regRate);
      grandTotal += cost;

      const details = [];
      if (item.airQty > 0 && airRate) details.push(`${dict.modeAir.split(' ')[0]}×${item.airQty}`);
      if (item.surfaceQty > 0) details.push(`${dict.modeSurface.split(' ')[0]}×${item.surfaceQty}`);
      if (item.regQty > 0) details.push(`${dict.colRegQty.split(' ')[0]}×${item.regQty}`);

      const cnNote = (isCN && dest.code !== 'CN') ? ` [${dict.cnAnnotatePrefix}${dest.names['zh-CN']}${dict.cnAnnotateSuffix}]` : '';
      lines.push(`${dest.flag} ${dest.names[state.lang]} (${dest.code})${cnNote}: ${details.join(', ')} = ${cSym} ${fmtHKD(cost)}`);
    });

    lines.push(`------------------------`);
    lines.push(`${dict.grandTotalLabel}: ${cSym} ${fmtHKD(grandTotal)}`);

    const textToCopy = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        showSnackbar(dict.copiedToast);
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = textToCopy;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showSnackbar(dict.copiedToast);
    }
  }

  /**
   * Global MD1 Ink Ripple Effect Listener
   */
  function initMd1Ripple() {
    document.addEventListener('pointerdown', (e) => {
      const target = e.target.closest('.md-ripple-surface');
      if (!target) return;

      const rect = target.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const wave = document.createElement('span');
      wave.className = 'md-ripple-wave';
      wave.style.width = `${size}px`;
      wave.style.height = `${size}px`;
      wave.style.left = `${e.clientX - rect.left - size / 2}px`;
      wave.style.top = `${e.clientY - rect.top - size / 2}px`;

      target.appendChild(wave);
      wave.addEventListener('animationend', () => {
        wave.remove();
      });
    });
  }

  /**
   * Sync Collapsible Reference Schedule State
   */
  function syncReferenceCollapsible() {
    const refCollapsible = document.getElementById('referenceCollapsible');
    const refIcon = document.getElementById('referenceToggleIcon');
    if (refCollapsible && refIcon) {
      refCollapsible.classList.toggle('is-collapsed', !state.refExpanded);
      refIcon.classList.toggle('is-collapsed', !state.refExpanded);
    }
  }

  /**
   * Render Everything
   */
  function renderAll() {
    syncOperatorDynamicUI();
    syncUndoButtonUI();
    renderSegmentedControls();
    renderPopularChips();
    renderDestinationsAndTotals();
    renderDesktopRateSchedule();
    renderMobileRateCards();
    renderDialogOptions();
    renderStampHelperDialog();
    syncReferenceCollapsible();
  }

  /**
   * Initialize Event Listeners
   */
  function initEvents() {
    // Snackbar Undo Action Button
    const snackbarActionBtn = document.getElementById('mdSnackbarAction');
    if (snackbarActionBtn) {
      snackbarActionBtn.addEventListener('click', () => {
        if (typeof currentSnackbarActionHandler === 'function') {
          currentSnackbarActionHandler();
        }
      });
    }

    // Toolbar Undo Button
    const btnUndoAction = document.getElementById('btnUndoAction');
    if (btnUndoAction) {
      btnUndoAction.addEventListener('click', () => {
        performUndo();
      });
    }

    // Master Switch: Origin Postal Service (Hongkong Post vs China Post)
    const btnOperatorHK = document.getElementById('btnOperatorHK');
    const btnOperatorCN = document.getElementById('btnOperatorCN');

    if (btnOperatorHK) {
      btnOperatorHK.addEventListener('click', (e) => {
        if (state.operator === 'hkpost') return;
        const willSwitchTheme = state.theme === 'chinapost_green' || state.theme === 'royal_crimson';
        const waveColor = willSwitchTheme ? '#C62828' : window.HKPOST_THEMES[state.theme].primary500;
        runWithThemeWaveTransition(e, waveColor, () => {
          applyOperator('hkpost');
          renderAll();
        });
      });
    }

    if (btnOperatorCN) {
      btnOperatorCN.addEventListener('click', (e) => {
        if (state.operator === 'chinapost') return;
        const willSwitchTheme = state.theme === 'royal_crimson' || state.theme === 'chinapost_green';
        const waveColor = willSwitchTheme ? '#006837' : window.HKPOST_THEMES[state.theme].primary500;
        runWithThemeWaveTransition(e, waveColor, () => {
          applyOperator('chinapost');
          renderAll();
        });
      });
    }

    const searchInput = document.getElementById('countrySearchInput');
    const searchTextField = document.getElementById('searchTextField');
    const btnClearSearch = document.getElementById('btnClearSearch');
    const acMenu = document.getElementById('autocompleteMenu');

    if (searchInput) {
      searchInput.addEventListener('focus', () => {
        searchTextField.classList.add('is-focused');
        if (searchInput.value.trim()) {
          renderAutocomplete(searchInput.value);
        }
      });

      searchInput.addEventListener('blur', () => {
        searchTextField.classList.remove('is-focused');
        // If user edited Postcrossing IDs in the box and clicked outside, sync them automatically
        if (/\b([A-Za-z]{2})\s*[-–—]\s*(\d{3,10})\b/.test(searchInput.value) || state.importedPcIds.length > 0) {
          syncPostcrossingIdsFromText(searchInput.value);
        }
        setTimeout(() => {
          if (acMenu) acMenu.classList.remove('is-open');
        }, 160);
      });

      // Smart Paste Listener for Postcrossing IDs:
      // Keeps existing + newly pasted IDs in the input box separated by spaces!
      searchInput.addEventListener('paste', (e) => {
        const clipboardText = (e.clipboardData || window.clipboardData)?.getData('text') || '';
        if (/\b([A-Za-z]{2})\s*[-–—]\s*(\d{3,10})\b/.test(clipboardText)) {
          e.preventDefault();
          const currentVal = searchInput.value || '';
          const combined = `${currentVal} ${clipboardText}`;
          syncPostcrossingIdsFromText(combined);
        }
      });

      searchInput.addEventListener('input', () => {
        const val = searchInput.value;
        searchTextField.classList.toggle('has-value', val.length > 0);
        if (btnClearSearch) {
          btnClearSearch.style.display = val.length > 0 ? 'inline-flex' : 'none';
        }
        renderAutocomplete(val);
      });

      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' && state.acMatches.length > 0) {
          e.preventDefault();
          state.acActiveIndex = (state.acActiveIndex + 1) % state.acMatches.length;
          updateAutocompleteHighlight();
        } else if (e.key === 'ArrowUp' && state.acMatches.length > 0) {
          e.preventDefault();
          state.acActiveIndex = (state.acActiveIndex - 1 + state.acMatches.length) % state.acMatches.length;
          updateAutocompleteHighlight();
        } else if (e.key === ' ' && /\b([A-Za-z]{2})\s*[-–—]\s*(\d{3,10})$/.test(searchInput.value.trim())) {
          // When typing Postcrossing IDs and pressing Space, automatically import & format with space!
          e.preventDefault();
          syncPostcrossingIdsFromText(searchInput.value);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          handleSearchSubmit(searchInput.value);
        } else if (e.key === 'Escape') {
          if (acMenu) acMenu.classList.remove('is-open');
        }
      });
    }

    if (btnClearSearch) {
      btnClearSearch.addEventListener('click', () => {
        if (state.importedPcIds.length > 0) {
          pushUndoSnapshot();
          state.importedPcIds = [];
          saveState();
        }
        clearSearchInput();
        if (searchInput) searchInput.focus();
      });
    }

    // Mobile Popular Chips Expand/Collapse Toggle
    const btnToggleChips = document.getElementById('btnToggleMobileChips');
    if (btnToggleChips) {
      btnToggleChips.addEventListener('click', () => {
        state.mobileChipsExpanded = !state.mobileChipsExpanded;
        const dict = t();
        const textEl = document.getElementById('mobileChipsToggleText');
        const iconEl = document.getElementById('mobileChipsToggleIcon');
        const listEl = document.getElementById('popularChipsContainer');
        if (textEl) textEl.textContent = state.mobileChipsExpanded ? dict.collapseChips : dict.expandChips;
        if (iconEl) iconEl.style.transform = state.mobileChipsExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
        if (listEl) listEl.classList.toggle('is-mobile-collapsed', !state.mobileChipsExpanded);
      });
    }

    // Default Mode & Weight Tier & China Post Surface/SAL Buttons
    document.getElementById('btnDefaultAir').addEventListener('click', () => {
      state.defaultMode = 'air';
      saveState();
      renderSegmentedControls();
    });

    document.getElementById('btnDefaultSurface').addEventListener('click', () => {
      state.defaultMode = 'surface';
      saveState();
      renderSegmentedControls();
    });

    document.getElementById('btnWeight20g').addEventListener('click', () => {
      state.weightTier = '20g';
      saveState();
      renderAll();
    });

    document.getElementById('btnWeight30g').addEventListener('click', () => {
      state.weightTier = '30g';
      saveState();
      renderAll();
    });

    const btnCnSurface = document.getElementById('btnCnSurface');
    const btnCnSAL = document.getElementById('btnCnSAL');
    if (btnCnSurface) {
      btnCnSurface.addEventListener('click', () => {
        state.cnSurfaceMode = 'surface';
        saveState();
        renderAll();
      });
    }
    if (btnCnSAL) {
      btnCnSAL.addEventListener('click', () => {
        state.cnSurfaceMode = 'sal';
        saveState();
        renderAll();
      });
    }

    // Batch Actions
    document.getElementById('btnBatchAllAir').addEventListener('click', () => {
      if (state.items.length === 0) return;
      pushUndoSnapshot();
      state.items.forEach(item => {
        const dest = DEST_MAP.get(item.code);
        if (!dest) return;
        const total = item.airQty + item.surfaceQty;
        if (canDestinationAir(dest)) {
          item.airQty = total;
          item.surfaceQty = 0;
        } else {
          item.airQty = 0;
          item.surfaceQty = total;
        }
      });
      saveState();
      renderAll();
    });

    document.getElementById('btnBatchAllSurface').addEventListener('click', () => {
      if (state.items.length === 0) return;
      pushUndoSnapshot();
      state.items.forEach(item => {
        const total = item.airQty + item.surfaceQty;
        item.surfaceQty = total;
        item.airQty = 0;
      });
      saveState();
      renderAll();
    });

    document.getElementById('btnCopySummary').addEventListener('click', copySummaryToClipboard);
    const btnMobileCopy = document.getElementById('btnMobileCopy');
    if (btnMobileCopy) {
      btnMobileCopy.addEventListener('click', copySummaryToClipboard);
    }

    const btnShareUrl = document.getElementById('btnShareUrl');
    if (btnShareUrl) {
      btnShareUrl.addEventListener('click', shareCalculationUrl);
    }

    const mobileBarScrollTop = document.getElementById('mobileBarScrollTop');
    if (mobileBarScrollTop) {
      mobileBarScrollTop.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    document.getElementById('btnClearAll').addEventListener('click', () => {
      if (state.items.length === 0 && state.importedPcIds.length === 0) return;
      pushUndoSnapshot();
      const dict = t();
      state.items = [];
      state.importedPcIds = [];
      clearSearchInput();
      saveState();
      renderAll();
      showSnackbar(dict.clearedToast, dict.undoBtn, performUndo);
    });

    // Collapsible Rate Schedule Reference Card
    const refHeader = document.getElementById('referenceToggleHeader');
    if (refHeader) {
      refHeader.addEventListener('click', () => {
        state.refExpanded = !state.refExpanded;
        syncReferenceCollapsible();
      });
    }

    // Mobile Sticky Bottom Bar Scroll Visibility
    const mobileBottomBar = document.getElementById('mobileBottomBar');
    if (mobileBottomBar) {
      window.addEventListener('scroll', () => {
        const shouldShow = window.scrollY > 220 && state.items.length > 0;
        mobileBottomBar.classList.toggle('is-visible', shouldShow);
      }, { passive: true });
    }

    // Automatic System Color Scheme Media Query Listener
    if (window.matchMedia) {
      const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
      const handleSystemSchemeChange = () => {
        if (state.colorSchemePref === 'auto') {
          applyColorScheme('auto');
          renderDialogOptions();
        }
      };
      if (darkMq.addEventListener) {
        darkMq.addEventListener('change', handleSystemSchemeChange);
      } else if (darkMq.addListener) {
        darkMq.addListener(handleSystemSchemeChange);
      }
    }

    // Dialog Open/Close with Smooth MD1 Point-of-Origin Animation
    const themeBackdrop = document.getElementById('themeDialogBackdrop');
    const langBackdrop = document.getElementById('langDialogBackdrop');
    const stampBackdrop = document.getElementById('stampDialogBackdrop');
    const btnOpenTheme = document.getElementById('btnOpenThemeDialog');
    const btnOpenLang = document.getElementById('btnOpenLangDialog');
    const btnOpenStamp = document.getElementById('btnOpenStampDialog');
    const btnCloseTheme = document.getElementById('btnCloseThemeDialog');
    const btnCloseLang = document.getElementById('btnCloseLangDialog');
    const btnCloseStamp = document.getElementById('btnCloseStampDialog');

    if (btnOpenTheme) {
      btnOpenTheme.addEventListener('click', () => {
        openDialogWithOrigin(themeBackdrop, btnOpenTheme);
      });
    }

    if (btnOpenLang) {
      btnOpenLang.addEventListener('click', () => {
        openDialogWithOrigin(langBackdrop, btnOpenLang);
      });
    }

    if (btnOpenStamp) {
      btnOpenStamp.addEventListener('click', () => {
        renderStampHelperDialog();
        openDialogWithOrigin(stampBackdrop, btnOpenStamp);
      });
    }

    if (btnCloseTheme) {
      btnCloseTheme.addEventListener('click', () => closeDialog(themeBackdrop));
    }
    if (btnCloseLang) {
      btnCloseLang.addEventListener('click', () => closeDialog(langBackdrop));
    }
    if (btnCloseStamp) {
      btnCloseStamp.addEventListener('click', () => closeDialog(stampBackdrop));
    }

    [themeBackdrop, langBackdrop, stampBackdrop].forEach(backdrop => {
      if (!backdrop) return;
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          closeDialog(backdrop);
        }
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        [themeBackdrop, langBackdrop, stampBackdrop].forEach(backdrop => {
          if (backdrop && backdrop.classList.contains('is-open')) {
            closeDialog(backdrop);
          }
        });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        const activeTag = document.activeElement ? document.activeElement.tagName : '';
        if (activeTag !== 'INPUT' && state.undoStack.length > 0) {
          e.preventDefault();
          performUndo();
        }
      }
    });
  }

  function updateAutocompleteHighlight() {
    const menu = document.getElementById('autocompleteMenu');
    if (!menu) return;
    const items = menu.querySelectorAll('.md-autocomplete-item');
    items.forEach((el, idx) => {
      el.classList.toggle('is-active', idx === state.acActiveIndex);
    });
  }

  // Bootstrap Application
  document.addEventListener('DOMContentLoaded', () => {
    loadInitialState();
    applyColorScheme(state.colorSchemePref, false);
    applyTheme(state.theme);
    applyLanguage(state.lang);
    initMd1Ripple();
    initEvents();
    if (state.importedPcIds.length > 0) {
      setSearchInputValue(`${state.importedPcIds.join(' ')} `);
    }
    renderAll();

    // Point 6: Register PWA Service Worker for Offline Caching
    if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.protocol === 'http:')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  });
})();
