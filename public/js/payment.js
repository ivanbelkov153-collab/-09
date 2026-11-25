const {
  allAttractions,
  clearCart,
  csrfFetch,
  date,
  loadAttractionSettings,
  price
} = window.NovaPark;
const pendingBookingKey = "novaParkPendingBooking";
const bookingAttractionIdsKey = "novaParkBookingAttractionIds";
const checkout = document.querySelector("#payment-checkout");
const resultPanel = document.querySelector("#payment-result");
const unavailablePanel = document.querySelector("#payment-unavailable");
const unavailableMessage = document.querySelector("#payment-unavailable-message");
const errorMessage = document.querySelector("#payment-error");
const confirmButton = document.querySelector("#confirm-payment");
let order = null;
let attractions = [];
let user = null;
let wheelStatus = null;

function showUnavailable(message) {
  checkout.hidden = true;
  unavailablePanel.hidden = false;
  unavailableMessage.textContent = message;
}

function getSavedOrder() {
  const raw = sessionStorage.getItem(pendingBookingKey);
  if (!raw) return null;
  const saved = JSON.parse(raw);
  if (!saved || typeof saved.selectedDate !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(saved.selectedDate)
    || typeof saved.selectedTime !== "string"
    || !/^([1][0-9]|2[01]):00$/.test(saved.selectedTime)
    || !Number.isInteger(saved.adult) || saved.adult < 0 || saved.adult > 10
    || !Number.isInteger(saved.child) || saved.child < 0 || saved.child > 10
    || saved.adult + saved.child === 0
    || !Array.isArray(saved.attractionIds) || !saved.attractionIds.length
    || !saved.attractionIds.every((id) => typeof id === "string")) {
    throw new Error("Сохранённый заказ повреждён. Вернитесь в корзину и оформите его заново.");
  }
  return { ...saved, attractionIds: Array.from(new Set(saved.attractionIds)) };
}

async function getCurrentUser() {
  const response = await fetch("/api/me", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Не удалось проверить вход.");
  return result.user || null;
}

async function getWheelStatus() {
  const response = await fetch("/api/wheel/status", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Не удалось проверить приз.");
  return result;
}

function selectedAttractions() {
  return order.attractionIds.map((id) => attractions.find((item) => item.id === id));
}

function renderOrder() {
  const selected = selectedAttractions();
  if (selected.some((item) => !item)) {
    throw new Error("Один из аттракционов больше недоступен. Вернитесь в корзину и обновите заказ.");
  }
  const reward = wheelStatus.reward && !wheelStatus.reward.used ? wheelStatus.reward : null;
  const guestCount = order.adult + order.child;
  const subtotal = selected.reduce((sum, item) => sum + Number(item.price || 0), 0) * guestCount;
  const discount = reward && reward.discount ? Math.round(subtotal * reward.discount / 100) : 0;

  document.querySelector("#payment-date").textContent = date(order.selectedDate);
  document.querySelector("#payment-guests").textContent = `Взрослых: ${order.adult}, детей: ${order.child}`;
  document.querySelector("#payment-attraction-count").textContent = String(selected.length);
  document.querySelector("#payment-attractions").innerHTML = selected.map((item) => {
    const itemName = window.NovaPark.escape(item.name);
    return `<li><span>${itemName}</span><span>${price(Number(item.price) * guestCount)}</span></li>`;
  }).join("");
  document.querySelector("#payment-subtotal").textContent = price(subtotal);
  document.querySelector("#payment-reward").textContent = reward
    ? reward.code === "popcorn" ? "Попкорн — QR в профиле" : reward.label
    : "Нет";
  document.querySelector("#payment-discount").textContent = discount ? `−${price(discount)}` : price(0);
  document.querySelector("#payment-total").textContent = price(subtotal - discount);
  document.querySelector("#payment-email").textContent = order.buyerEmail;
  confirmButton.disabled = false;
}

function showError(error) {
  errorMessage.textContent = error instanceof TypeError
    ? "Не удалось подключиться к серверу. Запусти Node.js сервер командой npm start и открой http://localhost:3000."
    : error.message || "Не удалось загрузить заказ.";
}

confirmButton.addEventListener("click", async () => {
  if (!order || !user || confirmButton.disabled) return;
  errorMessage.textContent = "";
  confirmButton.disabled = true;
  confirmButton.textContent = "Оформляем бронь…";
  try {
    const response = await csrfFetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        selectedDate: order.selectedDate,
        selectedTime: order.selectedTime,
        buyerEmail: order.buyerEmail,
        adult: order.adult,
        child: order.child,
        attractions: selectedAttractions().map((item) => ({
          id: item.id,
          name: item.name,
          price: Number(item.price)
        }))
      })
    });
    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      throw new Error("Сервер бронирований вернул некорректный ответ. Запусти сайт через npm start.");
    }
    if (!response.ok) throw new Error(responseData.error || "Не удалось создать бронь.");

    document.querySelector("#payment-result-message").textContent =
      `Номер брони ${responseData.booking.id}. Дата посещения: ${date(responseData.booking.date)}. Сумма: ${price(responseData.booking.total)}.`;
    checkout.hidden = true;
    resultPanel.hidden = false;
    try {
      sessionStorage.removeItem(pendingBookingKey);
      sessionStorage.removeItem(bookingAttractionIdsKey);
      clearCart();
    } catch (error) {
      console.error("Не удалось очистить данные заказа после бронирования:", error);
      document.querySelector(".demo-result-note").textContent =
        "Бронь создана, но локальную корзину не удалось очистить. Средства не списывались.";
    }
  } catch (error) {
    showError(error);
    confirmButton.disabled = false;
    confirmButton.innerHTML = 'Подтвердить демо-оформление <span aria-hidden="true">→</span>';
  }
});

async function initialize() {
  try {
    order = getSavedOrder();
    if (!order) {
      showUnavailable("В корзине нет подготовленного заказа. Добавьте аттракционы и выберите дату посещения.");
      return;
    }
    await loadAttractionSettings();
    attractions = allAttractions();
    user = await getCurrentUser();
    if (!user) {
      window.location.href = "../html/auth.html?return=payment";
      return;
    }
    order.buyerEmail = order.buyerEmail || user.email;
    wheelStatus = await getWheelStatus();
    renderOrder();
  } catch (error) {
    showError(error);
    if (!order) showUnavailable(error.message || "Не удалось восстановить заказ.");
  }
}

initialize();
