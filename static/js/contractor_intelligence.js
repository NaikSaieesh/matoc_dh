document.addEventListener('DOMContentLoaded', () => {
  const contractorSelect = document.getElementById('contractor');

  if (contractorSelect) {
    contractorSelect.addEventListener('change', () => {
      const contractor = contractorSelect.value;
      window.location.search = `?contractor=${encodeURIComponent(contractor)}`;
    });
  }
});