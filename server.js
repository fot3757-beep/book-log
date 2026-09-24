const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sanitizeHtml = require('sanitize-html');
const Database = require('better-sqlite3');

// ---------------------------------------------------------------------------
// 설정 (환경변수)
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

// Railway에서 Volume을 연결하면 /data 같은 경로가 재배포/재시작에도 유지됩니다.
// DB_PATH, UPLOAD_DIR 환경변수로 그 경로를 지정해주세요. (기본값은 로컬 테스트용)
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'public', 'uploads');

// 사이트 자체는 누구나 볼 수 있고, 글쓰기/수정/삭제만 이 비밀번호로 보호됩니다.
// (예전 ACCESS_PASSWORD 변수를 그대로 쓰고 있다면 계속 인식하도록 둘 다 확인)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.ACCESS_PASSWORD || '';

// 폴더 준비
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// DB 초기화
// ---------------------------------------------------------------------------
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT DEFAULT '',
    category TEXT DEFAULT '',
    rating INTEGER DEFAULT 0,
    date TEXT DEFAULT '',
    note TEXT DEFAULT '',
    cover_url TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_logs (
    date TEXT PRIMARY KEY,
    read INTEGER DEFAULT 0,
    pages INTEGER DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reading_dates (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    date TEXT NOT NULL,
    pages INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reading_dates_book_id ON reading_dates(book_id);
`);

// 마이그레이션: 기존에 만들어둔 DB에는 status 컬럼이 없을 수 있으니 없으면 추가
// (이미 등록된 책들은 전부 '다 읽었어요'로 취급해서 기존 통계와 어긋나지 않게 함)
const bookColumns = db.prepare('PRAGMA table_info(books)').all().map(c => c.name);
if (!bookColumns.includes('status')) {
  db.exec("ALTER TABLE books ADD COLUMN status TEXT DEFAULT 'done'");
}
if (!bookColumns.includes('summary')) {
  db.exec("ALTER TABLE books ADD COLUMN summary TEXT DEFAULT ''");
}

// 마이그레이션: 카테고리를 폴더처럼 중첩할 수 있도록 parent_id 추가
const categoryColumns = db.prepare('PRAGMA table_info(categories)').all().map(c => c.name);
if (!categoryColumns.includes('parent_id')) {
  db.exec('ALTER TABLE categories ADD COLUMN parent_id TEXT DEFAULT NULL');
}

// 마이그레이션: 책/영화/드라마를 한 목록에서 다루기 위한 콘텐츠 유형
if (!bookColumns.includes('type')) {
  db.exec("ALTER TABLE books ADD COLUMN type TEXT DEFAULT 'book'");
}
if (!bookColumns.includes('pages')) {
  db.exec('ALTER TABLE books ADD COLUMN pages INTEGER DEFAULT 0');
}
const VALID_TYPES = ['book', 'movie', 'drama'];
function normalizeType(t) {
  return VALID_TYPES.includes(t) ? t : 'book';
}

const VALID_STATUSES = ['want', 'reading', 'done'];
function normalizeStatus(s) {
  return VALID_STATUSES.includes(s) ? s : 'done';
}

// ---------------------------------------------------------------------------
// 앱 설정
// ---------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// 글쓰기/수정/삭제 요청에만 거는 관리자 인증. 조회(GET)는 누구나 가능하고,
// 프론트엔드가 이 헤더에 비밀번호를 담아 보낼 때만 통과시킵니다.
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return next(); // 비밀번호를 아예 설정 안 했으면 (개발용) 막지 않음
  const provided = req.headers['x-admin-password'] || '';
  if (provided === ADMIN_PASSWORD) return next();
  return res.status(401).json({ error: '관리자 인증이 필요해요.' });
}

// 프론트엔드가 비밀번호를 검증만 해볼 수 있는 엔드포인트
app.post('/api/admin/login', (req, res) => {
  const password = (req.body && req.body.password) || '';
  if (!ADMIN_PASSWORD) return res.json({ ok: true }); // 비밀번호 미설정이면 항상 통과
  if (password === ADMIN_PASSWORD) return res.json({ ok: true });
  return res.status(401).json({ ok: false, error: '비밀번호가 틀렸어요.' });
});

// 정적 파일 (프론트엔드) — 누구나 접근 가능
app.use(express.static(path.join(__dirname, 'public')));

// 업로드된 이미지는 UPLOAD_DIR 위치와 무관하게 항상 /uploads/... 로 접근 가능하게 별도로 서빙
app.use('/uploads', express.static(UPLOAD_DIR));

// 이미지 업로드 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('이미지 파일만 업로드할 수 있어요.'));
    }
    cb(null, true);
  },
});

function sanitizeNote(html) {
  return sanitizeHtml(html || '', {
    allowedTags: [
      'p', 'br', 'strong', 'em', 'u', 's', 'blockquote', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'a', 'img', 'span', 'code', 'pre',
    ],
    allowedAttributes: {
      '*': ['class'],
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt'],
    },
    allowedSchemes: ['http', 'https', 'data'],
  });
}

function sanitizeSummary(s) {
  return (s || '').toString().trim().slice(0, 200);
}

// ---------------------------------------------------------------------------
// API: 카테고리
// ---------------------------------------------------------------------------
app.get('/api/categories', (req, res) => {
  const rows = db.prepare('SELECT * FROM categories ORDER BY created_at ASC').all();
  res.json(rows.map(r => ({ id: r.id, name: r.name, createdAt: r.created_at, parentId: r.parent_id || null })));
});

app.post('/api/categories', requireAdmin, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '카테고리 이름이 필요해요.' });
  const parentId = req.body.parentId || null;
  if (parentId) {
    const parent = db.prepare('SELECT id FROM categories WHERE id = ?').get(parentId);
    if (!parent) return res.status(400).json({ error: '상위 카테고리를 찾을 수 없어요.' });
  }
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  db.prepare('INSERT INTO categories (id, name, created_at, parent_id) VALUES (?, ?, ?, ?)').run(id, name, createdAt, parentId);
  res.json({ id, name, createdAt, parentId });
});

app.delete('/api/categories/:id', requireAdmin, (req, res) => {
  // 폴더(하위 카테고리)를 지우면 그 밑에 있는 하위 카테고리들도 같이 삭제
  const descendants = db.prepare(`
    WITH RECURSIVE descendants(id) AS (
      SELECT id FROM categories WHERE id = ?
      UNION ALL
      SELECT c.id FROM categories c JOIN descendants d ON c.parent_id = d.id
    )
    SELECT id FROM descendants
  `).all(req.params.id).map(r => r.id);

  const del = db.prepare('DELETE FROM categories WHERE id = ?');
  const tx = db.transaction((ids) => { ids.forEach(id => del.run(id)); });
  tx(descendants);
  res.json({ ok: true, deletedIds: descendants });
});

// ---------------------------------------------------------------------------
// API: 책 기록
// ---------------------------------------------------------------------------
function rowToBook(r, readDates) {
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    category: r.category,
    rating: r.rating,
    date: r.date,
    note: r.note,
    summary: r.summary || '',
    coverUrl: r.cover_url,
    status: r.status || 'done',
    type: r.type || 'book',
    pages: r.pages || 0,
    readDates: readDates || [],
    createdAt: r.created_at,
  };
}

const getReadDatesStmt = db.prepare('SELECT id, date, pages FROM reading_dates WHERE book_id = ? ORDER BY date ASC');

function replaceReadDates(bookId, readDates) {
  const list = Array.isArray(readDates) ? readDates : [];
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM reading_dates WHERE book_id = ?').run(bookId);
    const insert = db.prepare('INSERT INTO reading_dates (id, book_id, date, pages, created_at) VALUES (?, ?, ?, ?, ?)');
    const seenDates = new Set();
    for (const entry of list) {
      const date = (entry && entry.date || '').trim();
      if (!date || seenDates.has(date)) continue; // 날짜별 하나만 (중복 방지)
      seenDates.add(date);
      const pages = Number.isFinite(Number(entry.pages)) ? Math.max(0, Math.floor(Number(entry.pages))) : 0;
      insert.run(crypto.randomUUID(), bookId, date, pages, Date.now());
    }
  });
  tx();
}

app.get('/api/books', (req, res) => {
  const rows = db.prepare('SELECT * FROM books ORDER BY date DESC, created_at DESC').all();
  res.json(rows.map(r => rowToBook(r, getReadDatesStmt.all(r.id))));
});

app.post('/api/books', requireAdmin, (req, res) => {
  const b = req.body || {};
  const title = (b.title || '').trim();
  if (!title) return res.status(400).json({ error: '제목이 필요해요.' });

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const row = {
    id,
    title,
    author: (b.author || '').trim(),
    category: b.category || '',
    rating: Number(b.rating) || 0,
    date: b.date || new Date().toISOString().slice(0, 10),
    note: sanitizeNote(b.note),
    summary: sanitizeSummary(b.summary),
    cover_url: b.coverUrl || '',
    status: normalizeStatus(b.status),
    type: normalizeType(b.type),
    pages: Number.isFinite(Number(b.pages)) ? Math.max(0, Math.floor(Number(b.pages))) : 0,
    created_at: createdAt,
  };
  db.prepare(`
    INSERT INTO books (id, title, author, category, rating, date, note, summary, cover_url, status, type, pages, created_at)
    VALUES (@id, @title, @author, @category, @rating, @date, @note, @summary, @cover_url, @status, @type, @pages, @created_at)
  `).run(row);

  replaceReadDates(id, b.readDates);

  res.json(rowToBook(row, getReadDatesStmt.all(id)));
});

app.put('/api/books/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: '기록을 찾을 수 없어요.' });

  const b = req.body || {};
  const title = (b.title || '').trim();
  if (!title) return res.status(400).json({ error: '제목이 필요해요.' });

  const updated = {
    id: req.params.id,
    title,
    author: (b.author || '').trim(),
    category: b.category || '',
    rating: Number(b.rating) || 0,
    date: b.date || existing.date,
    note: sanitizeNote(b.note),
    summary: b.summary !== undefined ? sanitizeSummary(b.summary) : (existing.summary || ''),
    cover_url: b.coverUrl !== undefined ? b.coverUrl : existing.cover_url,
    status: b.status !== undefined ? normalizeStatus(b.status) : (existing.status || 'done'),
    type: b.type !== undefined ? normalizeType(b.type) : (existing.type || 'book'),
    pages: b.pages !== undefined
      ? (Number.isFinite(Number(b.pages)) ? Math.max(0, Math.floor(Number(b.pages))) : 0)
      : (existing.pages || 0),
  };
  db.prepare(`
    UPDATE books SET title=@title, author=@author, category=@category, rating=@rating,
      date=@date, note=@note, summary=@summary, cover_url=@cover_url, status=@status, type=@type, pages=@pages WHERE id=@id
  `).run(updated);

  if (b.readDates !== undefined) replaceReadDates(req.params.id, b.readDates);

  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  res.json(rowToBook(row, getReadDatesStmt.all(req.params.id)));
});

app.delete('/api/books/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM books WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM reading_dates WHERE book_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// API: 통계 (누적 권수 + 연도별 그래프) — 누구나 조회 가능
// ---------------------------------------------------------------------------
app.get('/api/stats', (req, res) => {
  const type = VALID_TYPES.includes(req.query.type) ? req.query.type : null;
  const totalBooks = type
    ? db.prepare("SELECT COUNT(*) AS c FROM books WHERE status = 'done' AND type = ?").get(type).c
    : db.prepare("SELECT COUNT(*) AS c FROM books WHERE status = 'done'").get().c;
  const byYear = (type
    ? db.prepare(`
        SELECT substr(date, 1, 4) AS year, COUNT(*) AS count
        FROM books
        WHERE status = 'done' AND type = ? AND date IS NOT NULL AND date != ''
        GROUP BY year ORDER BY year ASC
      `).all(type)
    : db.prepare(`
        SELECT substr(date, 1, 4) AS year, COUNT(*) AS count
        FROM books
        WHERE status = 'done' AND date IS NOT NULL AND date != ''
        GROUP BY year ORDER BY year ASC
      `).all()
  ).filter(r => /^\d{4}$/.test(r.year));
  res.json({ totalBooks, byYear });
});

// ---------------------------------------------------------------------------
// API: 오늘의 기록 (읽음 여부 + 쪽수) — 조회는 누구나, 수정은 관리자만
// ---------------------------------------------------------------------------
app.get('/api/daily-logs', (req, res) => {
  const rows = db.prepare('SELECT * FROM daily_logs ORDER BY date ASC').all();
  res.json(rows.map(r => ({ date: r.date, read: !!r.read, pages: r.pages })));
});

app.get('/api/daily-logs/:date', (req, res) => {
  const row = db.prepare('SELECT * FROM daily_logs WHERE date = ?').get(req.params.date);
  res.json(row
    ? { date: row.date, read: !!row.read, pages: row.pages }
    : { date: req.params.date, read: false, pages: 0 });
});

app.put('/api/daily-logs/:date', requireAdmin, (req, res) => {
  const { date } = req.params;
  const b = req.body || {};
  const read = b.read ? 1 : 0;
  const pages = Number.isFinite(Number(b.pages)) ? Math.max(0, Math.floor(Number(b.pages))) : 0;
  const updatedAt = Date.now();
  db.prepare(`
    INSERT INTO daily_logs (date, read, pages, updated_at) VALUES (@date, @read, @pages, @updatedAt)
    ON CONFLICT(date) DO UPDATE SET read=@read, pages=@pages, updated_at=@updatedAt
  `).run({ date, read, pages, updatedAt });
  res.json({ date, read: !!read, pages });
});

// ---------------------------------------------------------------------------
// API: 이미지 업로드 (표지 사진 + 에디터 내 이미지 삽입 공용)
// ---------------------------------------------------------------------------
app.post('/api/upload', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 없어요.' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message });
  next();
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`My Book Log server running on port ${PORT}`);
  console.log(`DB: ${DB_PATH}`);
  console.log(`Uploads: ${UPLOAD_DIR}`);
});
