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

const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || ''; // 설정하면 비밀번호 보호가 켜집니다.
const ACCESS_USER = process.env.ACCESS_USER || 'admin';

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
`);

// ---------------------------------------------------------------------------
// 앱 설정
// ---------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// 선택적 비밀번호 보호 (ACCESS_PASSWORD 환경변수를 설정했을 때만 활성화)
if (ACCESS_PASSWORD) {
  app.use((req, res, next) => {
    const auth = req.headers.authorization || '';
    const expected =
      'Basic ' + Buffer.from(`${ACCESS_USER}:${ACCESS_PASSWORD}`).toString('base64');
    if (auth === expected) return next();
    res.set('WWW-Authenticate', 'Basic realm="My Book Log"');
    return res.status(401).send('Authentication required.');
  });
}

// 정적 파일 (프론트엔드)
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
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt'],
      span: ['class'],
    },
    allowedSchemes: ['http', 'https', 'data'],
  });
}

// ---------------------------------------------------------------------------
// API: 카테고리
// ---------------------------------------------------------------------------
app.get('/api/categories', (req, res) => {
  const rows = db.prepare('SELECT * FROM categories ORDER BY created_at ASC').all();
  res.json(rows.map(r => ({ id: r.id, name: r.name, createdAt: r.created_at })));
});

app.post('/api/categories', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '카테고리 이름이 필요해요.' });
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  db.prepare('INSERT INTO categories (id, name, created_at) VALUES (?, ?, ?)').run(id, name, createdAt);
  res.json({ id, name, createdAt });
});

app.delete('/api/categories/:id', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// API: 책 기록
// ---------------------------------------------------------------------------
function rowToBook(r) {
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    category: r.category,
    rating: r.rating,
    date: r.date,
    note: r.note,
    coverUrl: r.cover_url,
    createdAt: r.created_at,
  };
}

app.get('/api/books', (req, res) => {
  const rows = db.prepare('SELECT * FROM books ORDER BY date DESC, created_at DESC').all();
  res.json(rows.map(rowToBook));
});

app.post('/api/books', (req, res) => {
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
    cover_url: b.coverUrl || '',
    created_at: createdAt,
  };
  db.prepare(`
    INSERT INTO books (id, title, author, category, rating, date, note, cover_url, created_at)
    VALUES (@id, @title, @author, @category, @rating, @date, @note, @cover_url, @created_at)
  `).run(row);

  res.json(rowToBook(row));
});

app.put('/api/books/:id', (req, res) => {
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
    cover_url: b.coverUrl !== undefined ? b.coverUrl : existing.cover_url,
  };
  db.prepare(`
    UPDATE books SET title=@title, author=@author, category=@category, rating=@rating,
      date=@date, note=@note, cover_url=@cover_url WHERE id=@id
  `).run(updated);

  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  res.json(rowToBook(row));
});

app.delete('/api/books/:id', (req, res) => {
  db.prepare('DELETE FROM books WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// API: 이미지 업로드 (표지 사진 + 에디터 내 이미지 삽입 공용)
// ---------------------------------------------------------------------------
app.post('/api/upload', upload.single('file'), (req, res) => {
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
