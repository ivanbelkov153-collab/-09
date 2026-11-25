const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const { randomBytes, randomInt, timingSafeEqual } = require("node:crypto");
const fsSync = require("node:fs");
const path = require("node:path");
const pool = require("./db");
const app = express();
const port = process.env.PORT || 3000;
app.disable("x-powered-by");
if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY);
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const sessionSecretFile = path.join(dataDir, "session-secret");
const baseAttractions = [
  { id: "roller-coaster", name: "Американские горки", category: "Экстремальные", height: 140, price: 350, time: "2 мин" },
  { id: "carousel", name: "Большая карусель", category: "Семейные", height: 90, price: 250, time: "5 мин" },
  { id: "drop-tower", name: "Башня падения", category: "Экстремальные", height: 140, price: 300, time: "1 мин" },
  { id: "ferris-wheel", name: "Колесо обозрения", category: "Семейные", height: 100, price: 200, time: "12 мин" },
  { id: "magic-garden", name: "Волшебный сад", category: "Детские", height: 0, price: 150, time: "10 мин" },
  { id: "autodrome", name: "Автодром", category: "Семейные", height: 110, price: 250, time: "7 мин" }
];
const baseAttractionIds = new Set(baseAttractions.map((item) => item.id));
const attractionCategories = new Set(["Экстремальные", "Семейные", "Детские"]);
const attractionIdPattern = /^[a-z0-9а-яё-]{1,100}$/i;
const ticketCodePattern = /^NP-\d{6}$/;
const popcornCodePattern = /^NP-P-[A-F0-9]{12}$/;
const wheelPrizes = [
  { code: "discount10", label: "Скидка 10%", message: "Скидка 10% применится к следующей брони.", discount: 10 },
  { code: "discount25", label: "Скидка 25%", message: "Скидка 25% применится к следующей брони.", discount: 25 },
  { code: "discount20", label: "Скидка 20%", message: "Скидка 20% применится к следующей брони.", discount: 20 },
  { code: "discount25", label: "Скидка 25%", message: "Скидка 25% применится к следующей брони.", discount: 25 },
  { code: "again", label: "Ещё одно вращение", message: "Можно прокрутить колесо ещё раз." }
];
const legacyWheelPrizes = [
  { code: "popcorn", label: "Попкорн в подарок", message: "QR-код для получения попкорна доступен в профиле." },
  { code: "surprise", label: "Сюрприз на входе", message: "Сюрприз будет указан в следующем билете." },
  { code: "points100", label: "100 бонусных баллов", message: "100 баллов начислены в профиль." }
];
function isValidName(name) {
  return name.length >= 2 && name.length <= 100;
}

function findWheelPrize(code) {
  return wheelPrizes.find((item) => item.code === code)
    || legacyWheelPrizes.find((item) => item.code === code);
}

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  fsSync.mkdirSync(dataDir, { recursive: true });
  try {
    return fsSync.readFileSync(sessionSecretFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const secret = randomBytes(32).toString("hex");
    try {
      fsSync.writeFileSync(sessionSecretFile, secret, { encoding: "utf8", flag: "wx", mode: 0o600 });
      return secret;
    } catch (writeError) {
      if (writeError.code !== "EEXIST") throw writeError;
      return fsSync.readFileSync(sessionSecretFile, "utf8");
    }
  }
}

class PostgresSessionStore extends session.Store {
  constructor(database) {
    super();
    this.database = database;
  }

  get(sessionId, callback) {
    this.database.query(
      "SELECT sess, expire FROM sessions WHERE sid = $1",
      [sessionId],
      (queryError, result) => {
        if (queryError) return callback(queryError);
        if (!result.rowCount) return callback(null, null);

        try {
          let stored = result.rows[0].sess;
          if (typeof stored === "string") stored = JSON.parse(stored);
          if (!stored || typeof stored !== "object" || !stored.cookie) {
            throw new Error("Некорректная сессия в PostgreSQL.");
          }
          const expiryValue = stored.cookie.expires || result.rows[0].expire;
          const expires = expiryValue ? new Date(expiryValue) : null;
          if (expires && !Number.isFinite(expires.getTime())) {
            throw new Error("Некорректный срок действия сессии в PostgreSQL.");
          }
          if (expires && expires.getTime() <= Date.now()) {
            return this.destroy(sessionId, (error) => callback(error, null));
          }
          callback(null, stored);
        } catch (error) {
          callback(error);
        }
      }
    );
  }

