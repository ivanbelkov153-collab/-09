const {
  addCartAttraction,
  allAttractions,
  escape,
  getCartAttractionIds,
  getDefaultGuests,
  price,
  setCartGuests,
  slug
} = window.NovaPark;
const frame = document.querySelector(".park-map-frame");
const world = document.querySelector("#map-world");
const markers = document.querySelector("#map-markers");
const attractionList = document.querySelector("#map-attraction-list");
const tip = document.querySelector("#map-tip");
const compass = document.querySelector(".map-compass");
const attractionPopover = document.querySelector("#map-attraction-popover");
const attractionPopoverTitle = document.querySelector("#map-attraction-title");
const attractionPopoverDetails = document.querySelector("#map-attraction-details");
const attractionPopoverClose = document.querySelector("#map-popover-close");
const cartForm = document.querySelector("#map-cart-form");
const adultCount = document.querySelector("#map-adult-count");
const childCount = document.querySelector("#map-child-count");
const cartFeedback = document.querySelector("#map-cart-feedback");
const addToCartButton = document.querySelector("#map-add-to-cart");
const state = { scale: 1, rotation: 0, x: 0, y: 0, pointer: null, startX: 0, startY: 0 };
let selectedAttraction = null;
let attractionsReady = false;
const minScale = 1;
const maxScale = 1.8;
let markerDrag = null;
let suppressClickMarker = null;
let popoverOpenTimer = null;
let popoverCloseTimer = null;
let activeMarker = null;
let selectedAttractionId = null;
let alreadyAdded = false;
const basePositions = {
  "roller-coaster": { left: 38, top: 36 },
  carousel: { left: 66, top: 28 },
  "ferris-wheel": { left: 76, top: 59 },
  "drop-tower": { left: 57, top: 65 },
  "magic-garden": { left: 32, top: 62 },
  autodrome: { left: 40, top: 74 }
};
const extraPositions = [
  { left: 17, top: 27 }, { left: 83, top: 25 }, { left: 86, top: 48 },
  { left: 85, top: 72 }, { left: 17, top: 75 }, { left: 14, top: 50 },
  { left: 50, top: 15 }, { left: 50, top: 85 }, { left: 30, top: 17 },
  { left: 70, top: 17 }, { left: 30, top: 83 }, { left: 70, top: 83 },
  { left: 20, top: 40 }, { left: 80, top: 40 }, { left: 22, top: 62 },
  { left: 78, top: 64 }, { left: 42, top: 17 }, { left: 58, top: 83 }
];

function extraPosition(index) {
  if (extraPositions[index]) return extraPositions[index];
  const angle = (index - extraPositions.length) * 2.4;
  return {
    left: Math.min(88, Math.max(12, 50 + 36 * Math.cos(angle))),
    top: Math.min(84, Math.max(16, 50 + 31 * Math.sin(angle)))
  };
}

function customPosition(item) {
  if (!item.mapPosition) return null;
  const left = Number(item.mapPosition.left);
  const top = Number(item.mapPosition.top);
  if (!Number.isFinite(left) || left < 5 || left > 95 || !Number.isFinite(top) || top < 5 || top > 95) {
    return null;
  }
  return { left, top };
}

function renderAttractions() {
  closeAttractionPopover();
  const items = allAttractions();
  const baseCount = window.NovaPark.attractions.length;
  markers.innerHTML = items.map((item, index) => {
    const id = item.id || slug(item.name);
    const position = customPosition(item) || basePositions[id] || extraPosition(index - baseCount);
    const draggable = attractionsReady && window.NovaPark.isAdmin();
    const dragLabel = draggable ? " Перетащите, чтобы изменить положение." : "";
    return `<button class="map-marker" type="button" data-attraction-id="${escape(id)}" data-attraction="${escape(item.name)}" data-draggable="${draggable}" aria-haspopup="dialog" aria-controls="map-attraction-popover" aria-expanded="false" aria-label="${escape(`Описание: ${item.name}.${dragLabel}`)}" style="left: ${position.left}%; top: ${position.top}%;">${index + 1}</button>`;
  }).join("");
  attractionList.innerHTML = items.map((item, index) => {
    const id = item.id || slug(item.name);
    return `<button type="button" data-map-select="${escape(item.name)}" data-attraction-id="${escape(id)}" aria-label="Найти ${escape(item.name)} на карте" aria-pressed="false"><i>${index + 1}</i>${escape(item.name)}</button>`;
  }).join("");
  if (selectedAttraction && items.some((item) => item.name === selectedAttraction)) {
    selectAttraction(selectedAttraction);
  } else {
    selectedAttraction = null;
    tip.innerHTML = '<span class="tip-icon">⌖</span><span>Наведите курсор на маркер или выберите аттракцион в списке, чтобы открыть описание.</span>';
  }
}

