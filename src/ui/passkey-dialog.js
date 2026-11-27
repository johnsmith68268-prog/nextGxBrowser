    (function () {
      const params = new URLSearchParams(window.location.search);
      const dialogId = params.get('dialog') || '';
      const $ = (id) => document.getElementById(id);
      const titleEl = $('title'), subtitleEl = $('subtitle'), originEl = $('origin'),
        userLineEl = $('userLine'), candidatesEl = $('candidates'), noteEl = $('note'),
        errorEl = $('error'), btnContinue = $('btnContinue'), btnCancel = $('btnCancel');
      let selectedCredentialId = null;
      let request = null;

      function fail(msg) {
        errorEl.textContent = msg;
        errorEl.hidden = false;
        btnContinue.disabled = true;
      }
      function submit(action) {
        try {
          window.gxPasskeyDialogAPI.submit({ dialogId, action, selectedCredentialId });
        } catch (_) { }
        // The main process closes this window; if it does not, close via cancel.
        if (action === 'cancel') window.close();
      }
      function escapeHtml(s) {
        return String(s == null ? '' : s)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      }

      btnCancel.addEventListener('click', () => submit('cancel'));
      btnContinue.addEventListener('click', () => submit('confirm'));
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') submit('cancel');
        if (e.key === 'Enter') {
          if (btnContinue.disabled) return;
          const active = document.activeElement;
          if (active === btnCancel || (active && active.classList && active.classList.contains('candidate'))) {
            return;
          }
          submit('confirm');
        }
      });

      if (!window.gxPasskeyDialogAPI || !dialogId) {
        fail('This dialog could not be opened. Please try again.');
        return;
      }
      window.gxPasskeyDialogAPI.getRequest(dialogId).then((req) => {
        request = req;
        if (!req || typeof req !== 'object') {
          fail('This passkey request is no longer available.');
          return;
        }
        const site = req.rpName || req.rpId || req.origin || 'this site';
        if (req.mode === 'create') {
          titleEl.innerHTML = 'Create a passkey for <span class="site">' + escapeHtml(site) + '</span>';
          subtitleEl.textContent = 'nextGx will save a passkey on this device so you can sign in without a password.';
          if (req.username) {
            userLineEl.innerHTML = 'Signing in as <strong>' + escapeHtml(req.username) + '</strong>';
            userLineEl.hidden = false;
          }
          noteEl.textContent = 'Your passkey stays on this device. Confirming here is the "touch" that proves you are present — no PIN or fingerprint is checked.';
        } else {
          titleEl.innerHTML = 'Use your passkey with <span class="site">' + escapeHtml(site) + '</span>';
          subtitleEl.textContent = 'Choose a passkey to sign in.';
          const list = Array.isArray(req.candidates) ? req.candidates : [];
          if (list.length > 1) {
            candidatesEl.hidden = false;
            list.forEach((c, i) => {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'candidate' + (i === 0 ? ' selected' : '');
              const initial = (c.username || c.displayName || '?').trim().charAt(0).toUpperCase() || '?';
              const when = c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '';
              btn.innerHTML = '<span class="avatar">' + escapeHtml(initial) + '</span>' +
                '<span class="who"><span class="name">' + escapeHtml(c.displayName || c.username || 'Passkey') + '</span><br/>' +
                '<span class="meta">' + escapeHtml(c.username || '') + (when ? ' · created ' + escapeHtml(when) : '') + '</span></span>';
              btn.addEventListener('click', () => {
                selectedCredentialId = c.id;
                candidatesEl.querySelectorAll('.candidate').forEach((el) => el.classList.remove('selected'));
                btn.classList.add('selected');
              });
              candidatesEl.appendChild(btn);
            });
            selectedCredentialId = list[0].id;
          } else if (list.length === 1) {
            selectedCredentialId = list[0].id;
            userLineEl.innerHTML = 'Signing in as <strong>' + escapeHtml(list[0].username || list[0].displayName || '') + '</strong>';
            userLineEl.hidden = false;
          }
          noteEl.textContent = 'Confirming here is the "touch" that proves you are present — no PIN or fingerprint is checked.';
        }
        originEl.textContent = req.origin || '';
      }).catch(() => fail('This passkey request could not be loaded.'));
    })();
  
