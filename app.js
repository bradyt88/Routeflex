const MAX_STOPS = 30;
const POSTCODE_API = "https://api.postcodes.io/postcodes";
const OSRM_TABLE_API = "https://router.project-osrm.org/table/v1/driving/";
const OSRM_ROUTE_API = "https://router.project-osrm.org/route/v1/driving/";
const EXACT_ROUTE_LIMIT = 8;
const DRIVER_MODE_STORAGE_KEY = "routeflex-driver-mode-state-v1";
const SAVED_ROUTES_STORAGE_KEY = "routeflex-saved-routes-v1";

let map;
let routeLine = null;
let markerLayer = null;
let lastOrderedStops = [];
let routeState = null;
let routeSummary = null;
let driverModeState = null;
let currentLocation = null;
let locationMarker = null;
let savedRoutes = [];
let busy = false;

const els = {
  start: document.getElementById("start-postcode"),
  stops: document.getElementById("stops"),
  addStop: document.getElementById("add-stop"),
  count: document.getElementById("stop-count"),
  optimise: document.getElementById("optimise"),
  clear: document.getElementById("clear-all"),
  example: document.getElementById("load-example"),
  routeStatus: document.getElementById("route-status"),
  distance: document.getElementById("distance"),
  duration: document.getElementById("duration"),
  routeStops: document.getElementById("route-stops"),
  routeList: document.getElementById("route-list"),
  navigation: document.getElementById("open-navigation"),
  toast: document.getElementById("toast"),
  returnToStart: document.getElementById("return-to-start"),
  expandMap: document.getElementById("expand-map"),
  downloadRoute: document.getElementById("download-route"),
  useCurrentLocation: document.getElementById("use-current-location"),
  recalculateRemainingRoute: document.getElementById("recalculate-remaining-route"),
  routeOptionFastest: document.getElementById("route-option-fastest"),
  routeOptionShortest: document.getElementById("route-option-shortest"),
  selectedRouteLabel: document.getElementById("selected-route-label"),
  summaryTotalMiles: document.getElementById("summary-total-miles"),
  summaryDrivingTime: document.getElementById("summary-driving-time"),
  summaryDeliveries: document.getElementById("summary-deliveries"),
  summaryStart: document.getElementById("summary-start"),
  summaryReturn: document.getElementById("summary-return"),
  startDriverMode: document.getElementById("start-driver-mode"),
  driverModeOverlay: document.getElementById("driver-mode-overlay"),
  driverModeProgress: document.getElementById("driver-mode-progress"),
  driverModeStatus: document.getElementById("driver-mode-status"),
  driverStopNumber: document.getElementById("driver-stop-number"),
  driverPostcode: document.getElementById("driver-postcode"),
  driverHouseUnit: document.getElementById("driver-house-unit"),
  driverStreet: document.getElementById("driver-street"),
  driverNotes: document.getElementById("driver-notes"),
  driverDistance: document.getElementById("driver-distance"),
  driverDuration: document.getElementById("driver-duration"),
  driverRemainingDistance: document.getElementById("driver-remaining-distance"),
  driverRemainingDuration: document.getElementById("driver-remaining-duration"),
  driverRemainingStops: document.getElementById("driver-remaining-stops"),
  driverModeRunComplete: document.getElementById("driver-mode-run-complete"),
  driverModeCompleteText: document.getElementById("driver-mode-complete-text"),
  driverModeReturnText: document.getElementById("driver-mode-return-text"),
  driverModeReturnHome: document.getElementById("driver-mode-return-home"),
  driverModeNavigate: document.getElementById("driver-mode-navigate"),
  driverModePrevious: document.getElementById("driver-mode-previous"),
  driverModeNext: document.getElementById("driver-mode-next"),
  driverModeMarkDelivered: document.getElementById("driver-mode-mark-delivered"),
  exitDriverMode: document.getElementById("exit-driver-mode"),
  routeNameInput: document.getElementById("route-name-input"),
  saveRoute: document.getElementById("save-route"),
  loadSavedRoute: document.getElementById("load-saved-route"),
  deleteSavedRoute: document.getElementById("delete-saved-route"),
  savedRoutesList: document.getElementById("saved-routes-list")
};

function initMap() {
  map = L.map("map", { zoomControl: true }).setView([54.2, -2.5], 6);

  L.maplibreGL({
    style: "https://tiles.openfreemap.org/styles/liberty"
  }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);
}

function normalisePostcode(value) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function updateCount() {
  const count = document.querySelectorAll(".stop-row").length;
  els.count.textContent = `${count} / ${MAX_STOPS}`;
  els.addStop.disabled = count >= MAX_STOPS;
}

function addStop(value = "", options = {}) {
  const count = document.querySelectorAll(".stop-row").length;
  if (count >= MAX_STOPS) return;

  const row = document.createElement("div");
  row.className = "stop-row";
  row.innerHTML = `
    <div class="stop-number" aria-hidden="true">${count + 1}</div>
    <div class="stop-inputs">
      <div class="postcode-wrap">
        <input class="postcode-input stop-input" inputmode="text" autocomplete="postal-code"
               maxlength="8" placeholder="e.g. BB12 7XX" value="${escapeHtml(value.postcode || value || "")}">
        <button class="voice-button" type="button" aria-label="Voice input for delivery postcode">🎙</button>
      </div>
      <div class="detail-grid">
        <input class="detail-input house-input" inputmode="text" placeholder="House / unit"
               value="${escapeHtml(value.houseUnit || "")}">
        <input class="detail-input street-input" inputmode="text" placeholder="Street / address"
               value="${escapeHtml(value.street || "")}">
        <input class="detail-input notes-input" inputmode="text" placeholder="Delivery notes"
               value="${escapeHtml(value.notes || "")}">
      </div>
    </div>
    <button class="remove-stop" type="button" aria-label="Remove stop ${count + 1}">×</button>
  `;

  row.querySelector(".remove-stop").addEventListener("click", () => {
    row.remove();
    renumberStops();
    updateCount();
  });

  row.querySelector(".stop-input").addEventListener("input", (event) => {
    event.target.value = event.target.value.toUpperCase();
  });

  bindVoiceInput(
    row.querySelector(".stop-input"),
    row.querySelector(".voice-button")
  );

  els.stops.appendChild(row);
  updateCount();
}

function renumberStops() {
  [...document.querySelectorAll(".stop-row")].forEach((row, i) => {
    row.querySelector(".stop-number").textContent = i + 1;
    row.querySelector(".remove-stop").setAttribute("aria-label", `Remove stop ${i + 1}`);
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[ch]));
}

