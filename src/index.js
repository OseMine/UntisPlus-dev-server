// Untis+ Dev Server
//
// Simulates the WebUntis API for the Untis+ app (https://github.com/ninocss/UntisPlus).
// All school data lives in a persistent, editable store (data/db.json) which the
// admin panel (/admin) and the simulated API share.
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import dotenv from 'dotenv';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { getStore, saveStore, resetStore, nextId } from './store.js';
import { createAdminRouter } from './admin.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const SCHOOL_NAME = process.env.SCHOOL_NAME || 'demo';
const VALID_USER = process.env.UNTIS_USER || 'testuser';
const VALID_PASS = process.env.UNTIS_PASSWORD || 'testpass';
// The test account is a STUDENT. WebUntis person types / timetable element
// types: 1=Klasse, 2=Lehrer, 3=Raum, 4=Fach, 5=Schüler.
const TEST_STUDENT_ID = 123;
const TEST_CLASS_ID = 45;

const sessions = new Map();

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());

// Capture the raw request body so we can see exactly what arrives on the wire
// (json body-parsing may hide empty/malformed/encoded payloads).
const rawBodies = new WeakMap();
// The Untis+ app sends JSON-RPC with `Content-Type: text/plain; charset=utf-8`
// (not application/json) – so we must parse JSON for text/plain as well. Without
// this, req.body stays {} → method is undefined → "-32601 Method undefined not
// found" → the app shows "Login fehlgeschlagen".
app.use(express.json({
  type: (req) => {
    const ct = req.headers['content-type'] || '';
    return ct.includes('application/json') || ct.includes('text/plain') || ct.endsWith('+json');
  },
  verify: (req, res, buf) => rawBodies.set(req, buf),
}));

// Dev request logging: shows exactly what the Untis+ app sends.
// (Password/OTP fields are redacted.)
function redactSecrets(value) {
  if (!value || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return `(raw buffer ${value.length} bytes)`;
  const copy = Array.isArray(value) ? [...value] : { ...value };
  for (const key of Object.keys(copy)) {
    if (/password|otp|secret|key/i.test(key)) {
      copy[key] = '***';
    } else if (copy[key] && typeof copy[key] === 'object') {
      copy[key] = redactSecrets(copy[key]);
    }
  }
  return copy;
}

app.use((req, res, next) => {
  const cookie = req.headers.cookie ?? '';
  const raw = rawBodies.get(req);
  const rawStr = raw ? raw.toString('utf8') : '';
  console.log(`\n>>> ${new Date().toISOString()} ${req.method} ${req.originalUrl || req.url}`);
  console.log(`    ip=${req.ip} ua="${req.headers['user-agent'] ?? ''}"`);
  console.log(`    content-type="${req.headers['content-type'] ?? ''}" content-length="${req.headers['content-length'] ?? '-'}"`);
  if (cookie) console.log(`    cookie: ${cookie}`);
  if (rawStr) console.log(`    raw-body(${raw.length}): ${JSON.stringify(rawStr.slice(0, 1500))}`);
  console.log(`    parsed-body: ${req.body !== undefined ? JSON.stringify(redactSecrets(req.body)) : '(undefined)'}`);
  res.on('finish', () => {
    const setCookie = res.getHeaders()['set-cookie'];
    const cookieInfo = setCookie
      ? ' set-cookie=' + JSON.stringify(setCookie.map((c) => c.split(';')[0]))
      : '';
    console.log(`<<< ${res.statusCode}${cookieInfo}`);
  });
  next();
});

// Listens for the app sending a message (multipart/form-data).
app.post(['/WebUntis/api/rest/view/v1/messages', '/WebUntis/api/rest/view/v2/messages'],
  express.raw({ type: () => true, limit: '25mb' }), (req, res, next) => next());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const key = fs.readFileSync(path.join(__dirname, '..', 'key.pem'));
const cert = fs.readFileSync(path.join(__dirname, '..', 'cert.pem'));
const httpsOptions = { key, cert };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateSessionId() {
  return uuidv4();
}

function jsonRpcResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

function validateSession(req) {
  const sessionId = req.cookies?.JSESSIONID;
  return sessionId && sessions.has(sessionId) ? sessions.get(sessionId) : null;
}

function requireAuth(req, res, next) {
  const session = validateSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized', code: -32600 });
  }
  req.session = session;
  next();
}

