window.NovaPark = (() => {
  const keys = {
    bookings: "novaParkBookings",
    email: "novaParkCurrentEmail",
    name: "novaParkCurrentName",
    attractions: "novaParkExtraAttractions",
    overrides: "novaParkAttractionOverrides",
    cart: "novaParkCart",
    cartGuests: "novaParkCartGuests",
    defaultGuests: "novaParkDefaultGuests"
  };
  const rewardLabels = {
    discount10: "Скидка 10%",
    discount25: "Скидка 25%",
    popcorn: "Попкорн в подарок",
    discount20: "Скидка 20%",
    surprise: "Сюрприз на входе",
    points100: "100 бонусных баллов",
    again: "Дополнительное вращение"
  };
  const attractions = [
    { id: "roller-coaster", name: "Американские горки", category: "Экстремальные", height: 140, price: 350, time: "2 мин" },
    { id: "carousel", name: "Большая карусель", category: "Семейные", height: 90, price: 250, time: "5 мин" },
    { id: "drop-tower", name: "Башня падения", category: "Экстремальные", height: 140, price: 300, time: "1 мин" },
    { id: "ferris-wheel", name: "Колесо обозрения", category: "Семейные", height: 100, price: 200, time: "12 мин" },
    { id: "magic-garden", name: "Волшебный сад", category: "Детские", height: 0, price: 150, time: "10 мин" },
    { id: "autodrome", name: "Автодром", category: "Семейные", height: 110, price: 250, time: "7 мин" }
  ];
  const imageTemplate = document.querySelector("#attraction-image-sources");
  const attractionImages = new Map(
    imageTemplate
      ? Array.from(imageTemplate.content.querySelectorAll("img[data-attraction-name]"), (image) => [
        image.dataset.attractionName,
        image.getAttribute("src")
      ])
      : []
  );
  const fallbackImages = new Map([
    ["Американские горки", "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRGABAwS0ufJXAPXk1ZATOAM-xJrTc2cSB9Zh-8kofPFQ&s=10"],
    ["Большая карусель", "https://moscow-sun.ru/upload/iblock/103/qzd5iu9j8vyribo5q8s1jghfyoshqd75.jpg"],
    ["Башня падения", "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTJgfFJzV2ytOoG0HX9LblXHTg2E606kIdlKENsUyduKbEdWXc6hhCrhRdf&s=10"],
    ["Колесо обозрения", "https://moscow-sun.ru/upload/iblock/103/qzd5iu9j8vyribo5q8s1jghfyoshqd75.jpg"],
    ["Волшебный сад", "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTJgfFJzV2ytOoG0HX9LblXHTg2E606kIdlKENsUyduKbEdWXc6hhCrhRdf&s=10"],
    ["Автодром", "https://moscow-sun.ru/upload/iblock/103/qzd5iu9j8vyribo5q8s1jghfyoshqd75.jpg"]
  ]);
  let attractionSettings = { overrides: {}, extras: [] };
  let attractionSettingsPromise = null;
  let attractionSettingsRevision = 0;
  let csrfToken = "";
  let csrfTokenPromise = null;
  let currentRole = "user";
  async function getCsrfToken() {
    if (csrfToken) return csrfToken;
    if (!csrfTokenPromise) {
      csrfTokenPromise = fetch("/api/csrf", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      }).then(async (response) => {
        const result = await response.json();
        if (!response.ok || typeof result.csrfToken !== "string") {
          throw new Error(result.error || "Не удалось получить защитный токен.");
        }
        csrfToken = result.csrfToken;
        return csrfToken;
      }).finally(() => {
        csrfTokenPromise = null;
      });
    }
    return csrfTokenPromise;
  }
  async function csrfFetch(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return fetch(url, options);
    const headers = new Headers(options.headers || {});
    headers.set("X-CSRF-Token", await getCsrfToken());
    const response = await fetch(url, {
      ...options,
      method,
      headers,
      credentials: options.credentials || "same-origin"
    });
    const rotatedToken = response.headers.get("X-CSRF-Token");
    if (rotatedToken) csrfToken = rotatedToken;
    return response;
  }
  function read(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      console.error(`Не удалось прочитать данные ${key}:`, error);
      return fallback;
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error(`Не удалось сохранить данные ${key}:`, error);
      return false;
    }
  }
  function escape(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }
  function qrSvg(value) {
    const bytes = Array.from(new TextEncoder().encode(value));
    if (bytes.length > 17) throw new Error("Номер билета слишком длинный для QR-кода.");

    const bits = [];
    function appendBits(number, length) {
      for (let shift = length - 1; shift >= 0; shift -= 1) bits.push((number >>> shift) & 1);
    }
    appendBits(4, 4);
    appendBits(bytes.length, 8);
    bytes.forEach((byte) => appendBits(byte, 8));
    for (let i = 0; i < Math.min(4, 152 - bits.length); i += 1) bits.push(0);
    while (bits.length % 8) bits.push(0);

    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      data.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
    }
    for (let pad = 0; data.length < 19; pad += 1) data.push(pad % 2 ? 0x11 : 0xec);

    function multiply(a, b) {
      let product = 0;
      for (let i = 7; i >= 0; i -= 1) {
        product = (product << 1) ^ ((product >>> 7) * 0x11d);
        product ^= ((b >>> i) & 1) * a;
      }
      return product;
    }
    let generator = [1];
    for (let i = 0; i < 7; i += 1) {
      const next = new Array(generator.length + 1).fill(0);
      generator.forEach((coefficient, index) => {
        next[index] ^= coefficient;
        next[index + 1] ^= multiply(coefficient, 1 << i);
      });
      generator = next;
    }
    const remainder = [...data, ...new Array(7).fill(0)];
    for (let i = 0; i < data.length; i += 1) {
      const factor = remainder[i];
      generator.forEach((coefficient, index) => {
        remainder[i + index] ^= multiply(coefficient, factor);
      });
    }
    const codewords = [...data, ...remainder.slice(data.length)];
    const codeBits = codewords.flatMap((byte) => Array.from({ length: 8 }, (_, bit) => (byte >>> (7 - bit)) & 1));
    const size = 21;
    const matrix = Array.from({ length: size }, () => new Array(size).fill(false));
    const functionModules = Array.from({ length: size }, () => new Array(size).fill(false));
    function setFunction(x, y, dark) {
      matrix[y][x] = dark;
      functionModules[y][x] = true;
    }
    function drawFinder(left, top) {
      for (let dy = -1; dy <= 7; dy += 1) {
        for (let dx = -1; dx <= 7; dx += 1) {
          const x = left + dx;
          const y = top + dy;
          if (x < 0 || x >= size || y < 0 || y >= size) continue;
          const distance = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
          setFunction(x, y, dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 && distance !== 2);
        }
      }
    }
    for (let i = 8; i < size - 8; i += 1) {
      setFunction(i, 6, i % 2 === 0);
      setFunction(6, i, i % 2 === 0);
    }
    drawFinder(0, 0);
    drawFinder(size - 7, 0);
    drawFinder(0, size - 7);
    for (let i = 0; i <= 5; i += 1) setFunction(8, i, false);
    setFunction(8, 7, false);
    setFunction(8, 8, false);
    setFunction(7, 8, false);
    for (let i = 9; i < 15; i += 1) setFunction(14 - i, 8, false);
    for (let i = 0; i < 8; i += 1) setFunction(size - 1 - i, 8, false);
    for (let i = 8; i < 15; i += 1) setFunction(8, size - 15 + i, false);
    setFunction(8, size - 8, true);

    let bitIndex = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < size; vertical += 1) {
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        for (let offset = 0; offset < 2; offset += 1) {
          const x = right - offset;
          if (functionModules[y][x]) continue;
          const bit = bitIndex < codeBits.length ? codeBits[bitIndex] : 0;
          bitIndex += 1;
          matrix[y][x] = Boolean(bit ^ ((x + y) % 2 === 0 ? 1 : 0));
        }
      }
    }

    const formatData = 8;
    let format = formatData << 10;
    for (let bit = 14; bit >= 10; bit -= 1) {
      if ((format >>> bit) & 1) format ^= 0x537 << (bit - 10);
    }
    format = ((formatData << 10) | format) ^ 0x5412;
    for (let i = 0; i <= 5; i += 1) matrix[i][8] = Boolean((format >>> i) & 1);
    matrix[7][8] = Boolean((format >>> 6) & 1);
    matrix[8][8] = Boolean((format >>> 7) & 1);
    matrix[8][7] = Boolean((format >>> 8) & 1);
    for (let i = 9; i < 15; i += 1) matrix[8][14 - i] = Boolean((format >>> i) & 1);
    for (let i = 0; i < 8; i += 1) matrix[size - 1 - i][8] = Boolean((format >>> i) & 1);
    for (let i = 8; i < 15; i += 1) matrix[size - 15 + i][8] = Boolean((format >>> i) & 1);
    matrix[size - 8][8] = true;

    const quietZone = 4;
    const path = [];
    matrix.forEach((row, y) => row.forEach((dark, x) => {
      if (dark) path.push(`M${x + quietZone} ${y + quietZone}h1v1h-1z`);
    }));
    const dimension = size + quietZone * 2;
    return `<svg class="ticket-qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges" role="img" aria-label="QR-код билета ${escape(value)}"><rect width="${dimension}" height="${dimension}" fill="#fff"/><path d="${path.join("")}" fill="#111"/></svg>`;
  }
  function slug(value) {
    return String(value).toLocaleLowerCase("ru").replace(/[^a-z0-9а-яё]+/g, "-").replace(/^-|-$/g, "");
  }
  function allAttractions() {
    return [
      ...attractions.map((item) => ({ ...item, ...(attractionSettings.overrides[item.id] || {}) })),
      ...attractionSettings.extras
    ];
  }
  function applyAttractionSettings(settings) {
    if (!settings || typeof settings !== "object"
      || !settings.overrides || typeof settings.overrides !== "object" || Array.isArray(settings.overrides)
      || !Array.isArray(settings.extras)) {
      throw new Error("Сервер вернул некорректные данные аттракционов.");
    }
    attractionSettings = { overrides: settings.overrides, extras: settings.extras };
    attractionSettingsRevision += 1;
    attractionSettingsPromise = Promise.resolve(allAttractions());
    window.dispatchEvent(new Event("novapark:attractions-updated"));
  }
  function getAttractionSettings() {
    return JSON.parse(JSON.stringify(attractionSettings));
  }
  function isAdmin() {
    return currentRole === "admin";
  }
  function setUserRole(role) {
    const nextRole = role === "admin" ? "admin" : "user";
    if (nextRole === currentRole) return;
    currentRole = nextRole;
    window.dispatchEvent(new Event("novapark:role-changed"));
  }
  function loadAttractionSettings(force = false) {
    if (force) {
      attractionSettingsRevision += 1;
      attractionSettingsPromise = null;
    }
    if (!attractionSettingsPromise) {
      const requestRevision = attractionSettingsRevision;
      attractionSettingsPromise = fetch("/api/attractions", {
        cache: "no-store",
        headers: { Accept: "application/json" }
      })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Не удалось загрузить аттракционы с сервера.");
          if (requestRevision !== attractionSettingsRevision) return allAttractions();
          applyAttractionSettings(result.settings);
          return allAttractions();
        })
        .catch((error) => {
          if (requestRevision !== attractionSettingsRevision) return allAttractions();
          attractionSettingsPromise = null;
          throw error;
        });
    }
    return attractionSettingsPromise;
  }
  function price(value) {
    return `${Number(value).toLocaleString("ru-RU")} ₽`;
  }
  function date(iso) {
    return new Date(`${iso}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  }
  function isArchivedBooking(booking) {
    if (!booking || typeof booking !== "object") return false;
    if (booking.status === "Использован") return true;
    if (typeof booking.date !== "string") return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(booking.date.slice(0, 10));
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const visitDate = new Date(year, month - 1, day);
    if (visitDate.getFullYear() !== year || visitDate.getMonth() !== month - 1 || visitDate.getDate() !== day) {
      return false;
    }
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return visitDate < today;
  }
  function imageFor(item) {
    return item.image || attractionImages.get(item.name) || attractionImages.get(attractions[0].name) || "";
  }
  function getCartAttractionIds() {
    const stored = read(keys.cart, []);
    return Array.isArray(stored)
      ? Array.from(new Set(stored.filter((id) => typeof id === "string")))
      : [];
  }
  function getCartGuests() {
    const guests = read(keys.cartGuests, null);
    if (!isValidGuestCount(guests && guests.adult, guests && guests.child)) return null;
    const limits = getDefaultGuests();
    if (guests.adult > limits.adult || guests.child > limits.child) return limits;
    return guests;
  }
  function getDefaultGuests() {
    const guests = read(keys.defaultGuests, null);
    return isValidGuestCount(guests && guests.adult, guests && guests.child)
      ? guests
      : { adult: 1, child: 0 };
  }
  function isValidGuestCount(adult, child) {
    return Number.isInteger(adult) && adult >= 0 && adult <= 10
      && Number.isInteger(child) && child >= 0 && child <= 10
      && adult + child > 0;
  }
  function setCartGuests(adult, child) {
    if (!isValidGuestCount(adult, child)) {
      throw new Error("Укажи от 0 до 10 взрослых и детей и хотя бы одного гостя.");
    }
    const limits = getDefaultGuests();
    if (adult > limits.adult || child > limits.child) {
      throw new Error("Количество гостей не может превышать настройки профиля.");
    }
    if (!write(keys.cartGuests, { adult, child })) {
      throw new Error("Не удалось сохранить количество гостей в этом браузере.");
    }
    window.dispatchEvent(new Event("novapark:cart-guests-updated"));
  }
  function setDefaultGuests(adult, child) {
    if (!isValidGuestCount(adult, child)) {
      throw new Error("Укажи от 0 до 10 взрослых и детей и хотя бы одного гостя.");
    }
    if (!write(keys.defaultGuests, { adult, child })) {
      throw new Error("Не удалось сохранить настройки в этом браузере.");
    }
    setCartGuests(adult, child);
  }
  function saveCartAttractionIds(ids) {
    if (!write(keys.cart, ids)) throw new Error("Не удалось сохранить корзину в этом браузере.");
    window.dispatchEvent(new Event("novapark:cart-updated"));
  }
  function addCartAttraction(id) {
    if (!allAttractions().some((item) => item.id === id)) {
      throw new Error("Этот аттракцион больше недоступен. Обнови каталог.");
    }
    const ids = getCartAttractionIds();
    if (!ids.includes(id)) {
      if (ids.length >= 12) throw new Error("В корзине может быть не больше 12 аттракционов.");
      saveCartAttractionIds([...ids, id]);
    }
    return getCartAttractionIds();
  }
  function removeCartAttraction(id) {
    saveCartAttractionIds(getCartAttractionIds().filter((itemId) => itemId !== id));
  }
  function clearCart() {
    if (!write(keys.cartGuests, null)) throw new Error("Не удалось очистить количество гостей.");
    saveCartAttractionIds([]);
  }
  function card(item) {
    const image = imageFor(item);
    const id = item.id || slug(item.name);
    const inCart = getCartAttractionIds().includes(id);
    const cartGuests = getCartGuests();
    const guestLimits = getDefaultGuests();
    const heightInfo = Number(item.height) > 0
      ? `Рост: от ${Number(item.height)} см`
      : "Без ограничений по росту";
    const guestSummary = inCart && cartGuests
      ? `<div class="card-guest-summary">Взрослых: ${cartGuests.adult} · Детей: ${cartGuests.child}</div>`
      : "";
    const adultCount = 0;
    const childCount = 0;
    const adultLimit = guestLimits.adult;
    const childLimit = guestLimits.child;
    const action = inCart
      ? `<a class="card-book in-cart" href="../html/cart.html">В корзине ✓</a>`
      : `<button class="card-book" type="button" data-open-guest-popup>В корзину</button>`;
    const popup = inCart ? "" : `<div class="attraction-guest-popup" data-guest-popup hidden>
      <button class="attraction-guest-popup-close" type="button" data-guest-close aria-label="Закрыть">×</button>
      <form data-guest-form>
        <h3>Сколько гостей?</h3>
        <div class="guest-counter-row">
          <label for="guest-adult-${escape(id)}">Взрослые</label>
          <div class="guest-counter" data-guest-counter role="group" aria-label="Количество взрослых">
            <button type="button" data-guest-step="-1" aria-label="Уменьшить число взрослых" ${adultCount === 0 ? "disabled" : ""}>−</button>
            <input id="guest-adult-${escape(id)}" name="adult" type="number" min="0" max="${adultLimit}" value="${adultCount}" required>
            <button type="button" data-guest-step="1" aria-label="Увеличить число взрослых" ${adultCount >= adultLimit ? "disabled" : ""}>+</button>
          </div>
        </div>
        <div class="guest-counter-row">
          <label for="guest-child-${escape(id)}">Дети</label>
          <div class="guest-counter" data-guest-counter role="group" aria-label="Количество детей">
            <button type="button" data-guest-step="-1" aria-label="Уменьшить число детей" ${childCount === 0 ? "disabled" : ""}>−</button>
            <input id="guest-child-${escape(id)}" name="child" type="number" min="0" max="${childLimit}" value="${childCount}" required>
            <button type="button" data-guest-step="1" aria-label="Увеличить число детей" ${childCount >= childLimit ? "disabled" : ""}>+</button>
          </div>
        </div>
        <div class="guest-feedback" data-guest-feedback role="status" aria-live="polite"></div>
        <div class="guest-actions">
          <button class="button button-ghost button-small" type="button" data-guest-close>Отмена</button>
          <button class="button button-primary button-small" type="submit">В корзину</button>
        </div>
      </form>
    </div>`;
    return `<article id="ride-${escape(id)}" class="attraction-card" data-attraction-id="${escape(id)}"><div class="card-image-wrap"><img class="card-image" src="${escape(image)}" alt="${escape(item.name)}" loading="lazy"><span class="card-tag">${escape(item.category)}</span></div><div class="card-body"><div class="card-title-row"><h3>${escape(item.name)}</h3></div><div class="card-meta"><span>${heightInfo}</span><span>Время: ${escape(item.time || "5 мин")}</span></div>${guestSummary}<div class="card-footer"><span class="card-price">${price(item.price)} <small>/ за поездку</small></span>${action}</div></div>${popup}</article>`;
  }
  function closeAttractionGuestPopups(except) {
    document.querySelectorAll(".attraction-guest-popup:not([hidden])").forEach((popup) => {
      if (popup !== except) popup.hidden = true;
    });
  }
  function updateGuestCounter(input) {
    const counter = input.closest("[data-guest-counter]");
    const value = Number(input.value);
    const min = Number(input.min);
    const max = Number(input.max);
    counter.querySelector('[data-guest-step="-1"]').disabled = value <= min;
    counter.querySelector('[data-guest-step="1"]').disabled = value >= max;
  }
  document.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.matches(".attraction-guest-popup [data-guest-counter] input")) {
      updateGuestCounter(event.target);
    }
  });
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const stepButton = event.target.closest("[data-guest-step]");
    if (stepButton) {
      const input = stepButton.closest("[data-guest-counter]").querySelector("input");
      const min = Number(input.min);
      const max = Number(input.max);
      input.value = String(Math.max(min, Math.min(max, Number(input.value) + Number(stepButton.dataset.guestStep))));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus({ preventScroll: true });
      return;
    }
    const closeButton = event.target.closest("[data-guest-close]");
    if (closeButton) {
      const popup = closeButton.closest(".attraction-guest-popup");
      if (popup) popup.hidden = true;
      return;
    }
    const openButton = event.target.closest("[data-open-guest-popup]");
    if (openButton) {
      const cardElement = openButton.closest(".attraction-card");
      const popup = cardElement.querySelector("[data-guest-popup]");
      closeAttractionGuestPopups(popup);
      popup.hidden = false;
      popup.querySelector('[name="adult"]').focus({ preventScroll: true });
      const bounds = popup.getBoundingClientRect();
      const topbar = document.querySelector(".topbar");
      const safeTop = topbar ? topbar.getBoundingClientRect().bottom + 8 : 8;
      if (bounds.top < safeTop || bounds.bottom > window.innerHeight - 8) {
        cardElement.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      return;
    }
    if (!event.target.closest(".attraction-guest-popup")) closeAttractionGuestPopups();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const popup = document.querySelector(".attraction-guest-popup:not([hidden])");
    if (!popup) return;
    popup.hidden = true;
    popup.closest(".attraction-card").querySelector("[data-open-guest-popup]")?.focus();
  });
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches("[data-guest-form]")) return;
    event.preventDefault();
    const popup = form.closest(".attraction-guest-popup");
    const cardElement = popup.closest(".attraction-card");
    const feedback = form.querySelector("[data-guest-feedback]");
    feedback.textContent = "";
    try {
      setCartGuests(Number(form.elements.adult.value), Number(form.elements.child.value));
      addCartAttraction(cardElement.dataset.attractionId);
      popup.hidden = true;
    } catch (error) {
      feedback.textContent = error.message || "Не удалось добавить аттракцион.";
    }
  });
  document.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)
      || !image.matches(".card-image, .admin-attraction-row > img")
      || image.dataset.fallbackApplied) return;
    const fallback = fallbackImages.get(image.alt);
    if (!fallback) return;
    image.dataset.fallbackApplied = "true";
    image.src = fallback;
  }, true);
  const menu = document.querySelector("#top-nav");
  const toggle = document.querySelector("#menu-toggle");
  if (menu && toggle) toggle.addEventListener("click", () => {
    const open = menu.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  const accountLink = document.querySelector(".account-link");
  const topActions = document.querySelector(".top-actions");
  if (topActions && !topActions.querySelector(".header-cart")) {
    const cartLink = document.createElement("a");
    cartLink.className = "header-cart";
    cartLink.href = "../html/cart.html";
    cartLink.innerHTML = '<span class="header-cart-label">Корзина</span><b class="header-cart-count" aria-hidden="true">0</b>';
    cartLink.setAttribute("aria-label", "Корзина, 0 товаров");
    topActions.insertBefore(cartLink, topActions.firstElementChild);
    const updateCartCount = () => {
      const count = getCartAttractionIds().length;
      cartLink.querySelector(".header-cart-count").textContent = String(count);
      cartLink.setAttribute("aria-label", `Корзина, ${count} товаров`);
    };
    updateCartCount();
    window.addEventListener("novapark:cart-updated", updateCartCount);
    window.addEventListener("storage", (event) => {
      if (event.key === keys.cart) {
        updateCartCount();
        window.dispatchEvent(new Event("novapark:cart-updated"));
      }
    });
  }
  if (accountLink) {
    const accountLabel = accountLink.querySelector("span:last-child");
    const accountSideLinks = document.querySelectorAll(".account-side-link");
    const adminLinks = document.querySelectorAll(".admin-only");
    const updateAdminLinks = (isAdmin) => {
      adminLinks.forEach((link) => {
        link.hidden = !isAdmin;
      });
    };
    const updateAccountLink = (signedIn) => {
      const href = signedIn ? "../html/account.html" : "../html/auth.html";
      const label = signedIn ? "Профиль" : "Войти";
      accountLink.href = href;
      accountLabel.textContent = label;
      accountSideLinks.forEach((link) => {
        link.href = href;
        link.querySelector(".account-side-label").textContent = label;
      });
    };
    updateAdminLinks(false);
    updateAccountLink(Boolean(read(keys.email, "")));
    fetch("/api/me", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось проверить сессию пользователя.");
        const result = await response.json();
        updateAccountLink(Boolean(result.user));
        setUserRole(result.user ? result.user.role : "user");
        updateAdminLinks(isAdmin());
      })
      .catch((error) => console.error("Не удалось обновить ссылку профиля:", error));
  }

  return {
    keys, attractions, rewardLabels, read, write, escape, qrSvg, csrfFetch, allAttractions, loadAttractionSettings,
    applyAttractionSettings, getAttractionSettings, getCartAttractionIds, getCartGuests, getDefaultGuests,
    setCartGuests, setDefaultGuests, addCartAttraction,
    removeCartAttraction, clearCart, isAdmin, setUserRole,
    price, date, isArchivedBooking, imageFor, card, slug
  };
})();
