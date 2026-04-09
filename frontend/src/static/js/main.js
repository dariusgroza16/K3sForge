document.addEventListener('DOMContentLoaded', () => {
  try {
    setupHandlers();
    updateGenerateState();
    renderTopology();
    renderVMList();
    initWelcomeScreen();
  } catch(e) {
    console.error('init error', e);
    showToast('Frontend initialization error');
  } finally {
    const loader = document.getElementById('pageLoader');
    if (loader) {
      loader.classList.add('fade-out');
      setTimeout(() => loader.remove(), 500);
    }
  }
});
