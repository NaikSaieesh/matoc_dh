document.addEventListener('DOMContentLoaded', () => {
  const codeArea = document.getElementById('code');

  if (codeArea) {
    // Handle Tab key insertion inside the textarea
    codeArea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = codeArea.selectionStart;
        const end = codeArea.selectionEnd;

        // Insert 4 spaces
        codeArea.value = codeArea.value.slice(0, start) + '    ' + codeArea.value.slice(end);
        codeArea.selectionStart = codeArea.selectionEnd = start + 4;
      }
    });

    // Handle Ctrl/Cmd + S shortcut for saving
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const editorForm = document.getElementById('editor-form');
        if (editorForm) {
          editorForm.submit();
        }
      }
    });
  }
});