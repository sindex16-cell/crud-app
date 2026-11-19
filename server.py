"""HSK 1 notes app. Python standard library only."""
import hashlib, hmac, json, os, re, secrets, sqlite3, threading, time
from contextlib import closing
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

BASE = os.path.dirname(os.path.realpath(__file__))
PUBLIC = os.path.join(BASE, "public")
DB_PATH = os.environ.get("CRUD_DB", os.path.join(BASE, "data", "crud.db"))
HOST = os.environ.get("CRUD_HOST", "127.0.0.1")
PORT = int(os.environ.get("CRUD_PORT", "8000"))
SESSION_SECONDS = 7 * 24 * 3600
MAX_BODY = 8192
MAX_DESC = 1000
HASH_SLOTS = threading.Semaphore(4)  # limit parallel scrypt work
TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".js": "application/javascript; charset=utf-8"}


def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    from hsk1 import HSK1
    with closing(db()) as con, con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS users(
          id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE,
          salt BLOB NOT NULL, hash BLOB NOT NULL, created INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(
          token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS characters(
          id INTEGER PRIMARY KEY, hanzi TEXT UNIQUE NOT NULL, pinyin TEXT NOT NULL, meaning TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS descriptions(
          id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          text TEXT NOT NULL, updated INTEGER NOT NULL, UNIQUE(user_id, character_id));
        """)
        con.executemany("INSERT OR IGNORE INTO characters(hanzi,pinyin,meaning) VALUES(?,?,?)", HSK1)


def hash_pw(password, salt):
    with HASH_SLOTS:
        return hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)


class Handler(BaseHTTPRequestHandler):
    server_version = "crud"
    sys_version = ""

    # ---- helpers ----
    def send_json(self, code, obj, extra=None):
        # Store the reply. api() sends it after the database commit.
        self._pending = (code, obj, extra)

    def write_json(self, code, obj, extra=None):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.hsts()
        for k, v in (extra or []):
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        if "application/json" not in self.headers.get("Content-Type", ""):
            raise ValueError("Content-Type must be application/json.")
        n = int(self.headers.get("Content-Length") or 0)
        if not 0 <= n <= MAX_BODY:
            raise ValueError("Request is too big.")
        data = json.loads(self.rfile.read(n) or b"{}")
        if not isinstance(data, dict):
            raise ValueError("Bad request.")
        return data

    @staticmethod
    def text(d, key):
        v = d.get(key, "")
        if not isinstance(v, str):
            raise ValueError(f"{key} must be text.")
        return v

    def current_user(self, con):
        c = cookies.SimpleCookie(self.headers.get("Cookie", ""))
        if "session" not in c:
            return None
        return con.execute(
            "SELECT u.id, u.username FROM sessions s JOIN users u ON u.id=s.user_id "
            "WHERE s.token=? AND s.expires>?", (token_hash(c["session"].value), int(time.time()))).fetchone()

    def is_https(self):
        # The server listens on 127.0.0.1 only, so only nginx can set this header.
        return self.headers.get("X-Forwarded-Proto") == "https" or os.environ.get("CRUD_SECURE_COOKIE") == "1"

    def session_cookie(self, token, age):
        secure = "; Secure" if self.is_https() else ""
        return [("Set-Cookie", f"session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}{secure}")]

    def hsts(self):
        if self.is_https():
            self.send_header("Strict-Transport-Security", "max-age=31536000")

    # ---- routing ----
    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            return self.api("GET", path)
        self.static(path)

    def do_POST(self):
        self.api("POST", urlparse(self.path).path)

    def do_PUT(self):
        self.api("PUT", urlparse(self.path).path)

    def do_DELETE(self):
        self.api("DELETE", urlparse(self.path).path)

    def static(self, path):
        if path == "/":
            path = "/index.html"
        full = os.path.realpath(os.path.join(PUBLIC, path.lstrip("/")))
        ext = os.path.splitext(full)[1]
        if not full.startswith(PUBLIC + os.sep) or ext not in TYPES or not os.path.isfile(full):
            return self.write_json(404, {"error": "Not found."})
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", TYPES[ext])
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.hsts()
        self.end_headers()
        self.wfile.write(body)

    def api(self, method, path):
        self._pending = None
        try:
            with closing(db()) as con, con:  # commit when the block ends
                self.route(con, method, path)
        except json.JSONDecodeError:
            self._pending = (400, {"error": "Bad JSON."}, None)
        except ValueError as e:
            self._pending = (400, {"error": str(e)}, None)
        except Exception:
            self._pending = (500, {"error": "Server error. Try again."}, None)
        code, obj, extra = self._pending or (500, {"error": "Server error."}, None)
        self.write_json(code, obj, extra)

    def route(self, con, method, path):
        if method == "POST" and path == "/api/register":
            d = self.read_json()
            name, pw = self.text(d, "username").strip(), self.text(d, "password")
            if not re.fullmatch(r"[A-Za-z0-9_]{3,20}", name):
                raise ValueError("Username: 3 to 20 letters, digits or underscore.")
            if not 8 <= len(pw) <= 200:
                raise ValueError("Password must have 8 or more characters.")
            salt = secrets.token_bytes(16)
            try:
                cur = con.execute("INSERT INTO users(username,salt,hash,created) VALUES(?,?,?,?)",
                                  (name, salt, hash_pw(pw, salt), int(time.time())))
            except sqlite3.IntegrityError:
                return self.send_json(409, {"error": "This username is taken."})
            return self.start_session(con, cur.lastrowid, name)

        if method == "POST" and path == "/api/login":
            d = self.read_json()
            name, pw = self.text(d, "username"), self.text(d, "password")
            row = con.execute("SELECT * FROM users WHERE username=?", (name,)).fetchone()
            salt = row["salt"] if row else b"\0" * 16
            ok = hmac.compare_digest(hash_pw(pw, salt), row["hash"] if row else b"\0" * 64)
            if not (row and ok):
                return self.send_json(401, {"error": "Wrong username or password."})
            return self.start_session(con, row["id"], row["username"])

        user = self.current_user(con)
        if method == "POST" and path == "/api/logout":
            c = cookies.SimpleCookie(self.headers.get("Cookie", ""))
            if "session" in c:
                con.execute("DELETE FROM sessions WHERE token=?", (token_hash(c["session"].value),))
            return self.send_json(200, {"ok": True}, self.session_cookie("", 0))
        if not user:
            return self.send_json(401, {"error": "Log in first."})

        if method == "GET" and path == "/api/me":
            return self.send_json(200, {"username": user["username"]})

        if method == "GET" and path == "/api/characters":
            rows = con.execute(
                "SELECT c.id, c.hanzi, c.pinyin, c.meaning, "
                "(SELECT COUNT(*) FROM descriptions d WHERE d.character_id=c.id) AS count, "
                "EXISTS(SELECT 1 FROM descriptions d WHERE d.character_id=c.id AND d.user_id=?) AS mine "
                "FROM characters c ORDER BY c.id", (user["id"],)).fetchall()
            return self.send_json(200, [dict(r) for r in rows])

        m = re.fullmatch(r"/api/characters/(\d+)/descriptions", path)
        if m and method == "GET":
            rows = con.execute(
                "SELECT u.username, d.text, d.updated FROM descriptions d JOIN users u ON u.id=d.user_id "
                "WHERE d.character_id=? ORDER BY d.updated DESC", (int(m[1]),)).fetchall()
            return self.send_json(200, [dict(r, mine=r["username"] == user["username"]) for r in rows])

        m = re.fullmatch(r"/api/characters/(\d+)/description", path)
        if m:
            cid = int(m[1])
            if not con.execute("SELECT 1 FROM characters WHERE id=?", (cid,)).fetchone():
                return self.send_json(404, {"error": "Character not found."})
            if method == "PUT":
                text = self.text(self.read_json(), "text").strip()
                if not text or len(text) > MAX_DESC:
                    raise ValueError(f"Description must have 1 to {MAX_DESC} characters.")
                con.execute(
                    "INSERT INTO descriptions(user_id,character_id,text,updated) VALUES(?,?,?,?) "
                    "ON CONFLICT(user_id,character_id) DO UPDATE SET text=excluded.text, updated=excluded.updated",
                    (user["id"], cid, text, int(time.time())))
                return self.send_json(200, {"ok": True})
            if method == "DELETE":
                con.execute("DELETE FROM descriptions WHERE user_id=? AND character_id=?", (user["id"], cid))
                return self.send_json(200, {"ok": True})
        self.send_json(404, {"error": "Not found."})

    def start_session(self, con, user_id, name):
        token = secrets.token_urlsafe(32)
        con.execute("DELETE FROM sessions WHERE expires<?", (int(time.time()),))
        con.execute("INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)",
                    (token_hash(token), user_id, int(time.time()) + SESSION_SECONDS))
        self.send_json(200, {"username": name}, self.session_cookie(token, SESSION_SECONDS))

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    init_db()
    print(f"Listening on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