function getStartPostcode() {
  return normalisePostcode(els.start.value);
}

function getDeliveryStops() {
  return [...document.querySelectorAll(".stop-row")].map((row) => ({
    postcode: normalisePostcode(row.querySelector(".stop-input").value),
    houseUnit: row.querySelector(".house-input").value.trim(),
    street: row.querySelector(".street-input").value.trim(),
    notes: row.querySelector(".notes-input").value.trim()
  })).filter(stop => stop.postcode);
}

function getDeliveryPostcodes() {
  return getDeliveryStops().map(stop => stop.postcode);
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 2800);
}

function setBusy(state) {
  busy = state;
  els.optimise.disabled = state;
  els.optimise.querySelector("span").textContent = state ? "Planning route…" : "Optimise my route";
}

function getSpeechRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

function cleanSpokenPostcode(text) {
  if (!text) return "";

  const spokenDigitMap = {
    zero: "0",
    oh: "0",
    nil: "0",
    o: "0",
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9"
  };

  const cleanedText = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(space|dash|hyphen|slash)\b/g, " ")
    .trim();

  const tokens = cleanedText.split(/\s+/).filter(Boolean);

  const compact = tokens.reduce((result, token) => {
    const trimmed = token.trim();

    if (spokenDigitMap[trimmed] !== undefined) {
      return result + spokenDigitMap[trimmed];
    }

    if (/^\d+$/.test(trimmed)) {
      return result + trimmed;
    }

    if (/^[a-z]$/.test(trimmed)) {
      return result + trimmed.toUpperCase();
    }

    if (/^[a-z]+$/.test(trimmed)) {
      return result + trimmed.toUpperCase();
    }

    return result;
  }, "");

  const compactValue = compact.replace(/\s+/g, "").toUpperCase();
  const formatted = compactValue.match(/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/)
    ? `${compactValue.slice(0, -3)} ${compactValue.slice(-3)}`
    : compactValue;

  return normalisePostcode(formatted);
}

function setVoiceButtonState(button, listening) {
  button.classList.toggle("listening", listening);
  button.setAttribute("aria-pressed", String(listening));
  button.setAttribute("aria-label", listening ? "Listening for postcode" : "Voice input for postcode");
  button.textContent = listening ? "◉" : "🎙";
}

async function requestMicrophoneAccess() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return false;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch (error) {
    return false;
  }
}

function bindVoiceInput(input, button) {
  const SpeechRecognitionCtor = getSpeechRecognitionConstructor();

  if (!SpeechRecognitionCtor) {
    button.addEventListener("click", () => {
      showToast("Voice input isn't supported on this device/browser. Please type the postcode.");
    });
    return;
  }

  const recognition = new SpeechRecognitionCtor();
  recognition.lang = "en-GB";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  let isListening = false;

  const startListening = async () => {
    if (isListening) return;

    const hasPermission = await requestMicrophoneAccess();
    if (!hasPermission) {
      showToast("Microphone access was blocked. Please allow microphone access or type the postcode.");
      return;
    }

    isListening = true;
    setVoiceButtonState(button, true);
    showToast("Listening...");
    recognition.start();
  };

  button.addEventListener("click", startListening);

  recognition.addEventListener("result", (event) => {
    const transcript = Array.from(event.results)
      .map(result => result[0].transcript)
      .join(" ");

    const cleaned = cleanSpokenPostcode(transcript);
    if (cleaned) {
      input.value = cleaned;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      handleOptimise();
      showToast(`Recognised postcode: ${cleaned}`);
    } else {
      showToast("No postcode could be recognised. Please type the postcode.");
    }

    recognition.stop();
  });

  recognition.addEventListener("start", () => {
    isListening = true;
    setVoiceButtonState(button, true);
  });

  recognition.addEventListener("end", () => {
    isListening = false;
    setVoiceButtonState(button, false);
  });

  recognition.addEventListener("error", (event) => {
    isListening = false;
    setVoiceButtonState(button, false);

    if (event.error === "not-allowed") {
      showToast("Microphone access was blocked. Please allow microphone access or type the postcode.");
      return;
    }

    if (event.error !== "no-speech") {
      showToast("Voice input couldn't be processed. Please type the postcode.");
    }
  });
}

async function lookupPostcodes(postcodes) {
  const response = await fetch(`${POSTCODE_API}?filter=postcode,longitude,latitude,admin_district,region`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ postcodes })
  });

  if (!response.ok) throw new Error("The postcode service could not be reached.");

  const data = await response.json();

  return data.result.map((entry, index) => {
    if (!entry.result || entry.result.longitude == null || entry.result.latitude == null) {
      return { input: postcodes[index], valid: false };
    }

    return {
      input: postcodes[index],
      postcode: entry.result.postcode,
      longitude: Number(entry.result.longitude),
      latitude: Number(entry.result.latitude),
      district: entry.result.admin_district || "",
      region: entry.result.region || "",
      valid: true
    };
  });
}

function buildPointEntries(results, deliveryStops, startPostcode) {
  const enriched = results.map((entry, index) => {
    const isStart = Boolean(startPostcode) && index === 0;
    const stopMeta = isStart ? null : deliveryStops[index - (startPostcode ? 1 : 0)];

    return {
      ...entry,
      houseUnit: stopMeta?.houseUnit || "",
      street: stopMeta?.street || "",
      notes: stopMeta?.notes || ""
    };
  });

  const startPoint = startPostcode ? enriched[0] : null;
  const points = startPoint ? [startPoint, ...enriched.slice(1)] : enriched;

  return { startPoint, points };
}

async function getTravelMatrix(points) {
  if (!points.length) return { durations: [], distances: [] };

  const coordinates = points.map(point => `${point.longitude},${point.latitude}`).join(";");
  const response = await fetch(`${OSRM_TABLE_API}${coordinates}?annotations=duration,distance`);

  if (!response.ok) {
    throw new Error("The routing matrix service could not be reached.");
  }

  const data = await response.json();

  if (data.code !== "Ok" || !Array.isArray(data.durations) || !Array.isArray(data.distances)) {
    throw new Error("No travel-time matrix could be calculated for these locations.");
  }

  return {
    durations: data.durations,
    distances: data.distances
  };
}

async function getRoadRoute(points) {
  const coordinates = points.map(point => `${point.longitude},${point.latitude}`).join(";");
  const response = await fetch(`${OSRM_ROUTE_API}${coordinates}?overview=full&geometries=geojson`);

  if (!response.ok) {
    throw new Error("Could not build the final road line.");
  }

  const data = await response.json();

  if (data.code !== "Ok" || !data.routes?.length) {
    throw new Error("No road route was returned.");
  }

  return data.routes[0];
}

