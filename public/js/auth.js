const { keys, write, csrfFetch } = window.NovaPark;
const form = document.querySelector("#auth-form");
const error = document.querySelector("#auth-error");
const submit = document.querySelector("#auth-submit");
const mode = form.dataset.mode;
const registering = mode === "register";
const returnTarget = new URLSearchParams(window.location.search).get("return");
const returnToBooking = returnTarget === "booking";
const returnToPayment = returnTarget === "payment";
const returnToWheel = returnTarget === "wheel";
const switchLink = document.querySelector(".auth-switch-hint a");
if ((returnToBooking || returnToPayment || returnToWheel) && switchLink) {
  switchLink.search = `return=${returnTarget}`;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  const email = form.elements.email.value.trim().toLowerCase();
  const password = form.elements.password.value;
  const body = { email, password };

  if (registering) {
    const name = form.elements.name.value.trim();
    if (name.length < 2) {
      error.textContent = "Имя должно содержать не менее двух символов.";
      return;
    }
    if (password !== form.elements.confirmPassword.value) {
      error.textContent = "Пароли не совпадают.";
      return;
    }
    body.name = name;
  }

  submit.disabled = true;
  try {
    const response = await csrfFetch(`/api/${registering ? "register" : "login"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body)
    });
    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      if (response.status === 403 || /forbidden/i.test(responseText)) {
        throw new Error("Сервер отклонил запрос. Запусти сайт через Node.js: npm start, затем открой http://localhost:3000.");
      }
      throw new Error("Сервер входа вернул некорректный ответ. Запусти Node.js сервер и открой сайт через http://localhost:3000.");
    }
    if (!response.ok) throw new Error(result.error || "Не удалось выполнить запрос.");

    const sessionResponse = await fetch("/api/me", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    const sessionResult = await sessionResponse.json();
    if (!sessionResponse.ok || !sessionResult.user) {
      throw new Error("Вход выполнен, но сессия не сохранилась. Перезапусти сервер командой npm start и попробуй снова.");
    }

    write(keys.email, result.user.email);
    write(keys.name, result.user.name);
    window.location.href = returnToPayment
      ? "../html/payment.html"
      : returnToWheel
        ? "../html/wheel.html"
        : returnToBooking ? "../html/cart.html?resume=1" : "../html/account.html";
  } catch (requestError) {
    error.textContent = requestError instanceof TypeError
      ? "Не удалось подключиться к серверу. Запусти Node.js сервер командой npm start и открой сайт через http://localhost:3000."
      : requestError.message || "Не удалось подключиться к серверу.";
  } finally {
    submit.disabled = false;
  }
});
