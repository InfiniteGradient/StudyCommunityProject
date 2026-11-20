'use strict';

require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || '';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const allowedOrigins = String(process.env.CORS_ORIGIN || `http://localhost:${PORT},http://127.0.0.1:${PORT}`)
  .split(',').map((x) => x.trim()).filter(Boolean);

if (JWT_SECRET.length < 32) {
  console.error('Configuration error: set JWT_SECRET to a random secret of at least 32 characters in .env.');
  process.exit(1);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'study_community',
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 5,
  idleTimeout: 60000,
  queueLimit: 0,
  enableKeepAlive: true,
  charset: 'utf8mb4'
});

app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'", 'http://localhost:3000', 'http://127.0.0.1:3000'], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"] } } }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS.'));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '1mb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 25, standardHeaders: 'draft-7', legacyHeaders: false });
const writeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 90, standardHeaders: 'draft-7', legacyHeaders: false });
app.use('/api/auth', authLimiter);
app.use('/api', writeLimiter);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sendError = (res, status, message) => res.status(status).json({ error: message });
const s = (value, max = 5000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const num = (v) => Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null;
const userSafe = (row) => ({ user_id: row.user_id, username: row.username, display_name: row.display_name });

function authRequired(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return sendError(res, 401, 'Sign in to continue.');
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    req.user = { user_id: Number(payload.sub), username: payload.username };
    if (!req.user.user_id) throw new Error('Invalid subject');
    return next();
  } catch {
    return sendError(res, 401, 'Your session has expired. Sign in again.');
  }
}

async function activeGroupMember(executor, groupId, userId) {
  const [rows] = await executor.execute(
    `SELECT role, status FROM group_memberships WHERE group_id = ? AND user_id = ? LIMIT 1`, [groupId, userId]);
  return rows[0] && rows[0].status === 'ACTIVE' ? rows[0] : null;
}
async function groupConversationId(executor, groupId) {
  const [rows] = await executor.execute(
    `SELECT conversation_id FROM conversations WHERE conversation_type = 'GROUP' AND study_group_id = ? LIMIT 1`, [groupId]);
  if (!rows.length) throw new HttpError(500, 'Group conversation is not configured.');
  return rows[0].conversation_id;
}
async function ensureNotBlocked(executor, userA, userB) {
  const [rows] = await executor.execute(
    `SELECT 1 FROM user_blocks WHERE (user_id = ? AND blocked_user_id = ?) OR (user_id = ? AND blocked_user_id = ?) LIMIT 1`,
    [userA, userB, userB, userA]);
  if (rows.length) throw new HttpError(403, 'Messaging is unavailable because a block is active.');
}
async function canAccessConversation(executor, conversationId, userId) {
  const [memberRows] = await executor.execute(
    `SELECT cm.conversation_id FROM conversation_members cm WHERE cm.conversation_id = ? AND cm.user_id = ?`,
    [conversationId, userId]);
  if (!memberRows.length) throw new HttpError(403, 'You are not a participant in this conversation.');
  const [convRows] = await executor.execute(
    `SELECT conversation_id, conversation_type, study_group_id FROM conversations WHERE conversation_id = ?`, [conversationId]);
  if (!convRows.length) throw new HttpError(404, 'Conversation not found.');
  const conversation = convRows[0];
  if (conversation.conversation_type === 'GROUP') {
    const member = await activeGroupMember(executor, conversation.study_group_id, userId);
    if (!member) throw new HttpError(403, 'Only active group members can access group chat.');
    const [mutes] = await executor.execute(
      `SELECT 1 FROM moderation_actions WHERE group_id = ? AND target_user_id = ? AND action_type = 'MUTE'
       AND starts_at <= CURRENT_TIMESTAMP(3) AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(3))
       ORDER BY created_at DESC LIMIT 1`, [conversation.study_group_id, userId]);
    if (mutes.length) throw new HttpError(403, 'You are muted in this group until the moderation action expires.');
  } else {
    const [others] = await executor.execute(
      `SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id <> ?`, [conversationId, userId]);
    for (const other of others) await ensureNotBlocked(executor, userId, other.user_id);
  }
  return conversation;
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, service: 'study-community-api', database: 'connected', time: new Date().toISOString() });
}));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const username = s(req.body.username, 30).toLowerCase();
  const email = s(req.body.email, 255).toLowerCase();
  const displayName = s(req.body.display_name || req.body.displayName || username, 80);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!/^[a-z0-9_]{3,30}$/.test(username)) throw new HttpError(400, 'Username must be 3-30 characters using letters, numbers, or underscores.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (password.length < 10 || password.length > 128) throw new HttpError(400, 'Password must be between 10 and 128 characters.');
  if (!displayName) throw new HttpError(400, 'Display name is required.');
  const hash = await bcrypt.hash(password, 12);
  const conn = await pool.getConnection();
  let userId;
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `INSERT INTO users (username, email, password_hash, display_name, account_status) VALUES (?, ?, ?, ?, 'ACTIVE')`,
      [username, email, hash, displayName]);
    userId = result.insertId;
    await conn.execute('INSERT INTO user_profiles (user_id) VALUES (?)', [userId]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'That username or email is already registered.');
    throw err;
  } finally { conn.release(); }
  const token = jwt.sign({ username }, JWT_SECRET, { subject: String(userId), expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' });
  res.status(201).json({ token, user: { user_id: userId, username, email, display_name: displayName } });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const identifier = s(req.body.identifier || req.body.email || req.body.username, 255).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!identifier || !password) throw new HttpError(400, 'Enter your username/email and password.');
  const [rows] = await pool.execute(
    `SELECT user_id, username, email, password_hash, display_name, account_status FROM users WHERE username = ? OR email = ? LIMIT 1`,
    [identifier, identifier]);
  const row = rows[0];
  if (!row || !(await bcrypt.compare(password, row.password_hash))) throw new HttpError(401, 'Invalid username/email or password.');
  if (row.account_status !== 'ACTIVE') throw new HttpError(403, 'This account is not active.');
  await pool.execute('UPDATE users SET last_login_at = CURRENT_TIMESTAMP(3) WHERE user_id = ?', [row.user_id]);
  const token = jwt.sign({ username: row.username }, JWT_SECRET, { subject: String(row.user_id), expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' });
  res.json({ token, user: userSafe(row) });
}));

