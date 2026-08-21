const config = document.getElementById('app-config').dataset;
const isAdmin = config.isAdmin === 'true';
const columnsList = JSON.parse(config.columns);
const table = document.getElementById('data-table');
const tableWrap = document.querySelector('.table-wrap');

const urlUpdate = config.urlUpdate;
const urlCreate = config.urlCreate;
const urlPull = config.urlPull;
const urlPullStatus = config.urlPullStatus;

function tbodyRows() { 
  return Array.from(table.querySelector('tbody').children); 
}

function cellPos(td) { 
  return { rowIdx: tbodyRows().indexOf(td.closest('tr')), colIdx: td.cellIndex }; 
}

// 1. CELL EDITING & AUTO-SAVE LOGIC
function bindCellEditing(td) {
  let original = td.textContent;
  td.addEventListener('focus', () => { 
    original = td.textContent.trim().replace(/[$,\s]/g, "");
    td.textContent = original;
  });
  
  td.addEventListener('blur', () => {
    const value = td.textContent.trim();
    if (value === original) return;
    
    const tr = td.closest('tr');
    let id = tr.dataset.id;
    const column = td.getAttribute('data-column');
    
    const targetUrl = id ? urlUpdate : urlCreate;

    fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: id, column: column, value: value })
    })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        td.classList.add('saved');
        
        if (!id && data.new_id) {
          tr.dataset.id = data.new_id;
        }

        if (data.derived) {
          Object.keys(data.derived).forEach(colName => {
            const targetTd = tr.querySelector(`td[data-column="${colName}"]`);
            if (targetTd) {
              const val = data.derived[colName];
              targetTd.textContent = colName.includes('%')
                ? Number(val).toFixed(2)
                : Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              targetTd.classList.add('saved');
            }
          });
        }
      } else {
        alert("Save failed");
        td.textContent = original;
      }
    })
    .catch(err => {
      console.error(err);
      td.textContent = original;
    });
  });
}

document.querySelectorAll('td[contenteditable="true"]').forEach(bindCellEditing);

// 2. INFINITE SCROLL & EXCEL EMPTY ROW CREATION
function generateEmptyRows(count = 15) {
  if (!table) return;
  const tbody = table.querySelector('tbody');

  for (let i = 0; i < count; i++) {
    const tr = document.createElement('tr');
    
    columnsList.forEach(col => {
      const td = document.createElement('td');
      td.setAttribute('data-column', col);
      if (isAdmin) {
        td.setAttribute('contenteditable', 'true');
        bindCellEditing(td);
      }
      tr.appendChild(td);
    });

    if (isAdmin) {
      const actionTd = document.createElement('td');
      actionTd.innerHTML = `<button type="button" class="del-btn" onclick="this.closest('tr').remove()">Delete</button>`;
      tr.appendChild(actionTd);
    }

    tbody.appendChild(tr);
  }
}

generateEmptyRows(15);

if (tableWrap) {
  tableWrap.addEventListener('scroll', () => {
    const distanceToBottom = tableWrap.scrollHeight - tableWrap.scrollTop - tableWrap.clientHeight;
    if (distanceToBottom < 150) {
      generateEmptyRows(10);
    }
  });
}

// 3. LIVE SEARCH
const searchBox = document.getElementById('search');
if (searchBox && table) {
  searchBox.addEventListener('input', () => applyAllFilters());
}

// 4. EXCEL-STYLE PER-COLUMN SORT + FILTER DROPDOWN
const columnFilters = {};

function sortByColumn(idx, asc) {
  const tbody = table.querySelector('tbody');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  rows.sort((a, b) => {
    const av = (a.children[idx] ? a.children[idx].textContent : '').trim();
    const bv = (b.children[idx] ? b.children[idx].textContent : '').trim();
    const an = parseFloat(av.replace(/[^0-9.-]/g, ''));
    const bn = parseFloat(bv.replace(/[^0-9.-]/g, ''));
    let cmp;
    if (!isNaN(an) && !isNaN(bn) && av !== '' && bv !== '') cmp = an - bn;
    else cmp = av.localeCompare(bv);
    return asc ? cmp : -cmp;
  });
  rows.forEach(r => tbody.appendChild(r));
}