function getMatrixCost(matrix, metric, fromIndex, toIndex) {
  const value = metric === "distance"
    ? matrix.distances[fromIndex][toIndex]
    : matrix.durations[fromIndex][toIndex];

  return Number(value);
}

function routeCost(order, matrix, metric, startIndex, returnToStart) {
  if (!order.length) return 0;

  if (startIndex !== null) {
    let total = 0;
    let previousIndex = startIndex;

    for (const stopIndex of order) {
      total += getMatrixCost(matrix, metric, previousIndex, stopIndex);
      previousIndex = stopIndex;
    }

    if (returnToStart) {
      total += getMatrixCost(matrix, metric, previousIndex, startIndex);
    }

    return total;
  }

  let total = 0;
  let previousIndex = order[0];

  for (let i = 1; i < order.length; i += 1) {
    total += getMatrixCost(matrix, metric, previousIndex, order[i]);
    previousIndex = order[i];
  }

  return total;
}

function reverseSegment(order, start, end) {
  const next = [...order];
  const reversed = next.slice(start, end + 1).reverse();
  next.splice(start, end - start + 1, ...reversed);
  return next;
}

function improveWithTwoOpt(order, matrix, metric, startIndex, returnToStart) {
  let bestOrder = [...order];
  let bestCost = routeCost(bestOrder, matrix, metric, startIndex, returnToStart);
  let improved = true;

  while (improved) {
    improved = false;

    for (let i = 0; i < bestOrder.length - 1; i += 1) {
      for (let j = i + 1; j < bestOrder.length; j += 1) {
        const candidate = reverseSegment(bestOrder, i, j);
        const candidateCost = routeCost(candidate, matrix, metric, startIndex, returnToStart);

        if (candidateCost < bestCost) {
          bestOrder = candidate;
          bestCost = candidateCost;
          improved = true;
        }
      }
    }
  }

  return bestOrder;
}

function generatePermutations(items) {
  if (items.length <= 1) {
    return [[...items]];
  }

  const permutations = [];

  items.forEach((item, index) => {
    const remaining = items.filter((_, itemIndex) => itemIndex !== index);
    generatePermutations(remaining).forEach(suffix => {
      permutations.push([item, ...suffix]);
    });
  });

  return permutations;
}

function solveExactRoute(deliveryIndices, matrix, metric, startIndex, returnToStart) {
  let bestOrder = [...deliveryIndices];
  let bestCost = Infinity;

  generatePermutations(deliveryIndices).forEach(permutation => {
    const cost = routeCost(permutation, matrix, metric, startIndex, returnToStart);

    if (cost < bestCost) {
      bestCost = cost;
      bestOrder = permutation;
    }
  });

  return bestOrder;
}

function solveHeuristicRoute(deliveryIndices, matrix, metric, startIndex, returnToStart) {
  const remaining = [...deliveryIndices];
  let currentIndex = startIndex !== null ? startIndex : remaining.shift();
  const order = startIndex !== null ? [] : [currentIndex];

  while (remaining.length) {
    let nearest = remaining[0];
    let nearestCost = Number.POSITIVE_INFINITY;

    remaining.forEach(candidate => {
      const cost = getMatrixCost(matrix, metric, currentIndex, candidate);
      if (cost < nearestCost) {
        nearestCost = cost;
        nearest = candidate;
      }
    });

    remaining.splice(remaining.indexOf(nearest), 1);
    order.push(nearest);
    currentIndex = nearest;
  }

  return improveWithTwoOpt(order, matrix, metric, startIndex, returnToStart);
}

function solveRouteOrder(points, matrix, metric, startIndex, returnToStart) {
  const deliveryIndices = startIndex === null
    ? points.map((_, index) => index)
    : points.slice(1).map((_, index) => index + 1);

  if (!deliveryIndices.length) {
    return {
      deliveryOrder: [],
      orderedPoints: startIndex === null ? [] : [points[0]],
      cost: 0
    };
  }

  let routeOrder = deliveryIndices;

  if (deliveryIndices.length <= EXACT_ROUTE_LIMIT) {
    routeOrder = solveExactRoute(deliveryIndices, matrix, metric, startIndex, returnToStart);
  } else {
    routeOrder = solveHeuristicRoute(deliveryIndices, matrix, metric, startIndex, returnToStart);
  }

  const orderedPoints = startIndex === null
    ? routeOrder.map(index => points[index])
    : [points[startIndex], ...routeOrder.map(index => points[index])];

  if (startIndex !== null && returnToStart) {
    orderedPoints.push(points[startIndex]);
  }

  return {
    deliveryOrder: routeOrder.map(index => points[index]),
    orderedPoints,
    cost: routeCost(routeOrder, matrix, metric, startIndex, returnToStart)
  };
}

function buildRouteRows(plan, points, startPoint, returnToStart, matrix) {
  const rows = [];

  if (startPoint) {
    rows.push({
      type: "start",
      routeLabel: "START / DEPOT",
      stopNumber: "S",
      postcode: startPoint.postcode,
      houseUnit: "",
      street: "",
      notes: "Depot / start point",
      distance: null,
      duration: null
    });
  }

  const deliveryPoints = plan.deliveryOrder || [];

  for (let i = 0; i < deliveryPoints.length; i += 1) {
    const currentPoint = deliveryPoints[i];
    const previousPoint = startPoint && i === 0 ? startPoint : deliveryPoints[i - 1];
    const currentIndex = points.indexOf(currentPoint);
    const previousIndex = previousPoint ? points.indexOf(previousPoint) : -1;

    rows.push({
      type: "delivery",
      routeLabel: `Stop ${i + 1}`,
      stopNumber: i + 1,
      postcode: currentPoint.postcode,
      houseUnit: currentPoint.houseUnit || "",
      street: currentPoint.street || "",
      notes: currentPoint.notes || "",
      distance: previousPoint ? getMatrixCost(matrix, "distance", previousIndex, currentIndex) : null,
      duration: previousPoint ? getMatrixCost(matrix, "duration", previousIndex, currentIndex) : null
    });
  }

  if (startPoint && returnToStart && deliveryPoints.length) {
    const lastDelivery = deliveryPoints[deliveryPoints.length - 1];
    const startIndex = points.indexOf(startPoint);
    const lastDeliveryIndex = points.indexOf(lastDelivery);

    rows.push({
      type: "return",
      routeLabel: "HOME / START",
      stopNumber: "H",
      postcode: startPoint.postcode,
      houseUnit: "",
      street: "",
      notes: "Return to start",
      distance: getMatrixCost(matrix, "distance", lastDeliveryIndex, startIndex),
      duration: getMatrixCost(matrix, "duration", lastDeliveryIndex, startIndex)
    });
  }

  return rows;
}

