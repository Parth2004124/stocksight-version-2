// --- CONFIGURATION & STATE ---
const SHEET_API_URL = "https://script.google.com/macros/s/AKfycbyScFGyxqSwudrvbCngaPtlKxtHlS4O8Q7bj4FcQEESir3LFSlnHquPxskKsBKC9kS1VQ/exec";
const BLACKLIST_KEYS = ['status', 'message', 'result', 'sync-ts', 'sync_ts', 'version', 'timestamp'];
const ETF_KEYWORDS = ['BEES', 'ETF', 'GOLD', 'LIQUID', 'HANGSENG', 'NIFTY', 'SENSEX', 'MOVALUE', 'MOMENTUM', 'MIDCAP', 'SMALLCAP', 'JUNIOR'];

// Global State Variables
let portfolio = {};
let livePrices = {};
let stockAnalysis = {};
let cardViews = {};
let activeTab = 'portfolio';
let saveTimeout = null;
let isOfflineMode = false;
let activeRequests = 0;
// NOTE: portfolioAnalytics is shared with stocky.js
let portfolioAnalytics = { healthScore: 0, scoredValue: 0, totalValue: 0, allocation: {}, risk: {}, efficiency: [] };

// --- DATA PERSISTENCE ---

function saveState(pushToCloud = true) {
    const state = { portfolio: portfolio, analysis: stockAnalysis, activeTab: activeTab, cardViews: cardViews };
    localStorage.setItem('stockSightData', JSON.stringify(state));
    calculateTotals();
    updateViewCounts();
    if (activeTab === 'summary') renderSignalSummary();

    if (!pushToCloud) return;

    updateCloudStatus('loading', 'Saving...');
    if (saveTimeout) clearTimeout(saveTimeout);

    saveTimeout = setTimeout(async () => {
        if (isOfflineMode) { updateCloudStatus('error', 'Offline'); return; }
        try {
            const cleanPayload = sanitizePortfolio(portfolio);
            const res = await fetch(SHEET_API_URL, {
                method: 'POST',
                body: JSON.stringify(cleanPayload),
                headers: { "Content-Type": "text/plain" }
            });
            const json = await res.json();
            if (json.status === 'success') {
                updateCloudStatus('success', 'Saved');
            } else {
                throw new Error(json.message || "Script returned error");
            }
        } catch (e) {
            try {
                const cleanPayload = sanitizePortfolio(portfolio);
                await fetch(SHEET_API_URL, {
                    method: 'POST',
                    body: JSON.stringify(cleanPayload),
                    mode: 'no-cors',
                    headers: { "Content-Type": "text/plain" }
                });
                updateCloudStatus('success', 'Saved (Blind)');
            } catch (err2) {
                updateCloudStatus('error', 'Save Failed');
            }
        }
    }, 2000);
}

function sanitizePortfolio(raw) {
    const clean = {};
    if (!raw) return clean;
    Object.keys(raw).forEach(key => {
        const k = key.toLowerCase();
        if (BLACKLIST_KEYS.includes(k)) return;
        if (typeof raw[key] !== 'object' || raw[key] === null) return;
        if (key.length > 20 || key.includes(' ')) return;
        clean[key] = raw[key];
    });
    return clean;
}

// --- INITIALIZATION ---

async function initApp() {
    const robustData = localStorage.getItem('stockSightData');
    if (robustData) {
        const state = JSON.parse(robustData);
        portfolio = sanitizePortfolio(state.portfolio) || {};
        stockAnalysis = state.analysis || {};
        activeTab = state.activeTab || 'portfolio';
        cardViews = state.cardViews || {};

        let migrationNeeded = false;
        Object.keys(portfolio).forEach(key => {
            const clean = cleanTicker(key);
            if (clean !== key) {
                migrationNeeded = true;
                portfolio[clean] = portfolio[key];
                delete portfolio[key];
                if (stockAnalysis[key]) { stockAnalysis[clean] = stockAnalysis[key]; delete stockAnalysis[key]; }
                if (cardViews[key]) { cardViews[clean] = cardViews[key]; delete cardViews[key]; }
            }
        });

        if (migrationNeeded) saveState(false);

        Object.keys(stockAnalysis).forEach(sym => {
            if (stockAnalysis[sym].price) livePrices[sym] = stockAnalysis[sym].price;
        });
        renderUI();
    } else if (localStorage.getItem('stockPortfolio')) {
        portfolio = sanitizePortfolio(JSON.parse(localStorage.getItem('stockPortfolio')));
        renderUI();
    } else {
        const el = document.getElementById('empty-watchlist');
        if (el) el.innerHTML = "Initializing...";
    }

    await performCloudSync();

    const symbols = Object.keys(portfolio);
    if (symbols.length > 0) {
        setTimeout(() => { symbols.forEach(sym => fetchAsset(sym)); }, 100);
    }
}

