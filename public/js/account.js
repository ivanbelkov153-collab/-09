const { keys, rewardLabels, read, write, escape, qrSvg, price, date, isArchivedBooking, csrfFetch } = window.NovaPark;
const profileForm = document.querySelector("#profile-form");
const profileGuestActions = document.querySelector("#profile-guest-actions");
const profileGuestFeedback = document.querySelector("#profile-guest-feedback");
const logoutButton = document.querySelector("#logout-button");
const emailInput = profileForm.elements.email;
const accountRewardText = document.querySelector("#account-reward-text");
const accountRewardQr = document.querySelector("#account-reward-qr");
const ticketList = document.querySelector("#ticket-list");
const settingsTab = document.querySelector('[data-account-tab="settings"]');
const settingsPanel = document.querySelector("#account-settings");
const ticketQrViewer = document.querySelector("#ticket-qr-viewer");
const ticketQrViewerClose = document.querySelector("#ticket-qr-viewer-close");
const ticketQrLarge = document.querySelector("#ticket-qr-large");
const ticketQrLabel = document.querySelector("#ticket-qr-label");
let sessionUser = null;
let accountBookings = [];
let selectedAttractionName = "";

function renderCachedProfile(message) {
  const email = read(keys.email, "");
  if (email) {
    sessionUser = { email, name: read(keys.name, "") };
    accountBookings = read(keys.bookings, []).filter((booking) => booking.email === email);
  }
  render();
  if (message) document.querySelector("#profile-feedback").textContent = message;
}

function getBookedAttractionNames(bookings) {
  const names = new Set();
  bookings.forEach((booking) => {
    if (!Array.isArray(booking.attractions)) return;
    booking.attractions.forEach((ride) => {
      if (ride && typeof ride.name === "string" && ride.name.trim()) names.add(ride.name);
    });
  });
  return Array.from(names).sort((first, second) => first.localeCompare(second, "ru"));
}

function matchesSelectedAttraction(booking) {
  return !selectedAttractionName || (Array.isArray(booking.attractions)
    && booking.attractions.some((ride) => ride && ride.name === selectedAttractionName));
}

function render() {
  const signedIn = Boolean(sessionUser);
  const email = sessionUser ? sessionUser.email : "";
  const name = sessionUser ? sessionUser.name : "";
  const isAdmin = sessionUser && sessionUser.role === "admin";
  profileForm.hidden = !signedIn;
  profileGuestActions.hidden = signedIn;
  logoutButton.hidden = !signedIn;
  settingsTab.hidden = !isAdmin;
  settingsPanel.hidden = !isAdmin;
  document.querySelector("#account-name").innerHTML = name || "Гость Nova Park";
  document.querySelector("#account-email").textContent = email || "Укажи email для просмотра бронирований";
  document.querySelector("#account-avatar").textContent = name ? name.charAt(0).toLocaleUpperCase("ru") : "А";
  emailInput.value = email;
  document.querySelector("#profile-form").elements.name.value = name;
  const bookings = accountBookings.filter((item) => item.email === email);
  const attractionNames = getBookedAttractionNames(bookings);
  if (selectedAttractionName && !attractionNames.includes(selectedAttractionName)) {
    selectedAttractionName = "";
  }
  const filterOptions = `<option value="">Все аттракционы</option>${attractionNames
    .map((attractionName) => `<option value="${escape(attractionName)}">${escape(attractionName)}</option>`)
    .join("")}`;
  document.querySelectorAll("[data-booking-attraction-filter]").forEach((select) => {
    select.innerHTML = filterOptions;
    select.value = selectedAttractionName;
    select.closest(".booking-attraction-filter").hidden = attractionNames.length === 0;
  });
  if (isAdmin) {
    const defaultGuests = window.NovaPark.getDefaultGuests();
    document.querySelector("#default-adult-count").value = String(defaultGuests.adult);
    document.querySelector("#default-child-count").value = String(defaultGuests.child);
  }
  const currentBookings = bookings.filter((item) => !isArchivedBooking(item) && matchesSelectedAttraction(item));
  const archivedBookings = bookings.filter((item) => isArchivedBooking(item) && matchesSelectedAttraction(item));
  document.querySelector("#account-tickets .section-heading").innerHTML = email
    ? '<div><span class="eyebrow">ТВОИ ПРИКЛЮЧЕНИЯ</span><h2>Мои бронирования</h2></div><a class="button button-ghost button-small" href="../html/catalog.html">+ Выбрать аттракционы</a>'
    : '<div><span class="eyebrow">ТВОИ ПРИКЛЮЧЕНИЯ</span><h2>Войди, чтобы увидеть бронирования</h2></div><div><a class="button button-primary button-small" href="../html/auth.html">Войти</a> <a class="button button-ghost button-small" href="../html/register.html">Регистрация</a></div>';
  ticketList.innerHTML = currentBookings.length
    ? currentBookings.map((item) => {
      const rides = Array.isArray(item.attractions)
        ? item.attractions.map((ride) => escape(ride.name)).join(", ")
        : "";
      const reward = rewardLabels[item.reward] || "";
      const time = item.time ? ` · Время: ${escape(String(item.time).slice(0, 5))}` : "";
      const rideInfo = rides ? `<br>Аттракционы: ${rides}` : "";
      const rewardInfo = reward
        ? `<br>Приз: ${escape(reward)}${Number(item.discount) ? ` · скидка ${price(item.discount)}` : ""}`
        : "";
      return `<article class="ticket-card"><div class="ticket-details"><span class="ticket-status">${escape(item.status)}</span><h3>Билет в Nova Park</h3><p>Дата: ${date(item.date)}${time}<br>Взрослых: ${item.adult} · Детей: ${item.child}${rideInfo}${rewardInfo}<br>Номер: ${escape(item.id)} · Стоимость: ${price(item.total)}</p><button class="button button-ghost button-small ticket-qr-open" type="button" data-show-ticket-qr="${escape(item.id)}" aria-haspopup="dialog">Посмотреть QR</button></div><div class="ticket-qr-wrap">${qrSvg(item.id)}<small>Покажи QR-код при входе</small></div></article>`;
    }).join("")
    : bookings.length
      ? selectedAttractionName
        ? `<div class="empty-tickets">Нет активных броней с аттракционом «${escape(selectedAttractionName)}».</div>`
        : '<div class="empty-tickets">Активных бронирований нет. Прошедшие и использованные билеты сохранены в истории покупок.</div>'
      : '<div class="empty-tickets">Бронирований пока нет. <a href="../html/catalog.html">Выбери аттракционы для брони.</a></div>';
  document.querySelector("#purchase-history").innerHTML = archivedBookings.length
    ? archivedBookings.map((item) => {
      const rides = Array.isArray(item.attractions)
        ? item.attractions.map((ride) => escape(ride.name)).join(", ")
        : "";
      return `<div class="summary-row"><span>${date(item.date)} · ${escape(item.id)}${rides ? `<small class="history-ride-list">${rides}</small>` : ""}</span><b>${price(item.total)}</b></div>`;
    }).join("")
    : bookings.length
      ? selectedAttractionName
        ? `<p class="muted">В истории нет броней с аттракционом «${escape(selectedAttractionName)}».</p>`
        : '<p class="muted">Пока нет завершённых бронирований.</p>'
      : '<p class="muted">История покупок пока пуста.</p>';
}

