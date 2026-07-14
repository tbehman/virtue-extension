document.getElementById('saveBtn').addEventListener('click', () => {
  const url = document.getElementById('webhookUrl').value;
  chrome.storage.local.set({ webhookUrl: url }, () => {
    const status = document.getElementById('status');
    status.textContent = 'Saved successfully!';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
});

// Load saved URL on open
chrome.storage.local.get('webhookUrl', (data) => {
  if (data.webhookUrl) {
    document.getElementById('webhookUrl').value = data.webhookUrl;
  }
});