async function performCloudSync() {
    updateCloudStatus('loading', 'Syncing...');
    isOfflineMode = false;
    try {
        const response = await fetch(SHEET_API_URL, { method: 'GET' });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const cloudData = await response.json();
        if (cloudData.status === 'error') throw new Error(cloudData.message);

        if (cloudData && Object.keys(cloudData).length > 0) {
            // MERGE STRATEGY: Prefer cloud data, but don't overwrite if cloud is empty and local is not
            if (Object.keys(portfolio).length === 0 || confirm("Cloud data found. Overwrite local changes?")) {
                portfolio = sanitizePortfolio(cloudData);
                saveState(false);
                renderUI();
            }
        } else if (Object.keys(portfolio).length > 0) {
            saveState(true);
        }
        updateCloudStatus('success', 'Synced');
    } catch (e) {
        isOfflineMode = true;
        updateCloudStatus('error', 'Offline');
        const emptyState = document.getElementById('main-empty-state');
        if (emptyState) emptyState.classList.add('hidden');
        if (Object.keys(portfolio).length === 0) {
            const el = document.getElementById('empty-watchlist');
            if (el) el.innerHTML = "Offline Mode.<br>Add stocks locally.";
        }
    }
}

function forceSync() {
    sessionStorage.removeItem('syncErrorShown');
    performCloudSync();
}

function renderUI() {
    const symbols = Object.keys(portfolio).filter(key => {
        const k = key.toLowerCase();
        return !BLACKLIST_KEYS.some(bad => k.includes(bad));
    });

    if (symbols.length > 0) {
        const el1 = document.getElementById('empty-watchlist');
        const el2 = document.getElementById('main-empty-state');
        if (el1) el1.classList.add('hidden');
        if (el2) el2.classList.add('hidden');
        symbols.forEach(sym => {
            if (stockAnalysis[sym]) renderCard(sym, stockAnalysis[sym], true);
            else createCardSkeleton(sym);
            renderWatchlistItem(sym, !stockAnalysis[sym]);
        });
    }
    switchTab(activeTab);
    updateViewCounts();
    calculateTotals();
}

// --- NETWORK & FETCHING ---

const PROXIES = [
    { url: (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, type: 'text' },
    { url: (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}&t=${Date.now()}`, type: 'json' },
    { url: (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`, type: 'text' },
    { url: (url) => `https://thingproxy.freeboard.io/fetch/${encodeURIComponent(url)}`, type: 'text' }
];

async function fetchWithFallback(targetUrl) {
    let lastError;
    for (const proxy of PROXIES) {
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 10000);

            const res = await fetch(proxy.url(targetUrl), { signal: controller.signal });
            clearTimeout(id);

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            let content = proxy.type === 'json' ? (await res.json()).contents : await res.text();

            if (!content || content.length < 50) throw new Error("Empty/Blocked");

            if (targetUrl.includes('yahoo') && !content.includes('Chart') && !content.includes('quoteResponse') && !content.includes('QuoteSummaryStore') && !content.trim().startsWith('{')) throw new Error("Invalid Yahoo");

            return content;
        } catch (e) { lastError = e; }
    }
    throw lastError;
}

