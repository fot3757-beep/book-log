(function () {
  let categories = [];
  let books = [];
  let currentFilter = 'all';
  let searchQuery = '';
  let editingId = null;
  let currentRating = 0;
  let currentCoverUrl = null;
  let currentStatus = 'done';
  let currentReadDates = []; // [{date, pages}]
  let detailId = null;
  let quill = null;
  let isAdmin = false;
  let adminPassword = localStorage.getItem('bookLogAdminPassword') || '';

  const $ = (sel) => document.querySelector(sel);
  const statusNote = $('#statusNote');
  const categoryList = $('#categoryList');
  const bookGridWrap = $('#bookGridWrap');

  const bookOverlay = $('#bookOverlay');
  const catOverlay = $('#catOverlay');
  const detailOverlay = $('#detailOverlay');
  const detailArticle = $('#detailArticle');
  const modalTitle = $('#modalTitle');
  const inTitle = $('#inTitle');
  const inAuthor = $('#inAuthor');
  const inSummary = $('#inSummary');
  const inCategory = $('#inCategory');
  const inDate = $('#inDate');
  const starPicker = $('#starPicker');
  const inCatName = $('#inCatName');
  const searchInput = $('#searchInput');
  const statusPicker = $('#statusPicker');
  const dateFieldLabel = $('#dateFieldLabel');
  const readDatesList = $('#readDatesList');
  const inReadDateNew = $('#inReadDateNew');
  const inReadPagesNew = $('#inReadPagesNew');
  const btnAddReadDate = $('#btnAddReadDate');

  const statsOverlay = $('#statsOverlay');
  const statsBtn = $('#statsBtn');
  const statsTotalNum = $('#statsTotalNum');
  const statsChartCanvas = $('#statsChart');
  const statsEmpty = $('#statsEmpty');
  const todayDateLabel = $('#todayDateLabel');
  const todayViewStatus = $('#todayViewStatus');
  const todayReadCheck = $('#todayReadCheck');
  const todayPages = $('#todayPages');
  const todaySaveConfirm = $('#todaySaveConfirm');
  let statsChart = null;

  const calendarOverlay = $('#calendarOverlay');
  const calendarNavBtn = $('#calendarNavBtn');
  const calMonthLabel = $('#calMonthLabel');
  const calendarGrid = $('#calendarGrid');
  const calPrevBtn = $('#calPrevBtn');
  const calNextBtn = $('#calNextBtn');
  let calendarMonth = new Date(); // 현재 보고 있는 달 (1일 기준)
  calendarMonth.setDate(1);

  const adminOverlay = $('#adminOverlay');
  const adminToggleBtn = $('#adminToggleBtn');
  const adminToggleIcon = $('#adminToggleIcon');
  const adminToggleLabel = $('#adminToggleLabel');
  const inAdminPassword = $('#inAdminPassword');
  const adminError = $('#adminError');

  const coverPreview = $('#coverPreview');
  const coverPickBtn = $('#coverPickBtn');
  const coverRemoveBtn = $('#coverRemoveBtn');
  const coverHint = $('#coverHint');
  const inCoverFile = $('#inCoverFile');

  function refreshIcons() {
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
  }

  // ---------- Quill (blog-style editor) ----------
  function initQuill() {
    quill = new Quill('#noteEditor', {
      theme: 'snow',
      placeholder: '느낀 점, 인상 깊은 구절, 사진 등을 자유롭게 남겨보세요...',
      modules: {
        toolbar: {
          container: [
            [{ header: [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            ['blockquote'],
            [{ list: 'ordered' }, { list: 'bullet' }],
            ['link', 'image'],
            ['clean'],
          ],
          handlers: { image: handleEditorImage },
        },
      },
    });
  }

  function handleEditorImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const url = await uploadFile(file);
        const range = quill.getSelection(true);
        quill.insertEmbed(range.index, 'image', url, 'user');
        quill.setSelection(range.index + 1);
      } catch (err) {
        alert('이미지 업로드에 실패했어요.');
      }
    };
    input.click();
  }

  async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    const headers = {};
    if (adminPassword) headers['x-admin-password'] = adminPassword;
    const res = await fetch('/api/upload', { method: 'POST', body: formData, headers });
    if (res.status === 401) { setAdminState(false); openAdminModal(); throw new Error('관리자 인증이 필요해요.'); }
    if (!res.ok) throw new Error('upload failed');
    const data = await res.json();
    return data.url;
  }

  // ---------- Cover photo ----------
  function setCoverPreview(url) {
    currentCoverUrl = url || null;
    if (currentCoverUrl) {
      coverPreview.innerHTML = `<img src="${currentCoverUrl}" alt="cover preview">`;
      coverRemoveBtn.style.display = '';
      coverHint.textContent = '표지 사진이 등록됐어요.';
    } else {
      coverPreview.innerHTML = '<i data-lucide="image"></i>';
      coverRemoveBtn.style.display = 'none';
      coverHint.textContent = '책 표지나 관련 사진을 추가해보세요.';
      refreshIcons();
    }
  }

  coverPickBtn.addEventListener('click', () => inCoverFile.click());
  coverRemoveBtn.addEventListener('click', () => setCoverPreview(null));
  inCoverFile.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    coverHint.textContent = '업로드 중...';
    try {
      const url = await uploadFile(file);
      setCoverPreview(url);
    } catch (err) {
      coverHint.textContent = '업로드에 실패했어요. 다시 시도해주세요.';
    } finally {
      inCoverFile.value = '';
    }
  });

  // ---------- Star picker ----------
  for (let i = 1; i <= 5; i++) {
    const span = document.createElement('span');
    span.className = 'star-pick';
    span.dataset.v = i;
    span.innerHTML = '<i data-lucide="star"></i>';
    starPicker.appendChild(span);
  }
  function setRating(v) {
    currentRating = v;
    starPicker.querySelectorAll('.star-pick').forEach((el, idx) => {
      el.classList.toggle('on', (idx + 1) <= v);
    });
  }
  starPicker.addEventListener('click', (e) => {
    const t = e.target.closest('.star-pick');
    if (t) setRating(Number(t.dataset.v));
  });

  const STATUS_LABELS = { want: '읽고 싶어요', reading: '읽는 중', done: '다 읽었어요' };
  const STATUS_DATE_LABELS = { want: '추가한 날짜', reading: '읽기 시작한 날짜', done: '다 읽은 날짜' };

  function setStatus(status) {
    currentStatus = STATUS_LABELS[status] ? status : 'done';
    statusPicker.querySelectorAll('.status-pick').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.status === currentStatus);
    });
    if (dateFieldLabel) dateFieldLabel.textContent = STATUS_DATE_LABELS[currentStatus];
  }
  statusPicker.addEventListener('click', (e) => {
    const t = e.target.closest('.status-pick');
    if (t) setStatus(t.dataset.status);
  });

  // ---------- Read dates (한 책을 여러 날 나눠 읽은 기록) ----------
  function renderReadDatesList() {
    if (currentReadDates.length === 0) {
      readDatesList.innerHTML = '<span class="read-dates-empty">아직 추가한 날짜가 없어요.</span>';
      return;
    }
    const sorted = [...currentReadDates].sort((a, b) => a.date.localeCompare(b.date));
    readDatesList.innerHTML = sorted.map(rd => `
      <span class="read-date-chip" data-date="${rd.date}">
        ${fmtDate(rd.date)}${rd.pages ? `<span class="rd-pages">· ${rd.pages}쪽</span>` : ''}
        <button type="button" class="rd-del" data-date="${rd.date}"><i data-lucide="x"></i></button>
      </span>
    `).join('');
    readDatesList.querySelectorAll('.rd-del').forEach(btn => {
      btn.addEventListener('click', () => {
        currentReadDates = currentReadDates.filter(rd => rd.date !== btn.dataset.date);
        renderReadDatesList();
      });
    });
    refreshIcons();
  }

  btnAddReadDate.addEventListener('click', () => {
    const date = inReadDateNew.value;
    if (!date) { inReadDateNew.focus(); return; }
    const pages = Number(inReadPagesNew.value) || 0;
    const existing = currentReadDates.find(rd => rd.date === date);
    if (existing) {
      existing.pages = pages;
    } else {
      currentReadDates.push({ date, pages });
    }
    inReadDateNew.value = '';
    inReadPagesNew.value = '';
    renderReadDatesList();
  });

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : s;
    return d.innerHTML;
  }
  function stripHtml(html) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    return (d.textContent || '').trim();
  }
  function fmtDate(iso) {
    return iso ? iso.replaceAll('-', '.') : '';
  }
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ---------- API ----------
  async function api(path, options) {
    const opts = options || {};
    const headers = Object.assign({}, opts.headers);
    if (adminPassword) headers['x-admin-password'] = adminPassword;
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    if (res.status === 401) {
      setAdminState(false);
      openAdminModal();
      throw new Error('관리자 인증이 필요해요.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'request failed');
    }
    return res.json();
  }

  // ---------- Admin login ----------
  function setAdminState(on) {
    isAdmin = on;
    document.body.classList.toggle('is-admin', on);
    if (adminToggleIcon) adminToggleIcon.setAttribute('data-lucide', on ? 'lock-open' : 'lock');
    if (adminToggleLabel) adminToggleLabel.textContent = on ? '관리자 모드 (로그아웃)' : '관리자로 로그인';
    refreshIcons();
  }

  function openAdminModal() {
    inAdminPassword.value = '';
    adminError.textContent = '';
    adminOverlay.classList.add('show');
    setTimeout(() => inAdminPassword.focus(), 50);
  }
  function closeAdminModal() { adminOverlay.classList.remove('show'); }

  async function verifyAdminPassword(pw, { silent } = {}) {
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        adminPassword = pw;
        localStorage.setItem('bookLogAdminPassword', pw);
        setAdminState(true);
        closeAdminModal();
        return true;
      }
      if (!silent) adminError.textContent = data.error || '비밀번호가 틀렸어요.';
      return false;
    } catch (err) {
      if (!silent) adminError.textContent = '서버에 연결할 수 없어요.';
      return false;
    }
  }

  adminToggleBtn.addEventListener('click', () => {
    if (isAdmin) {
      isAdmin = false;
      adminPassword = '';
      localStorage.removeItem('bookLogAdminPassword');
      setAdminState(false);
    } else {
      openAdminModal();
    }
  });
  $('#btnAdminCancel').addEventListener('click', closeAdminModal);
  $('#btnAdminLogin').addEventListener('click', () => verifyAdminPassword(inAdminPassword.value));
  inAdminPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyAdminPassword(inAdminPassword.value); });
  adminOverlay.addEventListener('click', (e) => { if (e.target === adminOverlay) closeAdminModal(); });

  async function loadAll() {
    try {
      [categories, books] = await Promise.all([
        api('/api/categories'),
        api('/api/books'),
      ]);
      statusNote.textContent = '';
    } catch (err) {
      console.error(err);
      statusNote.textContent = '서버에 연결할 수 없어요. 잠시 후 새로고침해주세요.';
    }
    renderAll();
  }

  // ---------- Rendering ----------
  function renderCategoryOptions() {
    inCategory.innerHTML = '';
    if (categories.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '카테고리를 먼저 추가해주세요';
      inCategory.appendChild(opt);
      return;
    }
    categories.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.name;
      opt.textContent = c.name;
      inCategory.appendChild(opt);
    });
  }

  function renderCategoryList() {
    categoryList.innerHTML = '';
    const allItem = document.createElement('li');
    allItem.className = 'category-item' + (currentFilter === 'all' ? ' active' : '');
    allItem.innerHTML = `<span class="cat-name">전체보기</span><span class="count">${books.length}</span>`;
    allItem.onclick = () => { currentFilter = 'all'; renderAll(); };
    categoryList.appendChild(allItem);

    categories.forEach(c => {
      const count = books.filter(b => b.category === c.name).length;
      const li = document.createElement('li');
      li.className = 'category-item' + (currentFilter === c.name ? ' active' : '');
      li.innerHTML = `
        <span class="cat-name">${escapeHtml(c.name)}</span>
        <button class="cat-del" data-id="${c.id}" data-name="${escapeHtml(c.name)}" title="삭제"><i data-lucide="x"></i></button>
        <span class="count">${count}</span>
      `;
      li.addEventListener('click', (e) => {
        if (e.target.closest('.cat-del')) { e.stopPropagation(); deleteCategory(c.id, c.name); return; }
        currentFilter = c.name;
        renderAll();
      });
      categoryList.appendChild(li);
    });
    refreshIcons();
  }

  function getFilteredBooks() {
    let list = currentFilter === 'all' ? books : books.filter(b => b.category === currentFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(b =>
        (b.title || '').toLowerCase().includes(q) ||
        (b.summary || '').toLowerCase().includes(q) ||
        stripHtml(b.note).toLowerCase().includes(q) ||
        (b.author || '').toLowerCase().includes(q)
      );
    }
    return list;
  }

  function starsInlineHtml(rating) {
    let html = '';
    for (let i = 1; i <= 5; i++) {
      html += `<span class="star-slot ${i <= (rating || 0) ? 'on' : ''}"><i data-lucide="star"></i></span>`;
    }
    return html;
  }

  function renderBookGrid() {
    const filtered = getFilteredBooks();
    if (filtered.length === 0) {
      bookGridWrap.innerHTML = `
        <div class="empty-state">
          <i data-lucide="book-marked"></i>
          <p>${books.length === 0 ? '아직 기록된 책이 없어요.' : '조건에 맞는 기록이 없어요.'}</p>
          <p>오른쪽 위 '기록하기' 버튼으로 첫 기록을 남겨보세요.</p>
        </div>`;
      refreshIcons();
      return;
    }

    bookGridWrap.innerHTML = `<div class="book-grid">${filtered.map(b => `
      <div class="book-card" data-id="${b.id}">
        <button class="book-del" data-id="${b.id}" title="삭제"><i data-lucide="x"></i></button>
        <div class="book-cover-placeholder">${b.coverUrl ? `<img src="${b.coverUrl}" alt="cover">` : '<i data-lucide="book"></i>'}</div>
        <div class="book-info">
          <div>
            <div class="book-title">${escapeHtml(b.title)}</div>
            ${b.author ? `<div class="book-author">${escapeHtml(b.author)}</div>` : ''}
            <div class="book-meta">
              <div class="rating">${starsInlineHtml(b.rating)}</div>
              <div class="card-bottom-row">
                ${b.status && b.status !== 'done' ? `<span class="status-badge ${b.status}">${escapeHtml(STATUS_LABELS[b.status] || '')}</span>` : ''}
                ${b.category ? `<span class="cat-tag">${escapeHtml(b.category)}</span>` : ''}
                ${b.date ? `<span class="date-badge"><i data-lucide="calendar"></i><span>${fmtDate(b.date)}</span></span>` : ''}
              </div>
            </div>
          </div>
          ${(b.summary || b.note) ? `<div class="comment">${escapeHtml(b.summary || stripHtml(b.note))}</div>` : ''}
        </div>
      </div>
    `).join('')}</div>`;

    bookGridWrap.querySelectorAll('.book-del').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); deleteBook(btn.dataset.id); });
    });
    bookGridWrap.querySelectorAll('.book-card').forEach(card => {
      card.addEventListener('click', () => openDetail(card.dataset.id));
    });
    refreshIcons();
  }

  function renderAll() {
    renderCategoryList();
    renderBookGrid();
    if (detailId) renderDetail(detailId);
  }

  // ---------- Detail (blog reading) view ----------
  function openDetail(id) {
    detailId = id;
    renderDetail(id);
    detailOverlay.classList.add('show');
  }
  function closeDetail() {
    detailId = null;
    detailOverlay.classList.remove('show');
  }
  function renderDetail(id) {
    const b = books.find(x => x.id === id);
    if (!b) { closeDetail(); return; }
    let starsHtml = '';
    for (let i = 1; i <= 5; i++) {
      starsHtml += `<i data-lucide="star" class="${i <= (b.rating || 0) ? 'on' : ''}"></i>`;
    }
    detailArticle.innerHTML = `
      <div class="detail-cover-row">
        <div class="detail-cover">${b.coverUrl ? `<img src="${b.coverUrl}" alt="cover">` : '<i data-lucide="book"></i>'}</div>
      </div>
      <h1 class="detail-title">${escapeHtml(b.title)}</h1>
      ${b.author ? `<div class="detail-author">${escapeHtml(b.author)}</div>` : ''}
      ${b.summary ? `<p class="detail-summary">${escapeHtml(b.summary)}</p>` : ''}
      <div class="detail-meta-row">
        <div class="detail-stars">${starsHtml}</div>
        ${b.status && b.status !== 'done' ? `<span class="status-badge ${b.status}">${escapeHtml(STATUS_LABELS[b.status] || '')}</span>` : ''}
        ${b.category ? `<span class="cat-tag">${escapeHtml(b.category)}</span>` : ''}
        ${b.date ? `<span class="date-badge"><i data-lucide="calendar"></i><span>${fmtDate(b.date)}</span></span>` : ''}
      </div>
      ${b.readDates && b.readDates.length > 0 ? `
        <div class="detail-read-dates">
          <i data-lucide="calendar-days"></i>
          <span>읽은 날: ${b.readDates.map(rd => fmtDate(rd.date) + (rd.pages ? `(${rd.pages}쪽)` : '')).join(', ')}</span>
        </div>
      ` : ''}
      <div class="detail-body ${b.note ? '' : 'empty'}">${b.note ? b.note : '아직 남긴 기록이 없어요. 연필 아이콘을 눌러 기록을 추가해보세요.'}</div>
    `;
    refreshIcons();
    detailArticle.querySelectorAll('.detail-stars svg').forEach((svg, idx) => {
      if (idx < (b.rating || 0)) svg.classList.add('on');
    });
  }

  $('#detailClose').addEventListener('click', closeDetail);
  $('#detailEdit').addEventListener('click', () => {
    if (!detailId) return;
    const id = detailId;
    closeDetail();
    openEditModal(id);
  });
  $('#detailDelete').addEventListener('click', () => {
    if (!detailId) return;
    const id = detailId;
    const b = books.find(x => x.id === id);
    if (!confirm(`'${b ? b.title : '이 기록'}'을(를) 삭제할까요?`)) return;
    closeDetail();
    deleteBook(id);
  });

  // ---------- Write / Edit modal ----------
  function openAddModal() {
    editingId = null;
    modalTitle.textContent = '새 기록 추가';
    inTitle.value = '';
    inAuthor.value = '';
    inSummary.value = '';
    inDate.value = todayStr();
    quill.setContents([]);
    setRating(0);
    setStatus('done');
    currentReadDates = [];
    renderReadDatesList();
    setCoverPreview(null);
    renderCategoryOptions();
    if (currentFilter !== 'all') inCategory.value = currentFilter;
    bookOverlay.classList.add('show');
    setTimeout(() => inTitle.focus(), 50);
  }

  function openEditModal(id) {
    const b = books.find(x => x.id === id);
    if (!b) return;
    editingId = id;
    modalTitle.textContent = '기록 수정';
    inTitle.value = b.title || '';
    inAuthor.value = b.author || '';
    inSummary.value = b.summary || '';
    inDate.value = b.date || todayStr();
    quill.root.innerHTML = b.note || '';
    setRating(b.rating || 0);
    setStatus(b.status || 'done');
    currentReadDates = (b.readDates || []).map(rd => ({ date: rd.date, pages: rd.pages || 0 }));
    renderReadDatesList();
    setCoverPreview(b.coverUrl || null);
    renderCategoryOptions();
    if (b.category) inCategory.value = b.category;
    bookOverlay.classList.add('show');
  }

  function closeBookModal() { bookOverlay.classList.remove('show'); }

  async function saveBook() {
    const title = inTitle.value.trim();
    if (!title) { inTitle.focus(); return; }
    const noteHtml = quill.getText().trim() ? quill.root.innerHTML : '';
    const payload = {
      title,
      author: inAuthor.value.trim(),
      summary: inSummary.value.trim(),
      category: inCategory.value || '',
      rating: currentRating,
      date: inDate.value || todayStr(),
      note: noteHtml,
      coverUrl: currentCoverUrl || '',
      status: currentStatus,
      readDates: currentReadDates,
    };
    try {
      let saved;
      if (editingId) {
        saved = await api(`/api/books/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const idx = books.findIndex(b => b.id === editingId);
        if (idx > -1) books[idx] = saved;
      } else {
        saved = await api('/api/books', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        books.unshift(saved);
      }
      closeBookModal();
      renderAll();
    } catch (err) {
      console.error(err);
      statusNote.textContent = '저장에 실패했어요. 잠시 후 다시 시도해주세요.';
    }
  }

  async function deleteBook(id) {
    books = books.filter(b => b.id !== id);
    renderAll();
    try { await api(`/api/books/${id}`, { method: 'DELETE' }); }
    catch (err) { console.error(err); }
  }

  async function addCategory() {
    const name = inCatName.value.trim();
    if (!name) { inCatName.focus(); return; }
    if (categories.some(c => c.name === name)) { catOverlay.classList.remove('show'); return; }
    try {
      const cat = await api('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      categories.push(cat);
      catOverlay.classList.remove('show');
      renderAll();
    } catch (err) { console.error(err); }
  }

  async function deleteCategory(id, name) {
    if (!confirm(`'${name}' 카테고리를 삭제할까요?\n(이 카테고리로 기록된 책은 남아있어요)`)) return;
    categories = categories.filter(c => c.id !== id);
    if (currentFilter === name) currentFilter = 'all';
    renderAll();
    try { await api(`/api/categories/${id}`, { method: 'DELETE' }); }
    catch (err) { console.error(err); }
  }

  $('#writeBtn').addEventListener('click', openAddModal);
  $('#btnCancel').addEventListener('click', closeBookModal);
  $('#btnSave').addEventListener('click', saveBook);
  bookOverlay.addEventListener('click', (e) => { if (e.target === bookOverlay) closeBookModal(); });

  $('#addCategoryBtn').addEventListener('click', () => {
    inCatName.value = '';
    catOverlay.classList.add('show');
    setTimeout(() => inCatName.focus(), 50);
  });
  $('#btnCatCancel').addEventListener('click', () => catOverlay.classList.remove('show'));
  $('#btnCatSave').addEventListener('click', addCategory);
  catOverlay.addEventListener('click', (e) => { if (e.target === catOverlay) catOverlay.classList.remove('show'); });
  inCatName.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCategory(); });

  searchInput.addEventListener('input', (e) => { searchQuery = e.target.value; renderBookGrid(); });

  // ---------- Stats panel ----------
  function fmtTodayLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${dateStr.replaceAll('-', '.')} (${days[d.getDay()]}) · 오늘`;
  }

  function renderStatsChart(byYear) {
    if (!byYear || byYear.length === 0) {
      statsChartCanvas.style.display = 'none';
      statsEmpty.style.display = 'block';
      if (statsChart) { statsChart.destroy(); statsChart = null; }
      return;
    }
    statsChartCanvas.style.display = 'block';
    statsEmpty.style.display = 'none';

    const styles = getComputedStyle(document.body);
    const inkColor = styles.getPropertyValue('--ink').trim() || '#1a1a1a';
    const gridColor = styles.getPropertyValue('--border').trim() || '#e9ecef';
    const softColor = styles.getPropertyValue('--ink-faint').trim() || '#868e96';

    const labels = byYear.map(r => r.year + '년');
    const data = byYear.map(r => r.count);

    if (statsChart) statsChart.destroy();
    statsChart = new Chart(statsChartCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: inkColor,
          borderRadius: 6,
          maxBarThickness: 40,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: softColor } },
          y: {
            beginAtZero: true,
            ticks: { color: softColor, precision: 0 },
            grid: { color: gridColor },
          },
        },
      },
    });
  }

  async function loadStats() {
    try {
      const stats = await api('/api/stats');
      statsTotalNum.textContent = stats.totalBooks;
      renderStatsChart(stats.byYear);
    } catch (err) {
      console.error(err);
    }

    const today = todayStr();
    todayDateLabel.textContent = fmtTodayLabel(today);
    try {
      const log = await api(`/api/daily-logs/${today}`);
      todayReadCheck.checked = !!log.read;
      todayPages.value = log.pages || '';
      todayViewStatus.textContent = log.read
        ? `오늘 읽었어요${log.pages ? ` · ${log.pages}쪽` : ''}`
        : '오늘은 아직 안 읽었어요';
    } catch (err) {
      console.error(err);
    }
  }

  statsBtn.addEventListener('click', () => {
    statsOverlay.classList.add('show');
    loadStats();
  });
  $('#btnStatsClose').addEventListener('click', () => statsOverlay.classList.remove('show'));
  statsOverlay.addEventListener('click', (e) => { if (e.target === statsOverlay) statsOverlay.classList.remove('show'); });

  $('#btnTodaySave').addEventListener('click', async () => {
    const today = todayStr();
    try {
      const saved = await api(`/api/daily-logs/${today}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: todayReadCheck.checked, pages: Number(todayPages.value) || 0 }),
      });
      todayViewStatus.textContent = saved.read
        ? `오늘 읽었어요${saved.pages ? ` · ${saved.pages}쪽` : ''}`
        : '오늘은 아직 안 읽었어요';
      todaySaveConfirm.classList.add('show');
      clearTimeout(todaySaveConfirm._timer);
      todaySaveConfirm._timer = setTimeout(() => todaySaveConfirm.classList.remove('show'), 2200);
    } catch (err) {
      console.error(err);
      statusNote.textContent = '저장에 실패했어요. 관리자 로그인 상태를 확인해주세요.';
    }
  });

  // ---------- Calendar ----------
  function pad2(n) { return String(n).padStart(2, '0'); }

  function booksByDate() {
    const map = {};
    function addToDate(dateStr, book) {
      if (!dateStr) return;
      if (!map[dateStr]) map[dateStr] = [];
      if (!map[dateStr].some(b => b.id === book.id)) map[dateStr].push(book);
    }
    books.forEach(b => {
      if (b.status === 'want') return; // '읽고 싶어요'는 아직 읽은 게 아니라 달력에 표시 안 함
      if (b.readDates && b.readDates.length > 0) {
        b.readDates.forEach(rd => addToDate(rd.date, b));
      } else if (b.date) {
        addToDate(b.date, b);
      }
    });
    return map;
  }

  function renderCalendar() {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth(); // 0-based
    calMonthLabel.textContent = `${year}년 ${month + 1}월`;

    const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0=일
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const map = booksByDate();
    const today = todayStr();

    let html = '';
    for (let i = 0; i < firstDayOfWeek; i++) {
      html += '<div class="cal-cell empty"></div>';
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${pad2(month + 1)}-${pad2(day)}`;
      const dayBooks = map[dateStr] || [];
      const isToday = dateStr === today;
      const hasBook = dayBooks.length > 0;
      const first = dayBooks[0];

      let coverHtml = '';
      if (hasBook) {
        coverHtml = first.coverUrl
          ? `<img class="cal-cover-img" src="${first.coverUrl}" alt="">`
          : `<div class="cal-cover-fallback"><i data-lucide="book"></i></div>`;
      }
      const badge = dayBooks.length > 1 ? `<span class="cal-badge">+${dayBooks.length - 1}</span>` : '';

      html += `
        <div class="cal-cell ${hasBook ? 'has-book' : ''} ${isToday ? 'is-today' : ''}" data-date="${dateStr}" data-first-id="${hasBook ? first.id : ''}">
          <span class="cal-day-num">${day}</span>
          ${coverHtml}
          ${badge}
        </div>`;
    }
    calendarGrid.innerHTML = html;

    calendarGrid.querySelectorAll('.cal-cell.has-book').forEach(cell => {
      cell.addEventListener('click', () => {
        const id = cell.dataset.firstId;
        calendarOverlay.classList.remove('show');
        openDetail(id);
      });
    });
    calendarGrid.querySelectorAll('.cal-cell:not(.has-book):not(.empty)').forEach(cell => {
      cell.addEventListener('click', () => {
        if (!isAdmin) return;
        calendarOverlay.classList.remove('show');
        openAddModal();
        inDate.value = cell.dataset.date;
      });
    });
    refreshIcons();
  }

  calendarNavBtn.addEventListener('click', () => {
    calendarMonth = new Date();
    calendarMonth.setDate(1);
    renderCalendar();
    calendarOverlay.classList.add('show');
  });
  calPrevBtn.addEventListener('click', () => {
    calendarMonth.setMonth(calendarMonth.getMonth() - 1);
    renderCalendar();
  });
  calNextBtn.addEventListener('click', () => {
    calendarMonth.setMonth(calendarMonth.getMonth() + 1);
    renderCalendar();
  });
  $('#btnCalendarClose').addEventListener('click', () => calendarOverlay.classList.remove('show'));
  calendarOverlay.addEventListener('click', (e) => { if (e.target === calendarOverlay) calendarOverlay.classList.remove('show'); });

  refreshIcons();
  initQuill();
  loadAll();
  if (adminPassword) {
    verifyAdminPassword(adminPassword, { silent: true }).then((ok) => {
      if (!ok) { adminPassword = ''; localStorage.removeItem('bookLogAdminPassword'); }
    });
  }
})();