function setSessionCookies(res, sessionId) {
  res.cookie('JSESSIONID', sessionId, { httpOnly: true, sameSite: 'lax' });
  res.cookie('schoolname', SCHOOL_NAME, { httpOnly: true, sameSite: 'lax' });
}

// The Untis+ app sends `params` as a JSON object ({ user, password, client }),
// older clients as an array ([username, password, client]). Support both.
function extractCredentials(params) {
  if (Array.isArray(params)) {
    return { user: params[0], password: params[1], client: params[2] };
  }
  params = params || {};
  return {
    user: params.user,
    password: params.password,
    client: params.client,
    otp: params.otp,
  };
}

// Normalize JSON-RPC params that may arrive as an object or an array.
function normalizeParams(params) {
  if (Array.isArray(params)) return params[0] || {};
  if (params && typeof params === 'object') return params;
  return {};
}

// For getTimetable/getTimetableWithAbsences the app sends
// params = { options: { element, startDate, endDate, ... } } – unwrap it.
function optionsOf(params) {
  const value = normalizeParams(params);
  if (value && typeof value.options === 'object' && value.options !== null) {
    return value.options;
  }
  return value;
}

// The test account: student 123 in class 45 (seeded as "5A").
function sessionUser(session) {
  const store = getStore();
  const student = store.students.find((s) => s.id === TEST_STUDENT_ID) || null;
  const klass = student
    ? store.classes.find((c) => c.id === student.classId)
    : store.classes.find((c) => c.id === TEST_CLASS_ID);
  const klassId = klass ? klass.id : TEST_CLASS_ID;
  const personId = TEST_STUDENT_ID;
  return {
    personType: 5,
    personId,
    klasseId: klassId,
    className: klass ? klass.name : '5A',
    firstName: student ? student.firstName : 'Test',
    lastName: student ? student.lastName : 'User',
    klass,
  };
}

// ---------------------------------------------------------------------------
// Date + timetable helpers (dates as yyyymmdd ints, matching WebUntis)
// ---------------------------------------------------------------------------

function dateToInt(date) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function todayInt() {
  return dateToInt(new Date());
}

function addDays(dateInt, days) {
  const s = String(dateInt);
  const d = new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  d.setDate(d.getDate() + days);
  return dateToInt(d);
}

function weekdayOf(dateInt) {
  const s = String(dateInt);
  const jsDay = new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)).getDay();
  return jsDay === 0 ? 7 : jsDay; // 1=Mon .. 7=Sun
}

function entityRef(store, list, id) {
  const item = list.find((e) => e.id === id);
  return item ? { id: item.id, name: item.name, longName: item.longName || item.name } : null;
}

function makeLessonInstance(lesson, date) {
  const store = getStore();
  const klass = entityRef(store, store.classes, lesson.classId);
  const teacher = entityRef(store, store.teachers, lesson.teacherId);
  const subject = store.subjects.find((x) => x.id === lesson.subjectId);
  const room = entityRef(store, store.rooms, lesson.roomId);
  return {
    id: `${lesson.id}-${date}`,
    date,
    startTime: lesson.startTime,
    endTime: lesson.endTime,
    period: lesson.period,
    lsnumber: lesson.period,
    kl: klass ? [klass] : [],
    te: teacher ? [teacher] : [],
    su: subject ? [{ id: subject.id, name: subject.name, longName: subject.longName, color: subject.color }] : [],
    ro: room ? [room] : [],
    type: 'ls',
    lstext: '',
    info: '',
    substText: '',
    statflags: 'H',
    activityType: 1,
  };
}

function matchesElement(lesson, element) {
  const type = Number(element && element.type);
  const id = Number(element && element.id);
  if (!element || !Number.isFinite(id)) return true;
  if (type === 2) return lesson.teacherId === id;
  if (type === 3) return lesson.roomId === id;
  if (type === 4) return lesson.subjectId === id;
  if (type === 5) {
    const student = getStore().students.find((s) => s.id === id);
    return student ? lesson.classId === student.classId : false;
  }
  return lesson.classId === id; // 1 = class (and fallback)
}