app.get('/api/me', authRequired, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT u.user_id, u.username, u.email, u.display_name, u.created_at, p.bio, p.avatar_url,
            p.academic_program, p.academic_year, p.timezone, p.preferred_language
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.user_id WHERE u.user_id = ?`, [req.user.user_id]);
  if (!rows.length) throw new HttpError(404, 'Account not found.');
  res.json({ user: rows[0] });
}));

app.patch('/api/me', authRequired, asyncRoute(async (req, res) => {
  const displayName = s(req.body.display_name, 80);
  const bio = s(req.body.bio, 2000);
  const academicProgram = s(req.body.academic_program, 120);
  const academicYear = req.body.academic_year === '' || req.body.academic_year == null ? null : Number(req.body.academic_year);
  const timezone = s(req.body.timezone || 'Asia/Kolkata', 50);
  const language = s(req.body.preferred_language || 'en', 10);
  if (!displayName) throw new HttpError(400, 'Display name is required.');
  if (academicYear !== null && (!Number.isInteger(academicYear) || academicYear < 1 || academicYear > 15)) throw new HttpError(400, 'Academic year must be between 1 and 15.');
  await pool.execute('UPDATE users SET display_name = ? WHERE user_id = ?', [displayName, req.user.user_id]);
  await pool.execute('UPDATE user_profiles SET bio = ?, academic_program = ?, academic_year = ?, timezone = ?, preferred_language = ? WHERE user_id = ?',
    [bio || null, academicProgram || null, academicYear, timezone, language, req.user.user_id]);
  res.json({ message: 'Profile updated.' });
}));

app.get('/api/topics', asyncRoute(async (_req, res) => {
  const [rows] = await pool.execute(
    `SELECT s.subject_id, s.name AS subject_name, s.description AS subject_description,
            t.topic_id, t.name AS topic_name, t.description AS topic_description
       FROM subjects s LEFT JOIN topics t ON t.subject_id = s.subject_id
       ORDER BY s.name, t.name`);
  res.json({ items: rows });
}));

app.get('/api/levels', asyncRoute(async (_req, res) => {
  const [rows] = await pool.execute('SELECT level_id, name, description FROM learning_levels ORDER BY `rank`');
  res.json({ items: rows });
}));

app.get('/api/groups', asyncRoute(async (req, res) => {
  // Search can show safe discovery metadata for public and private groups.
  // Unlisted groups remain hidden. Membership/chat/resources are still protected separately.
  let viewerUserId = null;
  const authorization = req.get('authorization') || '';
  if (authorization.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authorization.slice(7).trim(), JWT_SECRET, { algorithms: ['HS256'] });
      const parsedUserId = Number(payload.sub);
      if (Number.isSafeInteger(parsedUserId) && parsedUserId > 0) viewerUserId = parsedUserId;
    } catch { /* Anonymous discovery is still allowed for public-safe fields. */ }
  }
  const where = [`g.visibility IN ('PUBLIC','PRIVATE')`, `g.status IN ('OPEN','FULL')`];
  // SELECT placeholders appear before WHERE placeholders, so viewer IDs are first.
  const params = [viewerUserId, viewerUserId];
  const search = s(req.query.search, 120);
  const subjectId = num(req.query.subjectId);
  const levelId = num(req.query.levelId);
  if (search) {
    where.push("(g.name LIKE ? OR g.short_description LIKE ? OR (g.visibility = 'PUBLIC' AND g.full_description LIKE ?) OR s.name LIKE ?)");
    const like = `%${search}%`; params.push(like, like, like, like);
  }
  if (subjectId) { where.push('g.subject_id = ?'); params.push(subjectId); }
  if (levelId) { where.push('g.level_id = ?'); params.push(levelId); }
  const [rows] = await pool.execute(
    `SELECT g.group_id, g.name, g.slug, g.short_description,
            CASE WHEN g.visibility = 'PUBLIC' THEN g.full_description ELSE NULL END AS full_description,
            g.group_type, g.visibility, g.language_code, g.max_members, g.status, g.created_at,
            s.name AS subject_name, ll.name AS level_name, u.username AS owner_username, u.display_name AS owner_display_name,
            (SELECT COUNT(*) FROM group_memberships gm WHERE gm.group_id = g.group_id AND gm.status = 'ACTIVE') AS member_count,
            (SELECT gm.status FROM group_memberships gm WHERE gm.group_id = g.group_id AND gm.user_id = ? LIMIT 1) AS viewer_membership_status,
            (SELECT jr.status FROM join_requests jr WHERE jr.group_id = g.group_id AND jr.user_id = ? AND jr.status = 'PENDING' LIMIT 1) AS viewer_request_status
       FROM study_groups g JOIN subjects s ON s.subject_id = g.subject_id
       JOIN learning_levels ll ON ll.level_id = g.level_id JOIN users u ON u.user_id = g.owner_user_id
       WHERE ${where.join(' AND ')} ORDER BY g.created_at DESC LIMIT 60`, params);
  res.json({ items: rows });
}));

app.get('/api/my/groups', authRequired, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT g.group_id, g.name, g.short_description, g.group_type, g.visibility, g.status,
            s.name AS subject_name, ll.name AS level_name, gm.role, gm.status AS membership_status,
            (SELECT COUNT(*) FROM group_memberships gm2 WHERE gm2.group_id = g.group_id AND gm2.status = 'ACTIVE') AS member_count
       FROM group_memberships gm JOIN study_groups g ON g.group_id = gm.group_id
       JOIN subjects s ON s.subject_id = g.subject_id JOIN learning_levels ll ON ll.level_id = g.level_id
       WHERE gm.user_id = ? AND gm.status = 'ACTIVE' ORDER BY g.updated_at DESC, g.created_at DESC`, [req.user.user_id]);
  res.json({ items: rows });
}));

app.post('/api/groups', authRequired, asyncRoute(async (req, res) => {
  const name = s(req.body.name, 140);
  const shortDescription = s(req.body.short_description || req.body.description, 250);
  const fullDescription = s(req.body.full_description || req.body.description, 6000);
  const subjectId = num(req.body.subject_id);
  const levelId = num(req.body.level_id);
  const maxMembers = Number(req.body.max_members || 30);
  const groupType = ['STUDY','EXAM_PREP','PROJECT','REVISION','HOMEWORK','LANGUAGE_EXCHANGE'].includes(req.body.group_type) ? req.body.group_type : 'STUDY';
  const visibility = ['PUBLIC','PRIVATE','UNLISTED'].includes(req.body.visibility) ? req.body.visibility : 'PUBLIC';
  if (name.length < 3) throw new HttpError(400, 'Group name must be at least 3 characters.');
  if (!subjectId || !levelId) throw new HttpError(400, 'Choose a subject and learning level.');
  if (!Number.isInteger(maxMembers) || maxMembers < 2 || maxMembers > 1000) throw new HttpError(400, 'Maximum members must be between 2 and 1000.');
  const slug = `${name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'study-group'}-${crypto.randomBytes(3).toString('hex')}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `INSERT INTO study_groups (owner_user_id, subject_id, level_id, name, slug, short_description, full_description,
        group_type, visibility, max_members, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
      [req.user.user_id, subjectId, levelId, name, slug, shortDescription || null, fullDescription || null, groupType, visibility, maxMembers]);
    const groupId = result.insertId;
    await conn.execute(`INSERT INTO group_memberships (group_id, user_id, role, status) VALUES (?, ?, 'OWNER', 'ACTIVE')`, [groupId, req.user.user_id]);
    const [convResult] = await conn.execute(
      `INSERT INTO conversations (conversation_type, study_group_id, created_by_user_id) VALUES ('GROUP', ?, ?)`, [groupId, req.user.user_id]);
    await conn.execute('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', [convResult.insertId, req.user.user_id]);
    await conn.commit();
    res.status(201).json({ group_id: groupId, name, slug, message: 'Study group created.' });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_NO_REFERENCED_ROW_2') throw new HttpError(400, 'Selected subject or learning level does not exist.');
    throw err;
  } finally { conn.release(); }
}));

app.get('/api/groups/:id', asyncRoute(async (req, res) => {
  const groupId = num(req.params.id);
  if (!groupId) throw new HttpError(400, 'Invalid group id.');
  const [rows] = await pool.execute(
    `SELECT g.group_id, g.name, g.slug, g.short_description, g.full_description, g.group_type, g.visibility,
            g.language_code, g.max_members, g.status, g.created_at, s.name AS subject_name,
            ll.name AS level_name, u.username AS owner_username, u.display_name AS owner_display_name,
            (SELECT COUNT(*) FROM group_memberships gm WHERE gm.group_id = g.group_id AND gm.status = 'ACTIVE') AS member_count
       FROM study_groups g JOIN subjects s ON s.subject_id = g.subject_id JOIN learning_levels ll ON ll.level_id = g.level_id
       JOIN users u ON u.user_id = g.owner_user_id WHERE g.group_id = ?`, [groupId]);
  if (!rows.length) throw new HttpError(404, 'Study group not found.');
  if (rows[0].visibility !== 'PUBLIC') {
    const token = (req.get('authorization') || '').slice(7);
    let uid = null; try { uid = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }).sub; } catch {}
    if (!uid || !(await activeGroupMember(pool, groupId, Number(uid)))) throw new HttpError(404, 'Study group not found.');
  }
  res.json({ group: rows[0] });
}));