let lastQrTrigger = null;
function closeTicketQrViewer() {
  if (ticketQrViewer.open) ticketQrViewer.close();
}

ticketList.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const trigger = event.target.closest("[data-show-ticket-qr]");
  if (!trigger) return;
  lastQrTrigger = trigger;
  const ticketId = trigger.dataset.showTicketQr;
  ticketQrLarge.innerHTML = qrSvg(ticketId);
  ticketQrLabel.textContent = `Бронь №${ticketId}`;
  if (!ticketQrViewer.open) ticketQrViewer.showModal();
  ticketQrViewerClose.focus({ preventScroll: true });
});
ticketQrViewerClose.addEventListener("click", closeTicketQrViewer);
ticketQrViewer.addEventListener("click", (event) => {
  if (event.target === ticketQrViewer) closeTicketQrViewer();
});
ticketQrViewer.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeTicketQrViewer();
});
ticketQrViewer.addEventListener("close", () => {
  if (lastQrTrigger && lastQrTrigger.isConnected) lastQrTrigger.focus({ preventScroll: true });
});
document.addEventListener("change", (event) => {
  if (!(event.target instanceof HTMLSelectElement)
    || !event.target.matches("[data-booking-attraction-filter]")) return;
  selectedAttractionName = event.target.value;
  render();
});

function renderGuestProfile(message) {
  sessionUser = null;
  accountBookings = [];
  render();
  accountRewardText.textContent = "Войди в аккаунт, чтобы увидеть призы.";
  profileGuestFeedback.textContent = message || "";
}

