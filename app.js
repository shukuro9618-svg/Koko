const DB_NAME = "koko-gps";
const STORE = "farewells";
const UNLOCK_METERS = 45;
const RECORDING_SECONDS = 5;
const DEMO_POSITION = {
  latitude: 35.6916,
  longitude: 139.7358,
  address: "東京都新宿区市谷田町 1丁目",
};
const FALLBACK_ADDRESS = "現在地の住所を取得中";
const params = new URLSearchParams(window.location.search);

const depositButton = document.querySelector("#depositButton");
const nearbyCard = document.querySelector("#nearbyCard");
const privacyNote = document.querySelector("#privacyNote");
const quietStatus = document.querySelector("#quietStatus");
const mapShell = document.querySelector("#mapShell");
const realMapElement = document.querySelector("#realMap");
const ritual = document.querySelector("#ritual");
const preview = document.querySelector("#preview");
const countdown = document.querySelector("#countdown");
const recordingState = document.querySelector("#recordingState");
const closeRitual = document.querySelector("#closeRitual");
const switchCamera = document.querySelector("#switchCamera");
const startCapture = document.querySelector("#startCapture");
const ritualPlace = document.querySelector("#ritualPlace");
const captureHint = document.querySelector("#captureHint");
const player = document.querySelector("#player");
const playback = document.querySelector("#playback");
const playerCaption = document.querySelector("#playerCaption");
const closePlayer = document.querySelector("#closePlayer");

let dbPromise;
let currentPosition = null;
let nearbyFarewell = null;
let activeStream = null;
let activeRecorder = null;
let activeTimer = null;
let recordingCancelled = false;
let pendingFarewell = null;
let demoNearby = params.has("nearby");
let cameraFacingMode = "environment";
let mapReady = false;
let mapZoom = 15;
let mapPosition = { ...DEMO_POSITION };
let zoomRemainder = 0;
const activePointers = new Map();
let pinchStartDistance = null;
let pinchStartZoom = mapZoom;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function saveFarewell(farewell) {
  const db = await openDb();

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(farewell);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function listFarewells() {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function distanceMeters(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earth = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * earth * Math.asin(Math.sqrt(h));
}

function setStatus(message) {
  quietStatus.textContent = message;
}

function initRealMap() {
  if (!realMapElement || mapReady) return;
  mapPosition = { ...DEMO_POSITION };
  renderTileBackground(mapPosition);
  mapReady = true;
  mapShell.classList.add("map-ready");
}

function updateRealMap(position) {
  if (!position) return;
  mapPosition = position;
  renderTileBackground(mapPosition);
  mapReady = true;
  mapShell.classList.add("map-ready");
}

function setMapZoom(nextZoom) {
  const boundedZoom = Math.min(17, Math.max(13, Math.round(nextZoom)));
  if (boundedZoom === mapZoom) return;

  mapZoom = boundedZoom;
  renderTileBackground(mapPosition);
}

function lonLatToWorldPixel(latitude, longitude, zoom) {
  const tileSize = 256;
  const scale = tileSize * 2 ** zoom;
  const sin = Math.sin((latitude * Math.PI) / 180);
  const x = ((longitude + 180) / 360) * scale;
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;

  return { x, y };
}

function renderTileBackground(position) {
  if (!realMapElement) return;

  const zoom = mapZoom;
  const tileSize = 256;
  const subdomains = ["a", "b", "c", "d"];
  const tilesPerSide = 2 ** zoom;
  const rect = realMapElement.getBoundingClientRect();
  const width = Math.max(rect.width, 390);
  const height = Math.max(rect.height, 844);
  const center = lonLatToWorldPixel(position.latitude, position.longitude, zoom);
  const leftWorld = center.x - width / 2;
  const topWorld = center.y - height / 2;
  const minX = Math.floor(leftWorld / tileSize);
  const maxX = Math.floor((center.x + width / 2) / tileSize);
  const minY = Math.floor(topWorld / tileSize);
  const maxY = Math.floor((center.y + height / 2) / tileSize);
  const fragment = document.createDocumentFragment();

  realMapElement.replaceChildren();

  for (let y = minY; y <= maxY; y += 1) {
    if (y < 0 || y >= tilesPerSide) continue;

    for (let x = minX; x <= maxX; x += 1) {
      const wrappedX = ((x % tilesPerSide) + tilesPerSide) % tilesPerSide;
      const img = document.createElement("img");
      const subdomain = subdomains[Math.abs(x + y) % subdomains.length];
      img.alt = "";
      img.decoding = "async";
      img.draggable = false;
      img.src = `https://${subdomain}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/${zoom}/${wrappedX}/${y}.png`;
      img.style.left = `${Math.round(x * tileSize - leftWorld)}px`;
      img.style.top = `${Math.round(y * tileSize - topWorld)}px`;
      fragment.appendChild(img);
    }
  }

  realMapElement.appendChild(fragment);
}

function setupMapZoomGestures() {
  mapShell.addEventListener(
    "wheel",
    (event) => {
      if (ritual && !ritual.classList.contains("hidden")) return;
      if (player && !player.classList.contains("hidden")) return;

      event.preventDefault();
      zoomRemainder += event.deltaY;

      if (Math.abs(zoomRemainder) < 80) return;

      const direction = zoomRemainder > 0 ? -1 : 1;
      zoomRemainder = 0;
      setMapZoom(mapZoom + direction);
    },
    { passive: false },
  );

  mapShell.addEventListener("pointerdown", (event) => {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.size === 2) {
      const [a, b] = Array.from(activePointers.values());
      pinchStartDistance = Math.hypot(a.x - b.x, a.y - b.y);
      pinchStartZoom = mapZoom;
    }
  });

  mapShell.addEventListener("pointermove", (event) => {
    if (!activePointers.has(event.pointerId)) return;

    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.size !== 2 || !pinchStartDistance) return;

    const [a, b] = Array.from(activePointers.values());
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const ratio = distance / pinchStartDistance;

    if (ratio > 1.18) {
      setMapZoom(pinchStartZoom + 1);
    } else if (ratio < 0.84) {
      setMapZoom(pinchStartZoom - 1);
    }
  });

  const clearPointer = (event) => {
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) {
      pinchStartDistance = null;
      pinchStartZoom = mapZoom;
    }
  };

  mapShell.addEventListener("pointerup", clearPointer);
  mapShell.addEventListener("pointercancel", clearPointer);
  mapShell.addEventListener("pointerleave", clearPointer);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}

