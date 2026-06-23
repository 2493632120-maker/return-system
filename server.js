const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const initSqlJs = require('sql.js');
const fs = require('fs');

const app = express();
// Zeabur 会设置 PORT 环境变量
const PORT = process.env.PORT || 3000;
// 数据库存到持久化目录（Zeabur 的 /data 是持久化的）
const DB_DIR = process.env.DB_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'returns.db');

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── 路由：客户提交页 / 管理员页（放在 static 之前，防止被 index.html 覆盖）───
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'submit.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use(express.static(path.join(__dirname, 'public')));

// ─── 数据库初始化 ──────────────────────────────────────────
let db;

function saveDb() {
  try {
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  } catch (e) {
    console.error('保存数据库失败:', e.message);
  }
}

async function initDb() {
  // 确保数据库目录存在
  fs.mkdirSync(DB_DIR, { recursive: true });

  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
    console.log('✅ 数据库已加载，路径:', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('✅ 新数据库已创建');
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS returns (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id    TEXT NOT NULL,
      customer    TEXT NOT NULL DEFAULT '',
      type        TEXT NOT NULL DEFAULT 'exchange',
      carrier     TEXT NOT NULL DEFAULT '',
      tracking_no TEXT NOT NULL DEFAULT '',
      return_address TEXT NOT NULL DEFAULT '',
      return_contact  TEXT NOT NULL DEFAULT '',
      return_phone   TEXT NOT NULL DEFAULT '',
      return_items TEXT NOT NULL DEFAULT '',
      reason      TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'pending',
      note        TEXT NOT NULL DEFAULT '',
      sent_carrier TEXT NOT NULL DEFAULT '',
      sent_tracking_no TEXT NOT NULL DEFAULT '',
      created_at  DATETIME DEFAULT (datetime('now','localtime')),
      updated_at  DATETIME DEFAULT (datetime('now','localtime'))
    )
  `);
  // 数据库迁移
  try { db.run('ALTER TABLE returns ADD COLUMN sent_carrier TEXT NOT NULL DEFAULT ""'); } catch(e) {}
  try { db.run('ALTER TABLE returns ADD COLUMN sent_tracking_no TEXT NOT NULL DEFAULT ""'); } catch(e) {}
  try { db.run('ALTER TABLE returns ADD COLUMN return_address TEXT NOT NULL DEFAULT ""'); } catch(e) {}
  try { db.run('ALTER TABLE returns ADD COLUMN return_contact TEXT NOT NULL DEFAULT ""'); } catch(e) {}
  try { db.run('ALTER TABLE returns ADD COLUMN return_phone TEXT NOT NULL DEFAULT ""'); } catch(e) {}
  try { db.run('ALTER TABLE returns ADD COLUMN return_items TEXT NOT NULL DEFAULT ""'); } catch(e) {}
  saveDb();
}

// ─── Helper ────────────────────────────────────────────────
function allRows(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
function firstRow(sql, params = []) { return allRows(sql, params)[0] || null; }
function run(sql, params = []) { db.run(sql, params); saveDb(); return true; }

// ─── 物流承运商 ──────────────────────────────────────────────
const CARRIERS = [
  { code: 'shunfeng',      name: '顺丰速运' },
  { code: 'shentong',      name: '申通快递' },
  { code: 'yuantong',      name: '圆通速递' },
  { code: 'zhongtong',     name: '中通快递' },
  { code: 'yunda',         name: '韵达快递' },
  { code: 'jingdong',      name: '京东快递' },
  { code: 'ems',           name: 'EMS' },
  { code: 'youzhengguonei', name: '邮政国内' },
  { code: 'debangwuliu',   name: '德邦物流' },
  { code: 'zhaijisong',    name: '宅急送' },
  { code: 'tiantian',      name: '天天快递' },
  { code: 'huitongkuaidi', name: '百世快递' },
  { code: 'youshuwuliu',   name: '优速快递' },
  { code: 'suer',          name: '速尔快递' },
  { code: 'jd',            name: '京东物流' },
];

// ─── API ───────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '020903';

app.get('/api/carriers', (req, res) => res.json(CARRIERS));

// 管理员验证
app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  res.json({ ok: password === ADMIN_PASSWORD });
});

// 健康检查（Zeabur 会定期检查）
app.get('/health', (req, res) => res.json({ status: 'ok', db: fs.existsSync(DB_PATH) }));

app.get('/api/logistics/:carrier/:trackingNo', async (req, res) => {
  const { carrier, trackingNo } = req.params;
  if (!trackingNo) return res.json({ error: '请填写运单号', updates: [] });
  try {
    const resp = await axios.get('https://www.kuaidi100.com/query', {
      params: { type: carrier, postid: trackingNo },
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.kuaidi100.com/' }
    });
    const data = resp.data;
    if (data.message === 'ok' && data.data) {
      res.json({
        carrier: data.com || carrier,
        trackingNo: data.nu || trackingNo,
        status: data.state,
        statusText: ['在途','揽收','疑难','已签收','退签','派件中','退回'][data.state] || '未知',
        updates: data.data.map(i => ({ time: i.time, context: i.context, location: i.location || '' })),
      });
    } else {
      res.json({ error: data.message || '暂未查询到物流信息', updates: [] });
    }
  } catch (err) {
    res.json({ error: '物流查询接口异常', updates: [] });
  }
});

// 保存图片
function saveImage(id, imageData) {
  if (!imageData) return;
  try {
    const dir = path.join(PHOTO_DIR, String(id));
    fs.mkdirSync(dir, { recursive: true });
    const matches = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
    const ext = matches ? matches[1] : 'jpg';
    const data = matches ? matches[2] : imageData;
    fs.writeFileSync(path.join(dir, 'photo.' + ext), Buffer.from(data, 'base64'));
  } catch(e) { console.error('Save image error:', e.message); }
}

app.post('/api/returns', (req, res) => {
  const { order_id, customer, type, carrier, tracking_no, return_address, return_contact, return_phone, return_items, reason, note, sent_carrier, sent_tracking_no, image } = req.body;
  if (!order_id) return res.status(400).json({ error: '订单号不能为空' });
  run(
    `INSERT INTO returns (order_id, customer, type, carrier, tracking_no, return_address, return_contact, return_phone, return_items, reason, note, sent_carrier, sent_tracking_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [order_id, customer || '', type || 'exchange', carrier || '', tracking_no || '', return_address || '', return_contact || '', return_phone || '', return_items || '', reason || '', note || '', sent_carrier || '', sent_tracking_no || '']
  );
  const item = firstRow('SELECT * FROM returns WHERE id = (SELECT MAX(id) FROM returns)');
  if (image && item) saveImage(item.id, image);
  res.json({ ok: true, item });
});

