// ── Utility helpers ───────────────────────────────────────────────────

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&"'<>]/g, function (s) {
    return ({'&':'&amp;','"':'&quot;',"'":"&#39;","<":"&lt;",">":"&gt;"})[s];
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