function formatPlace(position) {
  if (!position) return "場所不明";
  if (position.address) return position.address;

  return formatCoordinates(position);
}

function formatMunicipality(position) {
  if (position?.address) return position.address;

  return formatCoordinates(position);
}

function formatCoordinates(position) {
  if (!position) return "場所不明";

  return `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`;
}

function normalizeJapaneseAddress(data) {
  const parts = [
    data.principalSubdivision,
    data.city || data.locality,
    data.localityInfo?.administrative?.find((item) => item.adminLevel === 10)?.name,
    data.localityInfo?.administrative?.find((item) => item.adminLevel === 11)?.name,
  ].filter(Boolean);

  return Array.from(new Set(parts)).join("");
}

function normalizeNominatimAddress(data) {
  const address = data.address || {};
  const district = address.city_district || address.suburb || address.quarter || address.neighbourhood;
  const road = cleanRoadName(address.road);
  const parts = [
    address.state || address.province,
    address.city || address.town || address.village || address.county,
    district,
    road,
  ].filter(Boolean);

  const uniqueParts = Array.from(new Set(parts));
  const addressText = uniqueParts.join("");

  if (address.country_code === "jp" && !/^[^都道府県]+[都道府県]/.test(addressText)) {
    return `東京都${addressText}`;
  }

  return addressText;
}

function cleanRoadName(road) {
  if (!road) return "";
  if (/[;；]/.test(road)) return "";
  if (/[0-9０-９]+階/.test(road)) return "";
  if (/エレベーター|エスカレーター|改札|ホーム|出口|入口/.test(road)) return "";

  return road;
}

function hasDetailedAddress(address) {
  if (!address) return false;

  return /[区市町村]/.test(address) && address.length > 4;
}

async function fetchNominatimAddress(position) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(position.latitude));
  url.searchParams.set("lon", String(position.longitude));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "ja");

  const response = await fetch(url);
  if (!response.ok) return "";

  return normalizeNominatimAddress(await response.json());
}

async function fetchBigDataCloudAddress(position) {
  const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
  url.searchParams.set("latitude", String(position.latitude));
  url.searchParams.set("longitude", String(position.longitude));
  url.searchParams.set("localityLanguage", "ja");

  const response = await fetch(url);
  if (!response.ok) return "";

  return normalizeJapaneseAddress(await response.json());
}

async function enrichPositionWithAddress(position) {
  if (!position || position.address) return position;

  try {
    const nominatimAddress = await fetchNominatimAddress(position);
    const address = hasDetailedAddress(nominatimAddress)
      ? nominatimAddress
      : await fetchBigDataCloudAddress(position);

    return address ? { ...position, address } : position;
  } catch {
    return position;
  }
}

function setPlayerMeta(farewell) {
  const date = formatDate(farewell.createdAt);
  const place = formatPlace(farewell.position);
  playerCaption.innerHTML = `
    <span>撮影日</span>
    <strong>${date}</strong>
    <span>撮影場所</span>
    <strong>${place}</strong>
  `;
}

