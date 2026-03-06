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
  }
});
