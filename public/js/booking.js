(() => {
  const { keys, read, price, date, allAttractions, escape } = window.NovaPark;
  const pendingBookingKey = "novaParkPendingBooking";
  const bookingAttractionIdsKey = "novaParkBookingAttractionIds";
  const bookingTime = "10:00";
  const cartGuests = window.NovaPark.getCartGuests() || window.NovaPark.getDefaultGuests();
  const state = {
    adult: cartGuests ? cartGuests.adult : 0,
    child: cartGuests ? cartGuests.child : 0,
    selectedDate: null,
    attractionIds: [],
    month: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  };
  const emailInput = document.querySelector("#booking-email");
  const attractionList = document.querySelector("#booking-attraction-list");
  const secureNote = document.querySelector(".secure-note");
  const cartPage = Boolean(document.querySelector("#cart-items"));
  let wheelStatus = null;
  let emailEdited = false;
  emailInput.value = read(keys.email, "");
  emailInput.addEventListener("input", () => {
    emailEdited = true;
  });
  function readSavedAttractionIds() {
    const saved = sessionStorage.getItem(bookingAttractionIdsKey);
    if (!saved) return [];
    try {
      const ids = JSON.parse(saved);
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
        throw new Error("Сохранённый выбор аттракционов имеет неверный формат.");
      }
      return Array.from(new Set(ids));
    } catch (error) {
      console.error("Не удалось восстановить выбранные аттракционы:", error);
      sessionStorage.removeItem(bookingAttractionIdsKey);
      return [];
    }
  }
  function persistAttractionSelection() {
    try {
      sessionStorage.setItem(bookingAttractionIdsKey, JSON.stringify(state.attractionIds));
    } catch (error) {
      console.error("Не удалось сохранить выбранные аттракционы:", error);
      document.querySelector("#booking-message").textContent = "Не удалось сохранить выбранные аттракционы в этом браузере.";
    }
  }
  function restorePendingBooking() {
    const savedBooking = sessionStorage.getItem(pendingBookingKey);
    if (!savedBooking) return false;
    try {
      const saved = JSON.parse(savedBooking);
      if (!saved || typeof saved.selectedDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(saved.selectedDate)
        || !Array.isArray(saved.attractionIds) || !saved.attractionIds.length
        || !saved.attractionIds.every((id) => typeof id === "string")
        || !Number.isInteger(saved.adult) || saved.adult < 0 || saved.adult > 10
        || !Number.isInteger(saved.child) || saved.child < 0 || saved.child > 10
        || saved.adult + saved.child === 0) {
        throw new Error("Сохранённый выбор билетов имеет неверный формат.");
      }
      const [year, month, day] = saved.selectedDate.split("-").map(Number);
      const selectedDate = new Date(year, month - 1, day);
      if (selectedDate.getFullYear() !== year || selectedDate.getMonth() !== month - 1 || selectedDate.getDate() !== day) {
        throw new Error("Сохранённая дата посещения недействительна.");
      }
      state.selectedDate = saved.selectedDate;
      state.adult = saved.adult;
      state.child = saved.child;
      state.attractionIds = saved.attractionIds;
      state.month = new Date(year, month - 1, 1);
      return true;
    } catch (error) {
      console.error("Не удалось восстановить выбор билетов:", error);
      sessionStorage.removeItem(pendingBookingKey);
      return false;
    }
  }
  const restoredBooking = restorePendingBooking();
  const bookingQuery = new URLSearchParams(window.location.search);
  const requestedAttraction = bookingQuery.get("attraction");
  const fromCart = bookingQuery.get("fromCart") === "1" || cartPage;
  const selectionNote = document.querySelector("#booking-selection-note");
  if (selectionNote) selectionNote.hidden = !fromCart;
  if (!restoredBooking && fromCart) {
    state.attractionIds = window.NovaPark.getCartAttractionIds();
  } else if (!restoredBooking && requestedAttraction) {
    state.attractionIds = [requestedAttraction];
  } else if (!restoredBooking) {
    state.attractionIds = readSavedAttractionIds();
  }
  function renderAttractions() {
    attractionList.innerHTML = allAttractions().map((item) => `
      <label class="booking-attraction-option">
        <input type="checkbox" value="${escape(item.id)}" ${state.attractionIds.includes(item.id) ? "checked" : ""}>
        <span>${escape(item.name)}<small>${price(item.price)} за поездку</small></span>
      </label>
    `).join("");
  }
  attractionList.addEventListener("change", (event) => {
    if (event.target.type !== "checkbox") return;
    state.attractionIds = Array.from(attractionList.querySelectorAll("input:checked"), (input) => input.value);
    persistAttractionSelection();
    updateSummary();
  });
  function selectedAttractions() {
    return allAttractions().filter((item) => state.attractionIds.includes(item.id));
  }
  function renderCalendar() {
    const year = state.month.getFullYear();
    const month = state.month.getMonth();
    document.querySelector("#calendar-month").textContent = state.month.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let html = "";
    for (let i = 0; i < offset; i += 1) html += '<span class="calendar-day empty"></span>';
    for (let day = 1; day <= days; day += 1) {
      const current = new Date(year, month, day);
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const selected = iso === state.selectedDate;
      html += `<button class="calendar-day${selected ? " selected" : ""}${current.getTime() === today.getTime() ? " today" : ""}" data-date="${iso}" ${current < today ? "disabled" : ""} aria-pressed="${selected}">${day}</button>`;
    }
    document.querySelector("#calendar-days").innerHTML = html;
    document.querySelectorAll("[data-date]").forEach((button) => button.addEventListener("click", () => {
      state.selectedDate = button.dataset.date;
      renderCalendar();
      updateSummary();
    }));
    document.querySelector("#prev-month").disabled = year === today.getFullYear() && month <= today.getMonth();
  }
  function updateSummary() {
    const rides = selectedAttractions();
    const guests = state.adult + state.child;
    const subtotal = rides.reduce((sum, item) => sum + Number(item.price || 0), 0) * guests;
    const reward = wheelStatus && wheelStatus.reward && !wheelStatus.reward.used
      ? wheelStatus.reward
      : null;
    const discount = reward && reward.discount ? Math.round(subtotal * reward.discount / 100) : 0;
    document.querySelector("#summary-adult").textContent = String(state.adult);
    document.querySelector("#summary-child").textContent = String(state.child);
    document.querySelector("#summary-attractions").textContent = rides.length
      ? rides.map((item) => item.name).join(", ")
      : "Не выбраны";
    document.querySelector("#summary-subtotal").textContent = price(subtotal);
    const rewardLabel = reward
      ? reward.code === "popcorn" ? "Попкорн — QR в профиле" : reward.label
      : "Нет";
    document.querySelector("#summary-reward").textContent = rewardLabel;
    document.querySelector("#summary-discount").textContent = discount ? `−${price(discount)}` : price(0);
    document.querySelector("#summary-total").textContent = price(subtotal - discount);
    const selectedDate = state.selectedDate ? date(state.selectedDate) : "Выберите дату";
    document.querySelector("#summary-date").textContent = selectedDate;
  }
  async function loadWheelStatus() {
    try {
      const response = await fetch("/api/wheel/status", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      if (response.status === 401) return;
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось загрузить приз.");
      wheelStatus = result;
      updateSummary();
    } catch (error) {
      console.error("Не удалось загрузить призы:", error);
      document.querySelector("#booking-message").textContent = "Не удалось проверить приз. Итоговая стоимость будет подтверждена при бронировании.";
    }
  }
  async function getCurrentUser() {
    const response = await fetch("/api/me", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      if (response.status === 403 || /forbidden/i.test(responseText)) {
        throw new Error("Для бронирования запусти сайт через Node.js: npm start, затем открой http://localhost:3000.");
      }
      throw new Error("Не удалось проверить вход. Запусти Node.js сервер и открой сайт через http://localhost:3000.");
    }
    if (!response.ok) throw new Error(result.error || "Не удалось проверить вход.");
    return result.user || null;
  }
  getCurrentUser().then((user) => {
    secureNote.hidden = Boolean(user);
    if (!emailEdited) emailInput.value = user ? user.email : "";
  }).catch((error) => {
    console.error("Не удалось проверить вход на странице бронирования:", error);
  });
  document.querySelector("#prev-month").addEventListener("click", () => {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
    renderCalendar();
  });
  document.querySelector("#next-month").addEventListener("click", () => {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
    renderCalendar();
  });
  document.querySelector("#book-tickets").addEventListener("click", async () => {
    const message = document.querySelector("#booking-message");
    message.classList.remove("success");
    message.textContent = "";
    const buyerEmail = emailInput.value.trim().toLowerCase();
    if (!state.selectedDate) { message.textContent = "Сначала выбери дату посещения."; return; }
    if (!selectedAttractions().length) { message.textContent = "Выбери хотя бы один аттракцион."; return; }
    if (state.adult + state.child === 0) { message.textContent = "Вернись в корзину и укажи количество гостей."; return; }
    if (buyerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
      message.textContent = "Укажи корректный email для брони.";
      emailInput.focus();
      return;
    }
    try {
      sessionStorage.setItem(pendingBookingKey, JSON.stringify({
        selectedDate: state.selectedDate,
        selectedTime: bookingTime,
        buyerEmail,
        adult: state.adult,
        child: state.child,
        attractionIds: state.attractionIds
      }));
      window.location.href = "../html/payment.html";
    } catch (error) {
      message.textContent = error.message || "Не удалось сохранить заказ для оформления.";
    }
  });
  if (restoredBooking && new URLSearchParams(window.location.search).get("resume") === "1") {
    const message = document.querySelector("#booking-message");
    message.textContent = "Вход выполнен. Проверь заказ и нажми «Забронировать билет».";
    message.classList.add("success");
  }
  renderAttractions();
  persistAttractionSelection();
  window.addEventListener("novapark:attractions-updated", () => {
    renderAttractions();
    updateSummary();
  });
  if (cartPage) {
    window.addEventListener("novapark:cart-updated", () => {
      state.attractionIds = window.NovaPark.getCartAttractionIds();
      renderAttractions();
      persistAttractionSelection();
      updateSummary();
    });
    window.addEventListener("novapark:cart-guests-updated", () => {
      const guests = window.NovaPark.getCartGuests();
      state.adult = guests ? guests.adult : 0;
      state.child = guests ? guests.child : 0;
      updateSummary();
    });
  }
  window.NovaPark.loadAttractionSettings().catch((error) => {
    console.error("Не удалось загрузить аттракционы:", error);
    document.querySelector("#booking-message").textContent = error.message || "Не удалось загрузить аттракционы.";
  });
  loadWheelStatus();
  renderCalendar();
  updateSummary();
})();