function clampPan() {
  const bounds = frame.getBoundingClientRect();
  const angle = state.rotation * Math.PI / 180;
  const width = bounds.width * state.scale;
  const height = bounds.height * state.scale;
  const rotatedWidth = Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * height;
  const rotatedHeight = Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * height;
  const maxX = Math.max(0, (rotatedWidth - bounds.width) / 2);
  const maxY = Math.max(0, (rotatedHeight - bounds.height) / 2);
  state.x = Math.min(maxX, Math.max(-maxX, state.x));
  state.y = Math.min(maxY, Math.max(-maxY, state.y));
}

function updateTransform() {
  clampPan();
  world.style.transform = `translate(${state.x}px, ${state.y}px) rotate(${state.rotation}deg) scale(${state.scale})`;
  compass.style.transform = `rotate(${state.rotation}deg)`;
}

function zoomBy(amount) {
  state.scale = Math.min(maxScale, Math.max(minScale, state.scale + amount));
  updateTransform();
}

document.querySelector("#map-zoom-in").addEventListener("click", () => zoomBy(.15));
document.querySelector("#map-zoom-out").addEventListener("click", () => zoomBy(-.15));
document.querySelector("#map-rotate-left").addEventListener("click", () => {
  state.rotation -= 15;
  updateTransform();
});
document.querySelector("#map-rotate-right").addEventListener("click", () => {
  state.rotation += 15;
  updateTransform();
});
document.querySelector("#map-reset").addEventListener("click", () => {
  state.scale = 1;
  state.rotation = 0;
  state.x = 0;
  state.y = 0;
  updateTransform();
});

frame.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".map-marker")) return;
  state.pointer = event.pointerId;
  state.startX = event.clientX;
  state.startY = event.clientY;
  frame.setPointerCapture(event.pointerId);
});

frame.addEventListener("pointermove", (event) => {
  if (state.pointer !== event.pointerId) return;
  state.x += event.clientX - state.startX;
  state.y += event.clientY - state.startY;
  state.startX = event.clientX;
  state.startY = event.clientY;
  updateTransform();
});

function finishPan(event) {
  if (state.pointer !== event.pointerId) return;
  state.pointer = null;
  frame.classList.remove("is-dragging");
}

frame.addEventListener("pointerup", finishPan);
frame.addEventListener("pointercancel", finishPan);
frame.addEventListener("gotpointercapture", (event) => {
  if (event.target === frame) frame.classList.add("is-dragging");
});
window.addEventListener("resize", updateTransform);
frame.addEventListener("wheel", (event) => {
  event.preventDefault();
  zoomBy(event.deltaY < 0 ? .08 : -.08);
}, { passive: false });

markers.addEventListener("pointerdown", (event) => {
  const marker = event.target.closest('.map-marker[data-draggable="true"]');
  if (!marker || event.button !== 0) return;
  suppressClickMarker = null;
  markerDrag = {
    marker,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startLeft: Number.parseFloat(marker.style.left),
    startTop: Number.parseFloat(marker.style.top),
    moved: false
  };
  marker.classList.add("is-moving");
  marker.setPointerCapture(event.pointerId);
});

markers.addEventListener("dragstart", (event) => {
  if (event.target.closest('.map-marker[data-draggable="true"]')) event.preventDefault();
});

window.addEventListener("pointermove", (event) => {
  if (!markerDrag || markerDrag.pointerId !== event.pointerId) return;
  const deltaX = event.clientX - markerDrag.startX;
  const deltaY = event.clientY - markerDrag.startY;
  if (!markerDrag.moved && Math.hypot(deltaX, deltaY) < 3) return;
  if (!markerDrag.moved) {
    cancelPopoverOpen();
    closeAttractionPopover();
  }
  markerDrag.moved = true;
  markerDrag.marker.classList.add("is-moving");
  const angle = state.rotation * Math.PI / 180;
  const localX = (Math.cos(angle) * deltaX + Math.sin(angle) * deltaY) / state.scale;
  const localY = (-Math.sin(angle) * deltaX + Math.cos(angle) * deltaY) / state.scale;
  const left = Math.min(95, Math.max(5, markerDrag.startLeft + localX / frame.clientWidth * 100));
  const top = Math.min(95, Math.max(5, markerDrag.startTop + localY / frame.clientHeight * 100));
  markerDrag.position = { left, top };
  markerDrag.marker.style.left = `${left}%`;
  markerDrag.marker.style.top = `${top}%`;
  event.preventDefault();
});

