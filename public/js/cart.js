(() => {
  const { allAttractions, getCartAttractionIds, getCartGuests, removeCartAttraction, clearCart, escape, price } = window.NovaPark;
  const list = document.querySelector("#cart-items");
  const empty = document.querySelector("#cart-empty");
  const bookingControls = document.querySelector("#cart-booking-controls");
  const bookingEmpty = document.querySelector("#cart-booking-empty");
  const feedback = document.querySelector("#cart-feedback");
  const itemCount = document.querySelector("#cart-item-count");
  const summaryCount = document.querySelector("#cart-summary-count");
  const guestsSummary = document.querySelector("#cart-guests-summary");
  const clearButton = document.querySelector("#cart-clear");
  const bookButton = document.querySelector("#book-tickets");

  function render() {
    const ids = getCartAttractionIds();
    const cartGuests = getCartGuests();
    const guests = cartGuests || (ids.length ? window.NovaPark.getDefaultGuests() : null);
    const available = allAttractions();
    const items = ids.map((id) => available.find((item) => item.id === id));

    itemCount.textContent = String(ids.length);
    summaryCount.textContent = String(ids.length);
    guestsSummary.textContent = guests ? `Взрослых: ${guests.adult}, детей: ${guests.child}` : "Не указаны";
    empty.hidden = ids.length > 0;
    list.hidden = ids.length === 0;
    bookingControls.hidden = ids.length === 0;
    bookingEmpty.hidden = ids.length > 0;
    bookButton.hidden = ids.length === 0 || !guests;
    clearButton.hidden = ids.length === 0;

    list.innerHTML = ids.map((id, index) => {
      const item = items[index];
      if (!item) {
        return `<article class="cart-item"><div><h3>Аттракцион недоступен</h3><p>Возможно, он был удалён из каталога.</p></div><button class="cart-remove-button" type="button" data-remove="${escape(id)}">Удалить</button></article>`;
      }
      const height = Number(item.height) > 0 ? `Рост: от ${Number(item.height)} см` : "Рост: без ограничений";
      return `<article class="cart-item"><div><h3>${escape(item.name)}</h3><p>Категория: ${escape(item.category)} · ${height}</p></div><div class="cart-item-price"><strong>${price(item.price)}</strong><button class="cart-remove-button" type="button" data-remove="${escape(id)}">Удалить</button></div></article>`;
    }).join("");
  }

  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    try {
      removeCartAttraction(button.dataset.remove);
      feedback.textContent = "";
      render();
    } catch (error) {
      feedback.textContent = error.message || "Не удалось изменить корзину.";
    }
  });

  clearButton.addEventListener("click", () => {
    try {
      clearCart();
      feedback.textContent = "";
      render();
    } catch (error) {
      feedback.textContent = error.message || "Не удалось очистить корзину.";
    }
  });

  window.addEventListener("novapark:cart-updated", render);
  window.addEventListener("novapark:cart-guests-updated", render);
  window.addEventListener("novapark:attractions-updated", render);

  async function initialize() {
    const addId = new URLSearchParams(window.location.search).get("add");
    if (addId) {
      window.location.replace(`../html/catalog.html?add=${encodeURIComponent(addId)}`);
      return;
    }
    try {
      await window.NovaPark.loadAttractionSettings();
      feedback.textContent = "";
    } catch (error) {
      feedback.textContent = error.message || "Не удалось загрузить аттракционы.";
    } finally {
      render();
    }
  }

  render();
  initialize();
})();