function buildLessonInstances(element, startDate, endDate) {
  const store = getStore();
  const instances = [];
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
    const day = weekdayOf(d);
    for (const lesson of store.lessons) {
      if (lesson.weekday !== day) continue;
      if (!matchesElement(lesson, element)) continue;
      instances.push(makeLessonInstance(lesson, d));
    }
  }
  instances.sort((a, b) => a.date - b.date || a.startTime - b.startTime);
  return instances;
}

function dateRangeOf(options) {
  const store = getStore();
  const start = options.startDate || store.schoolYear.startDate || todayInt();
  const end = options.endDate || store.schoolYear.endDate || addDays(start, 7);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

// A token that _looks_ like a JWT (the app decodes the payload for tenant id).
function makePseudoJwt(sessionUserData) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const payload = {
    sub: String(TEST_STUDENT_ID),
    name: `${sessionUserData.firstName} ${sessionUserData.lastName}`,
    tenant_id: 'dev',
    personType: 5,
    iat: Math.floor(Date.now() / 1000),
  };
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.${crypto.randomBytes(18).toString('base64url')}`;
}

// Minimal multipart/form-data parser (no external dependency).
function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) return [];
  const boundary = match[1] || match[2];
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let pos = 0;
  for (;;) {
    const idx = buffer.indexOf(delimiter, pos);
    if (idx === -1) break;
    let start = idx + delimiter.length;
    if (buffer[start] === 0x2d && buffer[start + 1] === 0x2d) break; // trailing "--"
    start += 2; // CRLF after boundary
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), start);
    if (headerEnd === -1) break;
    const headers = buffer.slice(start, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    const marker = Buffer.from(`\r\n--${boundary}`);
    const next = buffer.indexOf(marker, bodyStart);
    const body = next === -1 ? buffer.slice(bodyStart) : buffer.slice(bodyStart, next);
    parts.push({ headers, body });
    pos = next === -1 ? buffer.length : next + 2;
  }
  return parts;
}

function newsItems() {
  return getStore().messages.filter((m) => m.scope === 'news');
}

function newsItemPayload(m) {
  return {
    id: m.id,
    subject: m.subject,
    headline: m.subject,
    title: m.subject,
    text: m.content,
    message: m.content,
    content: m.content,
    author: m.sender,
    date: m.sent,
  };
}

// ---------------------------------------------------------------------------
// JSON-RPC: /WebUntis/jsonrpc.do
// ---------------------------------------------------------------------------

app.post('/WebUntis/jsonrpc.do', (req, res) => {
  const { method, params, id } = req.body || {};
  const school = req.query.school;

  if (school !== SCHOOL_NAME) {
    return res.json(jsonRpcError(id, -32600, 'Invalid school'));
  }

  switch (method) {
    case 'authenticate': {
      const { user: username, password, client } = extractCredentials(params);
      if (username === VALID_USER && password === VALID_PASS) {
        const sessionId = generateSessionId();
        const user = sessionUser();
        sessions.set(sessionId, { username, school: SCHOOL_NAME, client, ...user });
        setSessionCookies(res, sessionId);
        return res.json(jsonRpcResponse(id, {
          sessionId,
          personType: user.personType,
          personId: user.personId,
          klasseId: user.klasseId,
        }));
      }
      return res.json(jsonRpcError(id, -32600, 'Invalid credentials'));
    }

    case 'getUserData2017': {
      const session = validateSession(req);
      if (!session) return res.json(jsonRpcError(id, -32600, 'Not authenticated'));
      return res.json(jsonRpcResponse(id, userData(session)));
    }

    case 'getCurrentSchoolyear': {
      const session = validateSession(req);
      if (!session) return res.json(jsonRpcError(id, -32600, 'Not authenticated'));
      return res.json(jsonRpcResponse(id, getStore().schoolYear));
    }

    case 'getHolidays': {
      const session = validateSession(req);
      if (!session) return res.json(jsonRpcError(id, -32600, 'Not authenticated'));
      const { start, end } = dateRangeOf(normalizeParams(params));
      const holidays = getStore().holidays.filter(
        (h) => h.startTime <= end && h.endTime >= start,
      );
      return res.json(jsonRpcResponse(id, holidays));
    }

    case 'getSubjects':
    case 'getTeachers':
    case 'getRooms':
    case 'getKlassen': {
      const session = validateSession(req);
      if (!session) return res.json(jsonRpcError(id, -32600, 'Not authenticated'));
      const store = getStore();
      const map = {
        getSubjects: store.subjects,
        getTeachers: store.teachers,
        getRooms: store.rooms,
        getKlassen: store.classes,
      };
      return res.json(jsonRpcResponse(id, map[method]));
    }

    case 'getTimetable': {
      const session = validateSession(req);
      if (!session) return res.json(jsonRpcError(id, -32600, 'Not authenticated'));
      const options = optionsOf(params);
      const element = (options.element && Array.isArray(options.element))
        ? options.element[0]
        : options.element || null;
      const { start, end } = dateRangeOf(options);
      return res.json(jsonRpcResponse(id, { timetable: buildLessonInstances(element, start, end) }));
    }

    case 'getTimetableWithAbsences': {
      const session = validateSession(req);
      if (!session) return res.json(jsonRpcError(id, -32600, 'Not authenticated'));
      const options = optionsOf(params);
      const { start, end } = dateRangeOf(options);
      const user = sessionUser(session);
      const store = getStore();
      const absences = store.absences.filter(
        (a) => a.classId === user.klasseId && a.date >= start && a.date <= end,
      );
      return res.json(jsonRpcResponse(id, {
        periodsWithAbsences: absences.map((a) => ({
          id: a.id,
          date: a.date,
          startTime: a.startTime,
          endTime: a.endTime,
          excused: !!a.excused,
          status: a.excused ? 'excused' : 'unexcused',
          reason: a.reason || '',
          subject: subjectName(a.subjectId),
          text: a.text || '',
          checked: false,
        })),
      }));
    }

    case 'getHomeWork2017': {
      const session = validateSession(req);
      if (!session) return res.json(jsonRpcError(id, -32600, 'Not authenticated'));
      const raw = Array.isArray(params) ? params[0] : normalizeParams(params);
      const personId = Number(raw.id);
      const hwType = String(raw.type || '').toUpperCase();
      const { start, end } = dateRangeOf(raw);
      const store = getStore();

      const user = sessionUser(session);
      // STUDENT → person is a student; otherwise the person is a teacher.
      const classIds = new Set();
      let teacherIds = new Set();
      if (hwType === 'TEACHER' && Number.isFinite(personId)) {
        teacherIds.add(personId);
      } else {
        const student = store.students.find((s) => s.id === personId) || null;
        classIds.add(student ? student.classId : user.klasseId);
      }

      const homeworks = store.homework.filter(
        (h) =>
          (classIds.has(h.classId) || teacherIds.has(h.teacherId)) &&
          h.dueDate >= start &&
          h.dueDate <= end,
      );

      const lessonsMap = {};
      for (const h of homeworks) {
        const lesson = store.lessons.find((l) => l.id === Number(h.lessonId)) || {
          id: h.lessonId,
          classId: h.classId,
          weekday: weekdayOf(h.dueDate),
          period: 1,
          startTime: 800,
          endTime: 845,
          subjectId: h.subjectId,
          teacherId: h.teacherId,
          roomId: store.rooms[0] ? store.rooms[0].id : 1,
        };
        const instance = makeLessonInstance(lesson, h.dueDate);
        lessonsMap[instance.id] = instance;
      }

      return res.json(jsonRpcResponse(id, {
        homeworks: homeworks.map((h) => {
          const lessonId = `${h.lessonId}-${h.dueDate}`;
          return {
            id: h.id,
            lessonId,
            date: h.dueDate,
            text: h.text,
            dueDate: h.dueDate,
            isDone: !!h.isDone,
            subject: subjectRef(h.subjectId),
            teacher: teacherRef(h.teacherId),
          };
        }),
        lessonNotes: [],
        lessonInfos: [],
        lessons: Object.values(lessonsMap),
      }));
    }

    // School-info fallbacks (newsfeed) used by the app when the REST news
    // widget returns nothing.
    case 'getMessagesOfDay2017':
    case 'getMessagesOfDay':
    case 'getMessages': {
      const session = validateSession(req);
      if (!session) return res.json(jsonRpcError(id, -32600, 'Not authenticated'));
      return res.json(jsonRpcResponse(id, newsItems().map(newsItemPayload)));
    }

    default:
      return res.json(jsonRpcError(id, -32601, `Method ${method} not found`));
  }
});

function subjectRef(subjectId) {
  const s = getStore().subjects.find((x) => x.id === subjectId);
  return s ? { id: s.id, name: s.name, longName: s.longName, color: s.color } : null;
}

function teacherRef(teacherId) {
  const t = getStore().teachers.find((x) => x.id === teacherId);
  return t ? { id: t.id, name: t.name, longName: t.longName } : null;
}

function subjectName(subjectId) {
  const s = getStore().subjects.find((x) => x.id === subjectId);
  return s ? s.longName : '';
}

function userData(session) {
  const user = sessionUser(session);
  return {
    personType: user.personType,
    personId: user.personId,
    klasseId: user.klasseId,
    className: user.className,
    firstName: user.firstName,
    lastName: user.lastName,
    email: 'test@demo.schule',
  };
}

// ---------------------------------------------------------------------------
// JSON-RPC (internal): /WebUntis/jsonrpc_intern.do  (login-key auth)
// ---------------------------------------------------------------------------

app.post('/WebUntis/jsonrpc_intern.do', (req, res) => {
  const { method, params, id } = req.body || {};
  const school = req.query.school;

  if (school !== SCHOOL_NAME) {
    return res.json(jsonRpcError(id, -32600, 'Invalid school'));
  }

  if (method !== 'getUserData2017') {
    return res.json(jsonRpcError(id, -32601, `Method ${method} not found`));
  }

  const raw = Array.isArray(params) ? params[0] : normalizeParams(params);
  const auth = raw?.auth || {};
  const user = auth.user;
  const otp = auth.otp;

  if (user !== VALID_USER || typeof otp !== 'string' || otp.length === 0) {
    return res.json(jsonRpcError(id, -32600, 'Invalid login key'));
  }

  const sessionId = generateSessionId();
  const data = userData({});
  sessions.set(sessionId, { username: user, school: SCHOOL_NAME, authMethod: 'loginKey', ...data });
  setSessionCookies(res, sessionId);
  return res.json(jsonRpcResponse(id, data));
});

// ---------------------------------------------------------------------------
// REST: app config / login-key identity
// ---------------------------------------------------------------------------

app.get('/WebUntis/api/app/config', (req, res) => {
  const session = validateSession(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  const user = sessionUser(session);
  res.json({
    data: {
      loginServiceConfig: {
        user: {
          personId: user.personId,
          persons: [
            {
              id: user.personId,
              type: user.personType,
              name: `${user.firstName} ${user.lastName}`,
              longName: `${user.firstName} ${user.lastName}`,
            },
          ],
        },
      },
    },
  });
});

// ---------------------------------------------------------------------------
// REST: MessageCenter 2021
// ---------------------------------------------------------------------------

app.get('/WebUntis/api/token/new', requireAuth, (req, res) => {
  const user = sessionUser(req.session);
  res.json({ accessToken: makePseudoJwt(user) });
});

app.get('/WebUntis/api/rest/view/v1/messages', requireAuth, (req, res) => {
  const user = sessionUser(req.session);
  const store = getStore();
  const incoming = store.messages
    .filter((m) => {
      if (m.scope !== 'inbox') return false;
      if (!m.recipients || m.recipients.length === 0) return true; // broadcast
      return m.recipients.some(
        (r) =>
          (r.type === 'CLASS' && r.id === user.klasseId) ||
          (r.type === 'STUDENT' && r.id === user.personId),
      );
    })
    .map((m) => ({
      id: m.id,
      subject: m.subject,
      content: m.content,
      contentPreview: m.content.slice(0, 140),
      sender: { displayName: m.sender },
      sentDateTime: m.sent,
      read: !!m.read,
      recipientOption: 'CLASS',
      recipientGroups: [],
      attachments: m.attachments || [],
    }));
  res.json({ incomingMessages: incoming });
});

app.post('/WebUntis/api/rest/view/v2/messages', requireAuth, (req, res) => {
  return handleMessageSend(req, res);
});

app.post('/WebUntis/api/rest/view/v1/messages', requireAuth, (req, res) => {
  return handleMessageSend(req, res);
});

function handleMessageSend(req, res) {
  if (!Buffer.isBuffer(req.body)) {
    return res.status(400).json({ errorMessage: 'Expected multipart/form-data body' });
  }
  const parts = parseMultipart(req.body, req.headers['content-type'] || '');
  const requestPart = parts.find((p) => /name="request"/.test(p.headers));
  if (!requestPart) {
    return res.status(400).json({ errorMessage: 'Missing "request" part' });
  }
  let meta;
  try {
    meta = JSON.parse(requestPart.body.toString('utf8'));
  } catch {
    return res.status(400).json({ errorMessage: 'Invalid "request" JSON' });
  }
  const store = getStore();
  const attachments = parts
    .filter((p) => /name="attachments"/.test(p.headers))
    .map((p) => {
      const m = /filename="([^"]*)"/i.exec(p.headers);
      return { fileId: uuidv4(), fileRegularName: (m && m[1]) || 'Anhang' };
    });
  const ids = (Array.isArray(meta.recipientPersons) ? meta.recipientPersons : [])
    .map((p) => Number(p && p.id))
    .filter(Number.isFinite);
  const recipients = ids.map((id) => {
    let type = 'STUDENT';
    if (store.teachers.some((t) => t.id === id)) type = 'TEACHER';
    else if (store.classes.some((c) => c.id === id)) type = 'CLASS';
    return { id, type };
  });
  const user = sessionUser(req.session);
  const message = {
    id: nextId('messages'),
    scope: 'inbox',
    subject: String(meta.subject || '').trim() || '(ohne Betreff)',
    content: String(meta.content || '').trim(),
    sender: `${user.firstName} ${user.lastName}`,
    sent: Date.now(),
    read: false,
    recipients,
    attachments,
  };
  store.messages.push(message);
  saveStore();
  console.log(`    ★ Nachricht vom App-Benutzer gespeichert (id=${message.id}, Empfänger: ${recipients.length}, Anhänge: ${attachments.length})`);
  res.status(201).json({ id: message.id, message: 'Message sent' });
}

app.get('/WebUntis/api/rest/view/v1/messages/permissions', requireAuth, (req, res) => {
  res.json({
    recipientOptions: ['TEACHER', 'STUDENT', 'CLASS'],
    maxFileSize: 7000000,
    maxFileCount: 5,
  });
});

app.get('/WebUntis/api/rest/view/v1/messages/recipients/static/persons', requireAuth, (req, res) => {
  const store = getStore();
  res.json([
    {
      type: 'TEACHER',
      persons: store.teachers.map((t) => ({ userId: t.id, displayName: t.longName || t.name, tags: [] })),
    },
    {
      type: 'CLASS',
      persons: store.classes.map((c) => ({ userId: c.id, displayName: c.longName || c.name, tags: [] })),
    },
    {
      type: 'STUDENT',
      persons: store.students.map((s) => ({
        userId: s.id,
        displayName: `${s.firstName} ${s.lastName}`,
        tags: [classOf(s.classId)],
      })),
    },
  ]);
});

function classOf(classId) {
  const c = getStore().classes.find((x) => x.id === classId);
  return c ? c.name : '';
}

app.get('/WebUntis/messageFileRequest.do', requireAuth, (req, res) => {
  const fileId = String(req.query.file || '');
  const name = attachmentName(fileId) || (fileId.endsWith('.pdf') ? fileId : 'Datei.pdf');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(Buffer.from(`%PDF-1.4\n% Mock-Datei der untisplus-dev-server für Anhang "${name}"\n%%EOF\n`, 'utf8'));
});

function attachmentName(fileId) {
  for (const m of getStore().messages) {
    for (const a of m.attachments || []) {
      if (a.fileId === fileId) return a.fileRegularName;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// REST: public news widget + fallbacks
// ---------------------------------------------------------------------------

app.get('/WebUntis/api/public/news/newsWidgetData', (req, res) => {
  res.json({ data: { messagesOfDay: newsItems().map(newsItemPayload) } });
});

app.get(['/WebUntis/api/public/messages', '/WebUntis/api/public/notifications', '/WebUntis/api/public/notices'], (req, res) => {
  res.json(newsItems().map(newsItemPayload));
});

// ---------------------------------------------------------------------------
// REST: public weekly timetable data
// ---------------------------------------------------------------------------

app.get('/WebUntis/api/public/timetable/weekly/data', (req, res) => {
  const elementType = Number(req.query.elementType || 0);
  const elementId = Number(req.query.elementId || 0);
  const dateStr = String(req.query.date || '');
  const [y, m, d] = dateStr.split('-').map(Number);
  let anchor = dateToInt(new Date());
  if (y && m && d) anchor = y * 10000 + m * 100 + d;
  const weekday = weekdayOf(anchor);
  const monday = addDays(anchor, -(weekday - 1));
  const sunday = addDays(monday, 6);
  const element = elementId ? { id: elementId, type: elementType } : null;
  const lessons = buildLessonInstances(element, monday, sunday);
  res.json({
    data: {
      result: {
        data: {
          elementType,
          elementId,
          date: dateStr,
          startDate: monday,
          endDate: sunday,
          lessons,
        },
      },
    },
  });
});

// ---------------------------------------------------------------------------
// Admin panel
// ---------------------------------------------------------------------------

app.use('/api/admin', createAdminRouter());
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.use('/admin', express.static(PUBLIC_DIR, { index: 'admin.html' }));

// ---------------------------------------------------------------------------
// Error handling + startup
// ---------------------------------------------------------------------------

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    console.error(`\n!!! MALFORMED JSON (${req.method} ${req.originalUrl || req.url}): ${err.message}`);
  }
  next(err);
});

https.createServer(httpsOptions, app).listen(PORT, '0.0.0.0', () => {
  console.log(`Untis+ Dev Server running on https://0.0.0.0:${PORT}`);
  console.log(`School: ${SCHOOL_NAME}`);
  console.log(`Test credentials: ${VALID_USER} / ${VALID_PASS}`);
  console.log(`Data store: ${path.join(__dirname, '..', 'data', 'db.json')}`);
  console.log('\nAdmin panel:');
  console.log(`  https://localhost:${PORT}/admin   (Klassen, Lehrer, Fächer, Räume, Schüler, Stundenplan, Hausaufgaben, Absenzen, Nachrichten)`);
  console.log('  API: /api/admin/bootstrap | /api/admin/{klassen|lehrer|...} (POST/PUT/DELETE) | /api/admin/reset | /api/admin/export');
  if (process.env.ADMIN_PASSWORD) console.log('  Admin login: ADMIN_PASSWORD ist gesetzt (Login-Seite aktiv)');
  console.log('\nWebUntis simulation:');
  console.log(`  JSON-RPC: POST /WebUntis/jsonrpc.do?school=${SCHOOL_NAME}  (authenticate, getKlassen, getTeachers, getSubjects, getRooms, getTimetable, getTimetableWithAbsences, getHomeWork2017, getHolidays, getCurrentSchoolyear, getMessagesOfDay2017, ...)`);
  console.log(`  JSON-RPC: POST /WebUntis/jsonrpc_intern.do?school=${SCHOOL_NAME}  (login-key auth)`);
  console.log('  REST: /api/token/new, /api/rest/view/v1/messages (+permissions, +recipients/static/persons), /api/public/news/newsWidgetData, /api/public/timetable/weekly/data');
  console.log('\nUse https://YOUR_LOCAL_IP:3000 in Untis+ app (accept self-signed cert)');
});