function applyAllFilters() {
  const q = searchBox ? searchBox.value.toLowerCase() : '';
  tbodyRows().forEach(tr => {
    let visible = true;
    if (q && !tr.textContent.toLowerCase().includes(q)) visible = false;
    if (visible) {
      for (const colIdx in columnFilters) {
        const allowed = columnFilters[colIdx];
        if (!allowed) continue;
        const td = tr.children[colIdx];
        const v = td ? td.textContent.trim() : '';
        if (!allowed.has(v)) { visible = false; break; }
      }
    }
    tr.style.display = visible ? '' : 'none';
  });
  
  document.querySelectorAll('.filter-btn').forEach(btn => {
    const idx = btn.dataset.colIdx;
    btn.classList.toggle('active', !!columnFilters[idx]);
  });
}

function getColumnValues(idx) {
  const values = new Set();
  tbodyRows().forEach(tr => {
    const td = tr.children[idx];
    values.add(td ? td.textContent.trim() : '');
  });
  return values;
}

const filterPanel = document.createElement('div');
filterPanel.className = 'filter-panel';
document.body.appendChild(filterPanel);
let openForIdx = null;

function closeFilterPanel() {
  filterPanel.style.display = 'none';
  openForIdx = null;
}

function openFilterPanel(idx, anchorEl) {
  openForIdx = idx;
  const allValues = Array.from(getColumnValues(idx)).sort((a, b) => a.localeCompare(b));
  const currentlyAllowed = columnFilters[idx] || new Set(allValues);

  filterPanel.innerHTML = `
    <div class="fp-item" data-action="sort-asc">Sort A to Z</div>
    <div class="fp-item" data-action="sort-desc">Sort Z to A</div>
    <div class="fp-sep"></div>
    <div class="fp-search-wrap"><input type="text" placeholder="Search" data-fp-search></div>
    <div class="fp-list" data-fp-list>
      <label><input type="checkbox" data-fp-select-all checked> <strong>(Select All)</strong></label>
      ${allValues.map(v => {
        const label = v === '' ? '(Blanks)' : v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const checked = currentlyAllowed.has(v) ? 'checked' : '';
        return `<label data-value="${encodeURIComponent(v)}"><input type="checkbox" data-fp-value="${encodeURIComponent(v)}" ${checked}> ${label}</label>`;
      }).join('')}
    </div>
    <div class="fp-footer">
      <button type="button" data-action="cancel">Cancel</button>
      <button type="button" class="fp-ok" data-action="ok">OK</button>
    </div>
  `;

  const rect = anchorEl.getBoundingClientRect();
  filterPanel.style.top = (window.scrollY + rect.bottom + 4) + 'px';
  filterPanel.style.left = (window.scrollX + Math.min(rect.left, window.innerWidth - 260)) + 'px';
  filterPanel.style.display = 'block';

  const selectAllBox = filterPanel.querySelector('[data-fp-select-all]');
  const valueBoxes = () => Array.from(filterPanel.querySelectorAll('[data-fp-value]'));

  selectAllBox.addEventListener('change', () => {
    valueBoxes().forEach(cb => { cb.checked = selectAllBox.checked; });
  });

  filterPanel.querySelectorAll('[data-fp-value]').forEach(cb => {
    cb.addEventListener('change', () => {
      selectAllBox.checked = valueBoxes().every(b => b.checked);
    });
  });

  const searchInput = filterPanel.querySelector('[data-fp-search]');
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase();
    filterPanel.querySelectorAll('.fp-list label[data-value]').forEach(lbl => {
      lbl.style.display = lbl.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  filterPanel.querySelector('[data-action="sort-asc"]').addEventListener('click', () => {
    sortByColumn(idx, true);
    closeFilterPanel();
  });
  filterPanel.querySelector('[data-action="sort-desc"]').addEventListener('click', () => {
    sortByColumn(idx, false);
    closeFilterPanel();
  });
  filterPanel.querySelector('[data-action="cancel"]').addEventListener('click', closeFilterPanel);
  filterPanel.querySelector('[data-action="ok"]').addEventListener('click', () => {
    const selected = new Set(
      valueBoxes().filter(cb => cb.checked).map(cb => decodeURIComponent(cb.dataset.fpValue))
    );
    if (selected.size === allValues.length) {
      delete columnFilters[idx];
    } else {
      columnFilters[idx] = selected;
    }
    closeFilterPanel();
    applyAllFilters();
  });
}

if (table) {
  table.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.colIdx, 10);
      if (openForIdx === idx && filterPanel.style.display === 'block') {
        closeFilterPanel();
      } else {
        openFilterPanel(idx, btn);
      }
    });
  });
}

