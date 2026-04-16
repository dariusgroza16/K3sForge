// ── Utility helpers ───────────────────────────────────────────────────

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&"'<>]/g, function (s) {
    return ({'&':'&amp;','"':'&quot;',"'":"&#39;","<":"&lt;",">":"&gt;"})[s];
  });
}

function setFieldError(inputEl, message) {
  const existing = inputEl.parentElement.querySelector('.field-error-msg');
  if (existing) existing.remove();
  if (message) {
    const msg = document.createElement('span');
    msg.className = 'field-error-msg';
    msg.textContent = message;
    inputEl.parentElement.appendChild(msg);
    inputEl.addEventListener('input', () => {
      inputEl.classList.remove('input-error');
      const m = inputEl.parentElement.querySelector('.field-error-msg');
      if (m) m.remove();
    }, { once: true });
  }
}

function wireSecretToggle(btnId, fieldId) {
  const btn   = document.getElementById(btnId);
  const field = document.getElementById(fieldId);
  if (!btn || !field) return;
  btn.addEventListener('click', () => {
    const isHidden = field.tagName === 'TEXTAREA'
      ? field.dataset.hidden === '1'
      : field.type === 'password';
    if (field.tagName === 'TEXTAREA') {
      field.dataset.hidden = isHidden ? '0' : '1';
      field.style.webkitTextSecurity = isHidden ? '' : 'disc';
    } else {
      field.type = isHidden ? 'text' : 'password';
    }
    const eyeOn  = btn.querySelector('.eye-icon');
    const eyeOff = btn.querySelector('.eye-off-icon');
    if (eyeOn)  eyeOn.style.display  = isHidden ? 'block' : 'none';
    if (eyeOff) eyeOff.style.display = isHidden ? 'none'  : 'block';
  });
}

function showToast(message, timeout = 3000) {
  const t = document.getElementById('toast');
  if (!t) return console.warn('toast element missing');
  t.textContent = message;
  t.classList.add('show');
  t.setAttribute('aria-hidden', 'false');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.classList.remove('show');
    t.setAttribute('aria-hidden', 'true');
  }, timeout);
}

function showConfirmToast(message, onConfirm, onCancel) {
  const t = document.getElementById('toast');
  if (!t) return console.warn('toast element missing');
  t.innerHTML = `${escapeHtml(message)}<div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;"><button id="toast-confirm" style="padding:6px 12px;background:#6366f1;color:#fff;border:none;border-radius:6px;cursor:pointer;">Proceed</button><button id="toast-cancel" style="padding:6px 12px;background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:6px;cursor:pointer;">Cancel</button></div>`;
  t.classList.add('show');
  t.setAttribute('aria-hidden', 'false');

  const confirmBtn = document.getElementById('toast-confirm');
  const cancelBtn  = document.getElementById('toast-cancel');

  const cleanup = () => {
    t.classList.remove('show');
    t.setAttribute('aria-hidden', 'true');
    setTimeout(() => { t.innerHTML = ''; }, 300);
  };

  if (confirmBtn) confirmBtn.addEventListener('click', () => { cleanup(); if (onConfirm) onConfirm(); });
  if (cancelBtn)  cancelBtn.addEventListener('click',  () => { cleanup(); if (onCancel)  onCancel();  });
}
