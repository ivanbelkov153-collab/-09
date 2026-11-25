const { keys, rewardLabels, read, escape, price, date, isArchivedBooking, slug, allAttractions, imageFor } = window.NovaPark;
const list = document.querySelector("#admin-attraction-list");
const cameraToggle = document.querySelector("#ticket-camera-toggle");
const cameraVideo = document.querySelector("#ticket-camera-video");
const bookingFilters = document.querySelector("#booking-filters");
let cameraStream = null;
let bookings = [];
let bookingView = "current";
let barcodeDetector = null;
let qrDecoder = null;
let qrDecoderPromise = null;
let scannerActive = false;
let scanFrameId = null;
let lastScanTime = 0;
const scanCanvas = document.createElement("canvas");
const scanContext = scanCanvas.getContext("2d", { willReadFrequently: true });

async function adminRequest(url, method, body) {
  const response = await window.NovaPark.csrfFetch(url, {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Не удалось сохранить аттракционы на сервере.");
  if (result.settings) window.NovaPark.applyAttractionSettings(result.settings);
  return result;
}

async function migrateLegacyAttractions() {
  const legacyExtras = read(keys.attractions, []);
  const legacyOverrides = read(keys.overrides, {});
  if (!Array.isArray(legacyExtras) || !legacyOverrides || typeof legacyOverrides !== "object" || Array.isArray(legacyOverrides)) {
    throw new Error("Старые настройки аттракционов имеют неверный формат.");
  }

  for (const oldItem of legacyExtras) {
    if (!oldItem || typeof oldItem.name !== "string") {
      throw new Error("Не удалось перенести старый аттракцион: проверь данные в браузере.");
    }
    const id = typeof oldItem.id === "string" ? oldItem.id : slug(oldItem.name);
    let existing = allAttractions().find((item) => item.id === id || item.name === oldItem.name);
    if (!existing) {
      await adminRequest("/api/admin/attractions", "POST", {
        id,
        name: oldItem.name,
        category: oldItem.category,
        height: Number(oldItem.height)
      });
      existing = allAttractions().find((item) => item.id === id);
    }
    if (existing && !window.NovaPark.attractions.some((item) => item.id === existing.id)
      && oldItem.mapPosition && !existing.mapPosition) {
      await adminRequest(`/api/admin/attractions/${encodeURIComponent(existing.id)}`, "PATCH", {
        mapPosition: oldItem.mapPosition
      });
    }
  }

  for (const [key, value] of Object.entries(legacyOverrides)) {
    const base = window.NovaPark.attractions.find((item) => item.id === key || item.name === key);
    const current = base && window.NovaPark.getAttractionSettings().overrides[base.id];
    if (base && (!current || current.height === undefined) && value && Number.isInteger(value.height)) {
      await adminRequest(`/api/admin/attractions/${encodeURIComponent(base.id)}`, "PATCH", {
        height: value.height
      });
    }
  }

  localStorage.removeItem(keys.attractions);
  localStorage.removeItem(keys.overrides);
}

function renderAttractions() {
  const baseCount = window.NovaPark.attractions.length;
  list.innerHTML = allAttractions().map((item, index) => {
    const positionInfo = item.mapPosition
      ? ` · карта: ${Number(item.mapPosition.left)}% слева, ${Number(item.mapPosition.top)}% сверху`
      : "";
    return `<div class="admin-attraction-row"><img src="${escape(imageFor(item))}" alt="${escape(item.name)}"><span>${escape(item.name)}<small>${escape(item.category)} · от ${Number(item.height) || 0} см · ${price(item.price)}${positionInfo}</small></span><form class="admin-height-form" data-height-form="${escape(item.id)}"><label>Рост<input name="height" type="number" min="0" max="220" value="${Number(item.height) || 0}" required></label><button class="admin-edit-button">Сохранить</button></form>${index >= baseCount ? `<button class="admin-delete-button" data-delete="${escape(item.id)}">Удалить</button>` : ""}</div>`;
  }).join("");
}
function renderTicketCheck(booking) {
  const result = document.querySelector("#scanner-result");
  const isUsed = booking.status === "Использован";
  const isActive = booking.status === "Активен";
  const rides = Array.isArray(booking.attractions)
    ? booking.attractions.map((item) => escape(item.name)).join(", ")
    : "Не указаны";
  const reward = rewardLabels[booking.reward] || "Нет";
  result.className = `scanner-result success${isUsed ? " is-used" : ""}${!isUsed && !isActive ? " is-invalid" : ""}`;
  result.innerHTML = `<section class="ticket-check-card"><div class="ticket-check-heading"><strong>${isActive ? "Билет действителен" : isUsed ? "Билет уже использован" : "Билет недействителен"}</strong><span>№ ${escape(booking.id)}</span></div><dl class="ticket-check-details"><div><dt>Покупатель</dt><dd>${escape(booking.email)}</dd></div><div><dt>Дата и время</dt><dd>${escape(date(booking.date))} · ${escape(String(booking.time || "—").slice(0, 5))}</dd></div><div><dt>Посетители</dt><dd>${Number(booking.adult) || 0} взрослых · ${Number(booking.child) || 0} детей</dd></div><div><dt>Аттракционы</dt><dd>${rides}</dd></div><div><dt>Приз</dt><dd>${escape(reward)}${Number(booking.discount) ? ` · −${price(booking.discount)}` : ""}</dd></div><div><dt>Сумма</dt><dd>${price(booking.total)}</dd></div></dl>${isActive ? `<button class="button button-primary ticket-use-button" type="button" data-mark-used="${escape(booking.id)}">Отметить проход</button>` : ""}</section>`;
}
function renderRewardCheck(reward, code) {
  const result = document.querySelector("#scanner-result");
  const isUsed = reward.used;
  result.className = `scanner-result success${isUsed ? " is-used" : ""}`;
  result.innerHTML = `<section class="ticket-check-card"><div class="ticket-check-heading"><strong>${isUsed ? "Попкорн уже выдан" : "Приз действителен"}</strong><span>${escape(code)}</span></div><p>${escape(reward.label)}</p>${isUsed ? "" : `<button class="button button-primary ticket-use-button" type="button" data-redeem-reward="${escape(code)}">Подтвердить выдачу попкорна</button>`}</section>`;
}
function showScannerMessage(message, type) {
  const result = document.querySelector("#scanner-result");
  result.className = `scanner-result${type ? ` ${type}` : ""}`;
  result.textContent = message;
}
async function checkTicket(rawValue) {
  let value = String(rawValue).trim().toUpperCase().replace(/[‐‑‒–—]/g, "-").replace(/\s+/g, "");
  try {
    const payload = JSON.parse(value);
    value = String(payload.id || payload.ticketId || payload.ticket || value).toUpperCase();
  } catch {}
  if (/^NP-P-[A-F0-9]{12}$/.test(value)) {
    try {
      const response = await fetch(`/api/wheel/rewards/${encodeURIComponent(value)}`, {
        headers: { Accept: "application/json" }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось проверить приз.");
      renderRewardCheck(result.reward, value);
    } catch (error) {
      showScannerMessage(error.message || "Не удалось проверить приз.", "error");
    }
    return;
  }
  const ticketMatch = value.match(/NP-?(\d{6})/);
  const numberMatch = value.match(/^\d{6}$/);
  const digits = ticketMatch ? ticketMatch[1] : numberMatch ? numberMatch[0] : null;
  if (!digits) {
    showScannerMessage("Введи корректный номер билета или отсканируй QR-код.", "error");
    return;
  }
  const id = `NP-${digits}`;
  const localBooking = read(keys.bookings, []).find((item) => item.id === id);
  try {
    const response = await fetch(`/api/tickets/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 404 && localBooking) {
        renderTicketCheck(localBooking);
        return;
      }
      showScannerMessage(result.error || "Не удалось проверить билет.", "error");
      return;
    }
    renderTicketCheck(result.booking);
  } catch (error) {
    console.error("Не удалось проверить билет:", error);
    if (localBooking) {
      renderTicketCheck(localBooking);
      return;
    }
    showScannerMessage("Не удалось подключиться к серверу. Проверь, что сайт запущен через npm start.", "error");
  }
}
function loadQrDecoder() {
  if (typeof window.jsQR === "function") return Promise.resolve(window.jsQR);
  if (qrDecoderPromise) return qrDecoderPromise;
  qrDecoderPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let timeoutId;
    function fail(error) {
      window.clearTimeout(timeoutId);
      qrDecoderPromise = null;
      script.remove();
      reject(error);
    }
    script.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timeoutId);
      if (typeof window.jsQR === "function") resolve(window.jsQR);
      else fail(new Error("Модуль QR-декодирования не загрузился."));
    };
    script.onerror = () => fail(new Error("Не удалось загрузить модуль QR-декодирования."));
    timeoutId = window.setTimeout(() => fail(new Error("Загрузка QR-сканера заняла слишком много времени.")), 10000);
    document.head.append(script);
  });
  return qrDecoderPromise;
}
function stopCamera(message) {
  scannerActive = false;
  if (scanFrameId !== null) window.cancelAnimationFrame(scanFrameId);
  scanFrameId = null;
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  cameraVideo.pause();
  cameraVideo.srcObject = null;
  cameraVideo.hidden = true;
  cameraToggle.textContent = "Сканировать QR";
  cameraToggle.setAttribute("aria-pressed", "false");
  if (message) showScannerMessage(message);
}
async function scanCameraFrame(timestamp) {
  if (!scannerActive) return;
  if (timestamp - lastScanTime < 150) {
    scanFrameId = window.requestAnimationFrame(scanCameraFrame);
    return;
  }
  lastScanTime = timestamp;
  if (cameraVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    try {
      let value = "";
      if (barcodeDetector) {
        const codes = await barcodeDetector.detect(cameraVideo);
        value = codes.find((item) => item.rawValue)?.rawValue || "";
      } else if (qrDecoder && scanContext) {
        const ratio = Math.min(1, 640 / cameraVideo.videoWidth);
        scanCanvas.width = Math.round(cameraVideo.videoWidth * ratio);
        scanCanvas.height = Math.round(cameraVideo.videoHeight * ratio);
        scanContext.drawImage(cameraVideo, 0, 0, scanCanvas.width, scanCanvas.height);
        const imageData = scanContext.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
        const code = qrDecoder(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
        value = code ? code.data : "";
      }
      if (value) {
        stopCamera();
        await checkTicket(value);
        return;
      }
    } catch (error) {
      if (!scannerActive) return;
      console.error("Не удалось распознать QR-код:", error);
      stopCamera("Не удалось прочитать QR-код. Проверь освещение или попробуй снова.");
      return;
    }
  }
  if (scannerActive) scanFrameId = window.requestAnimationFrame(scanCameraFrame);
}
async function startCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showScannerMessage("Для камеры открой сайт через http://10.56.20.155:3000.", "error");
    return;
  }
  cameraToggle.disabled = true;
  try {
    barcodeDetector = "BarcodeDetector" in window
      ? new window.BarcodeDetector({ formats: ["qr_code"] })
      : null;
  } catch (error) {
    console.error("Встроенный QR-сканер недоступен, использую резервный декодер:", error);
    barcodeDetector = null;
  }
  if (!barcodeDetector) {
    try {
      if (!scanContext) throw new Error("Не удалось подготовить область чтения QR.");
      qrDecoder = await loadQrDecoder();
    } catch (error) {
      console.error("Не удалось подготовить сканер QR:", error);
      showScannerMessage("Не удалось загрузить сканер QR. Проверь подключение к интернету.", "error");
      cameraToggle.disabled = false;
      return;
    }
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" } }
    });
    cameraVideo.srcObject = cameraStream;
    cameraVideo.hidden = false;
    await cameraVideo.play();
    scannerActive = true;
    cameraToggle.textContent = "Выключить камеру";
    cameraToggle.setAttribute("aria-pressed", "true");
    showScannerMessage("Наведите камеру на QR-код билета или приза.");
    scanFrameId = window.requestAnimationFrame(scanCameraFrame);
  } catch (error) {
    console.error("Не удалось открыть камеру:", error);
    stopCamera();
    const message = error.name === "NotAllowedError"
      ? "Нет доступа к камере. Разреши его в настройках браузера."
      : error.name === "NotFoundError"
        ? "Камера не найдена."
        : "Не удалось открыть камеру. Проверь разрешения браузера.";
    showScannerMessage(message, "error");
  } finally {
    cameraToggle.disabled = false;
  }
}
function renderBookingRows() {
  const isArchive = bookingView === "archive";
  const archivedCount = bookings.filter(isArchivedBooking).length;
  const currentCount = bookings.length - archivedCount;
  const visibleBookings = bookings.filter((item) => isArchivedBooking(item) === isArchive);
  bookingFilters.querySelector('[data-booking-filter="current"]').textContent = `Текущие (${currentCount})`;
  bookingFilters.querySelector('[data-booking-filter="archive"]').textContent = `Архив (${archivedCount})`;
  document.querySelectorAll("[data-booking-filter]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.bookingFilter === bookingView));
  });
  document.querySelector("#admin-bookings").innerHTML = visibleBookings.length
    ? visibleBookings.slice(0, 20).map((item) => {
      const rides = Array.isArray(item.attractions)
        ? item.attractions.map((ride) => escape(ride.name)).join(", ")
        : "—";
      const time = item.time ? ` · ${escape(String(item.time).slice(0, 5))}` : "";
      return `<tr><td>${escape(item.id)}</td><td>${escape(item.email)}</td><td>${date(item.date)}${time}</td><td>${rides || "—"}</td><td>${price(item.total)}</td><td><span class="status-pill">${escape(item.status)}</span></td></tr>`;
    }).join("")
    : `<tr><td colspan="6" class="muted">${isArchive ? "Архив пуст" : "Текущих бронирований нет"}</td></tr>`;
}
async function renderBookings() {
  try {
    const response = await fetch("/api/admin/bookings", { headers: { Accept: "application/json" } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Не удалось загрузить бронирования.");
    bookings = result.bookings;
  } catch (error) {
    console.error("Не удалось загрузить бронирования с сервера:", error);
    document.querySelector("#admin-bookings").innerHTML = `<tr><td colspan="6" class="muted">${escape(error.message || "Не удалось загрузить бронирования.")}</td></tr>`;
    return;
  }
  renderBookingRows();
  document.querySelector("#admin-ticket-count").textContent = bookings.reduce((sum, item) => sum + (Number(item.adult) || 0) + (Number(item.child) || 0), 0).toLocaleString("ru-RU");
  document.querySelector("#admin-revenue").textContent = price(bookings.reduce((sum, item) => sum + (Number(item.total) || 0), 0));
}
bookingFilters.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest("[data-booking-filter]");
  if (!button) return;
  bookingView = button.dataset.bookingFilter;
  renderBookingRows();
});
list.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete]");
  if (deleteButton) {
    const id = deleteButton.dataset.delete;
    const attraction = allAttractions().find((item) => item.id === id);
    if (!attraction || !window.confirm(`Удалить аттракцион «${attraction.name}»?`)) return;
    try {
      await adminRequest(`/api/admin/attractions/${encodeURIComponent(id)}`, "DELETE");
      renderAttractions();
    } catch (error) {
      window.alert(error.message || "Не удалось удалить аттракцион с сервера.");
    }
  }
});

list.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-height-form]");
  if (!form) return;
  event.preventDefault();
  const id = form.dataset.heightForm;
  const item = allAttractions().find((attraction) => attraction.id === id);
  if (!item) return;
  const height = Number(form.elements.height.value);
  if (!Number.isInteger(height) || height < 0 || height > 220) {
    window.alert("Укажи целое число от 0 до 220 см.");
    return;
  }
  try {
    await adminRequest(`/api/admin/attractions/${encodeURIComponent(id)}`, "PATCH", { height });
    renderAttractions();
  } catch (error) {
    window.alert(error.message || "Не удалось сохранить изменения на сервере.");
  }
});
document.querySelector("#scanner-result").addEventListener("click", async (event) => {
  const rewardButton = event.target.closest("[data-redeem-reward]");
  if (rewardButton) {
    const code = rewardButton.dataset.redeemReward;
    if (!window.confirm("Подтвердить выдачу попкорна по этому QR-коду?")) return;
    try {
      const response = await window.NovaPark.csrfFetch(`/api/wheel/rewards/${encodeURIComponent(code)}/redeem`, {
        method: "POST",
        headers: { Accept: "application/json" }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось выдать попкорн.");
      renderRewardCheck(result.reward, code);
    } catch (error) {
      showScannerMessage(error.message || "Не удалось выдать попкорн.", "error");
    }
    return;
  }
  const button = event.target.closest("[data-mark-used]");
  if (!button) return;
  const ticketId = button.dataset.markUsed;
  if (!window.confirm(`Отметить билет ${ticketId} как использованный?`)) return;
  try {
    const response = await window.NovaPark.csrfFetch(`/api/tickets/${encodeURIComponent(ticketId)}/use`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Не удалось отметить проход.");
    renderTicketCheck(result.booking);
    renderBookings();
  } catch (error) {
    showScannerMessage(error.message || "Не удалось отметить проход.", "error");
  }
});
document.querySelector("#add-attraction-toggle").addEventListener("click", () => {
  const form = document.querySelector("#add-attraction-form");
  form.hidden = !form.hidden;
});
document.querySelector("#add-attraction-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.elements.name.value.trim();
  const id = slug(name);
  if (!id) {
    window.alert("Укажи название аттракциона.");
    return;
  }
  if (allAttractions().some((item) => item.id === id
    || item.name.toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru"))) {
    window.alert("Аттракцион с таким названием уже есть.");
    return;
  }
  try {
    await adminRequest("/api/admin/attractions", "POST", {
      id,
      name,
      category: form.elements.category.value,
      height: Number(form.elements.height.value)
    });
    form.reset();
    form.hidden = true;
    renderAttractions();
  } catch (error) {
    window.alert(error.message || "Не удалось сохранить аттракцион на сервере.");
  }
});
window.addEventListener("novapark:attractions-updated", renderAttractions);
async function initializeAttractions() {
  try {
    await window.NovaPark.loadAttractionSettings();
    await migrateLegacyAttractions();
    renderAttractions();
  } catch (error) {
    console.error("Не удалось загрузить аттракционы:", error);
    list.innerHTML = `<p class="form-feedback">${escape(error.message || "Не удалось загрузить аттракционы с сервера.")}</p>`;
  }
}
cameraToggle.addEventListener("click", () => {
  if (scannerActive) stopCamera("Сканирование остановлено.");
  else startCamera();
});
window.addEventListener("pagehide", () => stopCamera());
document.addEventListener("visibilitychange", () => {
  if (document.hidden && scannerActive) stopCamera("Сканирование остановлено при скрытии вкладки.");
});
document.querySelector("#ticket-check-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (scannerActive) stopCamera();
  checkTicket(event.currentTarget.elements.ticketId.value);
});
initializeAttractions();
renderBookings();
