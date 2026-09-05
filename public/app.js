const problemRows = document.getElementById('problemRows');
const kanban = document.getElementById('kanban');
const searchInput = document.getElementById('search');
const difficultyFilter = document.getElementById('difficultyFilter');
const categoryFilter = document.getElementById('categoryFilter');
const tagsFilter = document.getElementById('tagsFilter');
const problemForm = document.getElementById('problemForm');
const problemModal = document.getElementById('problemModal');
const openAddProblemBtn = document.getElementById('openAddProblem');
const closeAddProblemBtn = document.getElementById('closeAddProblem');
const notesModal = document.getElementById('notesModal');
const notesInput = document.getElementById('notesInput');
const notesPreview = document.getElementById('notesPreview');
const closeNotesBtn = document.getElementById('closeNotes');
const saveNotesBtn = document.getElementById('saveNotes');
const tabButtons = [...document.querySelectorAll('.tab-btn')];
const tabPanels = [...document.querySelectorAll('.tab-panel')];

let problems = [];
let draggingProblemId = null;
let currentEditingId = null;
let currentNotesId = null;

function renderMarkdown(text) {
  return marked.parse(text || '');
}

function switchTab(tabId) {
  for (const button of tabButtons) {
    button.classList.toggle('active', button.dataset.tab === tabId);
  }
  for (const panel of tabPanels) {
    panel.classList.toggle('active', panel.id === tabId);
  }
}

function openModal() {
  problemModal.classList.remove('hidden');
}

function closeModal() {
  problemModal.classList.add('hidden');
}

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.status === 204 ? null : res.json();
}

function filtersToQuery() {
  const params = new URLSearchParams();
  if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
  if (difficultyFilter.value) params.set('difficulty', difficultyFilter.value);
  if (categoryFilter.value.trim()) params.set('category', categoryFilter.value.trim());
  if (tagsFilter.value.trim()) params.set('tags', tagsFilter.value.trim());
  return params.toString();
}

function renderProblems() {
  problemRows.innerHTML = '';
  for (const problem of problems) {
    const tr = document.createElement('tr');
    const tags = (problem.tags || []).join(', ');
    tr.innerHTML = `
      <td>${problem.title || ''}</td>
      <td>${problem.difficulty}</td>
      <td>${problem.category || ''}</td>
      <td>${tags}</td>
      <td>
        <button data-notes="${problem.id}">Notes</button>
        <button data-edit="${problem.id}">Edit</button>
        <button data-delete="${problem.id}">Delete</button>
      </td>
    `;
    problemRows.appendChild(tr);
  }
}

function difficultyClass(value) {
  return ['easy', 'medium', 'hard'].includes(value) ? value : 'easy';
}

async function renderKanban() {
  const boxes = await request('/api/boxes');
  kanban.innerHTML = '';

  for (const box of boxes) {
    const column = document.createElement('div');
    column.className = 'column';
    column.dataset.box = String(box.box);
    column.innerHTML = `<h3>${box.name}</h3>`;

    column.addEventListener('dragover', (event) => {
      event.preventDefault();
    });

    column.addEventListener('drop', async (event) => {
      event.preventDefault();
      if (!draggingProblemId) return;
      await request(`/api/problems/${draggingProblemId}/box`, {
        method: 'PATCH',
        body: JSON.stringify({ box: box.box }),
      });
      await loadProblems();
      await renderAnalytics();
      draggingProblemId = null;
    });

    for (const problem of box.problems) {
      const card = document.createElement('article');
      card.className = 'card';
      card.draggable = true;
      card.dataset.problemId = String(problem.id);
      card.innerHTML = `
        <div class="title">${problem.title || '(Untitled)'}</div>
        <a href="${problem.link || '#'}" target="_blank" rel="noopener noreferrer">Open LeetCode</a>
        <span class="badge ${difficultyClass(problem.difficulty)}">${problem.difficulty}</span>
        <div class="tags">${(problem.tags || []).join(', ')}</div>
      `;
      card.addEventListener('dragstart', () => {
        draggingProblemId = problem.id;
      });
      column.appendChild(card);
    }

    kanban.appendChild(column);
  }
}

function renderAnalyticsHeatmap(data) {
  const heatmap = document.getElementById('heatmap');
  heatmap.innerHTML = '';
  for (const point of data.heatmap) {
    const cell = document.createElement('div');
    const level = point.count >= 8 ? 4 : point.count >= 4 ? 3 : point.count >= 2 ? 2 : point.count >= 1 ? 1 : 0;
    cell.className = `heatcell ${level ? `l${level}` : ''}`;
    cell.title = `${point.date}: ${point.count} review${point.count === 1 ? '' : 's'}`;
    heatmap.appendChild(cell);
  }
}