function findSwapTarget(drag) {
  let nearest = null;
  let nearestDistance = Infinity;
  markers.querySelectorAll(".map-marker").forEach((marker) => {
    if (marker.dataset.attractionId === drag.marker.dataset.attractionId) return;
    const left = Number.parseFloat(marker.style.left);
    const top = Number.parseFloat(marker.style.top);
    const deltaX = (left - drag.position.left) * frame.clientWidth / 100;
    const deltaY = (top - drag.position.top) * frame.clientHeight / 100;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= 40 && distance < nearestDistance) {
      nearest = marker;
      nearestDistance = distance;
    }
  });
  return nearest;
}

async function finishMarkerDrag(event) {
  if (!markerDrag || markerDrag.pointerId !== event.pointerId) return;
  const drag = markerDrag;
  markerDrag = null;
  drag.marker.classList.remove("is-moving");
  if (!drag.moved) return;
  selectedAttraction = drag.marker.dataset.attraction;
  if (!drag.position) return;
  const swapTarget = findSwapTarget(drag);
  const targetPosition = swapTarget
    ? {
      left: Number.parseFloat(swapTarget.style.left),
      top: Number.parseFloat(swapTarget.style.top)
    }
    : null;
  if (swapTarget && targetPosition) {
    drag.marker.style.left = `${targetPosition.left}%`;
    drag.marker.style.top = `${targetPosition.top}%`;
    swapTarget.style.left = `${drag.startLeft}%`;
    swapTarget.style.top = `${drag.startTop}%`;
  }
  suppressClickMarker = drag.marker;
  window.setTimeout(() => {
    if (suppressClickMarker === drag.marker) suppressClickMarker = null;
  }, 0);
  try {
    const firstId = drag.marker.dataset.attractionId;
    const secondId = swapTarget && swapTarget.dataset.attractionId;
    const response = await window.NovaPark.csrfFetch(swapTarget ? "/api/admin/attractions/swap" : `/api/admin/attractions/${encodeURIComponent(firstId)}`, {
      method: swapTarget ? "POST" : "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(swapTarget
        ? {
          firstId,
          secondId,
          firstPosition: { left: drag.startLeft, top: drag.startTop },
          secondPosition: targetPosition
        }
        : { mapPosition: drag.position })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Не удалось сохранить положение аттракциона.");
    window.NovaPark.applyAttractionSettings(result.settings);
    selectAttraction(drag.marker.dataset.attraction);
    tip.innerHTML = swapTarget
      ? `<span class="tip-icon">⌖</span><span><b>${escape(drag.marker.dataset.attraction)}</b> и <b>${escape(swapTarget.dataset.attraction)}</b> поменялись местами.</span>`
      : `<span class="tip-icon">⌖</span><span><b>${escape(drag.marker.dataset.attraction)}</b> · новое положение сохранено на сервере.</span>`;
  } catch (error) {
    console.error("Не удалось сохранить положение аттракциона:", error);
    try {
      await window.NovaPark.loadAttractionSettings(true);
    } catch (loadError) {
      console.error("Не удалось восстановить положение аттракциона:", loadError);
    }
    renderAttractions();
    suppressClickMarker = null;
    tip.textContent = error.message || "Не удалось сохранить положение аттракциона.";
  }
}

window.addEventListener("pointerup", finishMarkerDrag);
window.addEventListener("pointercancel", finishMarkerDrag);
window.addEventListener("click", (event) => {
  const marker = event.target instanceof Element ? event.target.closest(".map-marker") : null;
  if (!suppressClickMarker || marker !== suppressClickMarker) return;
  event.preventDefault();
  event.stopPropagation();
  suppressClickMarker = null;
}, true);

function selectAttraction(name) {
  selectedAttraction = name;
  const item = allAttractions().find((attraction) => attraction.name === name);
  document.querySelectorAll(".map-marker").forEach((marker) => {
    marker.classList.toggle("selected", marker.dataset.attraction === name);
  });
  document.querySelectorAll("[data-map-select]").forEach((button) => {
    const selected = button.dataset.mapSelect === name;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  if (!item) {
    tip.innerHTML = `<span class="tip-icon">⌖</span><span>${escape(name)} · подробности пока недоступны.</span>`;
    return;
  }
  const heightInfo = Number(item.height) > 0
    ? `рост от ${Number(item.height)} см`
    : "без ограничений по росту";
  tip.innerHTML = `<span class="tip-icon">⌖</span><span><b>${escape(item.name)}</b> · ${escape(item.category)} · ${heightInfo} · ${price(item.price)} за поездку.</span>`;
}

function focusAttraction(name) {
  const marker = Array.from(markers.querySelectorAll(".map-marker"))
    .find((item) => item.dataset.attraction === name);
  if (!marker) return;

  cancelPopoverOpen();
  closeAttractionPopover();
  const mapBounds = frame.getBoundingClientRect();
  const markerBounds = marker.getBoundingClientRect();
  const markerOutsideMap = markerBounds.right < mapBounds.left
    || markerBounds.left > mapBounds.right
    || markerBounds.bottom < mapBounds.top
    || markerBounds.top > mapBounds.bottom;
  if (markerOutsideMap) {
    state.scale = 1;
    state.rotation = 0;
    state.x = 0;
    state.y = 0;
    updateTransform();
  }

  openAttractionPopover(marker.dataset.attractionId, marker);
  frame.scrollIntoView({ behavior: "smooth", block: "center" });
}

function positionAttractionPopover(marker) {
  const markerBounds = marker.getBoundingClientRect();
  const popoverBounds = attractionPopover.getBoundingClientRect();
  const gap = 12;
  let left = markerBounds.right + gap;
  if (left + popoverBounds.width > window.innerWidth - 12) {
    left = markerBounds.left - popoverBounds.width - gap;
  }
  left = Math.max(12, Math.min(left, window.innerWidth - popoverBounds.width - 12));
  const top = Math.max(12, Math.min(
    markerBounds.top + (markerBounds.height - popoverBounds.height) / 2,
    window.innerHeight - popoverBounds.height - 12
  ));
  attractionPopover.style.left = `${left}px`;
  attractionPopover.style.top = `${top}px`;
}

function openAttractionPopover(id, marker) {
  const item = allAttractions().find((attraction) => attraction.id === id);
  if (!item || !marker) return;
  if (activeMarker && activeMarker !== marker) activeMarker.setAttribute("aria-expanded", "false");
  activeMarker = marker;
  activeMarker.setAttribute("aria-expanded", "true");
  selectAttraction(item.name);
  attractionPopoverTitle.textContent = item.name;
  const heightInfo = Number(item.height) > 0
    ? `Рост от ${Number(item.height)} см`
    : "Без ограничений по росту";
  attractionPopoverDetails.textContent = `${item.category} · ${heightInfo} · ${price(item.price)} за поездку.`;
  selectedAttractionId = id;
  const guestLimits = getDefaultGuests();
  adultCount.max = String(guestLimits.adult);
  childCount.max = String(guestLimits.child);
  adultCount.value = "0";
  childCount.value = "0";
  updateGuestCounters();
  alreadyAdded = getCartAttractionIds().includes(id);
  addToCartButton.innerHTML = alreadyAdded
    ? 'Сохранить гостей <span aria-hidden="true">→</span>'
    : 'Добавить в корзину <span aria-hidden="true">→</span>';
  cartFeedback.textContent = alreadyAdded ? "Аттракцион уже в корзине." : "";
  attractionPopover.hidden = false;
  positionAttractionPopover(marker);
}

function updateGuestCounters() {
  [adultCount, childCount].forEach((input) => {
    const value = Number(input.value);
    const counter = input.closest("[data-map-guest-counter]");
    counter.querySelector('[data-map-guest-step="-1"]').disabled = value <= Number(input.min);
    counter.querySelector('[data-map-guest-step="1"]').disabled = value >= Number(input.max);
  });
}

function closeAttractionPopover() {
  cancelPopoverClose();
  if (activeMarker && activeMarker.isConnected) activeMarker.setAttribute("aria-expanded", "false");
  activeMarker = null;
  attractionPopover.hidden = true;
}

function cancelPopoverOpen() {
  if (popoverOpenTimer !== null) window.clearTimeout(popoverOpenTimer);
  popoverOpenTimer = null;
}

function cancelPopoverClose() {
  if (popoverCloseTimer !== null) window.clearTimeout(popoverCloseTimer);
  popoverCloseTimer = null;
}

function schedulePopoverClose() {
  cancelPopoverClose();
  if (window.matchMedia("(hover: none)").matches) return;
  popoverCloseTimer = window.setTimeout(() => {
    popoverCloseTimer = null;
    const markerHovered = activeMarker && activeMarker.matches(":hover");
    const markerFocused = activeMarker && activeMarker.matches(":focus");
    const popoverHovered = attractionPopover.matches(":hover");
    const popoverFocused = attractionPopover.matches(":focus-within");
    if (!markerHovered && !markerFocused && !popoverHovered && !popoverFocused) {
      closeAttractionPopover();
    }
  }, 250);
}

function schedulePopoverOpen(marker) {
  if (markerDrag) return;
  cancelPopoverOpen();
  cancelPopoverClose();
  popoverOpenTimer = window.setTimeout(() => {
    popoverOpenTimer = null;
    if (marker.isConnected && !marker.classList.contains("is-moving")) {
      openAttractionPopover(marker.dataset.attractionId, marker);
    }
  }, 350);
}

attractionPopoverClose.addEventListener("click", closeAttractionPopover);
attractionPopover.addEventListener("pointerenter", cancelPopoverClose);
attractionPopover.addEventListener("pointerleave", schedulePopoverClose);
attractionPopover.addEventListener("focusin", cancelPopoverClose);
attractionPopover.addEventListener("focusout", schedulePopoverClose);
attractionPopover.addEventListener("pointerdown", (event) => event.stopPropagation());
attractionPopover.addEventListener("click", (event) => {
  const stepButton = event.target.closest("[data-map-guest-step]");
  if (stepButton && !stepButton.disabled) {
    const input = document.getElementById(stepButton.dataset.mapGuestTarget);
    input.value = String(Math.min(Number(input.max), Math.max(Number(input.min),
      Number(input.value) + Number(stepButton.dataset.mapGuestStep))));
    updateGuestCounters();
  }
  event.stopPropagation();
});
attractionPopover.addEventListener("input", (event) => {
  if (event.target === adultCount || event.target === childCount) updateGuestCounters();
});
cartForm.addEventListener("submit", (event) => {
  event.preventDefault();
  cartFeedback.textContent = "";
  try {
    if (!selectedAttractionId) throw new Error("Сначала выберите аттракцион на карте.");
    setCartGuests(Number(adultCount.value), Number(childCount.value));
    addCartAttraction(selectedAttractionId);
    cartFeedback.textContent = alreadyAdded
      ? "Количество гостей сохранено."
      : "Аттракцион добавлен в корзину. Бронь оформляется в корзине.";
    alreadyAdded = true;
    addToCartButton.innerHTML = 'Сохранить гостей <span aria-hidden="true">→</span>';
  } catch (error) {
    cartFeedback.textContent = error.message || "Не удалось обновить корзину.";
  }
});
attractionPopover.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAttractionPopover();
});
window.addEventListener("resize", () => {
  if (!attractionPopover.hidden && activeMarker) positionAttractionPopover(activeMarker);
});
window.addEventListener("scroll", () => {
  if (!attractionPopover.hidden && activeMarker) positionAttractionPopover(activeMarker);
}, true);

markers.addEventListener("pointerover", (event) => {
  const marker = event.target.closest(".map-marker");
  if (!marker || marker.contains(event.relatedTarget)) return;
  schedulePopoverOpen(marker);
});
markers.addEventListener("pointerout", (event) => {
  const marker = event.target.closest(".map-marker");
  if (!marker || marker.contains(event.relatedTarget)) return;
  cancelPopoverOpen();
  if (event.relatedTarget !== attractionPopover && !attractionPopover.contains(event.relatedTarget)) {
    schedulePopoverClose();
  }
});
markers.addEventListener("focusin", (event) => {
  const marker = event.target.closest(".map-marker");
  if (marker) schedulePopoverOpen(marker);
});
markers.addEventListener("focusout", schedulePopoverClose);
markers.addEventListener("click", (event) => {
  const marker = event.target.closest(".map-marker");
  if (marker && (event.pointerType === "touch" || window.matchMedia("(hover: none)").matches)) {
    openAttractionPopover(marker.dataset.attractionId, marker);
  }
});

document.querySelector(".map-legend").addEventListener("click", (event) => {
  const button = event.target.closest("[data-map-select]");
  if (!button) return;
  focusAttraction(button.dataset.mapSelect);
});
window.addEventListener("novapark:attractions-updated", renderAttractions);
window.addEventListener("novapark:role-changed", renderAttractions);
renderAttractions();
window.NovaPark.loadAttractionSettings().then(() => {
  attractionsReady = true;
  renderAttractions();
}).catch((error) => {
  console.error("Не удалось загрузить аттракционы:", error);
  tip.textContent = error.message || "Не удалось загрузить аттракционы с сервера.";
});