  set(sessionId, stored, callback) {
    const expires = stored.cookie && stored.cookie.expires
      ? new Date(stored.cookie.expires)
      : new Date(Date.now() + (stored.cookie && stored.cookie.originalMaxAge || 365 * 24 * 60 * 60 * 1000));
    this.database.query(
      `INSERT INTO sessions (sid, sess, expire)
       VALUES ($1, $2, $3)
       ON CONFLICT (sid) DO UPDATE
       SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
      [sessionId, JSON.stringify(stored), expires],
      callback
    );
  }

  touch(sessionId, stored, callback) {
    this.set(sessionId, stored, callback);
  }

  destroy(sessionId, callback) {
    this.database.query("DELETE FROM sessions WHERE sid = $1", [sessionId], callback);
  }
}

app.use((req, res, next) => {
  res.set({
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'self'",
      "connect-src 'self'",
      "font-src 'self' data:",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data: https://unsplash.com https://images.unsplash.com https://moscow-sun.ru https://encrypted-tbn0.gstatic.com",
      "object-src 'none'",
      "script-src 'self' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline'"
    ].join("; "),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Origin-Agent-Cluster": "?1",
    "Permissions-Policy": "camera=(self), geolocation=(), microphone=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Download-Options": "noopen",
    "X-Content-Type-Options": "nosniff",
    "X-DNS-Prefetch-Control": "off",
    "X-Frame-Options": "DENY",
    "X-Permitted-Cross-Domain-Policies": "none",
    "X-XSS-Protection": "0"
  });
  if (process.env.NODE_ENV === "production" && req.secure) {
    res.set("Strict-Transport-Security", "max-age=15552000");
  }
  next();
});

app.use(express.json({ limit: "10kb" }));
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.get(["/", "/index.html"], (req, res) => {
  res.redirect("/html/index.html");
});

const sessionMiddleware = session({
  name: "nova.sid",
  store: new PostgresSessionStore(pool),
  secret: getSessionSecret(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: 365 * 24 * 60 * 60 * 1000
  }
});

app.get("/html/admin.html", sessionMiddleware, requireAdmin, (req, res) => {
  res.sendFile(path.join(publicDir, "html", "admin.html"));
});
app.use(express.static(publicDir));
app.use(sessionMiddleware);
app.use("/api", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const expected = req.session && req.session.csrfToken;
  const provided = req.get("X-CSRF-Token");
  if (typeof expected !== "string" || typeof provided !== "string") {
    return res.status(403).json({ error: "Запрос отклонён: отсутствует CSRF-токен. Обнови страницу и попробуй снова." });
  }
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
    return res.status(403).json({ error: "Запрос отклонён: CSRF-токен недействителен. Обнови страницу и попробуй снова." });
  }
  next();
});
app.get("/api/csrf", (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString("hex");
  res.set("X-CSRF-Token", req.session.csrfToken).json({ csrfToken: req.session.csrfToken });
});

function validateAttractionSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)
    || !settings.overrides || typeof settings.overrides !== "object" || Array.isArray(settings.overrides)
    || !Array.isArray(settings.extras)) {
    throw new Error("В базе данных повреждены настройки аттракционов.");
  }
  return settings;
}

async function loadAttractionSettings(queryable = pool) {
  const result = await queryable.query("SELECT settings FROM attraction_settings WHERE id = 1");
  if (!result.rowCount) throw new Error("Настройки аттракционов не найдены.");
  return validateAttractionSettings(result.rows[0].settings);
}

function isValidMapPosition(position) {
  return Boolean(position) && typeof position === "object" && !Array.isArray(position)
    && Number.isFinite(position.left) && position.left >= 5 && position.left <= 95
    && Number.isFinite(position.top) && position.top >= 5 && position.top <= 95;
}

function getServerAttractions(settings) {
  return [
    ...baseAttractions.map((item) => ({ ...item, ...(settings.overrides[item.id] || {}) })),
    ...settings.extras
  ];
}

async function syncAttractionRows(queryable, settings, previousNames = []) {
  const attractions = getServerAttractions(settings);
  const currentNames = new Set(attractions.map((item) => item.name));
  for (const attraction of attractions) {
    const updated = await queryable.query(
      "UPDATE attractions SET category = $2, price = $3 WHERE name = $1 RETURNING id",
      [attraction.name, attraction.category, attraction.price]
    );
    if (!updated.rowCount) {
      await queryable.query(
        "INSERT INTO attractions (name, category, price) VALUES ($1, $2, $3)",
        [attraction.name, attraction.category, attraction.price]
      );
    }
  }
  for (const name of previousNames) {
    if (!currentNames.has(name)) {
      await queryable.query("DELETE FROM attractions WHERE name = $1", [name]);
    }
  }
}

async function withTransaction(work, rollbackMessage) {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const result = await work(client);
    await client.query("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(rollbackMessage, rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

async function updateAttractionSettings(change) {
  return withTransaction(async (client) => {
    const result = await client.query(
      "SELECT settings FROM attraction_settings WHERE id = 1 FOR UPDATE"
    );
    if (!result.rowCount) throw new Error("Настройки аттракционов не найдены.");
    const settings = validateAttractionSettings(result.rows[0].settings);
    const previousNames = getServerAttractions(settings).map((item) => item.name);
    const outcome = change(settings) || {};
    if (outcome.error) return outcome;
    await client.query(
      "UPDATE attraction_settings SET settings = $1::jsonb WHERE id = 1",
      [JSON.stringify(settings)]
    );
    await syncAttractionRows(client, settings, previousNames);
    return { ...outcome, settings };
  }, "Не удалось отменить изменение аттракционов:");
}

const bookingQuery = `
  SELECT
    t.ticket_code AS id,
    b.visit_date::text AS date,
    b.visit_time::text AS time,
    b.adult_tickets AS adult,
    b.child_tickets AS child,
    b.total_price AS total,
    b.attractions,
    b.reward_code AS reward,
    b.discount_amount AS discount,
    t.status,
    COALESCE(NULLIF(b.buyer_email, ''), u.email, '') AS email,
    COALESCE(NULLIF(b.buyer_name, ''), u.name, '') AS name
  FROM bookings b
  JOIN tickets t ON t.booking_id = b.id
  LEFT JOIN users u ON u.id = b.user_id
`;

async function findBookingByTicket(ticketCode) {
  const result = await pool.query(`${bookingQuery} WHERE t.ticket_code = $1`, [ticketCode]);
  return result.rows[0] || null;
}

function wheelStatus(row, isAdmin = false) {
  const spinsUsed = row ? Number(row.spins_used) : 0;
  const rewardCode = row ? row.reward_code : null;
  const prize = findWheelPrize(rewardCode) || null;
  return {
    canSpin: isAdmin || spinsUsed === 0 || (spinsUsed === 1 && rewardCode === "again"),
    unlimited: isAdmin,
    spinsUsed,
    reward: prize ? {
      ...prize,
      used: Boolean(row.reward_used),
      qrCode: rewardCode === "popcorn" ? row.reward_qr_code || null : null
    } : null,
    points: row ? Number(row.points) || 0 : 0
  };
}

function makePopcornQrCode() {
  return `NP-P-${randomBytes(6).toString("hex").toUpperCase()}`;
}

async function createBooking(user, buyerEmail, selectedDate, selectedTime, adult, child, attractions) {
  const guestCount = adult + child;
  const subtotal = attractions.reduce((sum, item) => sum + item.price, 0) * guestCount;
  return withTransaction(async (client) => {
    const rewardResult = await client.query(
      "SELECT reward_code, reward_used FROM wheel_spins WHERE user_id = $1 FOR UPDATE",
      [user.id]
    );
    const savedReward = rewardResult.rows[0];
    const reward = savedReward && !savedReward.reward_used && savedReward.reward_code !== "popcorn"
      ? findWheelPrize(savedReward.reward_code)
      : null;
    const discount = reward && reward.discount ? Math.round(subtotal * reward.discount / 100) : 0;
    const total = subtotal - discount;
    const rewardCode = reward ? reward.code : null;

    if (reward) {
      await client.query(
        "UPDATE wheel_spins SET reward_used = true WHERE user_id = $1",
        [user.id]
      );
    }

    const savedBooking = await client.query(
      `INSERT INTO bookings
        (user_id, visit_date, visit_time, adult_tickets, child_tickets, total_price, buyer_name, buyer_email, attractions, reward_code, discount_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
       RETURNING id`,
      [
        user.id, selectedDate, selectedTime, adult, child, total, user.name, buyerEmail,
        JSON.stringify(attractions), rewardCode, discount
      ]
    );

    await client.query(
      `INSERT INTO payments (booking_id, amount, status)
       VALUES ($1, $2, $3)`,
      [savedBooking.rows[0].id, total, "demo"]
    );

    let ticketCode = "";
    let ticketSaved = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      ticketCode = `NP-${randomInt(100000, 1000000)}`;
      const ticket = await client.query(
        `INSERT INTO tickets (booking_id, ticket_code, status)
         VALUES ($1, $2, $3)
         ON CONFLICT (ticket_code) DO NOTHING
         RETURNING id`,
        [savedBooking.rows[0].id, ticketCode, "Активен"]
      );
      if (ticket.rowCount) {
        ticketSaved = true;
        break;
      }
    }
    if (!ticketSaved) throw new Error("Не удалось сгенерировать уникальный номер билета.");

    return {
      id: ticketCode,
      date: selectedDate,
      time: selectedTime,
      adult,
      child,
      attractions,
      reward: rewardCode,
      discount,
      total,
      status: "Активен",
      email: buyerEmail,
      name: user.name
    };
  }, "Не удалось отменить создание бронирования:");
}

function startSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
      req.session.csrfToken = randomBytes(32).toString("hex");
      req.session.save((saveError) => saveError ? reject(saveError) : resolve());
    });
  });
}

function requireAdmin(req, res, next) {
  if (req.path === "/html/admin.html") res.set("Cache-Control", "no-store");
  if (!req.session.user) {
    if (req.path === "/html/admin.html") return res.redirect("/html/auth.html");
    return res.status(401).json({ error: "Сначала войдите в аккаунт." });
  }
  pool.query("SELECT role FROM users WHERE id = $1", [req.session.user.id])
    .then((result) => {
      if (!result.rowCount || result.rows[0].role !== "admin") {
        if (req.path === "/html/admin.html") {
          return res.status(403).type("text/plain").send("Доступ запрещён. Нужна роль администратора.");
        }
        return res.status(403).json({ error: "Недостаточно прав для этой операции." });
      }
      next();
    })
    .catch(next);
}

function isConfiguredAdmin(email) {
  const configuredEmail = process.env.ADMIN_EMAIL;
  return typeof configuredEmail === "string" && configuredEmail.trim().toLowerCase() === email;
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Сначала войдите в аккаунт." });
  }
  next();
}

const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve().then(() => handler(req, res, next)).catch(next);

app.post("/api/register", asyncRoute(async (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";

  if (!isValidName(name)) {
    return res.status(400).json({ error: "Имя должно содержать не менее двух символов." });
  }
  if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Укажи корректный email." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Пароль должен содержать не менее 6 символов." });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (name, email, password, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, name, email, role`,
    [name, email, passwordHash, isConfiguredAdmin(email) ? "admin" : "user"]
  );
  if (!result.rowCount) {
    return res.status(409).json({ error: "Аккаунт с таким email уже существует." });
  }
  const user = result.rows[0];
  await startSession(req, user);
  res.set("X-CSRF-Token", req.session.csrfToken);
  res.status(201).json({ user: { name: user.name, email: user.email, role: user.role } });
}));

