// Almacén de sesiones en MySQL (tabla sf_sesion): las sesiones sobreviven a reinicios del servidor.
import session from 'express-session';

export const SESSION_TABLE_SQL = `CREATE TABLE IF NOT EXISTS sf_sesion (
  id      VARCHAR(128) NOT NULL PRIMARY KEY,
  data    MEDIUMTEXT   NOT NULL,
  expira  BIGINT       NOT NULL,
  KEY ix_sesion_expira (expira)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_spanish_ci`;

const DAY = 24 * 60 * 60 * 1000;

export class MySqlSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
  }

  static expiry(sess) {
    return sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + DAY;
  }

  get(sid, cb) {
    this.db.one('SELECT data FROM sf_sesion WHERE id = ? AND expira > ?', [sid, Date.now()])
      .then(row => cb(null, row ? JSON.parse(row.data) : null), cb);
  }

  set(sid, sess, cb = () => {}) {
    this.db.run(
      'INSERT INTO sf_sesion (id, data, expira) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), expira = VALUES(expira)',
      [sid, JSON.stringify(sess), MySqlSessionStore.expiry(sess)],
    ).then(() => {
      if (Math.random() < 0.02) this.db.run('DELETE FROM sf_sesion WHERE expira < ?', [Date.now()]).catch(() => {});
      cb();
    }, cb);
  }

  touch(sid, sess, cb = () => {}) {
    this.db.run('UPDATE sf_sesion SET expira = ? WHERE id = ?', [MySqlSessionStore.expiry(sess), sid])
      .then(() => cb(), cb);
  }

  destroy(sid, cb = () => {}) {
    this.db.run('DELETE FROM sf_sesion WHERE id = ?', [sid]).then(() => cb(), cb);
  }
}
