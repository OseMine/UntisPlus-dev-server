// Persistent data store for the Untis+ Dev Server.
//
// The store holds every piece of "school data" the simulated WebUntis API
// serves (classes, teachers, subjects, rooms, students, lessons, homework,
// absences, messages). It is persisted as JSON in data/db.json and mutated
// both by the WebUntis simulation (e.g. the app sending a message) and by the
// admin panel.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

// Period times used for seeded lessons (start, end as HHMM ints).
const PERIODS = [
  [745, 830],
  [835, 920],
  [935, 1020],
  [1025, 1110],
  [1120, 1205],
  [1235, 1320],
  [1325, 1410],
];

const SUBJECTS = [
  { id: 1, name: 'M', longName: 'Mathematik', color: '#3B82F6' },
  { id: 2, name: 'D', longName: 'Deutsch', color: '#EF4444' },
  { id: 3, name: 'E', longName: 'Englisch', color: '#10B981' },
  { id: 4, name: 'B', longName: 'Biologie', color: '#8B5CF6' },
  { id: 5, name: 'G', longName: 'Geschichte', color: '#F59E0B' },
  { id: 6, name: 'S', longName: 'Sport', color: '#06B6D4' },
  { id: 7, name: 'KU', longName: 'Kunst', color: '#EC4899' },
  { id: 8, name: 'MU', longName: 'Musik', color: '#84CC16' },
  { id: 9, name: 'PH', longName: 'Physik', color: '#6366F1' },
];

const TEACHERS = [
  { id: 1, name: 'Weber, Anna', longName: 'Frau Weber', email: 'a.weber@demo.schule', initials: 'AW' },
  { id: 2, name: 'Schmidt, Jonas', longName: 'Herr Schmidt', email: 'j.schmidt@demo.schule', initials: 'JS' },
  { id: 3, name: 'Müller, Lena', longName: 'Frau Müller', email: 'l.mueller@demo.schule', initials: 'LM' },
  { id: 4, name: 'Fischer, Tim', longName: 'Herr Fischer', email: 't.fischer@demo.schule', initials: 'TF' },
  { id: 5, name: 'Becker, Sarah', longName: 'Frau Becker', email: 's.becker@demo.schule', initials: 'SB' },
  { id: 6, name: 'Hoffmann, Paul', longName: 'Herr Hoffmann', email: 'p.hoffmann@demo.schule', initials: 'PH' },
  { id: 7, name: 'Koch, Marie', longName: 'Frau Koch', email: 'm.koch@demo.schule', initials: 'MK' },
  { id: 8, name: 'Richter, David', longName: 'Herr Richter', email: 'd.richter@demo.schule', initials: 'DR' },
];

const ROOMS = [
  { id: 1, name: 'R101', longName: 'Raum 101' },
  { id: 2, name: 'R102', longName: 'Raum 102' },
  { id: 3, name: 'R110', longName: 'Raum 110' },
  { id: 4, name: 'R201', longName: 'Raum 201' },
  { id: 5, name: 'R202', longName: 'Raum 202' },
  { id: 6, name: 'SP1', longName: 'Sporthalle 1' },
  { id: 7, name: 'MU1', longName: 'Musikraum' },
  { id: 8, name: 'KU1', longName: 'Kunstraum' },
  { id: 9, name: 'PC1', longName: 'PC-Raum 1' },
];

const CLASSES = [
  { id: 45, name: '5A', longName: 'Klasse 5A', teacherId: 1, roomId: 1 },
  { id: 46, name: '5B', longName: 'Klasse 5B', teacherId: 3, roomId: 2 },
  { id: 47, name: '6A', longName: 'Klasse 6A', teacherId: 5, roomId: 4 },
  { id: 48, name: '7A', longName: 'Klasse 7A', teacherId: 7, roomId: 5 },
];