function clearMap() {
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }
  if (markerLayer) markerLayer.clearLayers();
}

function makeMarker(number, label, latlng, isStart = false) {
  const colour = isStart ? "#51d88a" : "#ff7a00";
  const html = `<div style="
    width:30px;height:30px;border-radius:50%;
    background:${colour};color:#0a0d0f;
    display:grid;place-items:center;
    font-weight:900;font-size:11px;
    border:2px solid #10161b;
    box-shadow:0 3px 12px rgba(0,0,0,.35)
  ">${number}</div>`;

  const icon = L.divIcon({
    className: "",
    html,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });

  L.marker(latlng, { icon })
    .bindPopup(`<strong>${escapeHtml(label)}</strong>`)
    .addTo(markerLayer);
}

function drawMap(ordered, route) {
  clearMap();

  routeLine = L.geoJSON(route.geometry, {
    style: { color: "#ff7a00", weight: 5, opacity: .9 }
  }).addTo(map);

  ordered.forEach((stop, index) => {
    const isStart = index === 0 && stop.postcode === getStartPostcode();
    makeMarker(isStart ? "S" : index === ordered.length - 1 && stop.postcode === getStartPostcode() ? "H" : index, stop.postcode, [stop.latitude, stop.longitude], isStart);
  });

  const bounds = routeLine.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds.pad(.12));
}

function formatMiles(metres) {
  return (metres / 1609.344).toFixed(1);
}

function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) return `${mins} min`;
  return `${hours}h ${String(mins).padStart(2, "0")}m`;
}

function renderRouteList(routeRows) {
  els.routeList.className = "route-list";
  els.routeList.innerHTML = routeRows.map((row) => {
    const routeNumber = row.type === "start" ? "S" : row.type === "return" ? "H" : row.stopNumber;

    const addressParts = [row.houseUnit, row.street].filter(Boolean);
    const addressLine = addressParts.length ? `<div class="route-address">${escapeHtml(addressParts.join(" • "))}</div>` : "";
    const notesLine = row.notes ? `<div class="route-note">${escapeHtml(row.notes)}</div>` : "";

    const routeBadge = row.type === "start"
      ? "START / DEPOT"
      : row.type === "return"
        ? "HOME / START"
        : `DELIVERY ${row.stopNumber}`;

    const distanceText = row.distance == null ? "—" : `${formatMiles(row.distance)} mi`;
    const durationText = row.duration == null ? "—" : formatDuration(row.duration);

    return `
      <div class="route-item">
        <div class="route-number ${row.type === "start" ? "start" : row.type === "return" ? "return" : ""}">${routeNumber}</div>
        <div class="route-content">
          <div class="route-kicker">${routeBadge}</div>
          <div class="route-postcode">${escapeHtml(row.postcode)}</div>
          ${addressLine}
          ${notesLine}
        </div>
        <div class="route-legs">
          <div class="route-leg-value">${distanceText}</div>
          <div class="route-leg-time">${durationText}</div>
        </div>
      </div>
    `;
  }).join("");

  lastOrderedStops = routeRows.filter(row => row.type === "delivery").map(row => ({
    postcode: row.postcode,
    houseUnit: row.houseUnit,
    street: row.street,
    notes: row.notes
  }));

  els.navigation.disabled = lastOrderedStops.length === 0;
}

function renderRouteOptions() {
  if (!routeState) {
    els.routeOptionFastest.disabled = true;
    els.routeOptionShortest.disabled = true;
    els.routeOptionFastest.classList.remove("is-selected");
    els.routeOptionShortest.classList.remove("is-selected");
    els.startDriverMode.hidden = true;
    return;
  }

  const fastestAvailable = Boolean(routeState.fastest);
  const shortestAvailable = Boolean(routeState.shortest);

  els.routeOptionFastest.disabled = !fastestAvailable;
  els.routeOptionShortest.disabled = !shortestAvailable;

  const selectedFastest = routeState.selected === "fastest";

  els.routeOptionFastest.classList.toggle("is-selected", selectedFastest);
  els.routeOptionShortest.classList.toggle("is-selected", !selectedFastest);

  els.startDriverMode.hidden = !(routeState && routeState.fastest && routeState.shortest);
}

function updateRouteSummaryCards(selectedRoute) {
  if (!selectedRoute) {
    els.selectedRouteLabel.textContent = "—";
    els.summaryTotalMiles.textContent = "—";
    els.summaryDrivingTime.textContent = "—";
    els.summaryDeliveries.textContent = "—";
    els.summaryStart.textContent = "—";
    els.summaryReturn.textContent = "—";
    return;
  }

  els.selectedRouteLabel.textContent = selectedRoute.type === "fastest" ? "Fastest" : "Shortest";
  els.summaryTotalMiles.textContent = `${formatMiles(selectedRoute.route.distance)} mi`;
  els.summaryDrivingTime.textContent = formatDuration(selectedRoute.route.duration);
  els.summaryDeliveries.textContent = String(selectedRoute.deliveryCount);
  els.summaryStart.textContent = selectedRoute.startPostcode || "—";
  els.summaryReturn.textContent = selectedRoute.returnToStart ? "Enabled" : "Disabled";
}

function renderSelectedRoute() {
  if (!routeState) {
    updateRouteSummaryCards(null);
    return;
  }

  const selectedRoute = routeState[routeState.selected];

  if (!selectedRoute) {
    updateRouteSummaryCards(null);
    return;
  }

  routeSummary = {
    totalDistance: selectedRoute.route.distance,
    totalDuration: selectedRoute.route.duration,
    deliveryCount: selectedRoute.deliveryCount,
    startPostcode: selectedRoute.startPostcode,
    returnToStart: selectedRoute.returnToStart,
    routeRows: selectedRoute.routeRows,
    route: selectedRoute.route,
    selectedRouteType: selectedRoute.type
  };

  drawMap(selectedRoute.plan.orderedPoints, selectedRoute.route);
  renderRouteList(selectedRoute.routeRows);

  els.distance.textContent = formatMiles(selectedRoute.route.distance);
  els.duration.textContent = formatDuration(selectedRoute.route.duration);
  els.routeStops.textContent = String(selectedRoute.deliveryCount);
  els.routeStatus.textContent = `${selectedRoute.type === "fastest" ? "Fastest" : "Shortest"} route ready`;
  renderRouteOptions();
  updateRouteSummaryCards(selectedRoute);
}