app.post('/api/groups/:id/join', authRequired, asyncRoute(async (req, res) => {
  const groupId = num(req.params.id);
  if (!groupId) throw new HttpError(400, 'Invalid group id.');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [groups] = await conn.execute('SELECT group_id, visibility, max_members, status FROM study_groups WHERE group_id = ? FOR UPDATE', [groupId]);
    if (!groups.length || groups[0].status !== 'OPEN') throw new HttpError(404, 'This group is not open for new members.');
    const group = groups[0];
    const [members] = await conn.execute('SELECT status FROM group_memberships WHERE group_id = ? AND user_id = ? FOR UPDATE', [groupId, req.user.user_id]);
    if (members.length && members[0].status === 'BANNED') throw new HttpError(403, 'You cannot join this group.');
    if (members.length && members[0].status === 'ACTIVE') { await conn.commit(); return res.json({ status: 'ACTIVE', message: 'You are already a member.' }); }
    const [countRows] = await conn.execute("SELECT COUNT(*) AS total FROM group_memberships WHERE group_id = ? AND status = 'ACTIVE'", [groupId]);
    if (Number(countRows[0].total) >= group.max_members) throw new HttpError(409, 'This group has reached its member limit.');
    if (group.visibility === 'PRIVATE') {
      await conn.execute(
        `INSERT INTO join_requests (group_id, user_id, message, status) VALUES (?, ?, ?, 'PENDING')
         ON DUPLICATE KEY UPDATE message = VALUES(message), status = 'PENDING', created_at = CURRENT_TIMESTAMP(3)`,
        [groupId, req.user.user_id, s(req.body.message, 1000) || null]);
      await conn.commit(); return res.status(202).json({ status: 'PENDING', message: 'Join request sent to the group moderators.' });
    }
    if (members.length) {
      await conn.execute("UPDATE group_memberships SET status = 'ACTIVE', role = 'MEMBER', joined_at = CURRENT_TIMESTAMP(3), left_at = NULL WHERE group_id = ? AND user_id = ?", [groupId, req.user.user_id]);
    } else {
      await conn.execute("INSERT INTO group_memberships (group_id, user_id, role, status) VALUES (?, ?, 'MEMBER', 'ACTIVE')", [groupId, req.user.user_id]);
    }
    const conversationId = await groupConversationId(conn, groupId);
    await conn.execute('INSERT IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', [conversationId, req.user.user_id]);
    await conn.commit();
    res.json({ status: 'ACTIVE', message: 'You joined the study group.' });
  } catch (err) { await conn.rollback(); throw err; }
  finally { conn.release(); }
}));

app.get('/api/groups/:id/requests', authRequired, asyncRoute(async (req, res) => {
  const groupId = num(req.params.id); if (!groupId) throw new HttpError(400, 'Invalid group id.');
  const moderator = await activeGroupMember(pool, groupId, req.user.user_id);
  if (!moderator || !['OWNER','MODERATOR'].includes(moderator.role)) throw new HttpError(403, 'Only group owners or moderators can review requests.');
  const [rows] = await pool.execute(
    `SELECT jr.request_id, jr.user_id, jr.message, jr.created_at, u.username, u.display_name
     FROM join_requests jr JOIN users u ON u.user_id = jr.user_id
     WHERE jr.group_id = ? AND jr.status = 'PENDING' ORDER BY jr.created_at ASC`, [groupId]);
  res.json({ items: rows });
}));

app.post('/api/groups/:id/requests/:requestId/decision', authRequired, asyncRoute(async (req, res) => {
  const groupId = num(req.params.id), requestId = num(req.params.requestId);
  if (!groupId || !requestId) throw new HttpError(400, 'Invalid group or request id.');
  const decision = s(req.body.decision, 16).toUpperCase();
  if (!['APPROVED','REJECTED'].includes(decision)) throw new HttpError(400, 'Decision must be APPROVED or REJECTED.');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const moderator = await activeGroupMember(conn, groupId, req.user.user_id);
    if (!moderator || !['OWNER','MODERATOR'].includes(moderator.role)) throw new HttpError(403, 'Only group owners or moderators can review requests.');
    // Lock the group before the request row, matching the join flow's lock order and reducing deadlock risk.
    const [groups] = await conn.execute('SELECT max_members, status FROM study_groups WHERE group_id = ? FOR UPDATE', [groupId]);
    if (!groups.length) throw new HttpError(404, 'Study group not found.');
    const [requests] = await conn.execute(
      `SELECT request_id, user_id FROM join_requests WHERE request_id = ? AND group_id = ? AND status = 'PENDING' FOR UPDATE`, [requestId, groupId]);
    if (!requests.length) throw new HttpError(404, 'Pending join request not found.');
    const targetUserId = requests[0].user_id;
    if (decision === 'APPROVED') {
      const [count] = await conn.execute("SELECT COUNT(*) AS total FROM group_memberships WHERE group_id = ? AND status = 'ACTIVE'", [groupId]);
      if (groups[0].status !== 'OPEN' || Number(count[0].total) >= groups[0].max_members) throw new HttpError(409, 'This group cannot accept more members right now.');
      const [existing] = await conn.execute('SELECT status FROM group_memberships WHERE group_id = ? AND user_id = ? FOR UPDATE', [groupId, targetUserId]);
      if (existing.length && existing[0].status === 'BANNED') throw new HttpError(403, 'This user is banned from the group.');
      if (existing.length) await conn.execute("UPDATE group_memberships SET role = 'MEMBER', status = 'ACTIVE', joined_at = CURRENT_TIMESTAMP(3), left_at = NULL WHERE group_id = ? AND user_id = ?", [groupId, targetUserId]);
      else await conn.execute("INSERT INTO group_memberships (group_id, user_id, role, status) VALUES (?, ?, 'MEMBER', 'ACTIVE')", [groupId, targetUserId]);
      const conversationId = await groupConversationId(conn, groupId);
      await conn.execute('INSERT IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', [conversationId, targetUserId]);
    }
    await conn.execute('UPDATE join_requests SET status = ?, decided_at = CURRENT_TIMESTAMP(3), decided_by_user_id = ? WHERE request_id = ?', [decision, req.user.user_id, requestId]);
    await conn.execute('INSERT INTO notifications (recipient_user_id, actor_user_id, notification_type, title, body) VALUES (?, ?, ?, ?, ?)',
      [targetUserId, req.user.user_id, `GROUP_JOIN_${decision}`, decision === 'APPROVED' ? 'Join request approved' : 'Join request declined', decision === 'APPROVED' ? 'Your request to join a study group was approved.' : 'Your request to join a study group was declined.']);
    await conn.commit();
    res.json({ status: decision, message: decision === 'APPROVED' ? 'Member added to the group.' : 'Join request declined.' });
  } catch (err) { await conn.rollback(); throw err; }
  finally { conn.release(); }
}));