document.addEventListener('click', (e) => {
  if (filterPanel.style.display === 'block' && !filterPanel.contains(e.target) && !e.target.closest('.filter-btn')) {
    closeFilterPanel();
  }
});

// 5. EXCEL RANGE SELECTION, COPY & MULTI-CELL PASTE LOGIC
let dragAnchorTd = null;
let dragging = false;
let lastClickedTd = null;
let rangeCells = [];
let rangeActive = false;

function clearRangeHighlight() {
  table.querySelectorAll('td.range-selected').forEach(td => td.classList.remove('range-selected'));
}

function flatRange() { 
  return rangeCells.flat ? rangeCells.flat() : [].concat(...rangeCells); 
}

function selectRange(tdA, tdB) {
  clearRangeHighlight();
  const headerRow = table.querySelector('thead tr');
  const dataColCount = headerRow ? headerRow.querySelectorAll('th[data-col]').length : 0;
  
  const a = cellPos(tdA), b = cellPos(tdB);
  const rows = tbodyRows();
  const r0 = Math.min(a.rowIdx, b.rowIdx), r1 = Math.max(a.rowIdx, b.rowIdx);
  const c0 = Math.min(a.colIdx, b.colIdx);
  const c1 = Math.min(Math.max(a.colIdx, b.colIdx), dataColCount - 1);
  
  rangeCells = [];
  for (let r = r0; r <= r1; r++) {
    const tr = rows[r];
    if (!tr) continue;
    const line = [];
    for (let c = c0; c <= c1; c++) {
      const cell = tr.children[c];
      if (!cell) continue;
      cell.classList.add('range-selected');
      line.push(cell);
    }
    if (line.length) rangeCells.push(line);
  }
}

if (table) {
  const tbody = table.querySelector('tbody');
  const headerRow = table.querySelector('thead tr');
  const dataColCount = headerRow ? headerRow.querySelectorAll('th[data-col]').length : 0;

  table.addEventListener('mousedown', (e) => {
    const td = e.target.closest('td');
    if (!td || !tbody.contains(td) || td.cellIndex >= dataColCount) return;
    dragAnchorTd = td;
    dragging = false;
  });

  table.addEventListener('mousemove', (e) => {
    if (!dragAnchorTd || e.buttons !== 1) return;
    const td = e.target.closest('td');
    if (!td || !tbody.contains(td) || td.cellIndex >= dataColCount) return;
    if (td === dragAnchorTd && !dragging) return;
    dragging = true;
    rangeActive = true;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    if (window.getSelection) window.getSelection().removeAllRanges();
    selectRange(dragAnchorTd, td);
  });

  document.addEventListener('mouseup', () => {
    if (!dragging && dragAnchorTd) {
      clearRangeHighlight();
      rangeActive = false;
      rangeCells = [];
    }
    dragAnchorTd = null;
    dragging = false;
  });

  table.addEventListener('click', (e) => {
    const td = e.target.closest('td');
    if (!td || !tbody.contains(td) || td.cellIndex >= dataColCount) return;
    if (e.shiftKey && lastClickedTd) {
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      rangeActive = true;
      selectRange(lastClickedTd, td);
    } else if (!dragging) {
      lastClickedTd = td;
    }
  });
}

document.addEventListener('copy', (e) => {
  if (!rangeActive || !rangeCells.length) return;
  const tsv = rangeCells.map(line => line.map(td => td.textContent.trim()).join('\t')).join('\n');
  e.clipboardData.setData('text/plain', tsv);
  e.preventDefault();
});

