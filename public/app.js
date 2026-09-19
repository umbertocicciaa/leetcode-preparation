const problemRows = document.getElementById('problemRows');
const kanban = document.getElementById('kanban');
const searchInput = document.getElementById('search');
const difficultyFilter = document.getElementById('difficultyFilter');
const categoryFilter = document.getElementById('categoryFilter');
const tagsFilter = document.getElementById('tagsFilter');
const companyTagsFilter = document.getElementById('companyTagsFilter');
const problemForm = document.getElementById('problemForm');
const problemModal = document.getElementById('problemModal');
const openAddProblemBtn = document.getElementById('openAddProblem');
const closeAddProblemBtn = document.getElementById('closeAddProblem');
const clearProblemFormBtn = document.getElementById('clearProblemForm');
const descriptionModal = document.getElementById('descriptionModal');
const descriptionViewer = document.getElementById('descriptionViewer');
const closeDescriptionBtn = document.getElementById('closeDescription');
const notesViewerModal = document.getElementById('notesViewerModal');
const notesViewer = document.getElementById('notesViewer');
const closeNotesViewerBtn = document.getElementById('closeNotesViewer');
const notesModal = document.getElementById('notesModal');
const notesInput = document.getElementById('notesInput');
const closeNotesBtn = document.getElementById('closeNotes');
const saveNotesBtn = document.getElementById('saveNotes');
const clearNotesBtn = document.getElementById('clearNotes');
const tabButtons = [...document.querySelectorAll('.tab-btn')];
const tabPanels = [...document.querySelectorAll('.tab-panel')];

let problems = [];
let draggingProblemId = null;
let currentEditingId = null;
let currentNotesId = null;
let addProblemDraft = null;
let notesDrafts = {};

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

function saveAddProblemDraft() {
  const formData = new FormData(problemForm);
  addProblemDraft = Object.fromEntries(formData.entries());
}

function restoreAddProblemDraft() {
  if (!addProblemDraft) {
    problemForm.reset();
    return;
  }

  for (const [name, value] of Object.entries(addProblemDraft)) {
    const field = problemForm.elements[name];
    if (field) field.value = value;
  }
}

function clearAddProblemDraft() {
  addProblemDraft = null;
  problemForm.reset();
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
  if (companyTagsFilter.value.trim()) params.set('company_tags', companyTagsFilter.value.trim());
  return params.toString();
}