app.post('/api/groups/:id/invites', authRequired, asyncRoute(async (req, res) => {
  const groupId = num(req.params.id); if (!groupId) throw new HttpError(400, 'Invalid group id.');
  const member = await activeGroupMember(pool, groupId, req.user.user_id);
  if (!member || !['OWNER','MODERATOR'].includes(member.role)) throw new HttpError(403, 'Only group owners or moderators can invite people.');
  const inviteeId = req.body.invitee_user_id ? num(req.body.invitee_user_id) : null;
  const inviteEmail = s(req.body.invite_email, 255).toLowerCase() || null;
  if ((!inviteeId && !inviteEmail) || (inviteeId && inviteEmail)) throw new HttpError(400, 'Provide either invitee_user_id or invite_email.');
  if (inviteeId) {
    const [rows] = await pool.execute("SELECT user_id FROM users WHERE user_id = ? AND account_status = 'ACTIVE'", [inviteeId]);
    if (!rows.length) throw new HttpError(404, 'Invitee account not found.');
    if (inviteeId === req.user.user_id) throw new HttpError(400, 'You cannot invite yourself.');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)) throw new HttpError(400, 'Enter a valid invite email.');
  const [groups] = await pool.execute('SELECT group_id, name FROM study_groups WHERE group_id = ?', [groupId]);
  if (!groups.length) throw new HttpError(404, 'Study group not found.');
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const [result] = await pool.execute(
    `INSERT INTO group_invites (group_id, inviter_user_id, invitee_user_id, invite_email, invite_token_hash, status, expires_at)
     VALUES (?, ?, ?, ?, ?, 'PENDING', DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY))`,
    [groupId, req.user.user_id, inviteeId, inviteEmail, tokenHash]);
  if (inviteeId) await pool.execute(
    `INSERT INTO notifications (recipient_user_id, actor_user_id, notification_type, title, body, payload)
     VALUES (?, ?, 'GROUP_INVITE', 'Study group invitation', ?, JSON_OBJECT('group_id', ?))`,
    [inviteeId, req.user.user_id, `You were invited to join ${groups[0].name}.`, groupId]);
  res.status(201).json({ invite_id: result.insertId, token, expires_in_days: 7, note: 'Store this token securely and share it privately; the raw token is only returned once.' });
}));

app.post('/api/invites/accept', authRequired, asyncRoute(async (req, res) => {
  const token = s(req.body.token, 128);
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new HttpError(400, 'Enter a valid invitation token.');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [invites] = await conn.execute(
      `SELECT i.invite_id, i.group_id, i.inviter_user_id, i.invitee_user_id, i.invite_email, g.max_members, g.status AS group_status, g.name
       FROM group_invites i JOIN study_groups g ON g.group_id = i.group_id
       WHERE i.invite_token_hash = ? AND i.status = 'PENDING' AND i.expires_at > CURRENT_TIMESTAMP(3) FOR UPDATE`, [tokenHash]);
    if (!invites.length) throw new HttpError(404, 'Invitation is invalid, expired, or already used.');
    const invite = invites[0];
    const [users] = await conn.execute('SELECT email FROM users WHERE user_id = ?', [req.user.user_id]);
    if ((invite.invitee_user_id && Number(invite.invitee_user_id) !== req.user.user_id) ||
        (invite.invite_email && invite.invite_email.toLowerCase() !== String(users[0]?.email || '').toLowerCase())) {
      throw new HttpError(403, 'This invitation was issued to another account.');
    }
    if (invite.group_status !== 'OPEN') throw new HttpError(409, 'This group is not accepting members right now.');
    const [count] = await conn.execute("SELECT COUNT(*) AS total FROM group_memberships WHERE group_id = ? AND status = 'ACTIVE'", [invite.group_id]);
    if (Number(count[0].total) >= invite.max_members) throw new HttpError(409, 'The group has reached its member limit.');
    const [existing] = await conn.execute('SELECT status FROM group_memberships WHERE group_id = ? AND user_id = ? FOR UPDATE', [invite.group_id, req.user.user_id]);
    if (existing.length && existing[0].status === 'BANNED') throw new HttpError(403, 'You are banned from this group.');
    if (existing.length) await conn.execute("UPDATE group_memberships SET role = 'MEMBER', status = 'ACTIVE', joined_at = CURRENT_TIMESTAMP(3), left_at = NULL WHERE group_id = ? AND user_id = ?", [invite.group_id, req.user.user_id]);
    else await conn.execute("INSERT INTO group_memberships (group_id, user_id, role, status) VALUES (?, ?, 'MEMBER', 'ACTIVE')", [invite.group_id, req.user.user_id]);
    const conversationId = await groupConversationId(conn, invite.group_id);
    await conn.execute('INSERT IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', [conversationId, req.user.user_id]);
    await conn.execute("UPDATE group_invites SET status = 'ACCEPTED' WHERE invite_id = ?", [invite.invite_id]);
    await conn.execute(
      `INSERT INTO notifications (recipient_user_id, actor_user_id, notification_type, title, body, payload)
       VALUES (?, ?, 'GROUP_INVITE_ACCEPTED', 'Invitation accepted', ?, JSON_OBJECT('group_id', ?))`,
      [invite.inviter_user_id, req.user.user_id, `A learner accepted your invitation to ${invite.name}.`, invite.group_id]);
    await conn.commit();
    res.json({ group_id: invite.group_id, group_name: invite.name, message: 'Invitation accepted; you joined the group.' });
  } catch (err) { await conn.rollback(); throw err; }
  finally { conn.release(); }
}));

app.post('/api/groups/:id/leave', authRequired, asyncRoute(async (req, res) => {
  const groupId = num(req.params.id); if (!groupId) throw new HttpError(400, 'Invalid group id.');
  const member = await activeGroupMember(pool, groupId, req.user.user_id);
  if (!member) throw new HttpError(404, 'Active membership not found.');
  if (member.role === 'OWNER') throw new HttpError(409, 'Transfer group ownership before leaving as the owner.');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute("UPDATE group_memberships SET status = 'LEFT', left_at = CURRENT_TIMESTAMP(3) WHERE group_id = ? AND user_id = ?", [groupId, req.user.user_id]);
    const [conv] = await conn.execute('SELECT conversation_id FROM conversations WHERE study_group_id = ?', [groupId]);
    if (conv.length) await conn.execute('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [conv[0].conversation_id, req.user.user_id]);
    await conn.commit(); res.json({ message: 'You left the study group.' });
  } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
}));

