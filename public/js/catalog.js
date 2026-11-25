const { allAttractions, card } = window.NovaPark;
const filters = document.querySelector("#category-filters");
const grid = document.querySelector("#catalog-attractions");
const search = document.querySelector("#attraction-search");
const count = document.querySelector("#catalog-count");
const heading = document.querySelector(".page-heading h1");
const introduction = document.querySelector(".page-heading p");
const eyebrow = document.querySelector(".page-heading .eyebrow");
const mapLink = document.querySelector("#ride-map-link");
const pageQuery = new URLSearchParams(window.location.search);
const requestedRideId = pageQuery.get("ride");
const addAttractionId = pageQuery.get("add");
const editGuests = pageQuery.get("guests") === "1";
const guestPopup = document.querySelector("#guest-edit-popup");
const guestForm = document.querySelector("#guest-form");
const guestAdultInput = document.querySelector("#guest-adult-count");
const guestChildInput = document.querySelector("#guest-child-count");
const guestFeedback = document.querySelector("#guest-feedback");
const guestSubmitLabel = document.querySelector("#guest-submit-label");
const categories = ["Все", "Экстремальные", "Семейные", "Детские"];
let selected = "Все";
function render() {
  const requestedRide = requestedRideId
    ? allAttractions().find((item) => item.id === requestedRideId)
    : null;
  if (requestedRide) {
    grid.classList.add("single-attraction");
    document.title = `${requestedRide.name} — Nova Park`;
    heading.textContent = requestedRide.name;
    introduction.textContent = "Посмотрите условия посещения и выберите билет на эту поездку.";
    eyebrow.textContent = "АТТРАКЦИОН";
    search.closest(".search-box").hidden = true;
    filters.hidden = true;
    count.hidden = true;
    mapLink.hidden = false;
  }
  const query = search.value.trim().toLocaleLowerCase("ru");
  const items = allAttractions().filter((item) => requestedRide
    ? item.id === requestedRideId
    : (selected === "Все" || item.category === selected)
      && item.name.toLocaleLowerCase("ru").includes(query));
  grid.innerHTML = items.length ? items.map(card).join("") : '<div class="empty-state">Ничего не найдено. Измени запрос или категорию.</div>';
  if (!requestedRide) count.textContent = `Найдено аттракционов: ${items.length}`;
}
filters.innerHTML = categories.map((item) => `<button class="filter-chip${item === selected ? " active" : ""}" data-category="${item}">${item}</button>`).join("");
filters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  selected = button.dataset.category;
  filters.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.toggle("active", chip === button));
  render();
});
search.addEventListener("input", render);
function closeGuestPopup() {
  guestPopup.hidden = true;
}
document.querySelector("#guest-cancel").addEventListener("click", closeGuestPopup);
document.querySelector("#guest-close").addEventListener("click", closeGuestPopup);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !guestPopup.hidden) closeGuestPopup();
});
document.addEventListener("click", (event) => {
  if (!guestPopup.hidden && !guestPopup.contains(event.target)) closeGuestPopup();
});
guestForm.addEventListener("submit", (event) => {
  event.preventDefault();
  guestFeedback.textContent = "";
  try {
    window.NovaPark.setCartGuests(Number(guestAdultInput.value), Number(guestChildInput.value));
    closeGuestPopup();
    render();
    document.querySelector("#catalog-feedback").textContent = "Количество гостей сохранено.";
  } catch (error) {
    guestFeedback.textContent = error.message || "Проверь данные и попробуй снова.";
  }
});
render();
window.addEventListener("novapark:attractions-updated", render);
window.addEventListener("novapark:cart-updated", render);

async function initialize() {
  try {
    await window.NovaPark.loadAttractionSettings();
    if (!addAttractionId && !editGuests) return;
    if (addAttractionId && !allAttractions().some((item) => item.id === addAttractionId)) {
      throw new Error("Этот аттракцион больше недоступен. Обнови каталог.");
    }
    window.history.replaceState(null, "", window.location.pathname);
    if (addAttractionId) {
      const rideCard = Array.from(grid.querySelectorAll(".attraction-card"))
        .find((item) => item.dataset.attractionId === addAttractionId);
      const addButton = rideCard && rideCard.querySelector("[data-open-guest-popup]");
      if (addButton) {
        addButton.click();
      } else {
        window.location.replace("../html/cart.html");
      }
      return;
    }
    const guestLimits = window.NovaPark.getDefaultGuests();
    const cartGuests = window.NovaPark.getCartGuests();
    const guests = cartGuests || guestLimits;
    guestAdultInput.max = String(guestLimits.adult);
    guestChildInput.max = String(guestLimits.child);
    guestAdultInput.value = String(guests ? guests.adult : 1);
    guestChildInput.value = String(guests ? guests.child : 0);
    guestSubmitLabel.textContent = "Сохранить";
    guestPopup.hidden = false;
    guestAdultInput.focus();
  } catch (error) {
    console.error("Не удалось загрузить аттракционы:", error);
    document.querySelector("#catalog-feedback").textContent = error.message || "Не удалось загрузить аттракционы.";
  }
}

initialize();