app.post("/api/login", asyncRoute(async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const result = await pool.query(
    "SELECT id, name, email, password, role FROM users WHERE email = $1",
    [email]
  );
  const user = result.rows[0];

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "Неверный email или пароль." });
  }

  await startSession(req, user);
  res.set("X-CSRF-Token", req.session.csrfToken);
  res.json({ user: { name: user.name, email: user.email, role: user.role } });
}));

app.get("/api/me", asyncRoute(async (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  const result = await pool.query(
    "SELECT id, name, email, role FROM users WHERE id = $1",
    [req.session.user.id]
  );
  if (!result.rowCount) return res.json({ user: null });
  req.session.user = result.rows[0];
  res.json({ user: req.session.user });
}));

app.get("/api/attractions", asyncRoute(async (req, res) => {
  res.json({ settings: await loadAttractionSettings() });
}));

app.post("/api/admin/attractions", requireAdmin, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const id = typeof body.id === "string" ? body.id : "";
  const category = typeof body.category === "string" ? body.category : "";
  const height = body.height;
  if (!isValidName(name)
    || !/^[a-z0-9а-яё]+(?:-[a-z0-9а-яё]+)*$/i.test(id) || id.length > 100
    || !attractionCategories.has(category)
    || !Number.isInteger(height) || height < 0 || height > 220) {
    return res.status(400).json({ error: "Проверь название, категорию и минимальный рост аттракциона." });
  }

  const attraction = { id, name, category, height, price: 250, time: "5 мин", image: "" };
  const result = await updateAttractionSettings((settings) => {
    const duplicateId = baseAttractionIds.has(id) || settings.extras.some((item) => item.id === id);
    const duplicateName = [...baseAttractions, ...settings.extras]
      .some((item) => item.name.toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru"));
    if (duplicateId || duplicateName) {
      return { error: "Аттракцион с таким названием уже есть.", status: 409 };
    }
    settings.extras.push(attraction);
    return { attraction };
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(201).json({ attraction: result.attraction, settings: result.settings });
}));

app.post("/api/admin/attractions/swap", requireAdmin, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const { firstId, secondId, firstPosition, secondPosition } = body;
  if (typeof firstId !== "string" || !attractionIdPattern.test(firstId)
    || typeof secondId !== "string" || !attractionIdPattern.test(secondId)
    || firstId === secondId
    || !isValidMapPosition(firstPosition) || !isValidMapPosition(secondPosition)) {
    return res.status(400).json({ error: "Невозможно поменять аттракционы местами: проверь данные." });
  }

  const result = await updateAttractionSettings((settings) => {
    const firstExtra = settings.extras.find((item) => item.id === firstId);
    const secondExtra = settings.extras.find((item) => item.id === secondId);
    const firstExists = baseAttractionIds.has(firstId) || Boolean(firstExtra);
    const secondExists = baseAttractionIds.has(secondId) || Boolean(secondExtra);
    if (!firstExists || !secondExists) {
      return { error: "Один из аттракционов больше не найден.", status: 404 };
    }

    if (firstExtra) firstExtra.mapPosition = secondPosition;
    else settings.overrides[firstId] = { ...(settings.overrides[firstId] || {}), mapPosition: secondPosition };
    if (secondExtra) secondExtra.mapPosition = firstPosition;
    else settings.overrides[secondId] = { ...(settings.overrides[secondId] || {}), mapPosition: firstPosition };
    return {};
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ settings: result.settings });
}));

