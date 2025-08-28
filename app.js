/* ===============================
   Best Card Offers – App Logic
   Requires: window.cardsData (loaded first)
   =============================== */

(() => {
  // ---------- DOM ----------
  const merchantInput = document.getElementById('merchant-input');
  const merchantDatalist = document.getElementById('merchant-list');
  const resultsDiv = document.getElementById('results');
  const searchBtn = document.getElementById('search-btn');
  const speakBtn = document.getElementById('speak-btn');
  const addCardSelect = document.getElementById('add-card-select');
  const addCardBtn = document.getElementById('add-card-btn');
  const savedCardsWrap = document.getElementById('saved-cards');

  // ---------- Storage ----------
  const STORAGE_KEY = 'bestcard_sg_saved_cards_v2';

  function loadSavedCards() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  function saveSavedCards(cards) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  }

  let savedCards = loadSavedCards();

  // ---------- Helpers ----------
  const isArray = Array.isArray;

  // Build a flat list of all cards with bank attached
  function enumerateAllCards(cardsData) {
    const out = [];
    for (const bank in cardsData) {
      if (!isArray(cardsData[bank])) continue;
      cardsData[bank].forEach(card => {
        out.push({ bank, ...card });
      });
    }
    return out;
  }

  const ALL_CARDS = enumerateAllCards(window.cardsData || {});
  const CANONICAL_CATEGORIES = buildCanonicalCategorySet(window.cardsData || {});
  const CATEGORY_SYNONYMS = buildCategorySynonyms();

  function buildCanonicalCategorySet(data) {
    const set = new Set();
    for (const bank in data) {
      if (!isArray(data[bank])) continue;
      data[bank].forEach(card => {
        if (card && card.benefits) {
          Object.keys(card.benefits).forEach(cat => set.add(cat));
        }
      });
    }
    return set;
  }

  function buildCategorySynonyms() {
    // Map user words/phrases → array of canonical benefit keys to search
    // Add or tweak as needed to match your JSON categories
    return {
      dining: ['dining', 'food', 'restaurants', 'cafes', 'fast_food', 'f&b'],
      restaurant: ['dining', 'restaurants', 'food'],
      restaurants: ['dining', 'restaurants', 'food'],
      cafe: ['dining', 'cafes', 'food'],
      cafes: ['dining', 'cafes', 'food'],
      pizza: ['dining', 'fast_food', 'food'],
      burger: ['dining', 'fast_food', 'food'],
      coffee: ['dining', 'cafes', 'food'],

      groceries: ['supermarkets', 'grocery', 'groceries'],
      supermarket: ['supermarkets', 'grocery', 'groceries'],
      grocery: ['supermarkets', 'grocery', 'groceries'],

      petrol: ['petrol', 'fuel'],
      fuel: ['petrol', 'fuel'],
      gas: ['petrol', 'fuel'],

      transport: ['public_transport', 'online_transport', 'ride_hailing', 'transport'],
      taxi: ['ride_hailing', 'transport', 'online_transport'],
      grab: ['ride_hailing', 'online_transport', 'transport'],
      gojek: ['ride_hailing', 'online_transport', 'transport'],

      online: ['online_shopping', 'ecommerce', 'shopping'],
      ecommerce: ['online_shopping', 'ecommerce', 'shopping'],
      shopping: ['shopping', 'online_shopping', 'department_stores'],

      department: ['department_stores', 'shopping'],
      electronics: ['electronics', 'shopping'],
      telco: ['telco', 'utilities'],
      mobile: ['telco', 'utilities'],
      broadband: ['telco', 'utilities'],
      utilities: ['utilities'],
      electricity: ['utilities'],
      travel: ['travel', 'hotels', 'airlines'],
      hotel: ['travel', 'hotels'],
      airlines: ['travel', 'airlines'],
      flights: ['travel', 'airlines'],

      entertainment: ['entertainment', 'dining'],
      pharmacy: ['pharmacy', 'healthcare', 'guardian', 'watsons'],
      healthcare: ['healthcare', 'pharmacy'],

      // Generic fallbacks
      food: ['dining', 'restaurants', 'fast_food', 'cafes'],
      drinks: ['dining', 'cafes', 'bars'],
      bars: ['dining', 'bars'],
      coffee_tea: ['dining', 'cafes'],
    };
  }

  function normalize(str) {
    return (str || '').toString().trim().toLowerCase();
  }

  // Extract a numeric “strength” from a benefit description
  function extractBenefitStrength(desc = '') {
    const s = desc.toLowerCase();
    let score = 0;

    // percentages
    const pctMatches = [...s.matchAll(/(\d+(?:\.\d+)?)\s*%/g)];
    if (pctMatches.length) {
      const maxPct = Math.max(...pctMatches.map(m => parseFloat(m[1])));
      score += maxPct * 8; // weight for % cashback
    }

    // mpd (miles per dollar)
    const mpd = s.match(/(\d+(?:\.\d+)?)\s*(?:mpd|miles ?per ?dollar|miles\/\$)/i);
    if (mpd) score += parseFloat(mpd[1]) * 12; // weight miles

    // X points / 10X
    const xPoints = s.match(/(\d+)\s*[xX]\s*(?:points|uni\$|rewards|yuu)?/);
    if (xPoints) score += parseFloat(xPoints[1]) * 4;

    // “up to” slight penalty so guaranteed rates edge out “up to”
    if (s.includes('up to')) score *= 0.95;

    return score;
  }

  // Build suggestions list (merchants + categories + aliases)
  function buildSuggestionList(data) {
    const set = new Set();
    // Add canonical categories nicely cased
    CANONICAL_CATEGORIES.forEach(cat => set.add(niceLabel(cat)));

    for (const bank in data) {
      if (!isArray(data[bank])) continue;
      data[bank].forEach(card => {
        if (!card?.benefits) return;
        for (const cat in card.benefits) {
          const b = card.benefits[cat];
          // merchants
          if (isArray(b.merchants)) {
            b.merchants.forEach(m => {
              if (m?.name) set.add(m.name);
              if (isArray(m?.aliases)) m.aliases.forEach(a => a && set.add(a));
            });
          }
        }
      });
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  function niceLabel(slug) {
    return slug
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  function slugifyCategory(cat) {
    // Convert user-visible “Dining & Restaurants” back to key-ish
    return normalize(cat).replace(/\s*&\s*/g, '_').replace(/\s+/g, '_');
  }

  // MCC detection
  function parseMccQuery(q) {
    const m = q.match(/\b(\d{4})\b/);
    return m ? m[1] : null;
  }

  // Map a free text to candidate categories
  function expandToCategories(q) {
    const n = normalize(q);
    const slug = slugifyCategory(n);
    const cats = new Set();

    // direct matches to canonical categories
    for (const c of CANONICAL_CATEGORIES) {
      if (normalize(c) === n || normalize(c) === slug) cats.add(c);
    }

    // synonyms
    if (CATEGORY_SYNONYMS[n]) CATEGORY_SYNONYMS[n].forEach(c => cats.add(c));
    if (CATEGORY_SYNONYMS[slug]) CATEGORY_SYNONYMS[slug].forEach(c => cats.add(c));

    // Single word heuristics
    if (!cats.size) {
      // try partial contains
      for (const c of CANONICAL_CATEGORIES) {
        if (normalize(c).includes(n)) cats.add(c);
      }
    }

    return Array.from(cats);
  }

  // ---------- Datalist ----------
  const ALL_SUGGESTIONS = buildSuggestionList(window.cardsData || {});
  buildDatalist(ALL_SUGGESTIONS);

  function buildDatalist(items, limit = 500) {
    merchantDatalist.innerHTML = '';
    const fragment = document.createDocumentFragment();
    items.slice(0, limit).forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      fragment.appendChild(opt);
    });
    merchantDatalist.appendChild(fragment);
  }

  // When user focuses input, show more suggestions (hint for mobile)
  merchantInput.addEventListener('focus', () => {
    // Nudge mobile browsers to show datalist
    merchantInput.setAttribute('autocomplete', 'on');
  });

  // ---------- Voice Search ----------
  let recognition;
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new Rec();
    recognition.lang = 'en-SG';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript || '';
      merchantInput.value = transcript;
      findBestCards();
    };
    recognition.onerror = () => {
      // no-op; keep UI simple
    };
  }

  speakBtn.addEventListener('click', () => {
    if (!recognition) {
      alert('Voice input not supported on this browser.');
      return;
    }
    recognition.start();
  });

  // ---------- Populate Add Card Select ----------
  function populateAddCardSelect() {
    addCardSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a card to add…';
    placeholder.disabled = true;
    placeholder.selected = true;
    addCardSelect.appendChild(placeholder);

    // Order: by bank, then card name
    const sorted = [...ALL_CARDS].sort((a, b) => {
      const x = (a.bank + ' - ' + a.card_name).toLowerCase();
      const y = (b.bank + ' - ' + b.card_name).toLowerCase();
      return x.localeCompare(y);
    });

    sorted.forEach(({ bank, card_name }) => {
      const opt = document.createElement('option');
      opt.value = `${bank}|||${card_name}`;
      opt.textContent = `${bank} — ${card_name}`;
      addCardSelect.appendChild(opt);
    });
  }
  populateAddCardSelect();

  // ---------- Saved Cards UI ----------
  function renderSavedCards() {
    savedCardsWrap.innerHTML = '';
    if (!savedCards.length) {
      savedCardsWrap.innerHTML = `<p style="color:#666">No saved cards yet. Add from the list above.</p>`;
      return;
    }
    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexWrap = 'wrap';
    list.style.gap = '8px';

    savedCards.forEach(c => {
      const chip = document.createElement('div');
      chip.className = 'saved-chip';
      chip.style.display = 'inline-flex';
      chip.style.alignItems = 'center';
      chip.style.gap = '6px';
      chip.style.padding = '6px 10px';
      chip.style.background = '#eef5ff';
      chip.style.border = '1px solid #cfe0ff';
      chip.style.borderRadius = '999px';
      chip.style.fontSize = '0.9rem';

      const span = document.createElement('span');
      span.textContent = `${c.bank} — ${c.card_name}`;
      const btn = document.createElement('button');
      btn.textContent = '✕';
      btn.style.border = 'none';
      btn.style.background = 'transparent';
      btn.style.cursor = 'pointer';
      btn.title = 'Remove';
      btn.addEventListener('click', () => {
        savedCards = savedCards.filter(sc => !(sc.bank === c.bank && sc.card_name === c.card_name));
        saveSavedCards(savedCards);
        renderSavedCards();
      });

      chip.appendChild(span);
      chip.appendChild(btn);
      list.appendChild(chip);
    });

    savedCardsWrap.appendChild(list);
  }
  renderSavedCards();

  addCardBtn.addEventListener('click', () => {
    const val = addCardSelect.value;
    if (!val) return;
    const [bank, card_name] = val.split('|||');
    if (!savedCards.some(c => c.bank === bank && c.card_name === card_name)) {
      savedCards.push({ bank, card_name });
      saveSavedCards(savedCards);
      renderSavedCards();
    }
  });

  // ---------- Find Best Cards ----------
  searchBtn.addEventListener('click', findBestCards);
  merchantInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') findBestCards();
  });

  function findBestCards() {
  const query = merchantInput.value.trim().toLowerCase();
  if (!query) return;

  let allResults = [];

  for (const bank in window.cardsData) {
    window.cardsData[bank].forEach(card => {
      for (const category in card.benefits) {
        const benefit = card.benefits[category];
        let match = false;

        // Merchant match
      if (benefit.merchants){
        if (benefit.merchants.some(m => [m.name, ...(m.aliases || [])].map(x => x.toLowerCase()).includes(query))) {
          match = true;
        }
      }

        // Category match
        if (category.toLowerCase().includes(query)) {
          match = true;
        }

        if (match) {
          const label = `${bank} - ${card.card_name}`;
          allResults.push({
            card: label,
            bank,
            description: benefit.description || `Benefit in ${category}`,
            category,
            isSaved: savedCards.includes(${card.card_name}),
            // simple score metric, can expand with miles/%
            score: benefit.rewards || 1 
          });
        }
      }
    });
  }

  // Rank by score (desc)
  allResults.sort((a, b) => b.score - a.score);

  // Separate saved vs not saved
  const savedResults = allResults.filter(r => r.isSaved);
  const otherResults = allResults.filter(r => !r.isSaved);

  // Combine with saved first
  const finalResults = [...savedResults, ...otherResults].slice(0, 5);
    console.log(finalResults);
    renderResults(finalResults);
  }

   function populateMerchantDatalist() {
  const datalist = document.getElementById("merchant-list");
  datalist.innerHTML = "";

  // Collect categories → merchants/synonyms mapping
  const categoryMap = {};

  // From cardsData merchants
  for (const bank in window.cardsData) {
    window.cardsData[bank].forEach(card => {
      for (const category in card.benefits) {
        if (!categoryMap[category]) categoryMap[category] = new Set();
        const benefit = card.benefits[category];
        if (benefit.merchants) {
          benefit.merchants.forEach(m => {
            categoryMap[category].add(m.name);
            (m.aliases || []).forEach(alias => categoryMap[category].add(alias));
          });
        }
      }
    });
  }

  // From category synonyms
  for (const category in CATEGORY_SYNONYMS) {
    if (!categoryMap[category]) categoryMap[category] = new Set();
    CATEGORY_SYNONYMS[category].forEach(syn => categoryMap[category].add(syn));
  }

  // Build grouped datalist
  for (const category in categoryMap) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = category.charAt(0).toUpperCase() + category.slice(1);

    Array.from(categoryMap[category])
      .sort()
      .forEach(item => {
        const option = document.createElement("option");
        option.value = item;
        optgroup.appendChild(option);
      });

    datalist.appendChild(optgroup);
  }
}
   populateMerchantDatalist();
  // ---------- Render ----------
  function renderResults(rows) {
              console.log(rows);

      if (!rows.length) {
        resultsDiv.innerHTML = "<p>No matching card benefits found.</p>";
        return;
      }

      let html = `<table>
        <tr><th>Card</th><th>Benefit</th></tr>`;
      rows.forEach(r => {
        html += `<tr>
          <td>${r.card} ${r.isSaved ? '<span class="badge">Saved</span>' : ''}</td>
          <td>${r.description}</td>
        </tr>`;
      });
      html += "</table>";
      resultsDiv.innerHTML = html;
         console.log(html);

  }

  function renderTable(rows) {
    let html = `
      <table class="results-table desktop-view">
        <thead>
          <tr>
            <th>Bank</th>
            <th>Card</th>
            <th>Matched Category / Merchant</th>
            <th>Benefit</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
    `;
    rows.forEach(r => {
      const savedBadge = r.isSaved ? `<span class="badge">Saved</span>` : '';
      const lines = r.benefits
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, 3) // compact view
        .map(b => {
          const merchants = b.matchedMerchants.length ? ` — ${b.matchedMerchants.join(', ')}` : '';
          return `<div><strong>${niceLabel(b.category)}</strong>${merchants}<br><span style="color:#555">${b.description}</span></div>`;
        })
        .join('');

      html += `
        <tr class="${r.isSaved ? 'saved-row' : ''}">
          <td>${r.bank}</td>
          <td>${r.card} ${savedBadge}</td>
          <td>${lines}</td>
          <td>${bestBenefitLine(r.benefits)}</td>
          <td>${Math.round(r.rawScore)}</td>
        </tr>
      `;
    });
    html += `</tbody></table>`;
    return html;
  }

  function bestBenefitLine(benefits) {
    if (!benefits?.length) return '';
    const top = [...benefits].sort((a, b) => b.matchScore - a.matchScore)[0];
    return `<span title="${escapeHtml(top.description)}">${escapeHtml(top.description)}</span>`;
  }

  function renderMobileCards(rows) {
    let html = `<div class="mobile-cards">`;
    rows.forEach(r => {
      const savedBadge = r.isSaved ? `<span class="badge">Saved</span>` : '';
      const details = r.benefits
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, 3)
        .map(b => {
          const merchants = b.matchedMerchants.length ? ` — ${b.matchedMerchants.join(', ')}` : '';
          return `<p><strong>${niceLabel(b.category)}</strong>${merchants}<br>${escapeHtml(b.description)}</p>`;
        })
        .join('');

      html += `
        <div class="result-card ${r.isSaved ? 'saved-card' : ''}">
          <h3>${r.bank} — ${r.card} ${savedBadge}</h3>
          ${details}
          <p><strong>Score:</strong> ${Math.round(r.rawScore)}</p>
        </div>
      `;
    });
    html += `</div>`;
    return html;
  }

   document.getElementById("clear-merchant").addEventListener("click", () => {
  const merchantInput = document.getElementById("merchant-input");
  merchantInput.value = "";
  merchantInput.focus();
});
   
  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  // ---------- Expose (optional debugging) ----------
  window._bestcard = {
    findBestCards,
    savedCards,
    ALL_SUGGESTIONS,
    CANONICAL_CATEGORIES
  };
})();