function setRitualPlace(position) {
  ritualPlace.querySelector("strong").textContent = formatMunicipality(position);
  ritualPlace.classList.remove("hidden");
}

async function refreshNearby() {
  if (demoNearby && !nearbyFarewell) {
    nearbyFarewell = {
      id: "demo-nearby",
      blob: null,
      position: currentPosition || DEMO_POSITION,
      radius: UNLOCK_METERS,
      createdAt: new Date().toISOString(),
    };
    nearbyCard.classList.remove("hidden");
    mapShell.classList.remove("no-nearby");
    setStatus("この場所で預けられた別れがあります");
    return;
  }

  if (!currentPosition) return;

  const farewells = await listFarewells();
  nearbyFarewell = farewells.find((farewell) => {
    const distance = distanceMeters(currentPosition, farewell.position);
    return distance <= (farewell.radius || UNLOCK_METERS);
  });

  nearbyCard.classList.toggle("hidden", !nearbyFarewell);
  mapShell.classList.toggle("no-nearby", !nearbyFarewell);

  if (nearbyFarewell) {
    setStatus("この場所で預けられた別れがあります");
  } else {
    setStatus("地図だけが表示されています");
  }
}

function watchLocation() {
  initRealMap();

  if (!("geolocation" in navigator)) {
    updateRealMap(DEMO_POSITION);
    setStatus("位置情報を使えないため、場所の判定ができません");
    return;
  }

  navigator.geolocation.watchPosition(
    async (position) => {
      currentPosition = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      updateRealMap(currentPosition);
      enrichPositionWithAddress(currentPosition).then((enrichedPosition) => {
        currentPosition = enrichedPosition;
      });
      refreshNearby().catch(() => setStatus("預けた場所の確認に失敗しました"));
    },
    () => {
      if (demoNearby) updateRealMap(DEMO_POSITION);
      setStatus("位置情報を許可すると、場所に預けた動画だけ再生できます");
    },
    { enableHighAccuracy: true, maximumAge: 6000, timeout: 15000 },
  );
}

async function getPositionOnce() {
  if (currentPosition) return currentPosition;

  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("位置情報を使えません"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        currentPosition = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        resolve(currentPosition);
      },
      () => reject(new Error("位置情報が許可されていません")),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });
}

async function getRitualPosition() {
  try {
    const position = await getPositionOnce();
    const enrichedPosition = await enrichPositionWithAddress(position);
    currentPosition = enrichedPosition;
    return enrichedPosition;
  } catch (error) {
    if (demoNearby) return { ...DEMO_POSITION };
    throw error;
  }
}

function resetRecorderUi() {
  clearInterval(activeTimer);
  activeTimer = null;
  activeRecorder = null;
  pendingFarewell = null;
  countdown.textContent = String(RECORDING_SECONDS);
  countdown.hidden = false;
  recordingState.textContent = "カメラと位置情報を準備しています";
  startCapture.classList.remove("hidden");
  startCapture.disabled = true;
  startCapture.textContent = "撮影開始";
  startCapture.dataset.mode = "record";
  switchCamera.disabled = true;
  captureHint.textContent = "押してから5秒間だけ撮影します";
  ritualPlace.classList.add("hidden");
}

function stopStream() {
  if (!activeStream) return;
  activeStream.getTracks().forEach((track) => track.stop());
  activeStream = null;
  preview.srcObject = null;
}

async function openCameraStream() {
  stopStream();

  activeStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: cameraFacingMode } },
    audio: true,
  });
  preview.srcObject = activeStream;
  switchCamera.disabled = false;
}

async function toggleCamera() {
  if (activeRecorder?.state === "recording") return;
  if (startCapture.dataset.mode === "confirm") return;

  const previousFacingMode = cameraFacingMode;
  cameraFacingMode = cameraFacingMode === "environment" ? "user" : "environment";
  switchCamera.disabled = true;
  recordingState.textContent = cameraFacingMode === "user" ? "インカメラに切り替えています" : "外カメラに切り替えています";

  try {
    await openCameraStream();
    recordingState.textContent = cameraFacingMode === "user" ? "インカメラで撮影できます" : "外カメラで撮影できます";
    startCapture.disabled = false;
  } catch (error) {
    cameraFacingMode = previousFacingMode;
    try {
      await openCameraStream();
      recordingState.textContent = "この端末では切り替えられません";
      startCapture.disabled = false;
    } catch {
      recordingState.textContent = "カメラの許可が必要です";
      setStatus("カメラと位置情報の許可が必要です");
    }
  }
}

function closeRitualView() {
  if (activeRecorder && activeRecorder.state === "recording") {
    recordingCancelled = true;
    activeRecorder.stop();
    return;
  }
  stopStream();
  resetRecorderUi();
  ritual.classList.add("hidden");
}

