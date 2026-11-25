const wheel = document.querySelector("#fortune-wheel");
const button = document.querySelector("#spin-wheel");
const result = document.querySelector("#wheel-result");
const loginModal = document.querySelector("#wheel-login-modal");
const prizeModal = document.querySelector("#prize-modal");
const prizeMessage = document.querySelector("#prize-modal-message");
let rotation = 0;
let spinPending = false;
let loggedIn = false;
button.disabled = true;

function showLoginRequired() {
  loggedIn = false;
  button.disabled = false;
  button.textContent = "Крутить колесо ↻";
  result.textContent = "Для вращения войдите в аккаунт.";
}

function showStatus(status) {
  loggedIn = true;
  button.disabled = !status.canSpin;
  button.textContent = status.unlimited
    ? "Крутить ещё раз ↻"
    : status.canSpin
    ? status.spinsUsed ? "Крутить ещё раз ↻" : "Крутить колесо ↻"
    : "Попытка использована";

  if (status.unlimited) {
    result.textContent = "Для аккаунта администратора количество вращений не ограничено.";
  } else if (status.canSpin && status.spinsUsed) {
    result.textContent = "Выпало «Ещё раз» — у тебя есть дополнительное вращение.";
  } else if (status.reward && status.reward.code === "popcorn" && !status.reward.used) {
    result.textContent = "Попкорн в подарок — QR-код для получения доступен в профиле.";
  } else if (status.reward && !status.reward.used) {
    result.textContent = `${status.reward.label} сохранён и применится к следующей брони.`;
  } else if (status.reward && status.reward.code === "points100") {
    result.textContent = `В профиле ${status.points} бонусных баллов.`;
  } else if (status.spinsUsed) {
    result.textContent = "Вращение и дополнительная попытка использованы.";
  } else {
    result.textContent = "";
  }
}

async function loadStatus() {
  const response = await fetch("/api/wheel/status", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  if (response.status === 401) {
    showLoginRequired();
    return null;
  }
  const status = await response.json();
  if (!response.ok) throw new Error(status.error || "Не удалось загрузить колесо.");
  showStatus(status);
  return status;
}

function closePrizeModal() {
  if (prizeModal.open) prizeModal.close();
}

function closeLoginModal() {
  if (loginModal.open) loginModal.close();
}

document.querySelector("#close-prize-modal").addEventListener("click", closePrizeModal);
document.querySelector("#prize-modal-ok").addEventListener("click", closePrizeModal);
document.querySelector("#close-wheel-login-modal").addEventListener("click", closeLoginModal);
prizeModal.addEventListener("click", (event) => {
  if (event.target === prizeModal) closePrizeModal();
});
loginModal.addEventListener("click", (event) => {
  if (event.target === loginModal) closeLoginModal();
});

button.addEventListener("click", async () => {
  if (spinPending) return;
  if (!loggedIn) {
    if (!loginModal.open) loginModal.showModal();
    return;
  }
  spinPending = true;
  button.disabled = true;
  result.textContent = "Колесо крутится…";
  try {
    const response = await window.NovaPark.csrfFetch("/api/wheel/spin", {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    const spin = await response.json();
    if (response.status === 401) {
      showLoginRequired();
      loginModal.showModal();
      return;
    }
    if (!response.ok) throw new Error(spin.error || "Не удалось прокрутить колесо.");

    rotation += 360 * 6 + (360 - spin.prizeIndex * 72 - 36);
    wheel.style.transform = `rotate(${rotation}deg)`;
    window.setTimeout(() => {
      prizeMessage.textContent = spin.prize.message;
      prizeModal.showModal();
      showStatus(spin.status);
    }, 4600);
  } catch (error) {
    result.textContent = error.message || "Не удалось подключиться к серверу.";
    try {
      await loadStatus();
    } catch (statusError) {
      console.error("Не удалось обновить состояние колеса:", statusError);
    }
  } finally {
    spinPending = false;
  }
});

loadStatus().catch((error) => {
  console.error("Не удалось загрузить состояние колеса:", error);
  button.disabled = true;
  result.textContent = error.message || "Не удалось подключиться к серверу.";
});