// Helper to find correct symbol using Yahoo's open Autocomplete
async function resolveSymbolWithYahoo(query) {
    try {
        const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=1&newsCount=0`;
        const jsonStr = await fetchWithFallback(url);
        const json = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
        if (json && json.quotes && json.quotes.length > 0) {
            const sym = json.quotes[0].symbol;
            return sym.replace('.NS', '').replace('.BO', '');
        }
    } catch (e) { }
    return null;
}

async function fetchAsset(input) {
    const lowerInput = input.toLowerCase();
    if (BLACKLIST_KEYS.some(k => lowerInput.includes(k))) return;

    activeRequests++;
    updateReqCount();

    let sym = input.toUpperCase().split('.')[0].trim();

    try {
        if (/^\d{5,6}$/.test(sym)) await fetchMutualFund(sym);
        else await fetchStockOrETF(sym);

        const card = document.getElementById(`card-${sym}`);
        if (card) card.classList.remove('updating');

    } catch (e) {
        renderErrorCard(sym, e.message);
    } finally {
        activeRequests--;
        updateReqCount();
    }
}

async function fetchMutualFund(code) {
    const url = `https://api.mfapi.in/mf/${code}`;
    let json;

    try {
        const res = await fetch(url);
        if (res.ok) {
            json = await res.json();
        }
    } catch (e) { }

    if (!json) {
        try {
            const jsonStr = await fetchWithFallback(url);
            json = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
        } catch (e) { throw new Error("MF Not Found"); }
    }

    if (!json || !json.data) throw new Error("Invalid Data");
    const data = {
        name: json.meta.scheme_name,
        price: parseFloat(json.data[0].nav),
        type: 'FUND',
        meta: json.meta.fund_house,
        returns: calculateMFReturns(json.data)
    };
    livePrices[code] = data.price;
    renderCard(code, data);
}

// ROBUST FETCH FUNCTION (Fixed for Score/OPM)
async function fetchStockOrETF(sym) {
    const isLikelyETF = ETF_KEYWORDS.some(k => sym.includes(k));

    if (!isLikelyETF) {
        try {
            let html;
            let finalSym = sym;
            let searchNeeded = false;

            if (sym.includes(' ') || sym.includes('&') || sym.length > 9) {
                const resolved = await resolveSymbolWithYahoo(sym);
                if (resolved) finalSym = resolved;
            }

            try {
                html = await fetchWithFallback(`https://www.screener.in/company/${finalSym}/consolidated/`);
                if (html.includes("Page not found") || html.includes("could not be found")) throw new Error("Soft 404");
            } catch (e) {
                searchNeeded = true;
            }

            if (searchNeeded) {
                const searchRes = await fetchWithFallback(`https://www.screener.in/api/company/search/?q=${encodeURIComponent(sym)}`);
                const searchJson = typeof searchRes === 'string' ? JSON.parse(searchRes) : searchRes;
                if (searchJson && searchJson.length > 0) {
                    const relUrl = searchJson[0].url;
                    finalSym = relUrl.split('/')[2];
                    html = await fetchWithFallback(`https://www.screener.in${relUrl}consolidated/`);
                } else {
                    throw new Error("Search failed");
                }
            }

            if (html.includes("human") && html.includes("verification")) throw new Error("Screener Blocked");

            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const ratios = doc.getElementById('top-ratios');

            if (ratios) {
                const getVal = (txt) => {
                    for (let li of ratios.querySelectorAll('li')) {
                        if (li.innerText.toLowerCase().includes(txt.toLowerCase())) return parseFloat(li.querySelector('.number')?.innerText.replace(/,/g, '') || 0);
                    }
                    return null;
                };

                const price = getVal('Current Price');

                if (price) {
                    // --- ROBUST PARSING HELPERS (OPM & Growth Fixes) ---
                    const extractGrowth = (fullHtml, sectionTitle) => {
                        const idx = fullHtml.indexOf(sectionTitle);
                        if (idx === -1) return 0;
                        const snippet = fullHtml.substring(idx, idx + 2000);
                        let m = snippet.match(/3\s*Years:[\s\S]*?([0-9\.-]+)\s?%/i);
                        if (!m) m = snippet.match(/5\s*Years:[\s\S]*?([0-9\.-]+)\s?%/i);
                        if (!m) m = snippet.match(/TTM:[\s\S]*?([0-9\.-]+)\s?%/i);
                        return m ? parseFloat(m[1]) : 0;
                    };

                    // Robust OPM Parsing
                    let opm = getVal('OPM %') || getVal('OPM');
                    if (opm === null || opm === 0) {
                        const opmRegex = /OPM\s*%?[\s\S]{0,50}?(\d{1,3}(\.\d{1,2})?)%/i;
                        const m = html.match(opmRegex);
                        if (m) opm = parseFloat(m[1]);
                    }

                    let growth = extractGrowth(html, "Compounded Sales Growth");
                    let profitGrowth = extractGrowth(html, "Compounded Profit Growth");

                    let extraData = {};
                    try {
                        const yData = await fetchYahooQuote(finalSym.endsWith('.NS') ? finalSym : `${finalSym}.NS`);
                        if (yData) extraData = { beta: yData.beta, returns: yData.returns };
                    } catch (e) { }

                    const data = {
                        name: doc.querySelector('h1')?.innerText || finalSym,
                        price: price,
                        pe: getVal('Stock P/E'),
                        roe: getVal('ROE'),
                        roce: getVal('ROCE'),
                        mcap: getVal('Market Cap'),
                        opm: opm || 0,
                        growth: growth,
                        profitGrowth: profitGrowth,
                        beta: extraData.beta || 1.0,
                        returns: extraData.returns,
                        type: 'STOCK'
                    };
                    livePrices[sym] = data.price;
                    renderCard(sym, data, false, true);
                    return;
                }
            }
        } catch (e) {
            console.warn("Screener failed", e);
        }
    }

    try {
        const gData = await fetchGoogleFinance(sym);
        if (gData) {
            livePrices[sym] = gData.price;
            renderCard(sym, gData, false, true);
            return;
        }
    } catch (gErr) { }

    try {
        let targetSym = sym.endsWith('.NS') || sym.endsWith('.BO') ? sym : `${sym}.NS`;
        let data = await fetchYahooQuote(targetSym);
        if (!data && !sym.includes('.')) data = await fetchYahooQuote(`${sym}.BO`);
        if (data) {
            livePrices[sym] = data.price;
            renderCard(sym, data, false, true);
            return;
        }
    } catch (yErr) { }

    throw new Error("Asset not found");
}

async function fetchYahooQuote(yahooSym) {
    try {
        const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1mo&range=5y`;
        const chartJsonStr = await fetchWithFallback(chartUrl);
        const chartJson = JSON.parse(chartJsonStr);
        const result = chartJson?.chart?.result?.[0];
        const meta = result?.meta;

        if (meta && meta.regularMarketPrice) {
            const quotes = result.indicators.quote[0].close;
            const calcRet = (months) => {
                if (!quotes || quotes.length < months) return 0;
                const curr = quotes[quotes.length - 1];
                const old = quotes[quotes.length - 1 - months];
                if (!old) return 0;
                const years = months / 12;
                return ((Math.pow(curr / old, 1 / years) - 1) * 100);
            };
            return {
                name: meta.symbol.replace('.NS', '').replace('.BO', ''),
                price: meta.regularMarketPrice,
                type: 'ETF',
                pe: null,
                beta: 1.0,
                roe: null,
                returns: { r1y: calcRet(12), r3y: calcRet(36), r5y: calcRet(60) },
                technicals: {
                    high52: meta.fiftyTwoWeekHigh,
                    ma50: meta.fiftyDayAverage,
                    ma200: meta.twoHundredDayAverage
                }
            };
        }
    } catch (e) {
        const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yahooSym}`;
        const jsonStr = await fetchWithFallback(url);
        const json = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
        const res = json?.quoteResponse?.result?.[0];
        if (res) {
            return {
                name: res.shortName || yahooSym,
                price: res.regularMarketPrice,
                type: res.trailingPE ? 'STOCK' : 'ETF',
                pe: res.trailingPE,
                beta: res.beta || 1.0,
                returns: { r1y: 0, r3y: 0, r5y: 0 }
            };
        }
    }
    return null;
}

async function fetchGoogleFinance(sym) {
    let html = await fetchWithFallback(`https://www.google.com/finance/quote/${sym}:NSE`);
    if (html.includes("Couldn't find")) html = await fetchWithFallback(`https://www.google.com/finance/quote/${sym}:BSE`);

    const priceMatch = html.match(/class="YMlKec fxKbKc">₹?([0-9,.]+)</);
    const nameMatch = html.match(/<div class="zzDege">([^<]+)</) || html.match(/<h1[^>]*>([^<]+)</);
    const rangeMatch = html.match(/Year range.*?<div[^>]*>₹?([0-9,.]+)\s*-\s*₹?([0-9,.]+)/);

    if (priceMatch) {
        const price = parseFloat(priceMatch[1].replace(/,/g, ''));
        let high52 = 0, low52 = 0;
        if (rangeMatch) {
            low52 = parseFloat(rangeMatch[1].replace(/,/g, ''));
            high52 = parseFloat(rangeMatch[2].replace(/,/g, ''));
        } else {
            high52 = price * 1.05; low52 = price * 0.95;
        }
        return {
            name: nameMatch ? nameMatch[1] : sym,
            price: price,
            type: 'ETF',
            pe: null, roe: null,
            source: 'Google',
            technicals: { high52, low52 }
        };
    }
    return null;
}

// --- INTERACTION & CALCULATIONS ---

function processInput() {
    const input = document.getElementById('stockInput');
    const val = input.value.trim().toUpperCase();
    if (!val) return;
    const symbols = val.split(',').map(s => s.trim()).filter(s => s);
    input.value = '';

    const el1 = document.getElementById('empty-watchlist');
    const el2 = document.getElementById('main-empty-state');
    if (el1) el1.classList.add('hidden');
    if (el2) el2.classList.add('hidden');

    symbols.forEach(rawSym => {
        const sym = cleanTicker(rawSym);
        if (portfolio[sym]) return;
        portfolio[sym] = { qty: 0, avg: 0 };
        switchTab('watchlist');
        renderWatchlistItem(sym, true);
        createCardSkeleton(sym);
        fetchAsset(sym);
    });
    saveState();
}

function removeStock(sym) {
    delete portfolio[sym]; delete livePrices[sym]; delete stockAnalysis[sym];
    const w = document.getElementById(`wl-${sym}`);
    const c = document.getElementById(`card-${sym}`);
    if (w) w.remove(); if (c) c.remove();
    saveState();
}

window.unlockPrice = function (sym, event) {
    if (event) event.stopPropagation();
    if (!portfolio[sym]) return;

    // Delete frozen analysis state
    delete portfolio[sym].analyzedPrice;
    delete portfolio[sym].analyzedLevels;
    delete portfolio[sym].analyzedState;
    delete portfolio[sym].analyzedAction;

    saveState(true);

    if (typeof showToast === 'function') {
        showToast("Price unlocked. Fetching live spot data...", "success");
    }

    // Put it in loading state and refetch
    const card = document.getElementById(`card-${sym}`);
    if (card) {
        card.classList.add('updating');
    }
    fetchAsset(sym);
}

function clearAll() {
    if (confirm("Clear All?")) {
        portfolio = {}; livePrices = {}; stockAnalysis = {};
        document.getElementById('watchlist-container').innerHTML = `<div id="empty-watchlist" class="p-8 text-center text-gray-400 text-sm italic">Add stocks...</div>`;
        document.getElementById('view-portfolio').innerHTML = '';
        document.getElementById('view-watchlist').innerHTML = '';
        document.getElementById('main-empty-state').classList.remove('hidden');
        saveState();
    }
}

function handleEnter(e) { if (e.key === "Enter") processInput(); }

window.updateHolding = function (sym, field, val) {
    if (!portfolio[sym]) return;
    const oldQty = portfolio[sym].qty;
    portfolio[sym][field] = parseFloat(val) || 0;

    if (field === 'qty') {
        const newQty = portfolio[sym].qty;
        if ((oldQty === 0 && newQty > 0) || (oldQty > 0 && newQty === 0)) {
            if (stockAnalysis[sym]) renderCard(sym, stockAnalysis[sym]);
            renderWatchlistItem(sym, false);
        }
    }
    saveState();
    updateCardPnL(sym);
    calculateTotals();
}

function calculateTotals() {
    let tInv = 0, tCur = 0;
    for (let sym in portfolio) {
        if (livePrices[sym]) {
            const q = portfolio[sym].qty;
            tInv += q * portfolio[sym].avg;
            tCur += q * livePrices[sym];
        }
    }
    const pnl = tCur - tInv;
    document.getElementById('total-value').innerText = `₹${Math.round(tCur).toLocaleString()}`;
    const pnlEl = document.getElementById('total-pnl');
    pnlEl.innerText = `₹${Math.round(pnl).toLocaleString()}`;
    pnlEl.className = `font-bold text-lg leading-tight ${pnl >= 0 ? 'text-green-600' : 'text-red-500'}`;

    // Call logic function from logic.js
    if (typeof calculatePortfolioAggregates === 'function') {
        calculatePortfolioAggregates();
    }
}

function switchTab(tab) {
    activeTab = tab;
    saveState(false);
    const views = { 'portfolio': 'view-portfolio', 'watchlist': 'view-watchlist', 'summary': 'view-summary', 'support': 'view-support' };
    const tabs = { 'portfolio': 'tab-portfolio', 'watchlist': 'tab-watchlist', 'summary': 'tab-summary' };
    const es = document.getElementById('main-empty-state');

    if (Object.keys(portfolio).length === 0 && tab !== 'support') {
        Object.values(views).forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        if (es) es.classList.remove('hidden');
        return;
    } else {
        if (es) es.classList.add('hidden');
    }

    Object.keys(views).forEach(key => {
        const el = document.getElementById(views[key]);
        if (el) {
            if (key === tab) el.classList.remove('hidden');
            else el.classList.add('hidden');
        }
    });

    Object.keys(tabs).forEach(key => {
        const btn = document.getElementById(tabs[key]);
        if (btn) {
            if (key === tab) {
                btn.className = "tab-active py-1 transition-colors flex items-center gap-2";
            } else {
                btn.className = "tab-inactive py-1 transition-colors flex items-center gap-2";
            }
        }
    });

    if (tab === 'summary') renderSignalSummary();
}

function updateReqCount() {
    const el = document.getElementById('requestCounter');
    if (el) el.style.display = activeRequests > 0 ? 'block' : 'none';
}

// --- AUTOCOMPLETE SEARCH ---
let searchTimeout;

async function handleSearchInput(event) {
    const query = event.target.value.trim();
    const dropdown = document.getElementById('autocomplete-results');
    
    if (query.length < 3) {
        dropdown.classList.add('hidden');
        return;
    }

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        dropdown.innerHTML = `<div class="p-3 text-center text-slate-400 text-xs flex items-center justify-center gap-2"><div class="loader"></div> Searching...</div>`;
        dropdown.classList.remove('hidden');

        try {
            const [mfRes, stockRes] = await Promise.allSettled([
                fetchWithFallback(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(query)}`),
                fetchWithFallback(`https://www.screener.in/api/company/search/?q=${encodeURIComponent(query)}`)
            ]);

            let resultsHTML = '';
            let totalResults = 0;

            // Handle Stocks
            if (stockRes.status === 'fulfilled' && stockRes.value) {
                const data = typeof stockRes.value === 'string' ? JSON.parse(stockRes.value) : stockRes.value;
                if (Array.isArray(data)) {
                    data.slice(0, 5).forEach(item => {
                        const tickerMatch = item.url.match(/\/company\/(.*?)\//);
                        const ticker = tickerMatch ? tickerMatch[1] : null;
                        if (ticker) {
                            totalResults++;
                            resultsHTML += `<div onclick="selectSearchResult('${ticker}')" class="p-2 border-b border-slate-700/50 hover:bg-[#0f172a] cursor-pointer flex justify-between items-center transition-colors">
                                <span class="font-medium text-slate-200 text-xs truncate max-w-[75%] pr-2" title="${item.name}">${item.name}</span>
                                <span class="text-[9px] bg-indigo-900/30 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-800/50 flex-shrink-0">EQ: ${ticker}</span>
                            </div>`;
                        }
                    });
                }
            }

            // Handle MFs
            if (mfRes.status === 'fulfilled' && mfRes.value) {
                const data = typeof mfRes.value === 'string' ? JSON.parse(mfRes.value) : mfRes.value;
                if (Array.isArray(data)) {
                    data.slice(0, 5).forEach(item => {
                        totalResults++;
                        resultsHTML += `<div onclick="selectSearchResult('${item.schemeCode}')" class="p-2 border-b border-slate-700/50 hover:bg-[#0f172a] cursor-pointer flex justify-between items-center transition-colors">
                            <span class="font-medium text-slate-200 text-xs truncate max-w-[75%] pr-2" title="${item.schemeName}">${item.schemeName}</span>
                            <span class="text-[9px] bg-amber-900/30 text-amber-400 px-1.5 py-0.5 rounded border border-amber-800/50 flex-shrink-0">MF: ${item.schemeCode}</span>
                        </div>`;
                    });
                }
            }

            if (totalResults === 0) {
                dropdown.innerHTML = `<div class="p-3 text-center text-slate-500 text-xs italic">No results found for "${query}"</div>`;
            } else {
                dropdown.innerHTML = resultsHTML;
            }

        } catch (e) {
            dropdown.innerHTML = `<div class="p-3 text-center text-red-400 text-xs">Search failed</div>`;
        }
    }, 400);
}

function selectSearchResult(symbol) {
    const input = document.getElementById('stockInput');
    const dropdown = document.getElementById('autocomplete-results');
    input.value = symbol;
    dropdown.classList.add('hidden');
    processInput();
}

// Hide dropdown when clicking outside
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('autocomplete-results');
    const input = document.getElementById('stockInput');
    if (dropdown && !dropdown.contains(e.target) && e.target !== input) {
        dropdown.classList.add('hidden');
    }
});

// Start App
document.addEventListener('DOMContentLoaded', initApp);

