document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('search');

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase().trim();
      const rows = document.querySelectorAll('#mod-table tbody tr');

      rows.forEach(row => {
        const rowText = row.textContent.toLowerCase();
        row.style.display = rowText.includes(query) ? '' : 'none';
      });
    });
  }
});