async function loadWheelStatus() {
  try {
    const response = await fetch("/api/wheel/status", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Не удалось загрузить призы.");
    const reward = result.reward;
    accountRewardQr.hidden = true;
    accountRewardQr.innerHTML = "";
    let rewardMessage = "";
    if (reward && reward.code === "popcorn" && !reward.used) {
      if (typeof reward.qrCode === "string" && /^NP-P-[A-F0-9]{12}$/.test(reward.qrCode)) {
        rewardMessage = "Попкорн в подарок. Покажи этот QR-код сотруднику для получения.";
        accountRewardQr.innerHTML = `<div class="ticket-qr-wrap">${qrSvg(reward.qrCode)}<div><small>QR-код для получения попкорна</small><br><code>${escape(reward.qrCode)}</code></div></div>`;
        accountRewardQr.hidden = false;
      } else {
        rewardMessage = "Попкорн в подарок. Не удалось загрузить QR-код — обнови профиль.";
      }
    } else if (reward && !reward.used && reward.discount) {
      rewardMessage = `${rewardLabels[reward.code] || reward.label} применится автоматически при следующей брони.`;
    } else if (reward && !reward.used) {
      rewardMessage = `${rewardLabels[reward.code] || reward.label} будет указан в следующем билете.`;
    } else if (reward && reward.used && reward.code === "popcorn") {
      rewardMessage = "Попкорн по QR-коду уже выдан.";
    } else if (reward && reward.used && reward.discount) {
      rewardMessage = "Скидка уже использована.";
    }
    const points = `Баллы: ${Number(result.points) || 0}.`;
    const spins = result.unlimited
      ? "Для аккаунта администратора количество вращений не ограничено."
      : result.canSpin ? "Вращение доступно." : "Вращение использовано.";
    accountRewardText.textContent = [points, rewardMessage, spins].filter(Boolean).join(" ");
  } catch (error) {
    console.error("Не удалось загрузить призы профиля:", error);
    accountRewardText.textContent = "Не удалось загрузить состояние призов.";
  }
}

document.querySelectorAll("[data-account-tab]").forEach((button) => button.addEventListener("click", () => {
  if (button.dataset.accountTab === "settings" && (!sessionUser || sessionUser.role !== "admin")) return;
  document.querySelectorAll("[data-account-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
  document.querySelectorAll(".account-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `account-${button.dataset.accountTab}`));
}));
document.querySelector("#profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.elements.name.value.trim();
  const feedback = document.querySelector("#profile-feedback");
  if (!sessionUser) {
    profileGuestFeedback.textContent = "Для изменения профиля сначала войди в аккаунт.";
    return;
  }
  if (!name) { feedback.textContent = "Укажи имя."; feedback.classList.remove("success"); return; }
  try {
    const response = await csrfFetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Не удалось сохранить профиль.");
    sessionUser = { ...sessionUser, ...result.user };
    write(keys.name, sessionUser.name);
    feedback.textContent = "Профиль сохранён.";
    feedback.classList.add("success");
    render();
  } catch (error) {
    feedback.textContent = error.message || "Не удалось подключиться к серверу.";
    feedback.classList.remove("success");
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    const response = await csrfFetch("/api/logout", { method: "POST" });
    if (!response.ok) throw new Error("Не удалось выйти из аккаунта.");
  } catch (error) {
    document.querySelector("#profile-feedback").textContent = error.message || "Не удалось подключиться к серверу.";
    document.querySelector("#profile-feedback").classList.remove("success");
    return;
  }
  localStorage.removeItem(keys.email);
  localStorage.removeItem(keys.name);
  window.location.href = "../html/auth.html";
});

document.querySelector("#booking-settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const feedback = document.querySelector("#settings-feedback");
  feedback.classList.remove("success");
  if (!sessionUser || sessionUser.role !== "admin") {
    feedback.textContent = "Настройки доступны только администратору.";
    return;
  }
  try {
    window.NovaPark.setDefaultGuests(
      Number(document.querySelector("#default-adult-count").value),
      Number(document.querySelector("#default-child-count").value)
    );
    feedback.textContent = "Настройки сохранены. Эти значения будут подставляться при добавлении аттракционов.";
    feedback.classList.add("success");
  } catch (error) {
    feedback.textContent = error.message || "Не удалось сохранить настройки.";
  }
});

fetch("/api/me", { cache: "no-store", credentials: "same-origin" })
  .then((response) => {
    if (!response.ok) throw new Error("Не удалось проверить сессию.");
    return response.json();
  })

  .then(async ({ user }) => {
    if (!user) {
      renderGuestProfile("Чтобы увидеть билеты и данные профиля, войди или создай аккаунт.");
      return;
    }
    sessionUser = user;
    write(keys.email, user.email);
    write(keys.name, user.name);
    const bookingsResponse = await fetch("/api/bookings/me", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    const bookingsResult = await bookingsResponse.json();
    if (!bookingsResponse.ok) throw new Error(bookingsResult.error || "Не удалось загрузить билеты.");
    const localBookings = read(keys.bookings, []).filter((booking) => booking.email === user.email);
    accountBookings = Array.from(new Map([...localBookings, ...bookingsResult.bookings]
      .map((booking) => [booking.id, booking])).values());
    render();
    loadWheelStatus();
  })

  .catch((error) => {
    console.error(error);
    renderCachedProfile(error.message || "Не удалось подключиться к серверу. Проверь подключение и обнови профиль.");
  });