app.patch("/api/admin/attractions/:id", requireAdmin, asyncRoute(async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const hasHeight = Object.prototype.hasOwnProperty.call(body, "height");
  const hasMapPosition = Object.prototype.hasOwnProperty.call(body, "mapPosition");
  if (!attractionIdPattern.test(id)
    || (!hasHeight && !hasMapPosition)
    || (hasHeight && (!Number.isInteger(body.height) || body.height < 0 || body.height > 220))
    || (hasMapPosition && !isValidMapPosition(body.mapPosition))) {
    return res.status(400).json({ error: "Данные аттракциона указаны некорректно." });
  }

  const result = await updateAttractionSettings((settings) => {
    const extra = settings.extras.find((item) => item.id === id);
    if (extra) {
      if (hasHeight) extra.height = body.height;
      if (hasMapPosition) extra.mapPosition = body.mapPosition;
      return { attraction: extra };
    }
    if (!baseAttractionIds.has(id)) return { error: "Аттракцион не найден.", status: 404 };
    settings.overrides[id] = { ...(settings.overrides[id] || {}) };
    if (hasHeight) settings.overrides[id].height = body.height;
    if (hasMapPosition) settings.overrides[id].mapPosition = body.mapPosition;
    return { attraction: { ...baseAttractions.find((item) => item.id === id), ...settings.overrides[id] } };
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ attraction: result.attraction, settings: result.settings });
}));

