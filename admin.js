/**
 * admin.js – Modulares Admin-Panel für "Abi Finanzen 28"
 *
 * Sicherheit:
 *   - Rendert & arbeitet ausschließlich bei sessionStorage.getItem('abikasse_role') === 'admin'.
 *   - Nutzt ausschließlich window.AbikasseAPI.callAPI(...) (mit abikasse_session_token).
 *   - Keine nativen Browser-Popups (alert/confirm).
 */
(function () {
  'use strict';

  const SECTIONS = [
    { id: 'budget', label: 'Budget & Ziel' },
    { id: 'categories', label: 'Kategorien' },
    { id: 'security', label: 'Sicherheit & Log' }
  ];

  let activeSection = 'budget';
  let logsLoadedOnce = false;
  let pendingStornoTx = null;
  let stornoModalBound = false;

  const euroFormatter = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  });

  function isAdminSession() {
    try {
      return sessionStorage.getItem('abikasse_role') === 'admin';
    } catch (err) {
      return false;
    }
  }

  function getAPI() {
    return window.AbikasseAPI || null;
  }

  function getTabContainer() {
    return document.getElementById('tab-admin');
  }

  function cloneConfig() {
    const api = getAPI();
    const cfg = api && typeof api.getConfig === 'function' ? api.getConfig() : null;
    const rawCats = cfg && Array.isArray(cfg.kategorien) ? cfg.kategorien : [];
    return {
      jahrgang_name: cfg && cfg.jahrgang_name ? String(cfg.jahrgang_name) : '',
      abiball_ziel: cfg && !isNaN(Number(cfg.abiball_ziel)) ? Number(cfg.abiball_ziel) : 0,
      kategorien: rawCats.map(function (c) {
        return {
          id: String(c && c.id ? c.id : ''),
          name: String(c && c.name ? c.name : ''),
          color: String(c && c.color ? c.color : '#64748b'),
          budget: c && !isNaN(Number(c.budget)) ? Number(c.budget) : 0,
          active: c ? c.active !== false : true
        };
      })
    };
  }

  function notifySuccess(msg) {
    const api = getAPI();
    if (api && typeof api.showSuccessToast === 'function') {
      api.showSuccessToast(msg);
    }
  }

  function notifyError(msg) {
    const api = getAPI();
    if (api && typeof api.showErrorToast === 'function') {
      api.showErrorToast(msg);
    }
  }

  function buildCategoryId(name, existingList) {
    const baseSlug = String(name || 'kategorie')
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 20) || 'kategorie';

    let candidate = 'cat_' + baseSlug;
    const existingIds = new Set((existingList || []).map(function (c) { return c.id; }));
    if (existingIds.has(candidate)) {
      candidate = 'cat_' + baseSlug + '_' + Date.now().toString(36);
    }
    return candidate;
  }

  function bindStornoModal() {
    if (stornoModalBound) return;
    const modal = document.getElementById('modal-storno-confirm');
    const closeBtn = document.getElementById('storno-modal-close');
    const cancelBtn = document.getElementById('storno-modal-cancel');
    const confirmBtn = document.getElementById('storno-modal-confirm');
    const errorEl = document.getElementById('storno-modal-error');
    if (!modal || !confirmBtn) return;

    stornoModalBound = true;

    function closeModal() {
      pendingStornoTx = null;
      if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
      }
      confirmBtn.disabled = false;
      confirmBtn.removeAttribute('aria-busy');
      if (modal.open) modal.close();
    }

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    confirmBtn.addEventListener('click', function () {
      if (!isAdminSession() || !pendingStornoTx) {
        closeModal();
        return;
      }
      const api = getAPI();
      if (!api) return;

      const txToStorno = pendingStornoTx;
      if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
      }
      confirmBtn.disabled = true;
      confirmBtn.setAttribute('aria-busy', 'true');

      api.callAPI('stornoTransaction', { rowNumber: txToStorno.rowNumber })
        .then(function () {
          closeModal();
          notifySuccess('Buchung wurde storniert.');
          const tasks = [];
          if (typeof api.reloadHistory === 'function') tasks.push(api.reloadHistory());
          if (typeof api.reloadCoreState === 'function') tasks.push(api.reloadCoreState());
          return Promise.all(tasks);
        })
        .catch(function (err) {
          confirmBtn.disabled = false;
          confirmBtn.removeAttribute('aria-busy');
          const msg = (err && err.message) ? err.message : 'Stornierung fehlgeschlagen.';
          if (errorEl) {
            errorEl.textContent = msg;
            errorEl.classList.remove('hidden');
          } else {
            notifyError(msg);
          }
        });
    });
  }

  function openStornoModal(tx) {
    if (!isAdminSession() || !tx || !tx.rowNumber) return;
    bindStornoModal();
    const modal = document.getElementById('modal-storno-confirm');
    const summaryEl = document.getElementById('storno-modal-summary');
    const errorEl = document.getElementById('storno-modal-error');
    const confirmBtn = document.getElementById('storno-modal-confirm');
    if (!modal || !summaryEl) return;

    pendingStornoTx = tx;
    const desc = tx.description || tx.category || 'Buchung';
    const amountText = euroFormatter.format(Number(tx.amount) || 0);
    summaryEl.textContent = desc + ' · ' + amountText + (tx.date ? ' (' + tx.date + ')' : '');

    if (errorEl) {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
    }
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.removeAttribute('aria-busy');
    }
    modal.showModal();
  }

  function renderBudgetView(container) {
    const cfg = cloneConfig();
    const activeCats = cfg.kategorien.filter(function (c) { return c.active !== false; });

    const card = document.createElement('article');
    card.className = 'admin-card';

    const header = document.createElement('div');
    header.className = 'admin-card-header';
    const title = document.createElement('h3');
    title.textContent = 'Jahrgang & Abiball-Ziel';
    header.appendChild(title);
    card.appendChild(header);

    const form = document.createElement('form');

    const grid = document.createElement('div');
    grid.className = 'admin-grid-2';

    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Jahrgangs-Titel';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.required = true;
    nameInput.value = cfg.jahrgang_name;
    nameInput.placeholder = 'z. B. Abikasse 2028';
    nameLabel.appendChild(nameInput);
    grid.appendChild(nameLabel);

    const goalLabel = document.createElement('label');
    goalLabel.textContent = 'Abiball-Gesamtziel (€)';
    const goalInput = document.createElement('input');
    goalInput.type = 'number';
    goalInput.min = '0';
    goalInput.step = '0.01';
    goalInput.required = true;
    goalInput.value = String(cfg.abiball_ziel || 0);
    goalLabel.appendChild(goalInput);
    grid.appendChild(goalLabel);

    form.appendChild(grid);

    const budgetsHeading = document.createElement('h4');
    budgetsHeading.textContent = 'Kategorie-Budgets (aktive Kategorien)';
    budgetsHeading.style.marginTop = '1rem';
    budgetsHeading.style.marginBottom = '0.45rem';
    form.appendChild(budgetsHeading);

    const budgetInputs = new Map();
    if (activeCats.length === 0) {
      const emptyP = document.createElement('p');
      emptyP.className = 'admin-muted';
      emptyP.textContent = 'Keine aktiven Kategorien vorhanden.';
      form.appendChild(emptyP);
    } else {
      const list = document.createElement('div');
      activeCats.forEach(function (cat) {
        const row = document.createElement('div');
        row.className = 'admin-budget-row';

        const lbl = document.createElement('span');
        lbl.className = 'admin-budget-label';
        const dot = document.createElement('span');
        dot.className = 'admin-color-dot';
        dot.style.backgroundColor = cat.color || '#64748b';
        const nameTxt = document.createElement('span');
        nameTxt.textContent = cat.name;
        lbl.appendChild(dot);
        lbl.appendChild(nameTxt);

        const inputWrap = document.createElement('div');
        inputWrap.className = 'currency-input-wrap';

        const input = document.createElement('input');
        input.type = 'number';
        input.inputMode = 'decimal';
        input.setAttribute('inputmode', 'decimal');
        input.min = '0';
        input.step = '0.01';
        input.className = 'admin-budget-input';
        input.value = String(cat.budget || 0);
        input.setAttribute('aria-label', 'Budget für ' + cat.name + ' (€)');
        input.addEventListener('keydown', function (ev) {
          if (ev.key === 'e' || ev.key === 'E' || ev.key === '+' || ev.key === '-') {
            ev.preventDefault();
          }
        });
        budgetInputs.set(cat.id, input);

        const suffix = document.createElement('span');
        suffix.className = 'currency-input-suffix';
        suffix.setAttribute('aria-hidden', 'true');
        suffix.textContent = '€';

        inputWrap.appendChild(input);
        inputWrap.appendChild(suffix);

        row.appendChild(lbl);
        row.appendChild(inputWrap);
        list.appendChild(row);
      });
      form.appendChild(list);
    }

    const errP = document.createElement('p');
    errP.className = 'admin-inline-error hidden';
    form.appendChild(errP);

    const actions = document.createElement('div');
    actions.style.marginTop = '1rem';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'admin-btn-primary';
    saveBtn.textContent = 'Änderungen speichern';
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!isAdminSession()) return;
      const api = getAPI();
      if (!api) return;

      errP.textContent = '';
      errP.classList.add('hidden');

      const nextName = nameInput.value.trim();
      const nextGoal = parseFloat(goalInput.value);
      if (!nextName) {
        errP.textContent = 'Bitte einen Jahrgangs-Titel eingeben.';
        errP.classList.remove('hidden');
        return;
      }
      if (isNaN(nextGoal) || nextGoal < 0) {
        errP.textContent = 'Bitte ein gültiges Abiball-Gesamtziel (>= 0) eingeben.';
        errP.classList.remove('hidden');
        return;
      }

      const nextCats = cfg.kategorien.map(function (cat) {
        if (!budgetInputs.has(cat.id)) return cat;
        const val = parseFloat(budgetInputs.get(cat.id).value);
        return Object.assign({}, cat, {
          budget: !isNaN(val) && val >= 0 ? val : 0
        });
      });

      saveBtn.disabled = true;
      saveBtn.setAttribute('aria-busy', 'true');

      api.callAPI('updateConfig', {
        jahrgang_name: nextName,
        abiball_ziel: nextGoal,
        kategorien: nextCats
      })
        .then(function (res) {
          if (res && res.config && typeof api.applyAppConfig === 'function') {
            api.applyAppConfig(res.config);
          }
          notifySuccess('Budget & Ziel gespeichert.');
          renderPanel();
        })
        .catch(function (err) {
          saveBtn.disabled = false;
          saveBtn.removeAttribute('aria-busy');
          errP.textContent = (err && err.message) ? err.message : 'Speichern fehlgeschlagen.';
          errP.classList.remove('hidden');
        });
    });

    card.appendChild(form);
    container.appendChild(card);
  }

  function saveCategoriesConfig(nextCategories, successMessage, triggerBtn, errorEl) {
    if (!isAdminSession()) return;
    const api = getAPI();
    if (!api) return;

    if (errorEl) {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
    }
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.setAttribute('aria-busy', 'true');
    }

    api.callAPI('updateConfig', { kategorien: nextCategories })
      .then(function (res) {
        if (res && res.config && typeof api.applyAppConfig === 'function') {
          api.applyAppConfig(res.config);
        }
        notifySuccess(successMessage);
        renderPanel();
      })
      .catch(function (err) {
        if (triggerBtn) {
          triggerBtn.disabled = false;
          triggerBtn.removeAttribute('aria-busy');
        }
        const msg = (err && err.message) ? err.message : 'Kategorien konnten nicht gespeichert werden.';
        if (errorEl) {
          errorEl.textContent = msg;
          errorEl.classList.remove('hidden');
        } else {
          notifyError(msg);
        }
      });
  }

  function renderCategoriesView(container) {
    const cfg = cloneConfig();

    // Card 1: Bestehende Kategorien
    const listCard = document.createElement('article');
    listCard.className = 'admin-card';

    const listHeader = document.createElement('div');
    listHeader.className = 'admin-card-header';
    const listTitle = document.createElement('h3');
    listTitle.textContent = 'Kategorien verwalten';
    listHeader.appendChild(listTitle);
    listCard.appendChild(listHeader);

    const listHint = document.createElement('p');
    listHint.className = 'admin-muted';
    listHint.textContent = 'Feste Kategorie-IDs bleiben unverändert, damit bestehende Buchungen korrekt zugeordnet bleiben.';
    listCard.appendChild(listHint);

    const listError = document.createElement('p');
    listError.className = 'admin-inline-error hidden';

    const listWrap = document.createElement('div');
    listWrap.className = 'admin-cat-list';

    if (cfg.kategorien.length === 0) {
      const emptyP = document.createElement('p');
      emptyP.className = 'admin-muted';
      emptyP.textContent = 'Noch keine Kategorien angelegt.';
      listWrap.appendChild(emptyP);
    } else {
      cfg.kategorien.forEach(function (cat, index) {
        const isActive = cat.active !== false;
        const row = document.createElement('div');
        row.className = 'admin-cat-row' + (isActive ? '' : ' is-archived');

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = /^#[0-9a-f]{6}$/i.test(cat.color) ? cat.color : '#64748b';
        colorInput.setAttribute('aria-label', 'Farbe für ' + cat.name);

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = cat.name;
        nameInput.placeholder = 'Kategoriename';
        nameInput.setAttribute('aria-label', 'Name für ' + cat.name);

        const budgetInput = document.createElement('input');
        budgetInput.type = 'number';
        budgetInput.min = '0';
        budgetInput.step = '0.01';
        budgetInput.value = String(cat.budget || 0);
        budgetInput.setAttribute('aria-label', 'Budget für ' + cat.name);

        const statusBadge = document.createElement('span');
        statusBadge.className = 'admin-status-badge ' + (isActive ? 'is-active' : 'is-archived');
        statusBadge.textContent = isActive ? 'Aktiv' : 'Archiviert';

        const actions = document.createElement('div');
        actions.className = 'admin-cat-actions';

        const saveRowBtn = document.createElement('button');
        saveRowBtn.type = 'button';
        saveRowBtn.className = 'admin-btn-secondary';
        saveRowBtn.textContent = 'Speichern';
        saveRowBtn.addEventListener('click', function () {
          const nextName = nameInput.value.trim();
          const nextBudget = parseFloat(budgetInput.value);
          if (!nextName) {
            listError.textContent = 'Kategoriename darf nicht leer sein.';
            listError.classList.remove('hidden');
            return;
          }
          const updated = cfg.kategorien.map(function (c, i) {
            if (i !== index) return c;
            // ID bleibt strikt unverändert!
            return {
              id: c.id,
              name: nextName,
              color: colorInput.value || c.color,
              budget: !isNaN(nextBudget) && nextBudget >= 0 ? nextBudget : 0,
              active: c.active !== false
            };
          });
          saveCategoriesConfig(updated, 'Kategorie aktualisiert.', saveRowBtn, listError);
        });

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'admin-btn-secondary';
        toggleBtn.textContent = isActive ? 'Archivieren' : 'Reaktivieren';
        toggleBtn.addEventListener('click', function () {
          const updated = cfg.kategorien.map(function (c, i) {
            if (i !== index) return c;
            return Object.assign({}, c, { active: !isActive });
          });
          saveCategoriesConfig(
            updated,
            isActive ? 'Kategorie archiviert.' : 'Kategorie reaktiviert.',
            toggleBtn,
            listError
          );
        });

        actions.appendChild(saveRowBtn);
        actions.appendChild(toggleBtn);
        row.appendChild(colorInput);
        row.appendChild(nameInput);
        row.appendChild(budgetInput);
        row.appendChild(statusBadge);
        row.appendChild(actions);
        listWrap.appendChild(row);
      });
    }

    listCard.appendChild(listWrap);
    listCard.appendChild(listError);
    container.appendChild(listCard);

    // Card 2: Neue Kategorie anlegen
    const addCard = document.createElement('article');
    addCard.className = 'admin-card';

    const addHeader = document.createElement('div');
    addHeader.className = 'admin-card-header';
    const addTitle = document.createElement('h3');
    addTitle.textContent = 'Neue Kategorie anlegen';
    addHeader.appendChild(addTitle);
    addCard.appendChild(addHeader);

    const addForm = document.createElement('form');
    const addFields = document.createElement('div');
    addFields.className = 'admin-cat-edit-fields';

    const newColor = document.createElement('input');
    newColor.type = 'color';
    newColor.value = '#FF2D73';
    newColor.setAttribute('aria-label', 'Farbe der neuen Kategorie');

    const newName = document.createElement('input');
    newName.type = 'text';
    newName.placeholder = 'Name (z. B. Dekoration)';
    newName.required = true;
    newName.setAttribute('aria-label', 'Name der neuen Kategorie');

    const newBudget = document.createElement('input');
    newBudget.type = 'number';
    newBudget.min = '0';
    newBudget.step = '0.01';
    newBudget.placeholder = 'Budget (€)';
    newBudget.value = '0';
    newBudget.setAttribute('aria-label', 'Optionales Budget');

    const addBtn = document.createElement('button');
    addBtn.type = 'submit';
    addBtn.className = 'admin-btn-primary';
    addBtn.textContent = 'Hinzufügen';

    addFields.appendChild(newColor);
    addFields.appendChild(newName);
    addFields.appendChild(newBudget);
    addFields.appendChild(addBtn);
    addForm.appendChild(addFields);

    const addError = document.createElement('p');
    addError.className = 'admin-inline-error hidden';
    addForm.appendChild(addError);

    addForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const nameVal = newName.value.trim();
      if (!nameVal) {
        addError.textContent = 'Bitte einen Kategorienamen eingeben.';
        addError.classList.remove('hidden');
        return;
      }
      const budgetVal = parseFloat(newBudget.value);
      const nextCat = {
        id: buildCategoryId(nameVal, cfg.kategorien),
        name: nameVal,
        color: newColor.value || '#FF2D73',
        budget: !isNaN(budgetVal) && budgetVal >= 0 ? budgetVal : 0,
        active: true
      };
      const updated = cfg.kategorien.concat([nextCat]);
      saveCategoriesConfig(updated, 'Kategorie "' + nameVal + '" hinzugefügt.', addBtn, addError);
    });

    addCard.appendChild(addForm);
    container.appendChild(addCard);
  }

  function formatLogTimestamp(isoStr) {
    if (!isoStr) return '–';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return String(isoStr);
    return d.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function loadAndRenderLogs(listEl, refreshBtn) {
    if (!isAdminSession() || !listEl) return;
    const api = getAPI();
    if (!api) return;

    listEl.innerHTML = '';
    const loadingP = document.createElement('p');
    loadingP.className = 'admin-muted';
    loadingP.textContent = 'Protokoll wird geladen...';
    listEl.appendChild(loadingP);

    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.setAttribute('aria-busy', 'true');
    }

    api.callAPI('getAdminLog')
      .then(function (res) {
        logsLoadedOnce = true;
        if (refreshBtn) {
          refreshBtn.disabled = false;
          refreshBtn.removeAttribute('aria-busy');
        }
        listEl.innerHTML = '';
        const logs = res && Array.isArray(res.logs) ? res.logs.slice(0, 30) : [];
        if (logs.length === 0) {
          const emptyP = document.createElement('p');
          emptyP.className = 'admin-muted';
          emptyP.textContent = 'Noch keine Admin-Einträge vorhanden.';
          listEl.appendChild(emptyP);
          return;
        }
        logs.forEach(function (entry) {
          const item = document.createElement('div');
          item.className = 'admin-log-item';

          const left = document.createElement('div');
          const badge = document.createElement('span');
          badge.className = 'admin-action-badge';
          badge.textContent = entry.action || 'AKTION';
          const details = document.createElement('span');
          details.textContent = entry.details || '–';
          left.appendChild(badge);
          left.appendChild(details);

          const right = document.createElement('span');
          right.className = 'recent-meta';
          right.textContent = formatLogTimestamp(entry.timestamp);

          item.appendChild(left);
          item.appendChild(right);
          listEl.appendChild(item);
        });
      })
      .catch(function (err) {
        if (refreshBtn) {
          refreshBtn.disabled = false;
          refreshBtn.removeAttribute('aria-busy');
        }
        listEl.innerHTML = '';
        const errP = document.createElement('p');
        errP.className = 'admin-inline-error';
        errP.textContent = (err && err.message) ? err.message : 'AdminLog konnte nicht geladen werden.';
        listEl.appendChild(errP);
      });
  }

  function renderSecurityView(container) {
    const api = getAPI();

    // Card 1: Storno-Modus
    const stornoCard = document.createElement('article');
    stornoCard.className = 'admin-card';
    const stornoRow = document.createElement('div');
    stornoRow.className = 'admin-switch-row';

    const stornoText = document.createElement('div');
    const stornoTitle = document.createElement('h3');
    stornoTitle.style.margin = '0 0 0.2rem 0';
    stornoTitle.style.fontSize = '1.02rem';
    stornoTitle.textContent = 'Storno-Modus in der Historie aktivieren';
    const stornoDesc = document.createElement('p');
    stornoDesc.className = 'admin-muted';
    stornoDesc.style.margin = '0';
    stornoDesc.textContent = 'Blendet in der Historie bei jeder aktiven Buchung einen "Stornieren"-Button ein.';
    stornoText.appendChild(stornoTitle);
    stornoText.appendChild(stornoDesc);

    const stornoToggle = document.createElement('input');
    stornoToggle.type = 'checkbox';
    stornoToggle.setAttribute('role', 'switch');
    stornoToggle.setAttribute('aria-label', 'Storno-Modus in der Historie aktivieren');
    stornoToggle.checked = Boolean(api && typeof api.isStornoModeActive === 'function' && api.isStornoModeActive());
    stornoToggle.addEventListener('change', function () {
      if (!isAdminSession()) return;
      if (api && typeof api.setStornoMode === 'function') {
        api.setStornoMode(stornoToggle.checked);
      }
      notifySuccess(stornoToggle.checked ? 'Storno-Modus in der Historie aktiv.' : 'Storno-Modus deaktiviert.');
    });

    stornoRow.appendChild(stornoText);
    stornoRow.appendChild(stornoToggle);
    stornoCard.appendChild(stornoRow);
    container.appendChild(stornoCard);

    // Card 2: Zugangsdaten ändern
    const credCard = document.createElement('article');
    credCard.className = 'admin-card';
    const credHeader = document.createElement('div');
    credHeader.className = 'admin-card-header';
    const credTitle = document.createElement('h3');
    credTitle.textContent = 'Zugangsdaten ändern';
    credHeader.appendChild(credTitle);
    credCard.appendChild(credHeader);

    const credForm = document.createElement('form');
    const credGrid = document.createElement('div');
    credGrid.className = 'admin-grid-2';

    const keyLabel = document.createElement('label');
    keyLabel.textContent = 'Schlüssel';
    const keySelect = document.createElement('select');
    [
      { value: 'USER_PIN', label: 'USER_PIN (4 Ziffern – Buchungen)' },
      { value: 'VIEWER_PIN', label: 'VIEWER_PIN (4 Ziffern – Nur Lesen)' },
      { value: 'ADMIN_PASS', label: 'ADMIN_PASS (Passphrase mind. 8 Zeichen)' }
    ].forEach(function (opt) {
      const optionEl = document.createElement('option');
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      keySelect.appendChild(optionEl);
    });
    keyLabel.appendChild(keySelect);

    const valLabel = document.createElement('label');
    valLabel.textContent = 'Neuer Wert';
    const valInput = document.createElement('input');
    valInput.type = 'password';
    valInput.autocomplete = 'new-password';
    valInput.placeholder = '4 Ziffern eingeben';
    valLabel.appendChild(valInput);

    keySelect.addEventListener('change', function () {
      valInput.value = '';
      valInput.placeholder = keySelect.value === 'ADMIN_PASS'
        ? 'Mindestens 8 Zeichen'
        : '4 Ziffern eingeben';
    });

    credGrid.appendChild(keyLabel);
    credGrid.appendChild(valLabel);
    credForm.appendChild(credGrid);

    const credError = document.createElement('p');
    credError.className = 'admin-inline-error hidden';
    credForm.appendChild(credError);

    const credBtn = document.createElement('button');
    credBtn.type = 'submit';
    credBtn.className = 'admin-btn-primary';
    credBtn.textContent = 'Zugangsdaten speichern';
    credForm.appendChild(credBtn);

    credForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!isAdminSession() || !api) return;

      credError.textContent = '';
      credError.classList.add('hidden');

      const selectedKey = keySelect.value;
      const cleanVal = valInput.value.trim();

      if (selectedKey === 'VIEWER_PIN' || selectedKey === 'USER_PIN') {
        if (!/^\d{4}$/.test(cleanVal)) {
          credError.textContent = selectedKey + ' muss aus genau 4 Ziffern bestehen.';
          credError.classList.remove('hidden');
          return;
        }
      } else if (selectedKey === 'ADMIN_PASS') {
        if (cleanVal.length < 8) {
          credError.textContent = 'ADMIN_PASS muss mindestens 8 Zeichen (ohne reine Leerzeichen) lang sein.';
          credError.classList.remove('hidden');
          return;
        }
      }

      credBtn.disabled = true;
      credBtn.setAttribute('aria-busy', 'true');

      api.callAPI('updateCredentials', { key: selectedKey, value: cleanVal })
        .then(function () {
          credBtn.disabled = false;
          credBtn.removeAttribute('aria-busy');
          valInput.value = '';
          notifySuccess(selectedKey + ' wurde aktualisiert.');
          loadAndRenderLogs(logListEl, logRefreshBtn);
        })
        .catch(function (err) {
          credBtn.disabled = false;
          credBtn.removeAttribute('aria-busy');
          credError.textContent = (err && err.message) ? err.message : 'Zugangsdaten konnten nicht gespeichert werden.';
          credError.classList.remove('hidden');
        });
    });

    credCard.appendChild(credForm);
    container.appendChild(credCard);

    // Card 3: Aktivitäts-Protokoll (AdminLog)
    const logCard = document.createElement('article');
    logCard.className = 'admin-card';

    const logHeader = document.createElement('div');
    logHeader.className = 'admin-card-header';
    const logTitle = document.createElement('h3');
    logTitle.textContent = 'Aktivitäts-Protokoll (letzte 30 Einträge)';
    const logRefreshBtn = document.createElement('button');
    logRefreshBtn.type = 'button';
    logRefreshBtn.className = 'admin-btn-secondary';
    logRefreshBtn.textContent = 'Aktualisieren';

    logHeader.appendChild(logTitle);
    logHeader.appendChild(logRefreshBtn);
    logCard.appendChild(logHeader);

    const logListEl = document.createElement('div');
    logListEl.className = 'admin-log-list';
    logCard.appendChild(logListEl);

    logRefreshBtn.addEventListener('click', function () {
      loadAndRenderLogs(logListEl, logRefreshBtn);
    });

    container.appendChild(logCard);
    loadAndRenderLogs(logListEl, logRefreshBtn);
  }

  function renderPanel() {
    const container = getTabContainer();
    if (!container) return;

    if (!isAdminSession()) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = '';

    // Apple Segmented Control
    const segBar = document.createElement('div');
    segBar.className = 'admin-segmented';
    segBar.setAttribute('role', 'tablist');
    segBar.setAttribute('aria-label', 'Admin-Bereiche');

    SECTIONS.forEach(function (sec) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'admin-segment-btn' + (activeSection === sec.id ? ' is-active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', activeSection === sec.id ? 'true' : 'false');
      btn.textContent = sec.label;
      btn.addEventListener('click', function () {
        if (!isAdminSession() || activeSection === sec.id) return;
        activeSection = sec.id;
        renderPanel();
      });
      segBar.appendChild(btn);
    });

    container.appendChild(segBar);

    const viewHost = document.createElement('div');
    viewHost.className = 'admin-panel-view';
    if (activeSection === 'budget') {
      renderBudgetView(viewHost);
    } else if (activeSection === 'categories') {
      renderCategoriesView(viewHost);
    } else if (activeSection === 'security') {
      renderSecurityView(viewHost);
    }
    container.appendChild(viewHost);
  }

  function init() {
    if (!isAdminSession()) {
      reset();
      return;
    }
    bindStornoModal();
    renderPanel();
  }

  function onTabActivated() {
    if (!isAdminSession()) {
      reset();
      return;
    }
    bindStornoModal();
    renderPanel();
  }

  function reset() {
    activeSection = 'budget';
    logsLoadedOnce = false;
    pendingStornoTx = null;
    const container = getTabContainer();
    if (container) {
      container.innerHTML = '';
    }
    const modal = document.getElementById('modal-storno-confirm');
    if (modal && modal.open) {
      modal.close();
    }
  }

  window.AbikasseAdmin = {
    init: init,
    reset: reset,
    onTabActivated: onTabActivated,
    openStornoModal: openStornoModal
  };

  if (isAdminSession()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})();