app.post('/api/groups/:id/moderation', authRequired, asyncRoute(async (req, res) => {
  const groupId = num(req.params.id), targetUserId = num(req.body.target_user_id);
  const action = s(req.body.action_type, 20).toUpperCase(), reason = s(req.body.reason, 2000);
  if (!groupId || !targetUserId || targetUserId === req.user.user_id) throw new HttpError(400, 'Choose a valid group and another target user.');
  if (!['WARNING','MUTE','REMOVE','BAN','UNBAN'].includes(action)) throw new HttpError(400, 'Unsupported moderation action.');
  const moderator = await activeGroupMember(pool, groupId, req.user.user_id);
  if (!moderator || !['OWNER','MODERATOR'].includes(moderator.role)) throw new HttpError(403, 'Only group owners or moderators can moderate members.');
  const target = await activeGroupMember(pool, groupId, targetUserId);
  if (target?.role === 'OWNER') throw new HttpError(403, 'The group owner cannot be moderated through this endpoint.');
  const expiresAt = req.body.expires_at ? new Date(req.body.expires_at) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new HttpError(400, 'Invalid expiry date.');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO moderation_actions (group_id, moderator_user_id, target_user_id, action_type, reason, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`, [groupId, req.user.user_id, targetUserId, action, reason || null, expiresAt]);
    if (action === 'REMOVE' || action === 'BAN') {
      await conn.execute('UPDATE group_memberships SET status = ?, left_at = CURRENT_TIMESTAMP(3) WHERE group_id = ? AND user_id = ?', [action === 'BAN' ? 'BANNED' : 'REMOVED', groupId, targetUserId]);
      const [conv] = await conn.execute('SELECT conversation_id FROM conversations WHERE study_group_id = ?', [groupId]);
      if (conv.length) await conn.execute('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [conv[0].conversation_id, targetUserId]);
    } else if (action === 'UNBAN') {
      await conn.execute("UPDATE group_memberships SET status = 'LEFT' WHERE group_id = ? AND user_id = ? AND status = 'BANNED'", [groupId, targetUserId]);
    }
    await conn.commit(); res.status(201).json({ message: `Moderation action ${action.toLowerCase()} recorded.` });
  } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
}));

app.get('/api/groups/:id/rules', asyncRoute(async (req, res) => {
  const groupId = num(req.params.id); if (!groupId) throw new HttpError(400, 'Invalid group id.');
  const [groups] = await pool.execute('SELECT visibility FROM study_groups WHERE group_id = ?', [groupId]);
  if (!groups.length) throw new HttpError(404, 'Study group not found.');
  if (groups[0].visibility !== 'PUBLIC') {
    const header = req.get('authorization') || ''; let userId = null;
    try { if (header.startsWith('Bearer ')) userId = Number(jwt.verify(header.slice(7), JWT_SECRET, { algorithms: ['HS256'] }).sub); } catch {}
    if (!userId || !(await activeGroupMember(pool, groupId, userId))) throw new HttpError(404, 'Study group not found.');
  }
  const [rows] = await pool.execute('SELECT rule_id, title, rule_text, sort_order FROM group_rules WHERE group_id = ? ORDER BY sort_order, rule_id', [groupId]);
  res.json({ items: rows });
}));
app.post('/api/groups/:id/rules', authRequired, asyncRoute(async (req, res) => {
  const groupId = num(req.params.id); if (!groupId) throw new HttpError(400, 'Invalid group id.');
  const title = s(req.body.title, 120), ruleText = s(req.body.rule_text, 2000);
  const member = await activeGroupMember(pool, groupId, req.user.user_id);
  if (!member || !['OWNER','MODERATOR'].includes(member.role)) throw new HttpError(403, 'Only group owners or moderators can edit rules.');
  if (!title || !ruleText) throw new HttpError(400, 'Rule title and text are required.');
  const [result] = await pool.execute('INSERT INTO group_rules (group_id, title, rule_text, sort_order) VALUES (?, ?, ?, ?)', [groupId, title, ruleText, Number(req.body.sort_order || 0)]);
  res.status(201).json({ rule_id: result.insertId, message: 'Group rule added.' });
}));
app.get('/api/groups/:id/reviews', asyncRoute(async (req, res) => {
  const groupId = num(req.params.id); if (!groupId) throw new HttpError(400, 'Invalid group id.');
  const [groups] = await pool.execute('SELECT visibility FROM study_groups WHERE group_id = ?', [groupId]);
  if (!groups.length) throw new HttpError(404, 'Study group not found.');
  if (groups[0].visibility !== 'PUBLIC') {
    const header = req.get('authorization') || ''; let userId = null;
    try { if (header.startsWith('Bearer ')) userId = Number(jwt.verify(header.slice(7), JWT_SECRET, { algorithms: ['HS256'] }).sub); } catch {}
    if (!userId || !(await activeGroupMember(pool, groupId, userId))) throw new HttpError(404, 'Study group not found.');
  }
  const [rows] = await pool.execute(
    `SELECT r.review_id, r.rating, r.comment, r.created_at, u.display_name, u.username
     FROM group_reviews r JOIN users u ON u.user_id = r.reviewer_user_id
     WHERE r.group_id = ? ORDER BY r.created_at DESC LIMIT 100`, [groupId]);
  res.json({ items: rows });
}));
app.post('/api/groups/:id/reviews', authRequired, asyncRoute(async (req, res) => {
  const groupId = num(req.params.id); if (!groupId) throw new HttpError(400, 'Invalid group id.');
  const rating = Number(req.body.rating); const comment = s(req.body.comment, 2000);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'Rating must be from 1 to 5.');
  if (!(await activeGroupMember(pool, groupId, req.user.user_id))) throw new HttpError(403, 'Only active group members can review a group.');
  await pool.execute(
    `INSERT INTO group_reviews (group_id, reviewer_user_id, rating, comment) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment), created_at = CURRENT_TIMESTAMP(3)`,
    [groupId, req.user.user_id, rating, comment || null]);
  res.json({ message: 'Review saved.' });
}));
app.get('/api/saved-groups', authRequired, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT g.group_id, g.name, g.short_description, s.name AS subject_name, ll.name AS level_name, sg.saved_at
     FROM saved_groups sg JOIN study_groups g ON g.group_id = sg.group_id
     JOIN subjects s ON s.subject_id = g.subject_id JOIN learning_levels ll ON ll.level_id = g.level_id
     WHERE sg.user_id = ? ORDER BY sg.saved_at DESC`, [req.user.user_id]);
  res.json({ items: rows });
}));
app.post('/api/groups/:id/save', authRequired, asyncRoute(async (req, res) => {
  const groupId = num(req.params.id); if (!groupId) throw new HttpError(400, 'Invalid group id.');
  const [rows] = await pool.execute("SELECT group_id FROM study_groups WHERE group_id = ? AND visibility = 'PUBLIC'", [groupId]);
  if (!rows.length) throw new HttpError(404, 'Public study group not found.');
  await pool.execute('INSERT IGNORE INTO saved_groups (user_id, group_id) VALUES (?, ?)', [req.user.user_id, groupId]);
  res.status(201).json({ message: 'Group saved.' });
}));
app.delete('/api/groups/:id/save', authRequired, asyncRoute(async (req, res) => {
  const groupId = num(req.params.id); if (!groupId) throw new HttpError(400, 'Invalid group id.');
  await pool.execute('DELETE FROM saved_groups WHERE user_id = ? AND group_id = ?', [req.user.user_id, groupId]);
  res.json({ message: 'Group removed from saved groups.' });
}));

app.get('/api/groups/:id/members', authRequired, asyncRoute(async (req, res) => {
  const groupId = num(req.params.id); if (!groupId) throw new HttpError(400, 'Invalid group id.');
  if (!(await activeGroupMember(pool, groupId, req.user.user_id))) throw new HttpError(403, 'Join this group to view members.');
  const [rows] = await pool.execute(
    `SELECT u.user_id, u.username, u.display_name, gm.role, gm.joined_at FROM group_memberships gm
     JOIN users u ON u.user_id = gm.user_id WHERE gm.group_id = ? AND gm.status = 'ACTIVE' ORDER BY FIELD(gm.role,'OWNER','MODERATOR','MEMBER'), gm.joined_at`, [groupId]);
  res.json({ items: rows });
}));

app.get('/api/groups/:id/messages', authRequired, asyncRoute(async (req, res) => {
  const groupId = num(req.params.id); if (!groupId) throw new HttpError(400, 'Invalid group id.');
  if (!(await activeGroupMember(pool, groupId, req.user.user_id))) throw new HttpError(403, 'Only active group members can read the chat.');
  const conversationId = await groupConversationId(pool, groupId);
  const [rows] = await pool.execute(
    `SELECT m.message_id, m.body, m.message_type, m.sent_at, m.edited_at,
            u.user_id AS sender_user_id, u.username AS sender_username, u.display_name AS sender_display_name
       FROM messages m JOIN users u ON u.user_id = m.sender_user_id
       WHERE m.conversation_id = ? AND m.deleted_at IS NULL ORDER BY m.message_id DESC LIMIT 100`, [conversationId]);
  res.json({ items: rows.reverse() });
}));