app.delete("/api/admin/attractions/:id", requireAdmin, asyncRoute(async (req, res) => {
  const { id } = req.params;
  if (!attractionIdPattern.test(id)) {
    return res.status(400).json({ error: "Некорректный идентификатор аттракциона." });
  }
  const result = await updateAttractionSettings((settings) => {
    const index = settings.extras.findIndex((item) => item.id === id);
    if (index < 0) return { error: "Добавленный аттракцион не найден.", status: 404 };
    settings.extras.splice(index, 1);
    return {};
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ settings: result.settings });
}));

app.get("/api/wheel/status", requireLogin, asyncRoute(async (req, res) => {
  const userResult = await pool.query("SELECT role FROM users WHERE id = $1", [req.session.user.id]);
  if (!userResult.rowCount) return res.status(401).json({ error: "Аккаунт не найден. Войдите снова." });
  const isAdmin = userResult.rows[0].role === "admin";
  let result = await pool.query(
    "SELECT spins_used, reward_code, reward_used, reward_qr_code, points FROM wheel_spins WHERE user_id = $1",
    [req.session.user.id]
  );
  const row = result.rows[0];
  if (row && row.reward_code === "popcorn" && !row.reward_used && !row.reward_qr_code) {
    await pool.query(
      `UPDATE wheel_spins
         SET reward_qr_code = $2
         WHERE user_id = $1 AND reward_code = 'popcorn' AND reward_used = false AND reward_qr_code IS NULL`,
      [req.session.user.id, makePopcornQrCode()]
    );
    result = await pool.query(
      "SELECT spins_used, reward_code, reward_used, reward_qr_code, points FROM wheel_spins WHERE user_id = $1",
      [req.session.user.id]
    );
  }
  res.json(wheelStatus(result.rows[0], isAdmin));
}));