app.get('/api/returns', (req, res) => {
  res.json(allRows('SELECT * FROM returns ORDER BY created_at DESC'));
});

app.put('/api/returns/:id', (req, res) => {
  const { id } = req.params;
  const { order_id, customer, type, carrier, tracking_no, return_address, return_contact, return_phone, return_items, reason, status, note, sent_carrier, sent_tracking_no, image } = req.body;
  const fields = []; const values = [];
  if (order_id !== undefined) { fields.push('order_id = ?'); values.push(order_id); }
  if (customer !== undefined) { fields.push('customer = ?'); values.push(customer); }
  if (type !== undefined) { fields.push('type = ?'); values.push(type); }
  if (carrier !== undefined) { fields.push('carrier = ?'); values.push(carrier); }
  if (tracking_no !== undefined) { fields.push('tracking_no = ?'); values.push(tracking_no); }
  if (return_address !== undefined) { fields.push('return_address = ?'); values.push(return_address); }
  if (return_contact !== undefined) { fields.push('return_contact = ?'); values.push(return_contact); }
  if (return_phone !== undefined) { fields.push('return_phone = ?'); values.push(return_phone); }
  if (return_items !== undefined) { fields.push('return_items = ?'); values.push(return_items); }
  if (reason !== undefined) { fields.push('reason = ?'); values.push(reason); }
  if (status !== undefined) { fields.push('status = ?'); values.push(status); }
  if (note !== undefined) { fields.push('note = ?'); values.push(note); }
  if (sent_carrier !== undefined) { fields.push('sent_carrier = ?'); values.push(sent_carrier); }
  if (sent_tracking_no !== undefined) { fields.push('sent_tracking_no = ?'); values.push(sent_tracking_no); }
  if (fields.length === 0) return res.status(400).json({ error: '没有需要更新的字段' });
  fields.push("updated_at = datetime('now','localtime')");
  values.push(id);
  run(`UPDATE returns SET ${fields.join(', ')} WHERE id = ?`, values);
  if (image) saveImage(id, image);
  res.json({ ok: true, item: firstRow('SELECT * FROM returns WHERE id = ?', [id]) });
});

app.delete('/api/returns/:id', (req, res) => {
  run('DELETE FROM returns WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ─── 照片上传 ────────────────────────────────────────────
const PHOTO_DIR = path.join(DB_DIR, 'photos');

app.post('/api/upload/:id', (req, res) => {
  const { id } = req.params;
  const { image } = req.body;
  if (!image) return res.json({ error: '无图片数据' });
  try {
    const dir = path.join(PHOTO_DIR, id);
    fs.mkdirSync(dir, { recursive: true });
    const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
    const ext = matches ? matches[1] : 'jpg';
    const data = matches ? matches[2] : image;
    const filename = 'photo.' + ext;
    fs.writeFileSync(path.join(dir, filename), Buffer.from(data, 'base64'));
    res.json({ ok: true, url: `/api/photos/${id}/${filename}` });
  } catch(e) {
    res.json({ error: e.message });
  }
});

app.get('/api/photos/:id/:filename', (req, res) => {
  const file = path.join(PHOTO_DIR, req.params.id, req.params.filename);
  if (fs.existsSync(file)) return res.sendFile(file);
  res.status(404).json({ error: '未找到图片' });
});

app.get('/api/photos/:id', (req, res) => {
  const dir = path.join(PHOTO_DIR, req.params.id);
  if (fs.existsSync(dir)) {
    res.json(fs.readdirSync(dir).map(f => ({ url: `/api/photos/${req.params.id}/${f}` })));
  } else {
    res.json([]);
  }
});

// ─── 启动 ───────────────────────────────────────────────
initDb().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`📦 换货售后管理系统已启动`);
    console.log(`🌐 端口: ${PORT}`);
    console.log(`💾 数据库: ${DB_PATH}`);
  });
});