function resetResults() {
  clearMap();
  lastOrderedStops = [];
  routeState = null;
  routeSummary = null;
  driverModeState = null;
  els.driverModeOverlay.hidden = true;
  persistDriverModeState();
  els.distance.textContent = "—";
  els.duration.textContent = "—";
  els.routeStops.textContent = "—";
  els.routeStatus.textContent = "Waiting for stops";
  els.routeList.className = "empty-state";
  els.routeList.innerHTML = `<div class="empty-icon">☷</div><p>Your optimised stops will appear here.</p>`;
  els.navigation.disabled = true;
  updateRouteSummaryCards(null);
  renderRouteOptions();
}

function escapeCsv(value) {
  const stringValue = String(value ?? "");
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function getSavedRoutes() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_ROUTES_STORAGE_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch (error) {
    console.error("Could not load saved routes", error);
    return [];
  }
}

function persistSavedRoutes() {
  localStorage.setItem(SAVED_ROUTES_STORAGE_KEY, JSON.stringify(savedRoutes));
  renderSavedRoutesList();
}

function renderSavedRoutesList() {
  const selectedValue = els.savedRoutesList.value;

  els.savedRoutesList.innerHTML = "";

  if (!savedRoutes.length) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "No saved routes";
    els.savedRoutesList.appendChild(emptyOption);
  } else {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a saved route";
    els.savedRoutesList.appendChild(placeholder);

    savedRoutes.forEach((route) => {
      const option = document.createElement("option");
      option.value = route.id;
      option.textContent = route.name;
      els.savedRoutesList.appendChild(option);
    });
  }

  els.loadSavedRoute.disabled = savedRoutes.length === 0;
  els.deleteSavedRoute.disabled = savedRoutes.length === 0;

  if (savedRoutes.length && selectedValue && savedRoutes.some(route => route.id === selectedValue)) {
    els.savedRoutesList.value = selectedValue;
  } else {
    els.savedRoutesList.value = "";
  }
}

function handleSaveRoute() {
  if (!routeState) {
    showToast("Create a route before saving it.");
    return;
  }

  const routeName = (els.routeNameInput.value || "").trim() || `Route ${savedRoutes.length + 1}`;
  const payload = JSON.parse(JSON.stringify(routeState));

  savedRoutes = [{
    id: Date.now().toString(),
    name: routeName,
    routeState: payload,
    savedAt: new Date().toISOString()
  }, ...savedRoutes];

  els.routeNameInput.value = "";
  persistSavedRoutes();
  showToast(`Saved route "${routeName}".`);
}

function handleLoadSavedRoute() {
  const selectedId = els.savedRoutesList.value;
  if (!selectedId) {
    showToast("Choose a saved route first.");
    return;
  }

  const savedRoute = savedRoutes.find(route => route.id === selectedId);
  if (!savedRoute) {
    showToast("That saved route could not be found.");
    return;
  }

  routeState = JSON.parse(JSON.stringify(savedRoute.routeState));
  routeSummary = {
    totalDistance: routeState[routeState.selected].route.distance,
    totalDuration: routeState[routeState.selected].route.duration,
    deliveryCount: routeState[routeState.selected].deliveryCount,
    startPostcode: routeState[routeState.selected].startPostcode,
    returnToStart: routeState[routeState.selected].returnToStart,
    routeRows: routeState[routeState.selected].routeRows,
    route: routeState[routeState.selected].route,
    selectedRouteType: routeState[routeState.selected].type
  };

  driverModeState = null;
  persistDriverModeState();
  renderSelectedRoute();
  showToast(`Loaded saved route "${savedRoute.name}".`);
}

function handleDeleteSavedRoute() {
  const selectedId = els.savedRoutesList.value;
  if (!selectedId) {
    showToast("Choose a saved route first.");
    return;
  }

  const routeToDelete = savedRoutes.find(route => route.id === selectedId);
  if (!routeToDelete) {
    showToast("That saved route could not be found.");
    return;
  }

  savedRoutes = savedRoutes.filter(route => route.id !== selectedId);
  persistSavedRoutes();
  showToast(`Deleted saved route "${routeToDelete.name}".`);
}

function handleUseCurrentLocation() {
  if (!navigator.geolocation) {
    showToast("Geolocation is not supported on this device.");
    return;
  }

  if (!map) {
    showToast("The map is still loading. Please try again.");
    return;
  }

  navigator.geolocation.getCurrentPosition((position) => {
    currentLocation = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude
    };

    if (locationMarker) {
      map.removeLayer(locationMarker);
    }

    locationMarker = L.circleMarker([currentLocation.latitude, currentLocation.longitude], {
      radius: 10,
      color: "#2dd4bf",
      fillColor: "#2dd4bf",
      fillOpacity: 0.9,
      weight: 3
    }).addTo(markerLayer);

    locationMarker.bindPopup("Current location").openPopup();
    map.flyTo([currentLocation.latitude, currentLocation.longitude], 12, { duration: 0.6 });

    showToast("Current location captured.");
  }, () => {
    showToast("Location access was blocked. Please allow geolocation to use this feature.");
  }, {
    enableHighAccuracy: true,
    timeout: 10000
  });
}

function handleRecalculateRemainingRoute() {
  if (!routeState) {
    showToast("Create a route first.");
    return;
  }

  if (!currentLocation) {
    showToast("Use your current location first so the route can be re-centred.");
    return;
  }

  showToast("Remaining route recalculation is not yet available with the current static routing setup. The current location has been marked on the map.");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.error("Could not register service worker", error);
    });
  });
}

function getDriverModeViewData() {
  if (!routeState || !routeSummary) return null;

  const routeKey = routeState.selected || "fastest";
  const selectedRoute = routeState[routeKey];

  if (!selectedRoute) return null;

  return {
    routeKey,
    selectedRoute,
    deliveryRows: selectedRoute.routeRows.filter(row => row.type === "delivery"),
    startPostcode: selectedRoute.startPostcode,
    returnToStart: selectedRoute.returnToStart,
    deliveryCount: selectedRoute.deliveryCount
  };
}