app.post("/api/wheel/spin", requireLogin, asyncRoute(async (req, res) => {
  const outcome = await withTransaction(async (client) => {
    await client.query(
      "INSERT INTO wheel_spins (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
      [req.session.user.id]
    );
    const result = await client.query(
      "SELECT spins_used, reward_code, reward_used, reward_qr_code, points FROM wheel_spins WHERE user_id = $1 FOR UPDATE",
      [req.session.user.id]
    );
    const current = result.rows[0];
    const userResult = await client.query("SELECT role FROM users WHERE id = $1", [req.session.user.id]);
    if (!userResult.rowCount) return {
      responseStatus: 401,
      body: { error: "Аккаунт не найден. Войдите снова." }
    };
    const isAdmin = userResult.rows[0].role === "admin";
    const spinsUsed = Number(current.spins_used);
    if (!Number.isInteger(spinsUsed) || spinsUsed < 0
      || (!isAdmin && (spinsUsed >= 2 || !wheelStatus(current).canSpin))) return {
        responseStatus: 409,
        body: { error: "Ты уже использовал вращение.", status: wheelStatus(current, isAdmin) }
      };

    const prizeIndex = randomInt(0, wheelPrizes.length);
    const prize = wheelPrizes[prizeIndex];
    const points = Number(current.points) + (prize.code === "points100" ? 100 : 0);
    const rewardUsed = prize.code === "again" || prize.code === "points100";
    const rewardQrCode = prize.code === "popcorn" ? makePopcornQrCode() : null;
    const updated = {
      spins_used: Number(current.spins_used) + 1,
      reward_code: prize.code,
      reward_used: rewardUsed,
      reward_qr_code: rewardQrCode,
      points
    };
    await client.query(
      `UPDATE wheel_spins
       SET spins_used = $2, reward_code = $3, reward_used = $4, reward_qr_code = $5, points = $6
       WHERE user_id = $1`,
      [req.session.user.id, updated.spins_used, prize.code, rewardUsed, rewardQrCode, points]
    );
    return {
      responseStatus: 200,
      body: { prizeIndex, prize, status: wheelStatus(updated, isAdmin) }
    };
  }, "Не удалось отменить вращение колеса:");
  if (outcome.responseStatus !== 200) {
    return res.status(outcome.responseStatus).json(outcome.body);
  }
  res.json(outcome.body);
}));

