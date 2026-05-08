(function () {
  var state = {
    running: false,
    cancelled: false,
    total: 0,
    synced: 0,
    failed: 0
  };

  function request(path, options) {
    return fetch(BiolecBotAdmin.restUrl + path, Object.assign({
      headers: {
        'Content-Type': 'application/json',
        'X-WP-Nonce': BiolecBotAdmin.nonce
      }
    }, options || {})).then(async function (response) {
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        throw new Error(data.error || data.message || 'Request failed');
      }
      return data;
    });
  }

  function chunk(items, size) {
    var chunks = [];
    for (var index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  function getUi() {
    return {
      progress: document.querySelector('.biolec-progress'),
      title: document.querySelector('.biolec-progress__title'),
      count: document.querySelector('.biolec-progress__count'),
      bar: document.querySelector('.biolec-progress__bar span'),
      status: document.querySelector('.biolec-progress__status'),
      errors: document.querySelector('.biolec-progress__errors'),
      buttons: document.querySelectorAll('[data-biolec-action]'),
      cancel: document.querySelector('[data-biolec-action="cancel"]')
    };
  }

  function setRunning(isRunning) {
    var ui = getUi();
    state.running = isRunning;
    Array.prototype.forEach.call(ui.buttons, function (button) {
      if (button.dataset.biolecAction === 'cancel') {
        button.disabled = !isRunning;
      } else {
        button.disabled = isRunning;
      }
    });
  }

  function updateProgress(title, status) {
    var ui = getUi();
    var percent = state.total ? Math.round((state.synced + state.failed) / state.total * 100) : 0;
    ui.progress.hidden = false;
    ui.title.textContent = title;
    ui.count.textContent = state.total ? (state.synced + state.failed) + ' / ' + state.total : '';
    ui.bar.style.width = percent + '%';
    ui.status.textContent = status;
  }

  function addErrors(errors) {
    if (!errors || !errors.length) return;
    var ui = getUi();
    ui.errors.hidden = false;
    errors.slice(0, 5).forEach(function (item) {
      var line = document.createElement('p');
      line.textContent = (item.id || item.slug || 'Item') + ': ' + item.error;
      ui.errors.appendChild(line);
    });
  }

  function resetProgress(total) {
    var ui = getUi();
    state.cancelled = false;
    state.total = total || 0;
    state.synced = 0;
    state.failed = 0;
    ui.errors.innerHTML = '';
    ui.errors.hidden = true;
    updateProgress('Preparing sync...', 'Starting...');
  }

  async function syncCatalog(clearFirst) {
    setRunning(true);
    try {
      updateProgress('Loading catalog...', 'Getting product list from WooCommerce...');
      var catalog = await request('/catalog-ids');
      resetProgress(catalog.total);

      if (clearFirst) {
        updateProgress('Clearing catalog vectors...', 'Removing existing product vectors...');
        await request('/clear-products', { method: 'POST', body: JSON.stringify({}) });
      }

      var batches = chunk(catalog.ids, 5);
      for (var index = 0; index < batches.length; index++) {
        if (state.cancelled) {
          updateProgress('Sync cancelled', 'Stopped after current batch. Synced ' + state.synced + ', failed ' + state.failed + '.');
          return;
        }

        updateProgress('Syncing products...', 'Batch ' + (index + 1) + ' of ' + batches.length);
        var result = await request('/sync-products', {
          method: 'POST',
          body: JSON.stringify({ ids: batches[index] })
        });
        state.synced += result.sent || 0;
        state.failed += result.failed || 0;
        addErrors(result.errors);
        updateProgress('Syncing products...', 'Synced ' + state.synced + ', failed ' + state.failed + '.');
      }

      updateProgress('Catalog sync complete', 'Synced ' + state.synced + ', failed ' + state.failed + '.');
    } catch (error) {
      updateProgress('Sync failed', error.message);
    } finally {
      setRunning(false);
    }
  }

  async function syncPages() {
    setRunning(true);
    resetProgress(1);
    try {
      updateProgress('Syncing key pages...', 'Sending delivery, returns, VAT relief, and contact pages...');
      var result = await request('/sync-pages', { method: 'POST', body: JSON.stringify({}) });
      state.synced = result.sent || 0;
      state.failed = result.failed || 0;
      state.total = state.synced + state.failed + (result.missing ? result.missing.length : 0);
      addErrors(result.errors);
      updateProgress('Page sync complete', 'Synced ' + state.synced + ', failed ' + state.failed + ', missing ' + (result.missing ? result.missing.length : 0) + '.');
    } catch (error) {
      updateProgress('Page sync failed', error.message);
    } finally {
      setRunning(false);
    }
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-biolec-action]');
    if (!button) return;

    var action = button.dataset.biolecAction;
    if (action === 'sync-catalog') {
      syncCatalog(false);
    } else if (action === 'reindex-catalog') {
      syncCatalog(true);
    } else if (action === 'sync-pages') {
      syncPages();
    } else if (action === 'cancel') {
      state.cancelled = true;
      updateProgress('Cancelling...', 'The current batch will finish, then syncing will stop.');
    }
  });
})();