app.post('/api/groups/:id/messages', authRequired, asyncRoute(async (req, res) => {
  const groupId = num(req.params.id); if (!groupId) throw new HttpError(400, 'Invalid group id.');
  const body = s(req.body.body, 4000); if (!body) throw new HttpError(400, 'Message cannot be empty.');
  if (!(await activeGroupMember(pool, groupId, req.user.user_id))) throw new HttpError(403, 'Only active group members can post in this chat.');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const conversationId = await groupConversationId(conn, groupId);
    await canAccessConversation(conn, conversationId, req.user.user_id);
    await conn.execute(`INSERT INTO messages (conversation_id, sender_user_id, body, message_type) VALUES (?, ?, ?, 'TEXT')`, [conversationId, req.user.user_id, body]);
    await conn.execute('UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP(3) WHERE conversation_id = ?', [conversationId]);
    await conn.commit(); res.status(201).json({ message: 'Message sent.' });
  } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
}));

app.post('/api/dm/:userId', authRequired, asyncRoute(async (req, res) => {
  const otherId = num(req.params.userId);
  if (!otherId || otherId === req.user.user_id) throw new HttpError(400, 'Choose another valid user.');
  await ensureNotBlocked(pool, req.user.user_id, otherId);
  const [otherRows] = await pool.execute(`SELECT user_id FROM users WHERE user_id = ? AND account_status = 'ACTIVE'`, [otherId]);
  if (!otherRows.length) throw new HttpError(404, 'User not found.');
  const low = Math.min(otherId, req.user.user_id); const high = Math.max(otherId, req.user.user_id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [found] = await conn.execute('SELECT conversation_id FROM direct_conversation_pairs WHERE user_low_id = ? AND user_high_id = ? FOR UPDATE', [low, high]);
    let conversationId;
    if (found.length) conversationId = found[0].conversation_id;
    else {
      const [created] = await conn.execute(`INSERT INTO conversations (conversation_type, study_group_id, created_by_user_id) VALUES ('DIRECT', NULL, ?)`, [req.user.user_id]);
      conversationId = created.insertId;
      await conn.execute('INSERT INTO direct_conversation_pairs (conversation_id, user_low_id, user_high_id) VALUES (?, ?, ?)', [conversationId, low, high]);
      await conn.execute('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?), (?, ?)', [conversationId, req.user.user_id, conversationId, otherId]);
    }
    await conn.commit(); res.status(201).json({ conversation_id: conversationId });
  } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
}));

app.get('/api/conversations', authRequired, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT c.conversation_id, c.conversation_type, c.study_group_id, c.last_message_at,
      g.name AS group_name,
      (SELECT u.display_name FROM conversation_members cm2 JOIN users u ON u.user_id = cm2.user_id
        WHERE cm2.conversation_id = c.conversation_id AND cm2.user_id <> ? LIMIT 1) AS other_display_name,
      (SELECT u.user_id FROM conversation_members cm2 JOIN users u ON u.user_id = cm2.user_id
        WHERE cm2.conversation_id = c.conversation_id AND cm2.user_id <> ? LIMIT 1) AS other_user_id
     FROM conversation_members cm JOIN conversations c ON c.conversation_id = cm.conversation_id
     LEFT JOIN study_groups g ON g.group_id = c.study_group_id
     WHERE cm.user_id = ? AND cm.archived_at IS NULL
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT 100`, [req.user.user_id, req.user.user_id, req.user.user_id]);
  res.json({ items: rows });
}));

app.get('/api/conversations/:id/messages', authRequired, asyncRoute(async (req, res) => {
  const conversationId = num(req.params.id); if (!conversationId) throw new HttpError(400, 'Invalid conversation id.');
  const conversation = await canAccessConversation(pool, conversationId, req.user.user_id);
  const [rows] = await pool.execute(
    `SELECT m.message_id, m.body, m.message_type, m.sent_at, m.edited_at, u.user_id AS sender_user_id,
            u.username AS sender_username, u.display_name AS sender_display_name
       FROM messages m JOIN users u ON u.user_id = m.sender_user_id
       WHERE m.conversation_id = ? AND m.deleted_at IS NULL ORDER BY m.message_id DESC LIMIT 100`, [conversationId]);
  await pool.execute('UPDATE conversation_members SET last_read_at = CURRENT_TIMESTAMP(3) WHERE conversation_id = ? AND user_id = ?', [conversationId, req.user.user_id]);
  res.json({ conversation, items: rows.reverse() });
}));

app.post('/api/conversations/:id/messages', authRequired, asyncRoute(async (req, res) => {
  const conversationId = num(req.params.id); if (!conversationId) throw new HttpError(400, 'Invalid conversation id.');
  const body = s(req.body.body, 4000); if (!body) throw new HttpError(400, 'Message cannot be empty.');
  await canAccessConversation(pool, conversationId, req.user.user_id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`INSERT INTO messages (conversation_id, sender_user_id, body, message_type) VALUES (?, ?, ?, 'TEXT')`, [conversationId, req.user.user_id, body]);
    await conn.execute('UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP(3) WHERE conversation_id = ?', [conversationId]);
    await conn.commit(); res.status(201).json({ message: 'Message sent.' });
  } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
}));

app.get('/api/groups/:id/resources', authRequired, asyncRoute(async (req, res) => {
  const groupId = num(req.params.id); if (!groupId) throw new HttpError(400, 'Invalid group id.');
  if (!(await activeGroupMember(pool, groupId, req.user.user_id))) throw new HttpError(403, 'Join the group to view resources.');
  const [rows] = await pool.execute(
    `SELECT resource_id, title, description, resource_type, resource_url, is_pinned, created_at, updated_at
     FROM group_resources WHERE group_id = ? ORDER BY is_pinned DESC, created_at DESC LIMIT 200`, [groupId]);
  res.json({ items: rows });
}));
app.post('/api/groups/:id/resources', authRequired, asyncRoute(async (req, res) => {
  const groupId = num(req.params.id); if (!groupId) throw new HttpError(400, 'Invalid group id.');
  const title = s(req.body.title, 180); const url = s(req.body.resource_url || req.body.url, 1800);
  const description = s(req.body.description, 2000); const type = ['LINK','DOCUMENT','VIDEO','NOTE','CODE','OTHER'].includes(req.body.resource_type) ? req.body.resource_type : 'LINK';
  if (!title || !/^https?:\/\//i.test(url)) throw new HttpError(400, 'Enter a title and an http(s) resource URL.');
  const member = await activeGroupMember(pool, groupId, req.user.user_id);
  if (!member) throw new HttpError(403, 'Only active group members can add resources.');
  const [result] = await pool.execute('INSERT INTO group_resources (group_id, uploaded_by_user_id, title, description, resource_type, resource_url) VALUES (?, ?, ?, ?, ?, ?)', [groupId, req.user.user_id, title, description || null, type, url]);
  res.status(201).json({ resource_id: result.insertId, message: 'Resource added.' });
}));

app.get('/api/groups/:id/tasks', authRequired, asyncRoute(async (req, res) => {
  const groupId = num(req.params.id); if (!groupId) throw new HttpError(400, 'Invalid group id.');
  if (!(await activeGroupMember(pool, groupId, req.user.user_id))) throw new HttpError(403, 'Join the group to view tasks.');
  const [rows] = await pool.execute(
    `SELECT t.task_id, t.title, t.description, t.due_at, t.status, t.created_at, u.display_name AS created_by
     FROM study_tasks t JOIN users u ON u.user_id = t.created_by_user_id
     WHERE t.group_id = ? ORDER BY t.due_at IS NULL, t.due_at LIMIT 200`, [groupId]);
  res.json({ items: rows });
}));
app.post('/api/groups/:id/tasks', authRequired, asyncRoute(async (req, res) => {
  const groupId = num(req.params.id); if (!groupId) throw new HttpError(400, 'Invalid group id.');
  const title = s(req.body.title, 180); const description = s(req.body.description, 3000);
  if (title.length < 2) throw new HttpError(400, 'Task title is required.');
  const member = await activeGroupMember(pool, groupId, req.user.user_id);
  if (!member || !['OWNER','MODERATOR'].includes(member.role)) throw new HttpError(403, 'Only group owners or moderators can create tasks.');
  let dueAt = null;
  if (req.body.due_at) { const d = new Date(req.body.due_at); if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Invalid due date.'); dueAt = d; }
  const [result] = await pool.execute('INSERT INTO study_tasks (group_id, created_by_user_id, title, description, due_at) VALUES (?, ?, ?, ?, ?)', [groupId, req.user.user_id, title, description || null, dueAt]);
  res.status(201).json({ task_id: result.insertId, message: 'Task created.' });
}));

app.get('/api/groups/:id/sessions', authRequired, asyncRoute(async (req, res) => {
  const groupId = num(req.params.id); if (!groupId) throw new HttpError(400, 'Invalid group id.');
  if (!(await activeGroupMember(pool, groupId, req.user.user_id))) throw new HttpError(403, 'Join the group to view sessions.');
  const [rows] = await pool.execute(
    `SELECT session_id, title, description, starts_at, ends_at, location_mode, meeting_url, location_text, status
     FROM study_sessions WHERE group_id = ? ORDER BY starts_at LIMIT 200`, [groupId]);
  res.json({ items: rows });
}));
app.post('/api/groups/:id/sessions', authRequired, asyncRoute(async (req, res) => {
  const groupId = num(req.params.id); if (!groupId) throw new HttpError(400, 'Invalid group id.');
  const title = s(req.body.title, 160); const description = s(req.body.description, 3000);
  const starts = new Date(req.body.starts_at); const ends = new Date(req.body.ends_at);
  if (!title || Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) throw new HttpError(400, 'Enter a title and valid start/end times (end must be after start).');
  const member = await activeGroupMember(pool, groupId, req.user.user_id);
  if (!member || !['OWNER','MODERATOR'].includes(member.role)) throw new HttpError(403, 'Only group owners or moderators can schedule sessions.');
  const mode = ['ONLINE','IN_PERSON','HYBRID'].includes(req.body.location_mode) ? req.body.location_mode : 'ONLINE';
  const meetingUrl = s(req.body.meeting_url, 1800); const locationText = s(req.body.location_text, 1000);
  if (meetingUrl && !/^https?:\/\//i.test(meetingUrl)) throw new HttpError(400, 'Meeting URL must start with http:// or https://.');
  const [result] = await pool.execute(
    `INSERT INTO study_sessions (group_id, created_by_user_id, title, description, starts_at, ends_at, location_mode, meeting_url, location_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [groupId, req.user.user_id, title, description || null, starts, ends, mode, meetingUrl || null, locationText || null]);
  res.status(201).json({ session_id: result.insertId, message: 'Study session scheduled.' });
}));