const STUDENTS = [
  { id: 123, classId: 45, firstName: 'Test', lastName: 'User' },
  { id: 124, classId: 45, firstName: 'Emma', lastName: 'Braun' },
  { id: 125, classId: 45, firstName: 'Noah', lastName: 'Stein' },
  { id: 126, classId: 46, firstName: 'Mia', lastName: 'Wolf' },
  { id: 127, classId: 46, firstName: 'Leon', lastName: 'Hahn' },
  { id: 128, classId: 47, firstName: 'Lena', lastName: 'Voß' },
  { id: 129, classId: 47, firstName: 'Finn', lastName: 'Brandt' },
  { id: 130, classId: 48, firstName: 'Lina', lastName: 'Kruger' },
  { id: 131, classId: 48, firstName: 'Tom', lastName: 'Berger' },
];

// Deterministic weekly lessons: [classId, weekday(1=Mon..5=Fri), period(1..7), subjectId, teacherId, roomId]
const LESSON_PLAN = [
  // 5A – the class the test account (testuser) belongs to
  [45, 1, 1, 1, 2, 1], [45, 1, 2, 2, 1, 1], [45, 1, 3, 3, 3, 2], [45, 1, 4, 4, 4, 3],
  [45, 2, 1, 2, 1, 2], [45, 2, 2, 3, 3, 3], [45, 2, 3, 1, 2, 1], [45, 2, 4, 6, 6, 6],
  [45, 3, 1, 3, 3, 3], [45, 3, 2, 4, 4, 3], [45, 3, 3, 2, 1, 1], [45, 3, 5, 7, 7, 8],
  [45, 4, 1, 1, 2, 1], [45, 4, 2, 6, 6, 6], [45, 4, 3, 5, 5, 4], [45, 4, 4, 8, 8, 7],
  [45, 5, 1, 5, 5, 4], [45, 5, 2, 1, 2, 1], [45, 5, 3, 3, 3, 3], [45, 5, 4, 8, 8, 7],
  // 5B
  [46, 1, 1, 3, 3, 3], [46, 1, 2, 2, 1, 2], [46, 1, 3, 1, 6, 1],
  [46, 2, 1, 4, 4, 3], [46, 2, 2, 3, 3, 3], [46, 2, 3, 5, 5, 5],
  [46, 3, 1, 1, 6, 1], [46, 3, 2, 6, 2, 6], [46, 3, 3, 8, 8, 7],
  [46, 4, 1, 5, 5, 5], [46, 4, 2, 2, 1, 2], [46, 5, 1, 3, 3, 3], [46, 5, 2, 1, 6, 1],
  // 6A
  [47, 1, 1, 5, 5, 5], [47, 1, 2, 9, 6, 9], [47, 1, 3, 3, 3, 3],
  [47, 2, 1, 1, 2, 1], [47, 2, 2, 3, 3, 3], [47, 2, 4, 6, 4, 6],
  [47, 3, 1, 2, 1, 2], [47, 3, 2, 9, 6, 9], [47, 3, 3, 5, 5, 5],
  [47, 4, 1, 3, 3, 3], [47, 4, 2, 7, 7, 8], [47, 5, 1, 1, 2, 1], [47, 5, 2, 4, 4, 3],
  // 7A
  [48, 1, 1, 3, 3, 3], [48, 1, 2, 9, 2, 9], [48, 1, 3, 1, 6, 1],
  [48, 2, 1, 2, 1, 2], [48, 2, 2, 5, 5, 5], [48, 2, 3, 7, 7, 8],
  [48, 3, 1, 4, 4, 3], [48, 3, 2, 1, 6, 1], [48, 3, 3, 8, 8, 7],
  [48, 4, 1, 5, 5, 5], [48, 4, 2, 9, 2, 9], [48, 5, 1, 1, 6, 1], [48, 5, 2, 2, 1, 2],
];