function renderProblems() {
  problemRows.innerHTML = '';
  for (const problem of problems) {
    const tr = document.createElement('tr');
    const tags = (problem.tags || []).join(', ');
    const companyTags = (problem.company_tags || []).join(', ');
    const openProblemAction = problem.link
      ? `<button type="button" data-open="${problem.id}">Open Problem</button>`
      : "";

    tr.innerHTML = `
      <td>${problem.title || ""}</td>
      <td>${problem.difficulty}</td>
      <td>${problem.category || ""}</td>
      <td>${tags}</td>
      <td>${companyTags}</td>
      <td>
        ${openProblemAction}
        <button type="button" data-visualize="${problem.id}">Visualize Markdown</button>
        <button type="button" data-visualize-notes="${problem.id}">Visualize Notes</button>
        <button data-notes="${problem.id}">Edit Notes</button>
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
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'heatcell-button';
    button.setAttribute('aria-label', `Show ${point.count} review${point.count === 1 ? '' : 's'} from ${point.date}`);
    button.appendChild(cell);
    button.addEventListener('click', () => renderReviewDetails(point.date));
    heatmap.appendChild(button);
  }
}

async function renderReviewDetails(date) {
  const details = document.getElementById('reviewDetails');
  details.replaceChildren();
  const heading = document.createElement('h4');
  heading.textContent = `Reviewed on ${date}`;
  details.appendChild(heading);

  const reviews = await request(`/api/analytics/reviews?date=${encodeURIComponent(date)}`);
  if (!reviews.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No reviews recorded for this day.';
    details.appendChild(empty);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'review-list';
  for (const review of reviews) {
    const item = document.createElement('li');
    const title = document.createElement(review.link ? 'a' : 'span');
    title.textContent = review.title || '(Untitled problem)';
    if (review.link) {
      title.href = review.link;
      title.target = '_blank';
      title.rel = 'noopener noreferrer';
    }
    const meta = document.createElement('span');
    const time = new Date(review.studied_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const companies = (review.company_tags || []).join(', ');
    meta.textContent = `${review.difficulty} · ${review.category || 'Uncategorized'}${companies ? ` · ${companies}` : ''} · ${time}`;
    item.append(title, meta);
    list.appendChild(item);
  }
  details.appendChild(list);
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
    .map((item) => `<span><strong>Box ${item.box}</strong>${item.count} total · ${item.readyToday} due</span>`)
    .join('');

  document.getElementById('totalProblems').textContent = data.totalProblems;
  document.getElementById('reviewsThisWeek').textContent = data.reviewsThisWeek;
  document.getElementById('dueToday').textContent = data.dueToday;
  document.getElementById('streak').textContent = `${data.streak} day${data.streak === 1 ? '' : 's'}`;
  document.getElementById('longestStreak').textContent = `Longest streak: ${data.longestStreak} day${data.longestStreak === 1 ? '' : 's'} · ${data.totalReviews} reviews recorded`;
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

problemForm.addEventListener('input', (event) => {
  if (currentEditingId === null) saveAddProblemDraft();
});

problemForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = Object.fromEntries(formData.entries());
  payload.tags = (payload.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  payload.company_tags = (payload.company_tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  const isEdit = currentEditingId !== null;
  const method = isEdit ? 'PATCH' : 'POST';
  const path = isEdit ? `/api/problems/${currentEditingId}` : '/api/problems';
  await request(path, {
    method,
    body: JSON.stringify(payload),
  });
  event.target.reset();
  if (!isEdit) clearAddProblemDraft();
  currentEditingId = null;
  closeModal();
  await loadProblems();
  await renderAnalytics();
});

problemRows.addEventListener('click', async (event) => {
  const target = event.target;
  const notesId = Number(target.getAttribute('data-notes'));
  const deleteId = Number(target.getAttribute('data-delete'));
  const editId = Number(target.getAttribute('data-edit'));
  const openId = Number(target.getAttribute("data-open"));
  const visualizeId = Number(target.getAttribute("data-visualize"));
  const visualizeNotesId = Number(target.getAttribute("data-visualize-notes"));
  const id = notesId || deleteId || editId || openId || visualizeId || visualizeNotesId;
  if (!id) return;

  if (target.hasAttribute('data-visualize-notes')) {
    const problem = problems.find((p) => p.id === visualizeNotesId);
    if (!problem) return;
    const notes = Object.prototype.hasOwnProperty.call(notesDrafts, visualizeNotesId)
      ? notesDrafts[visualizeNotesId]
      : problem.notes || '';
    document.getElementById('notesViewerTitle').textContent = problem.title ? `Notes: ${problem.title}` : 'Notes';
    notesViewer.innerHTML = renderMarkdown(notes);
    notesViewerModal.classList.remove('hidden');
    return;
  }

  if (target.hasAttribute('data-visualize')) {
    const problem = problems.find((p) => p.id === visualizeId);
    if (!problem) return;
    document.getElementById('descriptionTitle').textContent = problem.title || 'Problem Description';
    descriptionViewer.innerHTML = renderMarkdown(problem.description || '');
    descriptionModal.classList.remove('hidden');
    return;
  }

  if (target.hasAttribute('data-open')) {
    const problem = problems.find((p) => p.id === openId);
    if (problem?.link) {
      window.open(problem.link, "_blank", "noopener,noreferrer");
    }
    return;
  }

  if (target.hasAttribute('data-delete')) {
    const current = problems.find((p) => p.id === id);
    const problemTitle = current?.title || 'this problem';
    const confirmed = window.confirm(`Are you sure you want to delete "${problemTitle}"? This action cannot be undone.`);
    if (!confirmed) return;

    await request(`/api/problems/${id}`, { method: 'DELETE' });
    await loadProblems();
    await renderAnalytics();
    return;
  }

  if (target.hasAttribute('data-notes')) {
    currentNotesId = id;
    const current = problems.find((p) => p.id === id);
    document.getElementById('noteTitle').textContent = `Notes: ${current.title || 'Problem'}`;
    notesInput.value = Object.prototype.hasOwnProperty.call(notesDrafts, id)
      ? notesDrafts[id]
      : current.notes || '';
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
  problemForm.elements.company_tags.value = (current.company_tags || []).join(', ');
  problemForm.elements.difficulty.value = current.difficulty || 'easy';
  problemForm.elements.description.value = current.description || '';
  openModal();
});

notesInput.addEventListener('input', () => {
  if (currentNotesId) notesDrafts[currentNotesId] = notesInput.value;
});

clearProblemFormBtn.addEventListener('click', () => {
  clearAddProblemDraft();
});

clearNotesBtn.addEventListener('click', () => {
  if (!currentNotesId) return;
  notesInput.value = '';
  notesDrafts[currentNotesId] = '';
});

for (const input of [searchInput, difficultyFilter, categoryFilter, tagsFilter, companyTagsFilter]) {
  input.addEventListener('input', () => {
    loadProblems().catch((err) => alert(err.message));
  });
}

loadProblems()
  .then(renderAnalytics)
  .catch((err) => alert(err.message));

for (const button of tabButtons) {
  button.addEventListener('click', () => {
    switchTab(button.dataset.tab);
    if (button.dataset.tab === 'analyticsTab') renderAnalytics().catch((err) => alert(err.message));
  });
}

document.getElementById('refreshAnalytics').addEventListener('click', () => {
  renderAnalytics().catch((err) => alert(err.message));
});

openAddProblemBtn.addEventListener('click', () => {
  currentEditingId = null;
  document.getElementById('addProblemTitle').textContent = 'Add Problem';
  problemForm.querySelector('button[type="submit"]').textContent = 'Save Problem';
  restoreAddProblemDraft();
  openModal();
});

closeAddProblemBtn.addEventListener('click', () => {
  saveAddProblemDraft();
  currentEditingId = null;
  document.getElementById('addProblemTitle').textContent = 'Add Problem';
  problemForm.querySelector('button[type="submit"]').textContent = 'Save Problem';
  closeModal();
});

problemModal.addEventListener('click', (event) => {
  if (event.target === problemModal) {
    saveAddProblemDraft();
    currentEditingId = null;
    closeModal();
  }
});

saveNotesBtn.addEventListener('click', async () => {
  if (!currentNotesId) return;
  await request(`/api/problems/${currentNotesId}`, {
    method: 'PATCH',
    body: JSON.stringify({ notes: notesInput.value }),
  });
  delete notesDrafts[currentNotesId];
  currentNotesId = null;
  notesModal.classList.add('hidden');
  await loadProblems();
  await renderAnalytics();
});

closeNotesBtn.addEventListener('click', () => {
  if (currentNotesId) notesDrafts[currentNotesId] = notesInput.value;
  currentNotesId = null;
  notesModal.classList.add('hidden');
});

notesModal.addEventListener('click', (event) => {
  if (event.target === notesModal) {
    if (currentNotesId) notesDrafts[currentNotesId] = notesInput.value;
    currentNotesId = null;
    notesModal.classList.add('hidden');
  }
});


descriptionModal.addEventListener('click', (event) => {
  if (event.target === descriptionModal) descriptionModal.classList.add('hidden');
});

closeDescriptionBtn.addEventListener('click', () => {
  descriptionModal.classList.add('hidden');
});


notesViewerModal.addEventListener('click', (event) => {
  if (event.target === notesViewerModal) notesViewerModal.classList.add('hidden');
});

closeNotesViewerBtn.addEventListener('click', () => {
  notesViewerModal.classList.add('hidden');
});
