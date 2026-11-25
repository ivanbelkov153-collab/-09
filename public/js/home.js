const homeAttractions = document.querySelector("#home-attractions");
if (homeAttractions) {
  const render = () => {
    homeAttractions.innerHTML = window.NovaPark.allAttractions().slice(0, 3).map(window.NovaPark.card).join("");
  };
  render();
  window.addEventListener("novapark:attractions-updated", render);
  window.addEventListener("novapark:cart-updated", render);
  window.NovaPark.loadAttractionSettings().catch((error) => {
    console.error("Не удалось загрузить аттракционы:", error);
  });
}