app.post('/api/tasks/:id/assign', authRequired, asyncRoute(async (req, res) => {
  const taskId = num(req.params.id); if (!taskId) throw new HttpError(400, 'Invalid task id.');
  const [tasks] = await pool.execute('SELECT task_id, group_id FROM study_tasks WHERE task_id = ?', [taskId]);
  if (!tasks.length) throw new HttpError(404, 'Task not found.');
  if (!(await activeGroupMember(pool, tasks[0].group_id, req.user.user_id))) throw new HttpError(403, 'Join the group before assigning yourself a task.');
  await pool.execute("INSERT INTO task_assignees (task_id, user_id, status) VALUES (?, ?, 'ASSIGNED') ON DUPLICATE KEY UPDATE status = IF(status = 'COMPLETED', status, 'ASSIGNED')", [taskId, req.user.user_id]);
  res.status(201).json({ message: 'You are assigned to this task.' });
}));
app.patch('/api/tasks/:id/status', authRequired, asyncRoute(async (req, res) => {
  const taskId = num(req.params.id), status = s(req.body.status, 16).toUpperCase();
  if (!taskId || !['ASSIGNED','IN_PROGRESS','COMPLETED'].includes(status)) throw new HttpError(400, 'Invalid task or task status.');
  const [rows] = await pool.execute('SELECT ta.task_id FROM task_assignees ta JOIN study_tasks t ON t.task_id = ta.task_id WHERE ta.task_id = ? AND ta.user_id = ?', [taskId, req.user.user_id]);
  if (!rows.length) throw new HttpError(403, 'Assign yourself to the task before updating its status.');
  await pool.execute('UPDATE task_assignees SET status = ?, completed_at = IF(? = \'COMPLETED\', CURRENT_TIMESTAMP(3), NULL) WHERE task_id = ? AND user_id = ?', [status, status, taskId, req.user.user_id]);
  res.json({ message: 'Task progress updated.' });
}));
app.post('/api/sessions/:id/attend', authRequired, asyncRoute(async (req, res) => {
  const sessionId = num(req.params.id); if (!sessionId) throw new HttpError(400, 'Invalid session id.');
  const [rows] = await pool.execute('SELECT session_id, group_id FROM study_sessions WHERE session_id = ?', [sessionId]);
  if (!rows.length) throw new HttpError(404, 'Study session not found.');
  if (!(await activeGroupMember(pool, rows[0].group_id, req.user.user_id))) throw new HttpError(403, 'Only active group members can register for a session.');
  await pool.execute("INSERT INTO session_attendees (session_id, user_id, status) VALUES (?, ?, 'REGISTERED') ON DUPLICATE KEY UPDATE status = 'REGISTERED'", [sessionId, req.user.user_id]);
  res.status(201).json({ message: 'You are registered for this session.' });
}));
app.delete('/api/sessions/:id/attend', authRequired, asyncRoute(async (req, res) => {
  const sessionId = num(req.params.id); if (!sessionId) throw new HttpError(400, 'Invalid session id.');
  await pool.execute("UPDATE session_attendees SET status = 'CANCELLED' WHERE session_id = ? AND user_id = ?", [sessionId, req.user.user_id]);
  res.json({ message: 'Session registration cancelled.' });
}));
app.post('/api/messages/:id/reactions', authRequired, asyncRoute(async (req, res) => {
  const messageId = num(req.params.id), reaction = s(req.body.reaction_code, 32);
  if (!messageId || !/^[\p{L}\p{N}_+-]{1,32}$/u.test(reaction)) throw new HttpError(400, 'Invalid message or reaction.');
  const [rows] = await pool.execute('SELECT conversation_id FROM messages WHERE message_id = ? AND deleted_at IS NULL', [messageId]);
  if (!rows.length) throw new HttpError(404, 'Message not found.');
  await canAccessConversation(pool, rows[0].conversation_id, req.user.user_id);
  await pool.execute('INSERT IGNORE INTO message_reactions (message_id, user_id, reaction_code) VALUES (?, ?, ?)', [messageId, req.user.user_id, reaction]);
  res.status(201).json({ message: 'Reaction added.' });
}));
app.delete('/api/messages/:id/reactions/:reaction', authRequired, asyncRoute(async (req, res) => {
  const messageId = num(req.params.id), reaction = s(req.params.reaction, 32);
  if (!messageId) throw new HttpError(400, 'Invalid message id.');
  const [rows] = await pool.execute('SELECT conversation_id FROM messages WHERE message_id = ?', [messageId]);
  if (!rows.length) throw new HttpError(404, 'Message not found.');
  await canAccessConversation(pool, rows[0].conversation_id, req.user.user_id);
  await pool.execute('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND reaction_code = ?', [messageId, req.user.user_id, reaction]);
  res.json({ message: 'Reaction removed.' });
}));
app.post('/api/messages/:id/read', authRequired, asyncRoute(async (req, res) => {
  const messageId = num(req.params.id); if (!messageId) throw new HttpError(400, 'Invalid message id.');
  const [rows] = await pool.execute('SELECT conversation_id FROM messages WHERE message_id = ? AND deleted_at IS NULL', [messageId]);
  if (!rows.length) throw new HttpError(404, 'Message not found.');
  await canAccessConversation(pool, rows[0].conversation_id, req.user.user_id);
  await pool.execute('INSERT INTO message_read_receipts (message_id, user_id, read_at) VALUES (?, ?, CURRENT_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE read_at = VALUES(read_at)', [messageId, req.user.user_id]);
  res.json({ message: 'Message marked as read.' });
}));
app.patch('/api/messages/:id', authRequired, asyncRoute(async (req, res) => {
  const messageId = num(req.params.id), body = s(req.body.body, 4000);
  if (!messageId || !body) throw new HttpError(400, 'Message and updated text are required.');
  const [rows] = await pool.execute('SELECT message_id, conversation_id, sender_user_id, sent_at FROM messages WHERE message_id = ? AND deleted_at IS NULL', [messageId]);
  if (!rows.length) throw new HttpError(404, 'Message not found.');
  await canAccessConversation(pool, rows[0].conversation_id, req.user.user_id);
  if (Number(rows[0].sender_user_id) !== req.user.user_id) throw new HttpError(403, 'You can only edit your own messages.');
  await pool.execute('UPDATE messages SET body = ?, edited_at = CURRENT_TIMESTAMP(3) WHERE message_id = ?', [body, messageId]);
  res.json({ message: 'Message edited.' });
}));
app.delete('/api/messages/:id', authRequired, asyncRoute(async (req, res) => {
  const messageId = num(req.params.id); if (!messageId) throw new HttpError(400, 'Invalid message id.');
  const [rows] = await pool.execute('SELECT message_id, conversation_id, sender_user_id FROM messages WHERE message_id = ? AND deleted_at IS NULL', [messageId]);
  if (!rows.length) throw new HttpError(404, 'Message not found.');
  const conversation = await canAccessConversation(pool, rows[0].conversation_id, req.user.user_id);
  let permitted = Number(rows[0].sender_user_id) === req.user.user_id;
  if (!permitted && conversation.conversation_type === 'GROUP') {
    const moderator = await activeGroupMember(pool, conversation.study_group_id, req.user.user_id);
    permitted = !!moderator && ['OWNER','MODERATOR'].includes(moderator.role);
  }
  if (!permitted) throw new HttpError(403, 'You can only delete your own message unless you moderate the group.');
  await pool.execute("UPDATE messages SET deleted_at = CURRENT_TIMESTAMP(3), body = '[deleted]' WHERE message_id = ?", [messageId]);
  res.json({ message: 'Message deleted.' });
}));