app.get("/api/bookings/me", requireLogin, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `${bookingQuery} WHERE b.user_id = $1 ORDER BY b.id DESC`,
    [req.session.user.id]
  );
  res.json({ bookings: result.rows });
}));

app.post("/api/bookings", requireLogin, asyncRoute(async (req, res) => {
  const { selectedDate, selectedTime, buyerEmail, adult, child, attractions } = req.body || {};
  const email = typeof buyerEmail === "string" ? buyerEmail.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Укажи корректный email для брони." });
  }
  if (typeof selectedDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
    return res.status(400).json({ error: "Укажи корректную дату посещения." });
  }
  if (typeof selectedTime !== "string" || !/^([1][0-9]|2[01]):00$/.test(selectedTime)) {
    return res.status(400).json({ error: "Выбери время посещения с 10:00 до 21:00." });
  }
  const [year, month, day] = selectedDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date < today) {
    return res.status(400).json({ error: "Дата посещения недействительна или уже прошла." });
  }
  if (!Number.isInteger(adult) || adult < 0 || adult > 10
    || !Number.isInteger(child) || child < 0 || child > 10 || adult + child === 0) {
    return res.status(400).json({ error: "Выбери от 0 до 10 гостей каждого типа и хотя бы одного гостя." });
  }
  if (!Array.isArray(attractions) || attractions.length === 0 || attractions.length > 12) {
    return res.status(400).json({ error: "Выбери от 1 до 12 аттракционов." });
  }
  const attractionSettings = await loadAttractionSettings();
  const availableAttractions = new Map(
    getServerAttractions(attractionSettings).map((item) => [item.id, item])
  );
  const selectedAttractions = [];
  const attractionIds = new Set();
  for (const attraction of attractions) {
    if (!attraction || typeof attraction !== "object"
      || typeof attraction.id !== "string" || attraction.id.length > 100
      || attractionIds.has(attraction.id)) {
      return res.status(400).json({ error: "Данные аттракционов указаны некорректно." });
    }
    const savedAttraction = availableAttractions.get(attraction.id);
    if (!savedAttraction) {
      return res.status(400).json({ error: "Выбранный аттракцион больше недоступен. Обнови страницу." });
    }
    attractionIds.add(attraction.id);
    selectedAttractions.push({
      id: savedAttraction.id,
      name: savedAttraction.name,
      price: savedAttraction.price
    });
  }

  const booking = await createBooking(
    req.session.user, email, selectedDate, selectedTime, adult, child, selectedAttractions
  );
  res.status(201).json({ booking });
}));

app.get("/api/admin/bookings", requireAdmin, asyncRoute(async (req, res) => {
  const result = await pool.query(`${bookingQuery} ORDER BY b.id DESC`);
  res.json({ bookings: result.rows });
}));

app.get("/api/tickets/:id", requireAdmin, asyncRoute(async (req, res) => {
  if (!ticketCodePattern.test(req.params.id)) {
    return res.status(400).json({ error: "Некорректный номер билета." });
  }
  const booking = await findBookingByTicket(req.params.id);
  if (!booking) return res.status(404).json({ error: "Билет не найден." });
  res.json({ booking });
}));

app.patch("/api/tickets/:id/use", requireAdmin, asyncRoute(async (req, res) => {
  if (!ticketCodePattern.test(req.params.id)) {
    return res.status(400).json({ error: "Некорректный номер билета." });
  }
  const updated = await pool.query(
    `UPDATE tickets
       SET status = 'Использован'
       WHERE ticket_code = $1 AND status = 'Активен'
       RETURNING id`,
    [req.params.id]
  );
  if (!updated.rowCount) {
    const ticket = await pool.query(
      "SELECT status FROM tickets WHERE ticket_code = $1",
      [req.params.id]
    );
    if (!ticket.rowCount) return res.status(404).json({ error: "Билет не найден." });
    return res.status(409).json({ error: "Билет уже использован или недействителен." });
  }
  const booking = await findBookingByTicket(req.params.id);
  res.json({ booking });
}));