function saveCellFromPaste(td, value) {
  const tr = td.closest('tr');
  const id = tr.dataset.id;
  const column = td.getAttribute('data-column');

  const targetUrl = id ? urlUpdate : urlCreate;

  fetch(targetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: id, column: column, value: value })
  })
  .then(r => r.json())
  .then(data => {
    if (data.ok) {
      td.classList.add('saved');
      if (!id && data.new_id) {
        tr.dataset.id = data.new_id;
      }
      if (data.derived) {
        Object.keys(data.derived).forEach(colName => {
          const targetTd = tr.querySelector(`td[data-column="${colName}"]`);
          if (targetTd) {
            const val = data.derived[colName];
            targetTd.textContent = colName.includes('%')
              ? Number(val).toFixed(2)
              : Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            targetTd.classList.add('saved');
          }
        });
      }
    }
  })
  .catch(err => console.error('Paste save error:', err));
}

document.addEventListener('paste', (e) => {
  let anchorTd = null;
  if (rangeActive && rangeCells.length && rangeCells[0].length) {
    anchorTd = rangeCells[0][0];
  } else if (document.activeElement && document.activeElement.tagName === 'TD') {
    anchorTd = document.activeElement;
  }

  if (!anchorTd || anchorTd.getAttribute('contenteditable') !== 'true') return;

  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  if (!text) return;

  e.preventDefault();

  let lines = text.replace(/\r/g, '').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  const grid = lines.map(line => line.split('\t'));
  const start = cellPos(anchorTd);
  const tbody = table.querySelector('tbody');
  const headerRow = table.querySelector('thead tr');
  const dataColCount = headerRow ? headerRow.querySelectorAll('th[data-col]').length : 0;

  const rowsNeeded = (start.rowIdx + grid.length) - tbody.children.length;
  if (rowsNeeded > 0) {
    generateEmptyRows(rowsNeeded);
  }

  const rows = tbodyRows();
  const newlySelected = [];

  grid.forEach((rowVals, r) => {
    const tr = rows[start.rowIdx + r];
    if (!tr) return;

    const rowCellsSelected = [];
    rowVals.forEach((val, c) => {
      const colIdx = start.colIdx + c;
      if (colIdx >= dataColCount) return;

      const td = tr.children[colIdx];
      if (!td || td.getAttribute('contenteditable') !== 'true') return;

      const cleanVal = val.trim();
      td.textContent = cleanVal;

      saveCellFromPaste(td, cleanVal);
      rowCellsSelected.push(td);
    });
    if (rowCellsSelected.length) newlySelected.push(rowCellsSelected);
  });

  if (newlySelected.length) {
    clearRangeHighlight();
    rangeCells = newlySelected;
    flatRange().forEach(td => td.classList.add('range-selected'));
    rangeActive = true;
  }
});

// 6. USA SPENDING PULL HANDLERS
const pullBtn = document.getElementById('pull-latest-btn');
const pullStatus = document.getElementById('pull-status');

if (pullBtn) {
  pullBtn.addEventListener('click', () => {
    if (!confirm("Are you sure you want to pull the latest data from USAspending.gov?")) return;

    pullBtn.disabled = true;
    if (pullStatus) {
      pullStatus.style.display = 'block';
      pullStatus.textContent = 'Initiating background data pull...';
    }

    fetch(urlPull, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        if (pullStatus) pullStatus.textContent = data.message || 'Pull started successfully.';
        pollPullStatus();
      } else {
        alert("Pull failed: " + (data.message || 'Unknown error'));
        pullBtn.disabled = false;
        if (pullStatus) pullStatus.style.display = 'none';
      }
    })
    .catch(err => {
      console.error(err);
      alert("Error connecting to server.");
      pullBtn.disabled = false;
      if (pullStatus) pullStatus.style.display = 'none';
    });
  });
}

function pollPullStatus() {
  const timer = setInterval(() => {
    fetch(urlPullStatus)
      .then(r => r.json())
      .then(progress => {
        if (!pullStatus) return;
        if (progress.running) {
          pullStatus.textContent = `Pulling data: ${progress.message || 'In progress...'}`;
        } else {
          clearInterval(timer);
          pullStatus.textContent = progress.message || 'Pull completed! Reloading page...';
          pullBtn.disabled = false;
          setTimeout(() => window.location.reload(), 1500);
        }
      })
      .catch(err => {
        console.error(err);
        clearInterval(timer);
        pullBtn.disabled = false;
      });
  }, 2000);
}