// yyyymmdd int helpers
function dateInt(year, month, day) {
  return year * 10000 + month * 100 + day;
}
function threeWeeksFromToday(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return dateInt(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

const HOLIDAYS = [
  { id: 1, name: 'Herbstferien', longName: 'Herbstferien 2026', startTime: 20261026, endTime: 20261030 },
  { id: 2, name: 'Weihnachtsferien', longName: 'Weihnachtsferien 2026/27', startTime: 20261223, endTime: 20270104 },
  { id: 3, name: 'Osterferien', longName: 'Osterferien 2027', startTime: 20270329, endTime: 20270409 },
  { id: 4, name: 'Pfingstferien', longName: 'Pfingstferien 2027', startTime: 20270517, endTime: 20270521 },
];

function buildSeed() {
  const lessons = LESSON_PLAN.map(([classId, weekday, period, subjectId, teacherId, roomId], index) => ({
    id: index + 1,
    classId,
    weekday,
    period,
    startTime: PERIODS[period - 1][0],
    endTime: PERIODS[period - 1][1],
    subjectId,
    teacherId,
    roomId,
  }));

  const today = new Date();
  const thisWeekDays = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return dateInt(d.getFullYear(), d.getMonth() + 1, d.getDate());
  };

  const homework = [
    {
      id: 1, classId: 45, subjectId: 1, teacherId: 2, lessonId: 1,
      text: 'Bearbeite Aufgaben 1–10 auf Seite 45.',
      dueDate: thisWeekDays(3), isDone: false,
    },
    {
      id: 2, classId: 45, subjectId: 3, teacherId: 3, lessonId: 5,
      text: 'Lies Kapitel 3 und schreibe eine Zusammenfassung.',
      dueDate: thisWeekDays(5), isDone: false,
    },
    {
      id: 3, classId: 45, subjectId: 4, teacherId: 4, lessonId: 8,
      text: 'Erstelle ein Plakat über den Frosch.',
      dueDate: thisWeekDays(8), isDone: false,
    },
    {
      id: 4, classId: 45, subjectId: 2, teacherId: 1, lessonId: 3,
      text: 'Übungsblatt 4 bearbeiten.',
      dueDate: thisWeekDays(1), isDone: true,
    },
    {
      id: 5, classId: 46, subjectId: 3, teacherId: 3, lessonId: 30,
      text: 'Vokabeln Unit 2 lernen.',
      dueDate: thisWeekDays(4), isDone: false,
    },
    {
      id: 6, classId: 47, subjectId: 1, teacherId: 2, lessonId: 44,
      text: 'Bruchrechnung: Aufgaben 1–8.',
      dueDate: thisWeekDays(6), isDone: false,
    },
  ];

  const absences = [
    {
      id: 1, classId: 45, studentId: 123, subjectId: 1,
      date: thisWeekDays(-2), startTime: 835, endTime: 920,
      reason: 'Krankheit', excused: true, text: 'Attest liegt vor',
    },
    {
      id: 2, classId: 45, studentId: 123, subjectId: 3,
      date: thisWeekDays(-1), startTime: 745, endTime: 830,
      reason: 'Arzttermin', excused: true, text: '',
    },
    {
      id: 3, classId: 46, studentId: 126, subjectId: 2,
      date: thisWeekDays(1), startTime: 835, endTime: 920,
      reason: 'Bus verpasst', excused: false, text: '',
    },
  ];

  const messages = [
    {
      id: 1, scope: 'news', subject: 'Willkommen im neuen Schuljahr 2026/27',
      content: 'Liebe Schülerinnen und Schüler, das neue Schuljahr beginnt am Montag um 07:45 Uhr. Wir freuen uns auf euch!',
      sender: 'Schulleitung', sent: Date.now() - 3 * 86400000, read: false,
      recipients: [],
    },
    {
      id: 2, scope: 'news', subject: 'Mathematik-Olympiade 2026',
      content: 'Anmeldungen für die Mathematik-Olympiade sind bis zum 31. Oktober möglich. Weitere Infos bei Frau Weber.',
      sender: 'Fachschaft Mathematik', sent: Date.now() - 1 * 86400000, read: false,
      recipients: [],
    },
    {
      id: 3, scope: 'inbox', subject: 'Herzlich willkommen, Test User!',
      content: 'Dein Zugang wurde erfolgreich eingerichtet. Der Stundenplan und die Hausaufgaben sind verfügbar.',
      sender: 'Schulverwaltung', sent: Date.now() - 2 * 86400000, read: false,
      recipients: [{ id: 45, type: 'CLASS' }],
    },
    {
      id: 4, scope: 'inbox', subject: 'Englisch-Zusatztraining am Dienstag',
      content: 'Für alle Interessierten: Zusatztraining Englisch dienstags, 7. Stunde, Raum 101.',
      sender: 'Frau Müller', sent: Date.now() - 5 * 3600000, read: false,
      recipients: [{ id: 45, type: 'CLASS' }],
    },
  ];

  const exams = buildSeedExams();

  return {
    schema: 1,
    school: { name: 'demo', longName: 'Demo-Gymnasium Musterstadt' },
    schoolYear: { id: 1, name: '2026/27', startDate: 20260831, endDate: 20270630 },
    classes: CLASSES,
    teachers: TEACHERS,
    subjects: SUBJECTS,
    rooms: ROOMS,
    students: STUDENTS,
    lessons,
    homework,
    absences,
    messages,
    exams,
    holidays: HOLIDAYS,
  };
}

// Exams (Prüfungen) seed – relative dates so the demo always shows upcoming
// AND past exams inside the app's request window (14 days back / 90 ahead).
function buildSeedExams() {
  const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return dateInt(d.getFullYear(), d.getMonth() + 1, d.getDate());
  };
  return [
    {
      id: 1, classIds: [45], subjectId: 1, subject: 'Mathematik', examType: 'Schularbeit',
      date: day(18), startTime: 850, endTime: 940,
      teachers: ['Frau Weber'], teacherIds: [2], rooms: ['R101'], roomIds: [1],
      description: 'Kapitel 1–3: Natürliche Zahlen, Grundrechenarten',
    },
    {
      id: 2, classIds: [45], subjectId: 3, subject: 'Englisch', examType: 'Vokabeltest',
      date: day(26), startTime: 935, endTime: 1020,
      teachers: ['Frau Müller'], teacherIds: [3], rooms: ['R102'], roomIds: [2],
      description: 'Unit 2: Wortschatz und Smalltalk',
    },
    {
      id: 3, classIds: [45], subjectId: 2, subject: 'Deutsch', examType: 'Diktat',
      date: day(34), startTime: 745, endTime: 830,
      teachers: ['Frau Weber'], teacherIds: [1], rooms: ['R101'], roomIds: [1],
      description: 'Diktat „Der herbstliche Wald“',
    },
    {
      id: 4, classIds: [45], subjectId: 4, subject: 'Biologie', examType: 'Stegreif',
      date: day(-10), startTime: 1025, endTime: 1110,
      teachers: ['Herr Fischer'], teacherIds: [4], rooms: ['R201'], roomIds: [4],
      description: 'Aufbau von Blütenpflanzen',
    },
    {
      id: 5, classIds: [47], subjectId: 9, subject: 'Physik', examType: 'Schularbeit',
      date: day(52), startTime: 850, endTime: 940,
      teachers: ['Herr Hoffmann'], teacherIds: [6], rooms: ['PC1'], roomIds: [9],
      description: 'Elektrizitätslehre: Schaltungen',
    },
    {
      id: 6, classIds: [48], subjectId: 5, subject: 'Geschichte', examType: 'Referat',
      date: day(74), startTime: 935, endTime: 1020,
      teachers: ['Frau Becker'], teacherIds: [5], rooms: ['R202'], roomIds: [5],
      description: 'Präsentation: Das Mittelalter',
    },
    {
      id: 7, classIds: [46], subjectId: 3, subject: 'Englisch', examType: 'Schularbeit',
      date: day(40), startTime: 1120, endTime: 1205,
      teachers: ['Frau Müller'], teacherIds: [3], rooms: ['R110'], roomIds: [3],
      description: 'Unit 1–2: Grammar and Writing',
    },
  ];
}

let store = null;

export function getStore() {
  if (store) return store;
  if (fs.existsSync(DB_PATH)) {
    try {
      store = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch (err) {
      console.error(`\n!!! Could not parse ${DB_PATH} (${err.message}) – reseeding fresh data.`);
      store = null;
    }
  }
  if (!store) {
    store = buildSeed();
    saveStore();
  }
  if (!Array.isArray(store.exams)) {
    store.exams = buildSeedExams();
    saveStore();
  }
  return store;
}

export function saveStore() {
  if (!store) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2));
}

export function resetStore() {
  store = buildSeed();
  saveStore();
  return store;
}

export function replaceStore(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid store payload');
  store = data;
  saveStore();
  return store;
}

export function nextId(collection) {
  const list = store[collection] || [];
  return list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

export const storePath = DB_PATH;