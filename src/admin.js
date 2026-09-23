// Admin panel API.
//
// Mounted under /api/admin. Serves the school-data CRUD the admin panel UI
// uses. Every mutation writes straight through to the shared store, so the
// same data the admin edits is what the simulated WebUntis API serves.
import express from 'express';
import crypto from 'crypto';
import { getStore, saveStore, resetStore, replaceStore, nextId, storePath } from './store.js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TOKEN = crypto.randomBytes(16).toString('hex');
const COOKIE = 'admin_token';

const COLLECTIONS = new Set([
  'classes',
  'teachers',
  'subjects',
  'rooms',
  'students',
  'lessons',
  'homework',
  'absences',
  'messages',
]);

function adminAuthed(req) {
  return !ADMIN_PASSWORD || (req.cookies && req.cookies[COOKIE] === TOKEN);
}

function requireAdmin(req, res, next) {
  if (!adminAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

export function createAdminRouter() {
  const router = express.Router();

  if (ADMIN_PASSWORD) {
    router.post('/login', (req, res) => {
      if (req.body?.password === ADMIN_PASSWORD) {
        res.cookie(COOKIE, TOKEN, { httpOnly: true, sameSite: 'lax' });
        return res.json({ ok: true });
      }
      return res.status(401).json({ error: 'Wrong password' });
    });
    router.post('/logout', (req, res) => {
      res.clearCookie(COOKIE);
      res.json({ ok: true });
    });
    router.get('/auth', (req, res) => res.json({ authed: adminAuthed(req) }));
  }

  // Everything below requires the password (when configured).
  router.use(requireAdmin);

  router.get('/bootstrap', (req, res) => {
    res.json(getStore());
  });

  router.get('/export', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="db.json"');
    res.send(JSON.stringify(getStore(), null, 2));
  });

  router.post('/reset', (req, res) => {
    res.json(resetStore());
  });

  router.post('/import', (req, res) => {
    try {
      res.json(replaceStore(req.body));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/:collection', (req, res, next) => {
    const collection = req.params.collection;
    if (!COLLECTIONS.has(collection)) return next();
    const item = { ...req.body, id: nextId(collection) };
    getStore()[collection].push(item);
    saveStore();
    res.status(201).json(item);
  });

  router.put('/:collection/:id', (req, res, next) => {
    const collection = req.params.collection;
    if (!COLLECTIONS.has(collection)) return next();
    const list = getStore()[collection];
    const index = list.findIndex((item) => String(item.id) === String(req.params.id));
    if (index === -1) return res.status(404).json({ error: 'Not found' });
    const updated = { ...list[index], ...req.body, id: list[index].id };
    list[index] = updated;
    saveStore();
    res.json(updated);
  });

  router.delete('/:collection/:id', (req, res, next) => {
    const collection = req.params.collection;
    if (!COLLECTIONS.has(collection)) return next();
    const list = getStore()[collection];
    const index = list.findIndex((item) => String(item.id) === String(req.params.id));
    if (index === -1) return res.status(404).json({ error: 'Not found' });
    list.splice(index, 1);
    saveStore();
    res.json({ ok: true });
  });

  router.get('/store-path', (req, res) => res.json({ path: storePath }));
  return router;
}