function renderAnalyticsLists(data) {
  const difficulty = document.getElementById('difficulty');
  difficulty.innerHTML = Object.entries(data.difficulty)
    .map(([name, count]) => `<li>${name}: ${count}</li>`)
    .join('');

  const category = document.getElementById('category');
  category.innerHTML = data.category.map((item) => `<li>${item.name}: ${item.count}</li>`).join('');

  const boxStatus = document.getElementById('boxStatus');
  boxStatus.innerHTML = data.boxStatus
    .map((item) => `Box ${item.box}: ${item.count} total (${item.readyToday} ready today)`)
    .join(' | ');

  document.getElementById('streak').textContent = `Current streak: ${data.streak} days (longest: ${data.longestStreak})`;
  document.getElementById('insights').textContent = data.insights;
}

async function renderAnalytics() {
  const data = await request('/api/analytics');
  renderAnalyticsHeatmap(data);
  renderAnalyticsLists(data);
}

async function loadProblems() {
  const query = filtersToQuery();
  problems = await request(`/api/problems${query ? `?${query}` : ''}`);
  renderProblems();
  await renderKanban();
}

problemForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = Object.fromEntries(formData.entries());
  payload.tags = (payload.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  const isEdit = currentEditingId !== null;
  const method = isEdit ? 'PATCH' : 'POST';
  const path = isEdit ? `/api/problems/${currentEditingId}` : '/api/problems';
  await request(path, {
    method,
    body: JSON.stringify(payload),
  });
  event.target.reset();
  currentEditingId = null;
  closeModal();
  await loadProblems();
  await renderAnalytics();
});

problemForm.elements.description.addEventListener('input', () => {
  document.getElementById('descriptionPreview').innerHTML = renderMarkdown(problemForm.elements.description.value);
});

problemRows.addEventListener('click', async (event) => {
  const target = event.target;
  const notesId = Number(target.getAttribute('data-notes'));
  const deleteId = Number(target.getAttribute('data-delete'));
  const editId = Number(target.getAttribute('data-edit'));
  const id = notesId || deleteId || editId;
  if (!id) return;

  if (target.hasAttribute('data-delete')) {
    await request(`/api/problems/${id}`, { method: 'DELETE' });
    await loadProblems();
    await renderAnalytics();
    return;
  }

  if (target.hasAttribute('data-notes')) {
    currentNotesId = id;
    const current = problems.find((p) => p.id === id);
    document.getElementById('noteTitle').textContent = `Notes: ${current.title || 'Problem'}`;
    notesInput.value = current.notes || '';
    notesPreview.innerHTML = renderMarkdown(current.notes);
    notesModal.classList.remove('hidden');
    return;
  }

  const current = problems.find((p) => p.id === id);
  if (!current) return;

  currentEditingId = id;
  document.getElementById('addProblemTitle').textContent = 'Edit Problem';
  problemForm.querySelector('button[type="submit"]').textContent = 'Update Problem';
  problemForm.elements.title.value = current.title || '';
  problemForm.elements.link.value = current.link || '';
  problemForm.elements.github_link.value = current.github_link || '';
  problemForm.elements.category.value = current.category || '';
  problemForm.elements.tags.value = (current.tags || []).join(', ');
  problemForm.elements.difficulty.value = current.difficulty || 'easy';
  problemForm.elements.description.value = current.description || '';
  document.getElementById('descriptionPreview').innerHTML = renderMarkdown(current.description);
  openModal();
});

for (const input of [searchInput, difficultyFilter, categoryFilter, tagsFilter]) {
  input.addEventListener('input', () => {
    loadProblems().catch((err) => alert(err.message));
  });
}

loadProblems()
  .then(renderAnalytics)
  .catch((err) => alert(err.message));

for (const button of tabButtons) {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
}

openAddProblemBtn.addEventListener('click', () => {
  currentEditingId = null;
  document.getElementById('addProblemTitle').textContent = 'Add Problem';
  problemForm.querySelector('button[type="submit"]').textContent = 'Save Problem';
  problemForm.reset();
  document.getElementById('descriptionPreview').innerHTML = '';
  openModal();
});
closeAddProblemBtn.addEventListener('click', () => {
  currentEditingId = null;
  document.getElementById('addProblemTitle').textContent = 'Add Problem';
  problemForm.querySelector('button[type="submit"]').textContent = 'Save Problem';
  closeModal();
});
problemModal.addEventListener('click', (event) => {
  if (event.target === problemModal) closeModal();
});

notesInput.addEventListener('input', () => {
  notesPreview.innerHTML = renderMarkdown(notesInput.value);
});

saveNotesBtn.addEventListener('click', async () => {
  if (!currentNotesId) return;
  await request(`/api/problems/${currentNotesId}`, {
    method: 'PATCH',
    body: JSON.stringify({ notes: notesInput.value }),
  });
  currentNotesId = null;
  notesModal.classList.add('hidden');
  await loadProblems();
});

closeNotesBtn.addEventListener('click', () => {
  currentNotesId = null;
  notesModal.classList.add('hidden');
});

notesModal.addEventListener('click', (event) => {
  if (event.target === notesModal) {
    currentNotesId = null;
    notesModal.classList.add('hidden');
  }
});