function persistDriverModeState() {
  if (!driverModeState) {
    localStorage.removeItem(DRIVER_MODE_STORAGE_KEY);
    return;
  }

  const snapshot = {
    routeKey: driverModeState.routeKey,
    completed: driverModeState.completed,
    currentIndex: driverModeState.currentIndex,
    returnLegVisible: driverModeState.returnLegVisible,
    returnLegCompleted: driverModeState.returnLegCompleted,
    routeSummary: {
      deliveryCount: driverModeState.routeSummary.deliveryCount,
      startPostcode: driverModeState.routeSummary.startPostcode,
      returnToStart: driverModeState.routeSummary.returnToStart,
      selectedRouteType: driverModeState.routeSummary.selectedRouteType
    },
    deliveryRows: driverModeState.deliveryRows,
    routeRows: driverModeState.routeRows
  };

  localStorage.setItem(DRIVER_MODE_STORAGE_KEY, JSON.stringify(snapshot));
}

function restoreDriverModeState() {
  try {
    const saved = JSON.parse(localStorage.getItem(DRIVER_MODE_STORAGE_KEY) || "null");
    if (!saved || !routeState) return null;

    const routeKey = saved.routeKey || "fastest";
    const routeSummaryData = routeState[routeKey];
    if (!routeSummaryData) return null;

    const deliveryRows = Array.isArray(saved.deliveryRows) && saved.deliveryRows.length
      ? saved.deliveryRows
      : routeSummaryData.routeRows.filter(row => row.type === "delivery");

    const routeRows = Array.isArray(saved.routeRows) && saved.routeRows.length
      ? saved.routeRows
      : routeSummaryData.routeRows;

    driverModeState = {
      routeKey,
      completed: Array.isArray(saved.completed) ? saved.completed : [],
      currentIndex: Number.isInteger(saved.currentIndex) ? saved.currentIndex : 0,
      returnLegVisible: Boolean(saved.returnLegVisible),
      returnLegCompleted: Boolean(saved.returnLegCompleted),
      routeSummary: {
        deliveryCount: routeSummaryData.deliveryCount,
        startPostcode: routeSummaryData.startPostcode,
        returnToStart: routeSummaryData.returnToStart,
        selectedRouteType: routeSummaryData.type
      },
      deliveryRows,
      routeRows
    };

    if (driverModeState.currentIndex >= driverModeState.deliveryRows.length) {
      driverModeState.currentIndex = Math.max(0, driverModeState.deliveryRows.length - 1);
    }

    if (
      driverModeState.routeSummary.returnToStart &&
      driverModeState.completed.length >= driverModeState.deliveryRows.length &&
      !driverModeState.returnLegCompleted
    ) {
      driverModeState.returnLegVisible = true;
    }

    return driverModeState;
  } catch (error) {
    console.error("Could not restore driver mode state", error);
    return null;
  }
}

function formatDriverStopDetails(row) {
  const distanceText = row.distance == null ? "—" : `${formatMiles(row.distance)} mi`;
  const durationText = row.duration == null ? "—" : formatDuration(row.duration);

  const addressParts = [row.houseUnit || "", row.street || ""].filter(Boolean);

  return {
    stopNumber: row.stopNumber,
    postcode: row.postcode || "—",
    houseUnit: row.houseUnit || "—",
    street: addressParts.join(" • ") || "—",
    notes: row.notes || "No delivery notes",
    distance: distanceText,
    duration: durationText
  };
}

function getCurrentDriverRow() {
  if (!driverModeState) return null;

  if (driverModeState.routeSummary.returnToStart && driverModeState.returnLegVisible) {
    return driverModeState.routeRows.find(row => row.type === "return") || null;
  }

  return driverModeState.deliveryRows[driverModeState.currentIndex] || null;
}

function getRemainingRouteTotals(currentRow) {
  if (!currentRow || !driverModeState?.routeRows?.length) {
    return { distance: 0, duration: 0 };
  }

  const startIndex = driverModeState.routeRows.indexOf(currentRow);
  if (startIndex === -1) {
    return { distance: 0, duration: 0 };
  }

  return driverModeState.routeRows.slice(startIndex).reduce((totals, row) => {
    if (row.distance != null) totals.distance += row.distance;
    if (row.duration != null) totals.duration += row.duration;
    return totals;
  }, { distance: 0, duration: 0 });
}

function renderDriverMode() {
  if (!driverModeState) {
    els.driverModeOverlay.hidden = true;
    return;
  }

  const completedCount = driverModeState.completed.length;
  const totalStops = driverModeState.deliveryRows.length;
  const isReturnMode = Boolean(driverModeState.routeSummary.returnToStart && driverModeState.returnLegVisible);
  const isRunComplete = driverModeState.returnLegCompleted || (!driverModeState.routeSummary.returnToStart && completedCount >= totalStops);

  const currentRow = getCurrentDriverRow();

  if (!currentRow) {
    els.driverModeOverlay.hidden = true;
    return;
  }

  const details = formatDriverStopDetails(currentRow);
  const remainingRoute = getRemainingRouteTotals(currentRow);
  const remainingRouteDistanceText = remainingRoute.distance > 0 ? `${formatMiles(remainingRoute.distance)} mi` : "—";
  const remainingRouteDurationText = remainingRoute.duration > 0 ? formatDuration(remainingRoute.duration) : "—";
  const deliveryProgressText = `${completedCount} / ${totalStops} complete`;

  els.driverModeProgress.textContent = deliveryProgressText;

  if (isRunComplete) {
    els.driverModeStatus.textContent = "RUN COMPLETE";
  } else if (isReturnMode) {
    els.driverModeStatus.textContent = "Return to depot/home";
  } else {
    els.driverModeStatus.textContent = `Current delivery ${driverModeState.currentIndex + 1} of ${totalStops}`;
  }

  els.driverStopNumber.textContent = isReturnMode ? "Return / Depot" : `Delivery ${details.stopNumber} of ${totalStops}`;
  els.driverPostcode.textContent = details.postcode;
  els.driverHouseUnit.textContent = details.houseUnit;
  els.driverStreet.textContent = details.street;
  els.driverNotes.textContent = details.notes;
  els.driverDistance.textContent = details.distance;
  els.driverDuration.textContent = details.duration;
  els.driverRemainingDistance.textContent = remainingRouteDistanceText;
  els.driverRemainingDuration.textContent = remainingRouteDurationText;
  els.driverRemainingStops.textContent = deliveryProgressText;

  els.driverModeRunComplete.hidden = !isRunComplete;
  els.driverModeCompleteText.textContent = driverModeState.routeSummary.returnToStart
    ? "The full route is complete, including the return journey."
    : `All ${totalStops} deliveries have been completed.`;
  els.driverModeReturnText.hidden = !driverModeState.routeSummary.returnToStart;
  if (driverModeState.routeSummary.returnToStart) {
    els.driverModeReturnText.textContent = "Return to depot/home";
  }

  els.driverModeNavigate.disabled = !currentRow;
  els.driverModePrevious.disabled = isRunComplete || (driverModeState.currentIndex <= 0 && !isReturnMode);
  els.driverModeNext.disabled = isRunComplete || (isReturnMode && !driverModeState.routeSummary.returnToStart);

  if (!isRunComplete && !isReturnMode) {
    els.driverModeNext.disabled = driverModeState.currentIndex >= totalStops - 1;
  }

  if (isRunComplete) {
    els.driverModeNext.disabled = true;
    els.driverModeMarkDelivered.disabled = true;
  } else {
    els.driverModeMarkDelivered.disabled = false;
  }

  els.driverModeReturnHome.hidden = !driverModeState.routeSummary.returnToStart || !isRunComplete;
  if (driverModeState.routeSummary.returnToStart && isRunComplete) {
    els.driverModeReturnHome.textContent = "NAVIGATE TO START";
  }
}