app.get("/api/wheel/rewards/:code", requireAdmin, asyncRoute(async (req, res) => {
  if (!popcornCodePattern.test(req.params.code)) {
    return res.status(400).json({ error: "Некорректный QR-код приза." });
  }
  const result = await pool.query(
    "SELECT reward_code, reward_used FROM wheel_spins WHERE reward_qr_code = $1",
    [req.params.code]
  );
  const reward = result.rows[0];
  if (!reward || reward.reward_code !== "popcorn") {
    return res.status(404).json({ error: "Приз не найден." });
  }
  res.json({
    reward: {
      code: reward.reward_code,
      label: "Попкорн в подарок",
      used: Boolean(reward.reward_used)
    }
  });
}));

app.post("/api/wheel/rewards/:code/redeem", requireAdmin, asyncRoute(async (req, res) => {
  if (!popcornCodePattern.test(req.params.code)) {
    return res.status(400).json({ error: "Некорректный QR-код приза." });
  }
  const redeemed = await pool.query(
    `UPDATE wheel_spins
       SET reward_used = true
       WHERE reward_qr_code = $1 AND reward_code = 'popcorn' AND reward_used = false
       RETURNING reward_code`,
    [req.params.code]
  );
  if (!redeemed.rowCount) {
    const current = await pool.query(
      "SELECT reward_code, reward_used FROM wheel_spins WHERE reward_qr_code = $1",
      [req.params.code]
    );
    if (!current.rowCount || current.rows[0].reward_code !== "popcorn") {
      return res.status(404).json({ error: "Приз не найден." });
    }
    return res.status(409).json({ error: "Попкорн по этому QR-коду уже выдан." });
  }
  res.json({ reward: { code: "popcorn", label: "Попкорн в подарок", used: true } });
}));

app.patch("/api/profile", requireLogin, asyncRoute(async (req, res, next) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  if (!isValidName(name)) {
    return res.status(400).json({ error: "Имя должно содержать не менее двух символов." });
  }

  const result = await pool.query(
    "UPDATE users SET name = $1 WHERE id = $2 RETURNING name, email",
    [name, req.session.user.id]
  );
  const user = result.rows[0];
  if (!user) {
    return req.session.destroy((error) => {
      if (error) return next(error);
      res.status(401).json({ error: "Аккаунт не найден. Войдите снова." });
    });
  }

  req.session.user.name = name;
  res.json({ user: { name: user.name, email: user.email } });
}));

app.post("/api/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("nova.sid", { httpOnly: true, sameSite: "lax" });
    res.json({ ok: true });
  });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: "Ошибка сервера. Попробуй ещё раз." });
});

pool.on("error", (error) => {
  console.error("Ошибка подключения к PostgreSQL:", error);
});

async function startServer() {
  await pool.query("SELECT 1");
  const adminEmail = typeof process.env.ADMIN_EMAIL === "string"
    ? process.env.ADMIN_EMAIL.trim().toLowerCase()
    : "";
  if (adminEmail) {
    await pool.query("UPDATE users SET role = 'admin' WHERE email = $1", [adminEmail]);
  }
  await pool.query(
    `INSERT INTO admins (login, password)
     SELECT u.email, u.password
     FROM users u
     WHERE u.role = 'admin'
       AND NOT EXISTS (
         SELECT 1 FROM admins a WHERE a.login = u.email
       )`
  );
  await syncAttractionRows(pool, await loadAttractionSettings());
  await pool.query("DELETE FROM sessions WHERE expire <= NOW()");

  const cleanupTimer = setInterval(() => {
    pool.query("DELETE FROM sessions WHERE expire <= NOW()")
      .catch((error) => console.error("Не удалось удалить истёкшие сессии:", error));
  }, 24 * 60 * 60 * 1000);
  cleanupTimer.unref();

  app.listen(port, () => {
    console.log(`Nova Park: http://localhost:${port}`);
  });
}

startServer().catch((error) => {
  console.error("Не удалось запустить сервер с PostgreSQL:", error);
  pool.end().catch((closeError) => console.error("Не удалось закрыть соединение с PostgreSQL:", closeError));
  process.exitCode = 1;
});