async function startRitual() {
  ritual.classList.remove("hidden");
  resetRecorderUi();
  recordingCancelled = false;

  try {
    const position = await getRitualPosition();
    setRitualPlace(position);
    recordingState.textContent = "カメラが起動しました";

    await openCameraStream();
    startCapture.disabled = false;
    countdown.hidden = true;
  } catch (error) {
    recordingState.textContent = "カメラの許可が必要です";
    setStatus("カメラと位置情報の許可が必要です");
  }
}

async function startRecording() {
  if (!activeStream || activeRecorder?.state === "recording") return;

  try {
    const position = await getRitualPosition();
    setRitualPlace(position);
    recordingState.textContent = "5秒だけ録画しています";
    countdown.hidden = false;
    startCapture.disabled = true;
    switchCamera.disabled = true;
    captureHint.textContent = "撮影しています";

    const chunks = [];
    const options = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? { mimeType: "video/webm;codecs=vp9,opus" }
      : undefined;

    const recorder = new MediaRecorder(activeStream, options);
    activeRecorder = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = async () => {
      if (recordingCancelled) {
        stopStream();
        ritual.classList.add("hidden");
        resetRecorderUi();
        setStatus("預ける儀式を閉じました");
        return;
      }

      const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
      pendingFarewell = {
        id: crypto.randomUUID(),
        blob,
        position,
        radius: UNLOCK_METERS,
        createdAt: new Date().toISOString(),
      };
      stopStream();
      recordingState.textContent = "この場所に預けますか";
      countdown.hidden = true;
      startCapture.textContent = "預ける";
      startCapture.dataset.mode = "confirm";
      startCapture.disabled = false;
      switchCamera.disabled = true;
      captureHint.textContent = "この場所に預けますか";
    };

    let remaining = RECORDING_SECONDS;
    countdown.textContent = String(remaining);
    recorder.start();

    activeTimer = setInterval(() => {
      remaining -= 1;
      countdown.textContent = String(Math.max(remaining, 0));

      if (remaining <= 0) {
        clearInterval(activeTimer);
        activeTimer = null;
        recordingState.textContent = "この場所に預けています";
        recorder.stop();
      }
    }, 1000);
  } catch (error) {
    recordingState.textContent = error.message || "録画を開始できませんでした";
  }
}

async function confirmPendingDeposit() {
  if (!pendingFarewell) return;

  await saveFarewell(pendingFarewell);
  ritual.classList.add("hidden");
  resetRecorderUi();
  await refreshNearby();
  setStatus("この場所に別れを預けました");
}

function handleRitualAction() {
  if (startCapture.dataset.mode === "confirm") {
    confirmPendingDeposit();
    return;
  }

  startRecording();
}

function openPlayer() {
  if (demoNearby && nearbyFarewell && !nearbyFarewell.blob) {
    setPlayerMeta(nearbyFarewell);
    playback.removeAttribute("src");
    player.classList.remove("hidden");
    return;
  }

  if (!nearbyFarewell || !currentPosition) return;

  const distance = distanceMeters(currentPosition, nearbyFarewell.position);
  if (distance > (nearbyFarewell.radius || UNLOCK_METERS)) {
    setStatus("この場所に近づいた時だけ再生できます");
    return;
  }

  const url = URL.createObjectURL(nearbyFarewell.blob);
  playback.src = url;
  playback.onended = () => URL.revokeObjectURL(url);
  setPlayerMeta(nearbyFarewell);
  player.classList.remove("hidden");
  playback.play().catch(() => {});
}

function closePlayerView() {
  playback.pause();
  if (playback.src) URL.revokeObjectURL(playback.src);
  playback.removeAttribute("src");
  player.classList.add("hidden");
}

depositButton.addEventListener("click", startRitual);
closeRitual.addEventListener("click", closeRitualView);
switchCamera.addEventListener("click", toggleCamera);
startCapture.addEventListener("click", handleRitualAction);
nearbyCard.addEventListener("click", openPlayer);
privacyNote.addEventListener("click", () => {
  setStatus("預けた動画の場所は、地図上には表示されません");
});
closePlayer.addEventListener("click", closePlayerView);

openDb()
  .then(() => {
    setStatus("地図だけが表示されています");
    setupMapZoomGestures();
    initRealMap();
    if (demoNearby) updateRealMap(DEMO_POSITION);
    if (demoNearby) {
      nearbyCard.classList.remove("hidden");
      mapShell.classList.remove("no-nearby");
      nearbyFarewell = {
        id: "demo-nearby",
        blob: null,
        position: currentPosition || DEMO_POSITION,
        radius: UNLOCK_METERS,
        createdAt: new Date().toISOString(),
      };
      setStatus("この場所で預けられた別れがあります");
    }
    watchLocation();
  })
  .catch(() => setStatus("保存領域を準備できませんでした"));