app.post('/api/users/:id/block', authRequired, asyncRoute(async (req, res) => {
  const targetUserId = num(req.params.id);
  if (!targetUserId || targetUserId === req.user.user_id) throw new HttpError(400, 'Choose another valid user.');
  const [rows] = await pool.execute("SELECT user_id FROM users WHERE user_id = ? AND account_status = 'ACTIVE'", [targetUserId]);
  if (!rows.length) throw new HttpError(404, 'User not found.');
  await pool.execute('INSERT IGNORE INTO user_blocks (user_id, blocked_user_id) VALUES (?, ?)', [req.user.user_id, targetUserId]);
  res.json({ message: 'User blocked. Direct messages between these accounts are now restricted.' });
}));
app.delete('/api/users/:id/block', authRequired, asyncRoute(async (req, res) => {
  const targetUserId = num(req.params.id); if (!targetUserId) throw new HttpError(400, 'Invalid user id.');
  await pool.execute('DELETE FROM user_blocks WHERE user_id = ? AND blocked_user_id = ?', [req.user.user_id, targetUserId]);
  res.json({ message: 'User unblocked.' });
}));

app.post('/api/reports', authRequired, asyncRoute(async (req, res) => {
  const targetUserId = req.body.target_user_id ? num(req.body.target_user_id) : null;
  const groupId = req.body.group_id ? num(req.body.group_id) : null;
  const messageId = req.body.message_id ? num(req.body.message_id) : null;
  const reason = s(req.body.reason, 40).toUpperCase();
  const details = s(req.body.details, 3000);
  if (!targetUserId && !groupId && !messageId) throw new HttpError(400, 'Choose the user, group, or message being reported.');
  if (!['SPAM','HARASSMENT','INAPPROPRIATE','SCAM','IMPERSONATION','OTHER'].includes(reason)) throw new HttpError(400, 'Select a valid report reason.');
  if (targetUserId === req.user.user_id) throw new HttpError(400, 'You cannot report your own account.');
  const [result] = await pool.execute(
    `INSERT INTO reports (reporter_user_id, target_user_id, group_id, message_id, reason, details, status)
     VALUES (?, ?, ?, ?, ?, ?, 'OPEN')`, [req.user.user_id, targetUserId, groupId, messageId, reason, details || null]);
  res.status(201).json({ report_id: result.insertId, message: 'Report submitted for review.' });
}));

app.get('/api/notifications', authRequired, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT notification_id, notification_type, title, body, created_at, read_at
     FROM notifications WHERE recipient_user_id = ? ORDER BY created_at DESC LIMIT 100`, [req.user.user_id]);
  res.json({ items: rows });
}));
app.post('/api/notifications/:id/read', authRequired, asyncRoute(async (req, res) => {
  const notificationId = num(req.params.id); if (!notificationId) throw new HttpError(400, 'Invalid notification id.');
  await pool.execute('UPDATE notifications SET read_at = CURRENT_TIMESTAMP(3) WHERE notification_id = ? AND recipient_user_id = ?', [notificationId, req.user.user_id]);
  res.json({ message: 'Notification marked as read.' });
}));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, _next) => {
  if (res.headersSent) return;
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.message === 'Origin is not allowed by CORS.') return res.status(403).json({ error: err.message });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That record already exists.' });
  if (err.code === 'ECONNREFUSED' || err.code === 'PROTOCOL_CONNECTION_LOST') {
    console.error('Database connection error:', err.code);
    return res.status(503).json({ error: 'Database is unavailable. Check that MySQL is running in XAMPP.' });
  }
  console.error('Request failed:', { method: req.method, path: req.path, message: err.message });
  return res.status(500).json({ error: 'An unexpected server error occurred.' });
});

let server;
(async () => {
  try {
    const conn = await pool.getConnection();
    await conn.query('SELECT 1'); conn.release();
    server = app.listen(PORT, () => console.log(`Study Community running at http://localhost:${PORT}`));
    server.requestTimeout = 15000;
    server.headersTimeout = 17000;
    server.keepAliveTimeout = 5000;
  } catch (err) {
    console.error('Startup failed. Confirm XAMPP MySQL is running and .env credentials match database/schema.sql.');
    console.error(err.code || err.message);
    process.exit(1);
  }
})();

async function shutdown(signal) {
  console.log(`${signal} received; shutting down gracefully...`);
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