function openDriverMode() {
  const viewData = getDriverModeViewData();
  if (!viewData) {
    showToast("Create a route first.");
    return;
  }

  const saved = restoreDriverModeState();

  if (!saved) {
    driverModeState = {
      routeKey: viewData.routeKey,
      completed: [],
      currentIndex: 0,
      returnLegVisible: false,
      returnLegCompleted: false,
      routeSummary: {
        deliveryCount: viewData.deliveryCount,
        startPostcode: viewData.startPostcode,
        returnToStart: viewData.returnToStart,
        selectedRouteType: viewData.selectedRoute.type
      },
      deliveryRows: viewData.deliveryRows,
      routeRows: viewData.selectedRoute.routeRows
    };
  }

  persistDriverModeState();
  renderDriverMode();
  els.driverModeOverlay.hidden = false;
}

function closeDriverMode() {
  els.driverModeOverlay.hidden = true;
}

function openDriverNavigation() {
  if (!driverModeState) return;

  const currentStop = driverModeState.deliveryRows[driverModeState.currentIndex];
  if (!currentStop) return;

  const destinationText = [currentStop.houseUnit, currentStop.street, currentStop.postcode].filter(Boolean).join(", ");
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destinationText || currentStop.postcode)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function navigateToStart() {
  if (!driverModeState || !driverModeState.routeSummary.startPostcode) return;

  const startPostcode = driverModeState.routeSummary.startPostcode;
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(startPostcode)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function markCurrentStopDelivered() {
  if (!driverModeState) return;

  const totalStops = driverModeState.deliveryRows.length;

  if (driverModeState.returnLegVisible) {
    driverModeState.returnLegCompleted = true;
    persistDriverModeState();
    renderDriverMode();
    return;
  }

  if (driverModeState.completed.length >= totalStops) {
    return;
  }

  const currentStop = driverModeState.deliveryRows[driverModeState.currentIndex];
  if (!currentStop) return;

  driverModeState.completed = [...driverModeState.completed, currentStop.postcode];

  if (driverModeState.currentIndex < totalStops - 1) {
    driverModeState.currentIndex += 1;
  } else if (driverModeState.routeSummary.returnToStart) {
    driverModeState.returnLegVisible = true;
  } else {
    driverModeState.returnLegCompleted = true;
  }

  persistDriverModeState();
  renderDriverMode();
}

function moveDriverMode(direction) {
  if (!driverModeState) return;

  const totalStops = driverModeState.deliveryRows.length;

  if (driverModeState.returnLegVisible) {
    if (direction === "previous") {
      driverModeState.returnLegVisible = false;
      driverModeState.currentIndex = Math.max(0, totalStops - 1);
    }

    persistDriverModeState();
    renderDriverMode();
    return;
  }

  if (direction === "previous") {
    driverModeState.currentIndex = Math.max(0, driverModeState.currentIndex - 1);
  }

  if (direction === "next") {
    if (driverModeState.currentIndex < totalStops - 1) {
      driverModeState.currentIndex += 1;
    } else if (driverModeState.routeSummary.returnToStart && driverModeState.completed.length >= totalStops) {
      driverModeState.returnLegVisible = true;
    }
  }

  persistDriverModeState();
  renderDriverMode();
}

function handleDriverModeStateInit() {
  const saved = restoreDriverModeState();
  if (saved) {
    renderDriverMode();
    els.driverModeOverlay.hidden = false;
  }
}

function updateDriverModeButtonState() {
  if (!routeState) {
    els.startDriverMode.hidden = true;
    return;
  }

  const hasRoute = Boolean(routeState.fastest && routeState.shortest);
  els.startDriverMode.hidden = !hasRoute;
}

function downloadRouteCsv() {
  if (!routeSummary) return;

  const summaryRows = [
    ["Route summary", "", "", "", "", "", ""],
    ["Total miles", formatMiles(routeSummary.totalDistance), "", "", "", "", ""],
    ["Total driving time", formatDuration(routeSummary.totalDuration), "", "", "", "", ""],
    ["Number of deliveries", routeSummary.deliveryCount, "", "", "", "", ""],
    ["Start / depot", routeSummary.startPostcode || "—", "", "", "", "", ""],
    ["Return to start", routeSummary.returnToStart ? "Enabled" : "Disabled", "", "", "", "", ""]
  ];

  const headers = [
    "Stop number",
    "House/unit",
    "Street/address",
    "Postcode",
    "Notes",
    "Distance from previous stop",
    "Driving time from previous stop"
  ];

  const detailRows = routeSummary.routeRows.map((row) => {
    const stopNumber = row.type === "start" ? "S" : row.type === "return" ? "H" : row.stopNumber;
    const distance = row.distance == null ? "" : `${formatMiles(row.distance)} mi`;
    const duration = row.duration == null ? "" : formatDuration(row.duration);

    return [
      stopNumber,
      row.houseUnit,
      row.street,
      row.postcode,
      row.notes,
      distance,
      duration
    ];
  });

  const csvRows = [
    ...summaryRows,
    ["", "", "", "", "", "", ""],
    headers,
    ...detailRows,
    ["", "", "", "", "", "", ""],
    ["Route summary", "", "", "", "", "", ""],
    ["Total miles", formatMiles(routeSummary.totalDistance), "", "", "", "", ""],
    ["Total driving time", formatDuration(routeSummary.totalDuration), "", "", "", "", ""],
    ["Number of deliveries", routeSummary.deliveryCount, "", "", "", "", ""],
    ["Start / depot", routeSummary.startPostcode || "—", "", "", "", "", ""],
    ["Return to start", routeSummary.returnToStart ? "Enabled" : "Disabled", "", "", "", "", ""]
  ];

  const csvContent = csvRows
    .map(row => row.map(escapeCsv).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "routeflex-route.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function handleOptimise() {
  if (busy) return;

  const deliveryStops = getDeliveryStops();
  const startPostcode = getStartPostcode();

  if (deliveryStops.length === 0) {
    showToast("Add at least one delivery postcode.");
    return;
  }

  const deliveryPostcodes = deliveryStops.map(stop => stop.postcode);

  if (new Set(deliveryPostcodes).size !== deliveryPostcodes.length) {
    showToast("You have entered a duplicate delivery postcode.");
    return;
  }

  setBusy(true);
  els.routeStatus.textContent = "Checking postcodes…";

  try {
    const lookupPostcodesList = startPostcode ? [startPostcode, ...deliveryPostcodes] : deliveryPostcodes;
    const results = await lookupPostcodes(lookupPostcodesList);

    const invalid = results.filter(result => !result.valid);
    if (invalid.length) {
      throw new Error(`Postcode not found: ${invalid.map(item => item.input).join(", ")}`);
    }

    const { startPoint, points } = buildPointEntries(results, deliveryStops, startPostcode);
    const startIndex = startPoint ? 0 : null;
    const returnToStart = els.returnToStart.checked && Boolean(startPoint);

    driverModeState = null;
    persistDriverModeState();

    els.routeStatus.textContent = "Optimising road order…";
    const matrix = await getTravelMatrix(points);

    const fastestPlan = solveRouteOrder(points, matrix, "duration", startIndex, returnToStart);
    const shortestPlan = solveRouteOrder(points, matrix, "distance", startIndex, returnToStart);

    els.routeStatus.textContent = "Building final road route…";

    const fastestRoute = await getRoadRoute(fastestPlan.orderedPoints);
    const shortestRoute = await getRoadRoute(shortestPlan.orderedPoints);

    const fastestRows = buildRouteRows(fastestPlan, points, startPoint, returnToStart, matrix);
    const shortestRows = buildRouteRows(shortestPlan, points, startPoint, returnToStart, matrix);

    routeState = {
      selected: "fastest",
      fastest: {
        type: "fastest",
        deliveryCount: deliveryStops.length,
        startPostcode,
        returnToStart,
        route: fastestRoute,
        plan: fastestPlan,
        routeRows: fastestRows
      },
      shortest: {
        type: "shortest",
        deliveryCount: deliveryStops.length,
        startPostcode,
        returnToStart,
        route: shortestRoute,
        plan: shortestPlan,
        routeRows: shortestRows
      }
    };

    renderSelectedRoute();

    const routeSummaryText = returnToStart
      ? `Route ready — ${deliveryStops.length} delivery stop${deliveryStops.length === 1 ? "" : "s"}.`
      : `Route ready — ${deliveryStops.length} delivery stop${deliveryStops.length === 1 ? "" : "s"} with no return leg.`;

    showToast(routeSummaryText);
  } catch (error) {
    console.error(error);
    els.routeStatus.textContent = "Route failed";
    showToast(error.message || "Something went wrong.");
  } finally {
    setBusy(false);
  }
}

function toggleMapExpansion() {
  const mapPanel = document.querySelector(".map-panel");
  if (!mapPanel) return;

  mapPanel.classList.toggle("is-expanded");
  document.body.classList.toggle("map-expanded", mapPanel.classList.contains("is-expanded"));

  if (mapPanel.classList.contains("is-expanded")) {
    els.expandMap.textContent = "Collapse map";
  } else {
    els.expandMap.textContent = "Expand map";
  }

  if (map) {
    map.invalidateSize();
    if (routeLine) {
      const bounds = routeLine.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds.pad(.12));
    }
  }
}

els.addStop.addEventListener("click", () => addStop());
els.optimise.addEventListener("click", handleOptimise);
els.downloadRoute.addEventListener("click", downloadRouteCsv);
els.expandMap.addEventListener("click", toggleMapExpansion);
els.routeOptionFastest.addEventListener("click", () => {
  if (!routeState || routeState.selected === "fastest") return;
  routeState.selected = "fastest";
  renderSelectedRoute();
});
els.routeOptionShortest.addEventListener("click", () => {
  if (!routeState || routeState.selected === "shortest") return;
  routeState.selected = "shortest";
  renderSelectedRoute();
});
els.startDriverMode.addEventListener("click", openDriverMode);
els.exitDriverMode.addEventListener("click", closeDriverMode);
els.driverModeNavigate.addEventListener("click", openDriverNavigation);
els.driverModePrevious.addEventListener("click", () => moveDriverMode("previous"));
els.driverModeNext.addEventListener("click", () => moveDriverMode("next"));
els.driverModeMarkDelivered.addEventListener("click", markCurrentStopDelivered);
els.driverModeReturnHome.addEventListener("click", navigateToStart);
els.useCurrentLocation.addEventListener("click", handleUseCurrentLocation);
els.recalculateRemainingRoute.addEventListener("click", handleRecalculateRemainingRoute);
els.saveRoute.addEventListener("click", handleSaveRoute);
els.loadSavedRoute.addEventListener("click", handleLoadSavedRoute);
els.deleteSavedRoute.addEventListener("click", handleDeleteSavedRoute);

els.clear.addEventListener("click", () => {
  els.start.value = "";
  els.stops.innerHTML = "";
  els.returnToStart.checked = true;
  addStop();
  resetResults();
  updateCount();
});

els.example.addEventListener("click", () => {
  els.start.value = "PR3 0SG";
  els.stops.innerHTML = "";
  [
    { postcode: "M45 6GN", houseUnit: "", street: "", notes: "" },
    { postcode: "EX16 5BL", houseUnit: "", street: "", notes: "" }
  ].forEach(item => addStop(item));
  els.returnToStart.checked = true;
  resetResults();
  updateCount();
  showToast("Example route loaded.");
});

els.navigation.addEventListener("click", () => {
  if (!lastOrderedStops.length) return;
  const destination = lastOrderedStops[0];
  const destinationText = [destination.houseUnit, destination.street, destination.postcode].filter(Boolean).join(", ");
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destinationText || destination.postcode)}`;
  window.open(url, "_blank", "noopener,noreferrer");
});

els.start.addEventListener("input", () => {
  els.start.value = els.start.value.toUpperCase();
});

initMap();
addStop();
bindVoiceInput(els.start, document.getElementById("start-voice-button"));
els.returnToStart.checked = true;
savedRoutes = getSavedRoutes();
renderSavedRoutesList();
updateRouteSummaryCards(null);
renderRouteOptions();
updateCount();
handleDriverModeStateInit();
registerServiceWorker();
