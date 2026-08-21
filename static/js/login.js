document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('admin-login-form');

  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      const password = document.getElementById('password').value.trim();

      if (!password) {
        e.preventDefault();
        alert('Please enter the admin password.');
      }
    });
  }
});